//! Take a custom AI head off your IntoMind One.
//!
//!     cargo run --release --bin remove_head -- [--slot 2] ["Ada's IntoMind One"]
//!
//! Slot 2 is where the Mind-Controlled Light Switch demo installs a custom AI
//! head, so that is the slot removed unless --slot names another of the four
//! user slots. Slot 0 holds the open source AI head for age and is the
//! device's own, so it cannot be removed. Slot 1 holds the open source AI
//! head for biological sex, which the Biological Sex Detector demo puts back
//! when it finds the slot empty.

use intomind_demos::device::Device;
use intomind_demos::{flag, name_arg};

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let slot: u8 = match flag(&args, "--slot") {
        Some(s) => s.parse().map_err(|_| format!("--slot takes a number, not {s:?}"))?,
        None => 2,
    };
    if slot == 0 {
        return Err("Slot 0 is the device's own head and cannot be removed.".into());
    }
    let dev = Device::connect(name_arg(&args, &["--slot"]).as_deref()).await?;
    let heads = dev.heads().await?;
    let Some(entry) = heads.iter().find(|h| h.slot == slot) else {
        dev.close().await;
        return Err(format!("This device has no slot {slot}. It has slots 1 to {}.", heads.len().saturating_sub(1)));
    };
    // A head_state of 1 is a valid head. Anything else is empty or unusable.
    if entry.state != 1 {
        println!("Slot {slot} is empty. Nothing to remove.");
        dev.close().await;
        return Ok(());
    }
    let name = String::from_utf8_lossy(&entry.name).trim_end_matches('\0').to_string();
    let shown = if name.is_empty() { "a custom AI head".to_string() } else { name };
    dev.remove_head(slot).await?;
    let after = dev.heads().await?;
    dev.close().await;
    if after.iter().any(|h| h.slot == slot && h.state == 1) {
        return Err(format!("The device still lists a head in slot {slot}."));
    }
    println!("Removed {shown} from slot {slot}. The slot is empty.");
    Ok(())
}
