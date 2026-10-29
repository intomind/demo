//! Record a minute and keep it: a recording as every IntoMind program
//! writes one, with its manifest and checksums, exported to BDF, which MNE,
//! EEGLAB and most EEG software open.
//!
//!     cargo run --release --bin record_and_export -- [--seconds 60] [--label my-first-minute] ["Ada's IntoMind One"]
//!
//! Recordings go to ~/.local/share/intomind/captures unless INTOMIND_CAPTURES
//! says otherwise, and to nowhere but your own disk. The crate records and
//! exports them as the Python library does, so this program and the Python
//! one beside it make the same files.

use std::time::Duration;

use intomind::capture::export;
use intomind::capture::record::{Run, Setup};
use intomind::capture::recording::Collection;
use intomind_demos::device::Device;
use intomind_demos::{flag, name_arg};
use serde_json::json;

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let seconds: f64 = flag(&args, "--seconds").map_or(Ok(60.0), |v| v.parse().map_err(|_| "--seconds takes a number".to_string()))?;
    let label = match flag(&args, "--label") {
        Some(l) => l,
        None => {
            let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            let (days, rem) = (t / 86_400, t % 86_400);
            // The civil date of `days` since 1970, in UTC.
            let z = days as i64 + 719_468;
            let (era, doe) = (z.div_euclid(146_097), z.rem_euclid(146_097));
            let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
            let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
            let mp = (5 * doy + 2) / 153;
            let (d, m) = (doy - (153 * mp + 2) / 5 + 1, if mp < 10 { mp + 3 } else { mp - 9 });
            let y = yoe + era * 400 + i64::from(m <= 2);
            format!("demo-{y}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, rem / 60 % 60, rem % 60)
        }
    };
    let recordings = Collection::open(Collection::default_dir());
    if recordings.path(&label, ".npz").map_err(|e| e.to_string())?.exists() {
        return Err(format!("A recording named {label} is already in {}. Choose another --label.", recordings.dir().display()));
    }

    let dev = Device::connect(name_arg(&args, &["--seconds", "--label"]).as_deref()).await?;
    // One exchange of clocks, as the Python library makes when it connects.
    dev.time_sync().await?;
    // Armed first and then started on a count that starts at zero, so the
    // first sample recorded is the stream's first.
    dev.arm_recorder();
    dev.reset_epoch().await?;
    dev.start().await?;
    println!("Recording {seconds:.0} seconds. Sit still, blink, close your eyes for a while.");
    let until = tokio::time::sleep(Duration::from_secs_f64(seconds));
    tokio::pin!(until);
    loop {
        tokio::select! {
            _ = &mut until => break,
            _ = tokio::signal::ctrl_c() => break,
            // The session collects every sample as it arrives. What is
            // handed on here is only drained.
            e = dev.next_event() => if e.is_none() { break },
        }
    }
    dev.stop().await?;
    // This program carried the samples, so it names itself as their adapter.
    let setup = Setup {
        adapter: Some(json!({"name": "intomind-demos", "version": env!("CARGO_PKG_VERSION"), "first_party": true, "transport": "bluetooth-le"})),
        ..Setup::default()
    };
    let mut run = Run::default();
    run.extra.insert("experiment".into(), json!("demo-record"));
    let meta = dev.save_recording(&recordings, &label, &setup, &run)?;
    dev.close().await;
    println!("Saved {} samples as {label} in {}, with its manifest and checksums.", meta["n"], recordings.dir().display());

    let result = export::export(&recordings, &label, "bdf", None).map_err(|e| e.to_string())?;
    let exact = if result["lossy"].as_bool() == Some(false) {
        "every value exact".to_string()
    } else {
        format!("largest error {} microvolts", result["max_error_uv"])
    };
    println!(
        "BDF at {}: {} samples, {} channels at {:.0} per second, {exact}.",
        result["path"].as_str().unwrap_or("?"),
        result["samples"],
        result["channels"],
        result["sample_rate_hz"].as_f64().unwrap_or(0.0)
    );
    println!("To open it in Python with MNE: mne.io.read_raw_bdf(path).");
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
