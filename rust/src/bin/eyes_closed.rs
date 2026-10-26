//! Alpha Flower as a program: stream, and print relative alpha power, the
//! power from 8 to 13 Hz as a fraction of the power from 4 to 30 Hz, once a
//! second. Close your eyes and watch the bar grow.
//!
//!     cargo run --release --bin eyes_closed -- ["Ada's IntoMind One"]

use std::collections::VecDeque;
use std::time::Duration;

use intomind::Event;
use intomind_demos::device::Device;
use intomind_demos::name_arg;
use intomind_demos::spectrum::{band, welch};

const ALPHA: (f64, f64) = (8.0, 13.0);
const WIDE: (f64, f64) = (4.0, 30.0);
const SECONDS: f64 = 4.0;
const KEEP: usize = 4000;

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let dev = Device::connect(name_arg(&args, &[]).as_deref()).await?;
    let channels = dev.info.channel_count as usize;
    let mut lanes: Vec<VecDeque<f64>> = vec![VecDeque::with_capacity(KEEP); channels];
    let mut fs = 0.0;
    dev.start().await?;
    println!("Streaming. Blink, clench your jaw, then close your eyes and count to ten. Ctrl-C to stop.\n");
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    tick.tick().await;
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            _ = tick.tick() => {
                let n = (SECONDS * fs) as usize;
                let values: Vec<f64> = lanes.iter().filter(|l| n > 0 && l.len() >= n).filter_map(|lane| {
                    let x: Vec<f64> = lane.iter().skip(lane.len() - n).copied().collect();
                    let mean = x.iter().sum::<f64>() / n as f64;
                    let x: Vec<f64> = x.iter().map(|v| v - mean).collect();
                    let (f, p) = welch(&x, fs, (2.0 * fs) as usize);
                    let wide = band(&f, &p, WIDE.0, WIDE.1);
                    (wide > 0.0).then(|| band(&f, &p, ALPHA.0, ALPHA.1) / wide)
                }).collect();
                if values.is_empty() {
                    println!("waiting for {SECONDS:.0} seconds of signal");
                    continue;
                }
                let relative = values.iter().sum::<f64>() / values.len() as f64;
                println!("relative alpha power: {relative:5.2}  {}", "#".repeat((relative * 60.0) as usize));
            }
            e = dev.next_event() => match e {
                None => break,
                Some(Event::Samples(b)) => {
                    fs = b.sample_rate_hz as f64;
                    for r in 0..b.rows() {
                        for (c, lane) in lanes.iter_mut().enumerate().take(b.channels) {
                            if lane.len() == KEEP {
                                lane.pop_front();
                            }
                            lane.push_back(b.microvolts(r, c, &dev.info));
                        }
                    }
                }
                Some(_) => {}
            },
        }
    }
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
