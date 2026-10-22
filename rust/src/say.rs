//! A cue spoken aloud, through whatever the computer speaks with. A
//! computer with nothing to speak with stays quiet, and the cue is printed
//! either way.

use std::process::{Child, Command};

/// Speak `text` without waiting for it to finish.
pub fn say(text: &str) {
    if let Some(mut child) = speaker(text) {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
}

#[cfg(target_os = "macos")]
fn speaker(text: &str) -> Option<Child> {
    Command::new("say").arg(text).spawn().ok()
}

#[cfg(target_os = "windows")]
fn speaker(text: &str) -> Option<Child> {
    let script = format!(
        "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{}')",
        text.replace('\'', "''")
    );
    Command::new("powershell").args(["-NoProfile", "-Command", &script]).spawn().ok()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn speaker(text: &str) -> Option<Child> {
    ["spd-say", "espeak-ng", "espeak"].iter().find_map(|program| Command::new(program).arg(text).spawn().ok())
}
