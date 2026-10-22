//! Record a minute and keep it: a capture in the published capture format,
//! with its manifest and checksums, and the same samples as a BDF file,
//! which MNE, EEGLAB and most EEG software open.
//!
//!     cargo run --release --bin record_and_export -- [--seconds 60] [--label my-first-minute] ["Ada's IntoMind One"]
//!
//! Recordings go to ~/.local/share/intomind/captures unless INTOMIND_CAPTURES
//! says otherwise, and to nowhere but your own disk.

use std::path::PathBuf;
use std::time::Duration;

use intomind::capture::{self, Checksums, Clock, Gap, Manifest, Samples, Signal, Software};
use intomind::Event;
use intomind_demos::device::{now, Device};
use intomind_demos::{flag, hex, name_arg};
use sha2::{Digest, Sha256};

/// The first batch's index, device time, rate, gain and mode.
type First = (u32, u64, u32, u8, u8);

/// Where captures go: INTOMIND_CAPTURES, or the same folder the Python package uses.
fn captures_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("INTOMIND_CAPTURES") {
        return PathBuf::from(d);
    }
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).unwrap_or_default();
    PathBuf::from(home).join(".local/share/intomind/captures")
}

/// Year, month, day, hour, minute, second in UTC, from seconds since 1970.
fn civil(t: f64) -> (i64, u32, u32, u32, u32, u32) {
    let secs = t as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d, (rem / 3600) as u32, (rem % 3600 / 60) as u32, (rem % 60) as u32)
}

/// A number in the eight characters a BDF header field holds, as precisely as fits.
fn field8(v: f64) -> String {
    (0..=6).rev().map(|d| format!("{v:.d$}")).find(|s| s.len() <= 8).unwrap_or_else(|| format!("{v:.0}"))
}

fn pad(s: &str, n: usize) -> Vec<u8> {
    let mut b: Vec<u8> = s.bytes().filter(|c| c.is_ascii() && !c.is_ascii_control()).take(n).collect();
    b.resize(n, b' ');
    b
}

/// The samples as one BDF data record. Returns the largest difference, in
/// microvolts, between what a reader will compute and what was measured.
fn write_bdf(path: &PathBuf, counts: &[i32], channels: usize, rate: u32, uv_per_count: f64, started: f64, device: &str) -> Result<f64, String> {
    let rows = counts.len() / channels;
    let (dmin, dmax) = (-8_388_608.0, 8_388_607.0);
    let (pmin, pmax) = (field8(dmin * uv_per_count), field8(dmax * uv_per_count));
    let (y, mo, d, h, mi, s) = civil(started);
    let mut out = Vec::new();
    out.push(0xFF);
    out.extend(pad("BIOSEMI", 7));
    out.extend(pad("X X X X", 80));
    out.extend(pad(&format!("{device} recording"), 80));
    out.extend(pad(&format!("{d:02}.{mo:02}.{:02}", y % 100), 8));
    out.extend(pad(&format!("{h:02}.{mi:02}.{s:02}"), 8));
    out.extend(pad(&(256 * (channels + 1)).to_string(), 8));
    out.extend(pad("24BIT", 44));
    out.extend(pad("1", 8));
    out.extend(pad(&field8(rows as f64 / rate as f64), 8));
    out.extend(pad(&channels.to_string(), 4));
    let each = |out: &mut Vec<u8>, text: &dyn Fn(usize) -> String, n: usize| (0..channels).for_each(|c| out.extend(pad(&text(c), n)));
    each(&mut out, &|c| format!("EEG {}", c + 1), 16);
    each(&mut out, &|_| "IntoMind One electrode".into(), 80);
    each(&mut out, &|_| "uV".into(), 8);
    each(&mut out, &|_| pmin.clone(), 8);
    each(&mut out, &|_| pmax.clone(), 8);
    each(&mut out, &|_| "-8388608".into(), 8);
    each(&mut out, &|_| "8388607".into(), 8);
    each(&mut out, &|_| String::new(), 80);
    each(&mut out, &|_| rows.to_string(), 8);
    each(&mut out, &|_| String::new(), 32);
    // What a reader computes from the header: a line through the two corners.
    let (p0, p1): (f64, f64) = (pmin.trim().parse().unwrap(), pmax.trim().parse().unwrap());
    let gain = (p1 - p0) / (dmax - dmin);
    let mut worst: f64 = 0.0;
    for c in 0..channels {
        for r in 0..rows {
            let v = counts[r * channels + c].clamp(-8_388_608, 8_388_607);
            out.extend(&v.to_le_bytes()[..3]);
            let read = p0 + (v as f64 - dmin) * gain;
            worst = worst.max((read - counts[r * channels + c] as f64 * uv_per_count).abs());
        }
    }
    std::fs::write(path, out).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(worst)
}

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let seconds: f64 = flag(&args, "--seconds").map_or(Ok(60.0), |v| v.parse().map_err(|_| "--seconds takes a number".to_string()))?;
    let (y, mo, d, h, mi, s) = civil(now());
    let label = flag(&args, "--label").unwrap_or_else(|| format!("demo-{y}{mo:02}{d:02}-{h:02}{mi:02}{s:02}"));
    let dir = captures_dir().join(&label);
    if dir.exists() {
        return Err(format!("A capture named {label} is already in {}. Choose another --label.", captures_dir().display()));
    }

    let dev = Device::connect(name_arg(&args, &["--seconds", "--label"]).as_deref()).await?;
    // Lead-off detection passes a small current through the electrodes, so
    // it stays as the wearer left it, and the capture says what the device
    // reports, as the Python package's does.
    let leadoff = dev.status().await?.loff_statp != 0;
    for _ in 0..8 {
        dev.time_sync().await?;
    }
    dev.start().await?;
    let started = now();
    println!("Recording {seconds:.0} seconds. Sit still, blink, close your eyes for a while.");
    let channels = dev.info.channel_count as usize;
    let (mut counts, mut gaps, mut first): (Vec<i32>, Vec<Gap>, Option<First>) = (Vec::new(), Vec::new(), None);
    let until = tokio::time::sleep(Duration::from_secs_f64(seconds));
    tokio::pin!(until);
    loop {
        tokio::select! {
            _ = &mut until => break,
            _ = tokio::signal::ctrl_c() => break,
            e = dev.next_event() => match e {
                None => break,
                Some(Event::Samples(b)) if b.channels == channels && !b.synthetic => {
                    first.get_or_insert((b.index, b.device_time, b.sample_rate_hz as u32, b.gain, b.mode));
                    counts.extend(&b.counts);
                }
                Some(Event::Gap(g)) if first.is_some() => gaps.push(Gap {
                    at_row: (counts.len() / channels) as u64,
                    last_index_before: g.last_index_before,
                    first_index_after: g.first_index_after,
                    samples_lost: g.samples_lost,
                    device_time_before: g.device_time_before,
                    device_time_after: g.device_time_after,
                    kind: if g.is_rebase() { "rebase" } else { "loss" }.into(),
                }),
                Some(_) => {}
            },
        }
    }
    dev.stop().await?;
    for _ in 0..8 {
        dev.time_sync().await?;
    }
    let clock = dev.clock().ok_or("The device's clock could not be put on this computer's.")?;
    let info = dev.info;
    let name = dev.name.clone();
    dev.close().await;
    let (first_index, first_device_time, rate, gain, mode) = first.ok_or("No samples arrived.")?;
    let uv_per_count = 2.0 * info.vref_uv as f64 / (gain as f64 * (1u64 << info.adc_bits) as f64);

    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let bytes: Vec<u8> = counts.iter().flat_map(|v| v.to_le_bytes()).collect();
    std::fs::write(dir.join(capture::SAMPLES), &bytes).map_err(|e| e.to_string())?;
    let v = |t: (u8, u8, u8)| format!("{}.{}.{}", t.0, t.1, t.2);
    let (y, mo, d, h, mi, s) = civil(started);
    let manifest = Manifest {
        format: capture::FORMAT,
        started: format!("{y}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z"),
        device: capture::Device {
            device_id: hex(&info.device_id),
            name: name.clone(),
            protocol: format!("{}.{}", info.proto_version.0, info.proto_version.1),
            firmware: v(info.fw_version),
            hardware: info.ext.as_ref().map(|e| v(e.hw_version)),
            build_id: info.ext.as_ref().map(|e| hex(&e.fw_build_id)),
        },
        signal: Signal { channels, sample_rate_hz: rate, gain, microvolts_per_count: uv_per_count, mode, leadoff, electrodes: Vec::new() },
        samples: Samples {
            count: (counts.len() / channels) as u64,
            dtype: "int32".into(),
            byte_order: "little".into(),
            first_index,
            first_device_time,
            device_tick_hz: info.time_tick_hz,
        },
        gaps,
        clock: Clock { offset_s: clock.offset_s, skew_ppm: clock.skew_ppm, syncs: clock.exchanges, residual_us: clock.residual_us },
        site: None,
        operator: None,
        note: None,
        software: Software { name: "intomind-demos record_and_export".into(), version: env!("CARGO_PKG_VERSION").into(), revision: None },
        checksums: Checksums { algorithm: "sha256".into(), samples: hex(&Sha256::digest(&bytes)), events: None },
    };
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(capture::MANIFEST), text).map_err(|e| e.to_string())?;
    let rows = counts.len() / channels;
    println!("Saved {rows} samples as {label} in {}, with its manifest and checksums.", captures_dir().display());

    let bdf = dir.join(format!("{label}.bdf"));
    let worst = write_bdf(&bdf, &counts, channels, rate, uv_per_count, started, &name)?;
    let exact = if worst == 0.0 { "every value exact".to_string() } else { format!("largest error {worst:.6} microvolts") };
    println!("BDF at {}: {rows} samples, {channels} channels at {rate} per second, {exact}.", bdf.display());
    if !manifest.gaps.is_empty() {
        println!("The recording has {} breaks, listed in its manifest. A BDF file has no way to show them, so its samples run on across them.", manifest.gaps.len());
    }
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
