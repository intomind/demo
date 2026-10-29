# The demos, as Rust programs

For people who would rather write Rust. Everything here runs on the
published `intomind` crate and nothing else of ours. That crate makes and
reads every message and does no input or output of its own, so
`src/device.rs` carries its bytes over Bluetooth with btleplug, and on
Linux `src/pairing.rs` pairs with the IntoMind One the way the Python
package does.

```
cd rust
cargo run --release --bin eyes_closed
```

Each program takes the device's name as its one argument when more than one
answers, as in `cargo run --release --bin age -- "Ada's IntoMind One"`.

| Program | Demo | What it does |
|---|---|---|
| `eyes_closed` | Alpha Flower | Streams, and prints the alpha band's share of the signal once a second. |
| `age` | Age Detector | Runs the open source AI head for age in slot 0 on your IntoMind One and prints its running mean beside the published error. |
| `biological_sex` | Biological Sex Detector | Runs the open source AI head for biological sex in slot 1 the same way, as a score. |
| `teach_it` | Mind-Controlled Light Switch | Two states with spoken cues, a custom AI head trained the way the Python API trains it, scored on held-out blocks, uploaded to slot 2 and run. With `--from`, reproduces the same custom AI head, byte for byte, from the training data the Mind-Controlled Light Switch demo saves, with no device. |
| `light_switch_pi` | Mind-Controlled Light Switch | On a Raspberry Pi: runs your custom AI head in slot 2 and drives an LED on a GPIO pin from it. |
| `remove_head` | Mind-Controlled Light Switch | Takes the custom AI head out of slot 2 on your IntoMind One, or out of another user slot with `--slot`. |
| `record_and_export` | | Records a minute in the published capture format, with its manifest and checksums, and writes the same samples, one after another, as a BDF file. A break in the recording is listed in the manifest and not shown in the BDF. |

`src/published.rs` holds the published figures the programs quote, and the
repository's `check.py` holds it to the heads repository's README like the
pages' `lib/numbers.js`. `cargo test` holds the trainer to the custom AI
head the Python API trains on the same numbers, byte for byte.

The flight simulator has no program, because it needs the screen to flicker.

The programs print rather than record. Two write to your own disk and
nowhere else: `record_and_export` writes the recording, and `teach_it`
writes your custom AI head.

On Linux, btleplug reaches the system's Bluetooth service through libdbus,
and the build compiles libdbus from its source, so no development package
has to be installed first. It needs a C compiler. Spoken cues use whatever
the computer speaks with: `say` on a Mac, the speech built into Windows,
and `spd-say` or `espeak` on Linux when one is installed.
