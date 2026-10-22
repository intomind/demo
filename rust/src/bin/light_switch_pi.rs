//! The Mind-Controlled Light Switch as a program, on a Raspberry Pi: run your
//! custom AI head in slot 2 and drive an LED on a GPIO pin from it. The same
//! loop as the board, through the published crate.
//!
//!     cargo run --release --bin light_switch_pi -- ["Ada's IntoMind One"]
//!
//! On a computer without a Raspberry Pi's pins it prints what the light
//! would do.

#[cfg(target_os = "linux")]
use std::time::Duration;

use intomind::Event;
use intomind_demos::device::Device;
use intomind_demos::name_arg;
use tokio::sync::watch;

const SLOT: u8 = 2;
#[cfg(target_os = "linux")]
const PIN: u8 = 17;
const THRESHOLD: f32 = 0.5;

#[derive(Clone, Copy, PartialEq)]
enum Light {
    Off,
    On,
    Blink,
}

/// The pin, followed from a channel: on, off, or blinking five times a second.
#[cfg(target_os = "linux")]
fn light() -> Option<watch::Sender<Light>> {
    let mut pin = rppal::gpio::Gpio::new().ok()?.get(PIN).ok()?.into_output();
    let (tx, mut rx) = watch::channel(Light::Off);
    tokio::spawn(async move {
        let mut lit = false;
        loop {
            let state = *rx.borrow_and_update();
            match state {
                Light::On => pin.set_high(),
                Light::Off => pin.set_low(),
                Light::Blink => {
                    lit = !lit;
                    if lit { pin.set_high() } else { pin.set_low() }
                }
            }
            let wait = if state == Light::Blink { Duration::from_millis(100) } else { Duration::from_secs(3600) };
            if tokio::time::timeout(wait, rx.changed()).await.is_ok_and(|r| r.is_err()) {
                pin.set_low();
                return;
            }
        }
    });
    Some(tx)
}

#[cfg(not(target_os = "linux"))]
fn light() -> Option<watch::Sender<Light>> {
    None
}

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let led = light();
    if led.is_none() {
        println!("This computer has no Raspberry Pi pins, so this prints instead of lighting one.");
    }
    let dev = Device::connect(name_arg(&args, &[]).as_deref()).await?;
    dev.select_head(SLOT).await?;
    dev.start().await?;
    dev.set_predictions(true).await?;
    println!("Running the head in slot {SLOT}. The light follows a window or two behind you. Ctrl-C to stop.");
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            e = dev.next_event() => match e {
                None => break,
                Some(Event::Prediction(p)) if p.head_slot == SLOT => {
                    let value = p.outputs[0];
                    let (state, words) = if p.gap_in_window || p.leadoff_in_window {
                        (Light::Blink, "flagged, not saying either")
                    } else if value > THRESHOLD {
                        (Light::On, "on")
                    } else {
                        (Light::Off, "off")
                    };
                    if let Some(led) = &led {
                        let _ = led.send(state);
                    }
                    println!("window {}: {value:.2}  {words}", p.index);
                }
                Some(_) => {}
            },
        }
    }
    if let Some(led) = &led {
        let _ = led.send(Light::Off);
    }
    let _ = dev.set_predictions(false).await;
    let _ = dev.stop().await;
    dev.close().await;
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
