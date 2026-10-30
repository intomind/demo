//! One IntoMind One over Bluetooth. btleplug carries the bytes, and the
//! published crate's `Session` makes and reads every message, so nothing
//! here knows the protocol beyond which characteristic is which.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use btleplug::api::{Central, Characteristic, Manager as _, Peripheral as _, RetrievePeripheralsOptions, ScanFilter, WriteType};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use intomind::embeddings::Form;
use intomind::protocol::control::{HeadEntry, ModelInfo, Opcode, Status};
use intomind::protocol::device_info::{capability, DeviceInfo};
use intomind::protocol::{uuid128, uuid_fill};
use intomind::capture::record::{Run, Setup};
use intomind::capture::recording::Collection;
use intomind::{Command, Event, HostClocks, Session, Step, Transfer};
use tokio::sync::mpsc;
use uuid::Uuid;

/// How long a scan listens.
const SCAN: Duration = Duration::from_secs(5);
/// How long an answer may take.
const ANSWER: Duration = Duration::from_secs(5);
/// How long securing the link may take before it is called failed.
const SECURE: Duration = Duration::from_secs(15);

fn uuid(fill: u16) -> Uuid {
    Uuid::from_bytes(uuid128(fill))
}

fn fill_of(u: &Uuid) -> Option<u16> {
    let (b, base) = (u.as_bytes(), uuid128(0));
    (b[..2] == base[..2] && b[4..] == base[4..]).then(|| u16::from_be_bytes([b[2], b[3]]))
}

fn bt(e: btleplug::Error) -> String {
    format!("Bluetooth: {e}")
}

/// A connected IntoMind One.
pub struct Device {
    /// The name it was found by.
    pub name: String,
    /// What it says it is.
    pub info: DeviceInfo,
    peripheral: Peripheral,
    chars: HashMap<u16, Characteristic>,
    session: Arc<Mutex<Session>>,
    answers: tokio::sync::Mutex<mpsc::UnboundedReceiver<(u8, Status, Vec<u8>)>>,
    updates: tokio::sync::Mutex<mpsc::UnboundedReceiver<Vec<u8>>>,
    events: tokio::sync::Mutex<mpsc::UnboundedReceiver<Event>>,
    reader: tokio::task::JoinHandle<()>,
}

impl Device {
    /// Find the IntoMind One named `wanted`, or the only one that answers,
    /// pair with it if it is not paired yet, read what it is, and listen to it.
    pub async fn connect(wanted: Option<&str>) -> Result<Device, String> {
        let manager = Manager::new().await.map_err(bt)?;
        let central = manager.adapters().await.map_err(bt)?.into_iter().next()
            .ok_or("This computer has no Bluetooth adapter, or it is switched off.")?;
        let service = uuid(uuid_fill::SERVICE);
        // A device the system is already connected to does not advertise, so
        // no scan hears it. The system knows it, and is asked first.
        let mut candidates = central
            .retrieve_peripherals(RetrievePeripheralsOptions { identifiers: None, services: Some(vec![service]) })
            .await
            .unwrap_or_default();
        central.start_scan(ScanFilter { services: vec![service] }).await.map_err(bt)?;
        tokio::time::sleep(SCAN).await;
        candidates.extend(central.peripherals().await.map_err(bt)?);
        let mut found: Vec<(Peripheral, String)> = Vec::new();
        for p in candidates {
            if found.iter().any(|(q, _)| q.id() == p.id()) {
                continue;
            }
            let Ok(Some(props)) = p.properties().await else { continue };
            // The system remembers devices it has met before. Only one heard
            // in this scan, which has a signal strength, or one the system
            // holds a connection to, is here now. Read while the scan still
            // runs: the system forgets a signal strength when a scan stops.
            let held = p.is_connected().await.unwrap_or(false);
            if !held && (props.rssi.is_none() || !props.services.contains(&service)) {
                continue;
            }
            found.push((p, props.local_name.or(props.advertisement_name).unwrap_or_else(|| "IntoMind One".into())));
        }
        let _ = central.stop_scan().await;
        if found.is_empty() {
            return Err("No IntoMind device answered. Turn it on and take it off the charger.".into());
        }
        let names = intomind::display_names(&found.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>());
        let at = match wanted {
            None if found.len() > 1 => return Err(format!("Several devices answered: {}. Pass one of their names.", names.join(", "))),
            None => 0,
            Some(w) => names.iter().position(|n| n == w).ok_or_else(|| format!("No device named {w:?}. Heard: {}", names.join(", ")))?,
        };
        let (peripheral, _) = found.swap_remove(at);
        let name = names[at].clone();
        peripheral.connect().await.map_err(bt)?;
        // Every characteristic but Device Info needs an encrypted, bonded
        // link. On Linux the system pairs only for a program that answers
        // for the computer, and `pairing` does that. Elsewhere the system
        // pairs by itself at the first encrypted operation below.
        #[cfg(target_os = "linux")]
        let note = crate::pairing::pair(&peripheral.address().to_string(), Duration::from_secs(20)).await;
        #[cfg(not(target_os = "linux"))]
        let note = String::from("the system pairs by itself");
        peripheral.discover_services().await.map_err(bt)?;
        let chars: HashMap<u16, Characteristic> = peripheral
            .characteristics()
            .into_iter()
            .filter(|c| c.service_uuid == service)
            .filter_map(|c| fill_of(&c.uuid).map(|f| (f, c)))
            .collect();
        let read = chars.get(&uuid_fill::DEVICE_INFO).ok_or("This device has no Device Info, so it is not an IntoMind device.")?;
        let mut session = Session::new();
        let info = session.on_device_info(&peripheral.read(read).await.map_err(bt)?).map_err(|e| format!("{e:?}"))?;
        let session = Arc::new(Mutex::new(session));

        let mut stream = peripheral.notifications().await.map_err(bt)?;
        let (answer_tx, answers) = mpsc::unbounded_channel();
        let (update_tx, updates) = mpsc::unbounded_channel();
        let (event_tx, events) = mpsc::unbounded_channel();
        let shared = session.clone();
        let reader = tokio::spawn(async move {
            while let Some(n) = stream.next().await {
                let Some(fill) = fill_of(&n.uuid) else { continue };
                if fill == uuid_fill::UPDATE_CONTROL {
                    let _ = update_tx.send(n.value);
                    continue;
                }
                let arrived = shared.lock().unwrap().on_notification(fill, &n.value);
                for e in arrived {
                    match e {
                        Event::Answer { opcode, status, payload } => {
                            let _ = answer_tx.send((opcode, status, payload));
                        }
                        other => {
                            let _ = event_tx.send(other);
                        }
                    }
                }
            }
        });

        let answer = chars.get(&uuid_fill::CONTROL_RSP).ok_or("This device has no control answers.")?;
        match tokio::time::timeout(SECURE, peripheral.subscribe(answer)).await {
            Ok(Ok(())) => {}
            failed => {
                let why = match failed {
                    Ok(Err(e)) => e.to_string(),
                    _ => format!("no answer within {} s", SECURE.as_secs()),
                };
                let _ = peripheral.disconnect().await;
                return Err(format!(
                    "The link could not be secured ({why}, {note}). Remove the device from the computer's Bluetooth settings \
                     (on Linux: bluetoothctl remove {}) and connect again.",
                    peripheral.address()
                ));
            }
        }
        let wanted = [
            (uuid_fill::EEG_DATA, true),
            (uuid_fill::STATUS, true),
            (uuid_fill::PREDICTIONS, info.capabilities & capability::MODEL != 0),
            (uuid_fill::EMBEDDINGS, info.capabilities & capability::EMBEDDINGS != 0),
            (uuid_fill::UPDATE_CONTROL, info.capabilities & (capability::HEADS | capability::UPDATE) != 0),
        ];
        for (fill, yes) in wanted {
            if let (true, Some(c)) = (yes, chars.get(&fill)) {
                peripheral.subscribe(c).await.map_err(bt)?;
            }
        }
        println!("Connected to {name}, {} channels.", info.channel_count);
        Ok(Device {
            name,
            info,
            peripheral,
            chars,
            session,
            answers: tokio::sync::Mutex::new(answers),
            updates: tokio::sync::Mutex::new(updates),
            events: tokio::sync::Mutex::new(events),
            reader,
        })
    }

    /// Whether the device says it can do this.
    pub fn can(&self, capability: u16) -> bool {
        self.info.capabilities & capability != 0
    }

    async fn write(&self, c: &Command) -> Result<(), String> {
        let ch = self.chars.get(&c.characteristic).ok_or_else(|| format!("This IntoMind One has no characteristic {:#06x}.", c.characteristic))?;
        let kind = if c.with_response { WriteType::WithResponse } else { WriteType::WithoutResponse };
        self.peripheral.write(ch, &c.bytes, kind).await.map_err(bt)
    }

    /// Send a command and wait for its answer. `what` finishes the sentence
    /// "Your IntoMind One refused ..." when it says no.
    pub async fn request(&self, command: Command, what: &str) -> Result<Vec<u8>, String> {
        let opcode = command.bytes[0];
        let mut answers = self.answers.lock().await;
        while answers.try_recv().is_ok() {}
        self.write(&command).await?;
        let deadline = tokio::time::Instant::now() + ANSWER;
        loop {
            match tokio::time::timeout_at(deadline, answers.recv()).await {
                Err(_) => return Err(format!("Your IntoMind One did not answer when asked {what}.")),
                Ok(None) => return Err("The connection to your IntoMind One closed.".into()),
                Ok(Some((op, status, payload))) if op == opcode => {
                    return match status {
                        Status::Ok => Ok(payload),
                        Status::UsbPower => Err("Unplug the USB cable. Your IntoMind One does not read its electrodes on USB power.".into()),
                        s => Err(format!("Your IntoMind One refused {what}: {s:?}.")),
                    }
                }
                Ok(Some(_)) => {}
            }
        }
    }

    fn command<T>(&self, make: impl FnOnce(&Session) -> Result<T, intomind::Error>) -> Result<T, String> {
        make(&self.session.lock().unwrap()).map_err(|e| format!("{e:?}"))
    }

    /// Count the samples from zero again.
    pub async fn reset_epoch(&self) -> Result<(), String> {
        let c = self.session.lock().unwrap().reset_epoch();
        self.request(c, "to count from zero").await.map(drop)
    }

    /// Start the stream of samples.
    pub async fn start(&self) -> Result<(), String> {
        let c = self.session.lock().unwrap().start_stream();
        self.request(c, "to start").await.map(drop)
    }

    /// Stop the stream.
    pub async fn stop(&self) -> Result<(), String> {
        let c = self.session.lock().unwrap().stop_stream();
        self.request(c, "to stop").await.map(drop)
    }

    /// What the device reports of itself now: streaming or idle, battery, charger, lead-off status.
    pub async fn status(&self) -> Result<intomind::protocol::status::StatusMsg, String> {
        let c = self.chars.get(&uuid_fill::STATUS).ok_or("This IntoMind One has no status.")?;
        let bytes = self.peripheral.read(c).await.map_err(bt)?;
        let arrived = self.session.lock().unwrap().on_notification(uuid_fill::STATUS, &bytes);
        arrived.into_iter().find_map(|e| if let Event::Status(s) = e { Some(s) } else { None }).ok_or_else(|| "The status did not read.".to_string())
    }

    /// The model's state, its encoder, and how often it describes a window.
    pub async fn model_info(&self) -> Result<ModelInfo, String> {
        let c = Command { characteristic: uuid_fill::CONTROL, bytes: vec![Opcode::GetModelInfo as u8], with_response: true };
        let payload = self.request(c, "for its model").await?;
        ModelInfo::parse(&payload).map_err(|e| format!("{e:?}"))
    }

    /// Have the model describe every window.
    pub async fn set_model_interval(&self, seconds: u16) -> Result<(), String> {
        let c = self.command(|s| s.set_model_interval(seconds))?;
        self.request(c, "to describe every window").await.map(drop)
    }

    /// What each head slot holds.
    pub async fn heads(&self) -> Result<Vec<HeadEntry>, String> {
        let c = self.command(|s| s.list_heads())?;
        let payload = self.request(c, "to list its heads").await?;
        let n = *payload.get(1).ok_or("a head list too short to read")? as usize;
        (0..n).map(|i| HeadEntry::parse(&payload[2 + i * HeadEntry::LEN..]).map_err(|e| format!("{e:?}"))).collect()
    }

    /// Choose the head that runs.
    pub async fn select_head(&self, slot: u8) -> Result<(), String> {
        let c = self.command(|s| s.select_head(slot))?;
        self.request(c, &format!("to select the head in slot {slot}")).await.map(drop)
    }

    /// Take the head out of a user slot. The device refuses slot 0, and any slot while streaming.
    pub async fn remove_head(&self, slot: u8) -> Result<(), String> {
        let c = self.command(|s| s.remove_head(slot))?;
        self.request(c, &format!("to remove the head in slot {slot}")).await.map(drop)
    }

    /// Turn the running head's predictions on or off.
    pub async fn set_predictions(&self, on: bool) -> Result<(), String> {
        let c = self.command(|s| s.set_predictions(on))?;
        self.request(c, "to run the head").await.map(drop)
    }

    /// Ask for the encoder's embedding of every window, or stop.
    pub async fn set_embeddings(&self, form: Option<Form>) -> Result<(), String> {
        let c = self.command(|s| s.set_embeddings(form))?;
        self.request(c, "to send embeddings").await.map(drop)
    }

    /// One exchange of clocks, for putting device time on the host's
    /// clocks, both read either side of it.
    pub async fn time_sync(&self) -> Result<(), String> {
        let c = self.session.lock().unwrap().time_sync();
        let before = HostClocks::now();
        let payload = self.request(c, "for its clock").await?;
        let after = HostClocks::now();
        self.session.lock().unwrap().on_time_sync_clocks(&payload, before, after).map_err(|e| format!("{e:?}"))
    }

    /// Collect every sample from here, for a recording.
    pub fn arm_recorder(&self) {
        self.session.lock().unwrap().arm_recorder();
    }

    /// Write what was collected as the recording `label`, and return its
    /// manifest.
    pub fn save_recording(&self, recordings: &Collection, label: &str, setup: &Setup, run: &Run) -> Result<intomind::capture::json::Value, String> {
        self.session.lock().unwrap().save_recording(recordings, label, setup, run).map_err(|e| e.to_string())
    }

    /// Put a head in `slot`, checked there. `progress` hears how far it has got.
    pub async fn upload_head(&self, slot: u8, blob: &[u8], progress: impl Fn(usize, usize)) -> Result<(), String> {
        let mut transfer = self.command(|s| Transfer::head(s, slot, blob))?;
        let mut updates = self.updates.lock().await;
        loop {
            match transfer.step(blob) {
                Step::Send(command) => {
                    while updates.try_recv().is_ok() {}
                    self.write(&command).await?;
                    let answer = tokio::time::timeout(ANSWER, updates.recv()).await
                        .map_err(|_| "Your IntoMind One stopped answering during the transfer.".to_string())?
                        .ok_or("The connection to your IntoMind One closed during the transfer.")?;
                    transfer.on_answer(&answer, blob).map_err(|e| format!("Your IntoMind One stopped the transfer: {e:?}."))?;
                    let (taken, total) = transfer.progress();
                    progress(taken, total);
                }
                Step::Data { characteristic, from, to } => {
                    self.write(&Command { characteristic, bytes: blob[from..to].to_vec(), with_response: false }).await?;
                    transfer.sent(to - from);
                }
                Step::Verified(_) => return Ok(()),
            }
        }
    }

    /// The next thing the device sent: samples, a gap, a status, a
    /// prediction, an embedding. None once the connection has closed.
    pub async fn next_event(&self) -> Option<Event> {
        self.events.lock().await.recv().await
    }

    /// Let go of the device. The notifications are let go first, while the
    /// link is still up: let go after it, the Bluetooth library's own thread
    /// panics on the listener it can no longer remove.
    pub async fn close(self) {
        self.reader.abort();
        let _ = self.reader.await;
        let _ = self.peripheral.disconnect().await;
    }
}
