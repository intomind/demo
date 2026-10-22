//! The Mind-Controlled Light Switch as a program: two states, spoken cues, a
//! custom AI head trained the way the Python API trains it, scored on
//! held-out blocks, uploaded to slot 2, and run on your IntoMind One.
//!
//!     cargo run --release --bin teach_it -- [--pair mental|eyes|jaw] [--per 15] [--bouts 8] ["Ada's IntoMind One"]
//!
//! Or reproduce a custom AI head, with no device, from the training data the
//! Mind-Controlled Light Switch demo saves:
//!
//!     cargo run --release --bin teach_it -- --from light-switch-training-data-2026-10-22-1405.json

use std::time::Duration;

use intomind::embeddings::{Assembler, Form};
use intomind::protocol::control::model_state;
use intomind::Event;
use intomind_demos::device::Device;
use intomind_demos::say::say;
use intomind_demos::shipped_head::state_name;
use intomind_demos::train::{blocked_folds, train_head, training_data};
use intomind_demos::{flag, hex, name_arg};

const SLOT: u8 = 2;
/// Windows delivered after a cue that began before it: the one that straddles it, and the one before that.
const SETTLE: usize = 2;

type Pair = [(&'static str, &'static str); 2];

const PRESETS: [(&str, Pair); 3] = [
    ("mental", [("Relaxed", "Relax. Breathe slowly and let your mind wander."),
                ("Mental math", "Mental arithmetic. Start at three hundred and keep subtracting seven.")]),
    ("eyes", [("Eyes open", "Eyes open."),
              ("Eyes closed", "Close your eyes, and keep them closed until the next cue.")]),
    ("jaw", [("Relaxed", "Relax your face."),
             ("Jaw clenched", "Clench your jaw gently, and hold it.")]),
];

fn file_name(on: &str, off: &str) -> String {
    format!("{}-vs-{}.imh", on.to_lowercase().replace(' ', "-"), off.to_lowercase().replace(' ', "-"))
}

fn report(rows: &[Vec<i32>], labels: &[f64], encoder_id: &str, name: &str) -> Result<Vec<u8>, String> {
    match blocked_folds(rows, labels, encoder_id)? {
        None => println!("Trained on {} windows, too few to hold any out, so there is no honest score.", rows.len()),
        Some(s) => {
            let accuracy = s.correct as f64 / s.total as f64;
            let mut line = format!(
                "Held out block by block: {} of {} right, {} percent, where guessing the commoner state gets {}.",
                s.correct, s.total, (accuracy * 100.0).round(), (s.chance * 100.0).round()
            );
            if accuracy >= 0.85 {
                line += " It separates the two states well.";
            } else if accuracy >= s.chance + 0.15 {
                line += " It separates them somewhat.";
            } else {
                line += " Near chance. The device will not tell these apart reliably.";
            }
            println!("{line}");
        }
    }
    let blob = train_head(rows, labels, name, encoder_id)?;
    println!("Your custom AI head is {} bytes.", blob.len());
    Ok(blob)
}

async fn collect(dev: &Device, pair: &Pair, per: usize, bouts: usize, channels: usize, tokens: usize) -> (Vec<Vec<i32>>, Vec<f64>) {
    let (mut rows, mut labels) = (Vec::new(), Vec::new());
    let (mut settle, mut flagged) = (0, 0);
    let mut assembler = Assembler::new(channels, tokens, Form::Window);
    for bout in 0..bouts {
        let label = bout % 2;
        let (state, cue) = pair[label];
        println!("\nBout {} of {bouts}: {state}", bout + 1);
        say(cue);
        let (mut seen, mut kept) = (0, 0);
        while seen < per + SETTLE + 2 {
            let Some(e) = dev.next_event().await else { return (rows, labels) };
            let Event::Embedding(e) = e else { continue };
            let Some(w) = assembler.feed(e) else { continue };
            seen += 1;
            if seen <= SETTLE {
                settle += 1;
            } else if w.gap_in_window || w.leadoff_in_window {
                flagged += 1;
            } else if let (true, Some(embedding)) = (kept < per, w.embedding) {
                rows.push(embedding.iter().map(|&v| v as i32).collect());
                labels.push(label as f64);
                kept += 1;
            }
        }
        println!("  kept {kept}");
    }
    say("Done.");
    println!("\n{} windows kept, {settle} dropped for beginning before a cue, {flagged} dropped for a gap or an electrode off.", rows.len());
    (rows, labels)
}

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let out = flag(&args, "--out");
    if let Some(source) = flag(&args, "--from") {
        let text = std::fs::read_to_string(&source).map_err(|e| format!("{source}: {e}"))?;
        let data = training_data(&text)?;
        let name = data.name.clone().unwrap_or_else(|| data.states.1.chars().take(15).collect());
        let blob = report(&data.rows, &data.labels, &data.encoder_id, &name)?;
        let out = out.unwrap_or_else(|| file_name(&data.states.1, &data.states.0));
        std::fs::write(&out, &blob).map_err(|e| format!("{out}: {e}"))?;
        println!("Wrote {out}. Same numbers in, same custom AI head out as the browser.");
        return Ok(());
    }
    let preset = flag(&args, "--pair").unwrap_or_else(|| "mental".into());
    let pair = PRESETS.iter().find(|(k, _)| *k == preset).map(|(_, p)| p).ok_or(format!("--pair is one of mental, eyes, jaw, not {preset}"))?;
    let number = |name: &str, default: usize| flag(&args, name).map_or(Ok(default), |v| v.parse().map_err(|_| format!("{name} takes a whole number")));
    let (per, bouts) = (number("--per", 15)?, number("--bouts", 8)?);

    let dev = Device::connect(name_arg(&args, &["--pair", "--per", "--bouts", "--from", "--out"]).as_deref()).await?;
    let info = dev.model_info().await?;
    if info.model_state != model_state::READY {
        return Err(format!("The device's model is {}, so it sends no embeddings.", state_name(info.model_state)));
    }
    if info.interval_s > 0 {
        dev.set_model_interval(0).await?;
        println!("The device was describing one window every {} seconds. Set to every window, and it keeps that setting.", info.interval_s);
    }
    let encoder_id = hex(&info.encoder_id);
    dev.start().await?;
    dev.set_embeddings(Some(Form::Window)).await?;
    let (rows, labels) = collect(&dev, pair, per, bouts, dev.info.channel_count as usize, (info.tokens_per_channel as usize).max(1)).await;
    let _ = dev.set_embeddings(None).await;
    let blob = report(&rows, &labels, &encoder_id, &pair[1].0.chars().take(15).collect::<String>())?;
    let out = out.unwrap_or_else(|| file_name(pair[1].0, pair[0].0));
    std::fs::write(&out, &blob).map_err(|e| format!("{out}: {e}"))?;
    println!("Wrote {out}.");

    // The device takes a head only while it is not streaming.
    dev.stop().await?;
    dev.upload_head(SLOT, &blob, |taken, total| println!("  installing: {taken} of {total} bytes")).await?;
    let id = hex(&blob[blob.len() - 32..blob.len() - 24]);
    println!("On the device in slot {SLOT}, identity {id}. Running it for two minutes: do one state, then the other.");
    dev.select_head(SLOT).await?;
    dev.start().await?;
    dev.set_predictions(true).await?;
    let until = tokio::time::sleep(Duration::from_secs(120));
    tokio::pin!(until);
    loop {
        tokio::select! {
            _ = &mut until => break,
            _ = tokio::signal::ctrl_c() => break,
            e = dev.next_event() => match e {
                None => break,
                Some(Event::Prediction(p)) if p.head_slot == SLOT => {
                    let v = p.outputs[0];
                    let flagged = if p.gap_in_window || p.leadoff_in_window { " flagged" } else { "" };
                    println!("window {}: {v:.2}  {}{flagged}", p.index, if v > 0.5 { pair[1].0 } else { pair[0].0 });
                }
                Some(_) => {}
            },
        }
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
