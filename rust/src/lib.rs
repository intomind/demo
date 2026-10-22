//! The IntoMind Demo Suite's demos as Rust programs.
//!
//! Everything here runs on the published `intomind` crate. That crate makes
//! and reads every message and does no input or output of its own, so
//! `device` carries its bytes over Bluetooth with btleplug.

pub mod device;
#[cfg(target_os = "linux")]
mod pairing;
pub mod published;
pub mod say;
pub mod shipped_head;
pub mod spectrum;
pub mod train;

/// The device's name, when the command line gives one: the first argument
/// that is not a flag or a flag's value.
pub fn name_arg(args: &[String], flags_with_values: &[&str]) -> Option<String> {
    let mut i = 1;
    while i < args.len() {
        if flags_with_values.contains(&args[i].as_str()) {
            i += 2;
            continue;
        }
        if !args[i].starts_with("--") {
            return Some(args[i].clone());
        }
        i += 1;
    }
    None
}

/// The value after a flag, when the command line gives it.
pub fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

/// Lowercase hexadecimal, the way the SDKs print identities.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
