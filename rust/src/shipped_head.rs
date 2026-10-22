//! Run one of the heads that ship on the device, and print what it says
//! beside what was published about it. `age` and `biological_sex` call this.

use std::time::Duration;

use intomind::protocol::control::model_state;
use intomind::protocol::device_info::capability;
use intomind::Event;

use crate::device::Device;
use crate::hex;
use crate::published::{age, sex, SOURCE};

/// The model's state, in words.
pub fn state_name(state: u8) -> &'static str {
    match state {
        model_state::NONE => "absent",
        model_state::NO_WEIGHTS => "without its weights",
        model_state::READY => "ready",
        _ => "updating",
    }
}

/// Run the head in `slot` for `seconds`, or until Ctrl-C.
pub async fn run(slot: u8, name: Option<&str>, seconds: f64) -> Result<(), String> {
    let (title, unit, digits, published) = if slot == age::SLOT {
        ("age", " years", 0, format!(
            "The published mean error is {} years when a person's windows are averaged, and {} years on one window. \
             Guessing the studies' mean age gets {} and {}.",
            age::AVERAGED_HEAD, age::ONE_WINDOW_HEAD, age::AVERAGED_MEAN_AGE, age::ONE_WINDOW_MEAN_AGE
        ))
    } else {
        ("biological sex", "", 2, format!(
            "In the training studies the target was 0 for male and 1 for female, and the output is a score, not a probability. \
             The published AUC is {} averaged over a person's windows and {} on one window, where 0.5 is chance.",
            sex::AVERAGED_HEAD, sex::ONE_WINDOW_HEAD
        ))
    };
    let dev = Device::connect(name).await?;
    if !dev.can(capability::MODEL) {
        return Err("This device does not report a model, so there is no AI head to run.".into());
    }
    let info = dev.model_info().await?;
    if info.model_state != model_state::READY {
        return Err(format!("The device's model is {}, so it cannot run an AI head yet.", state_name(info.model_state)));
    }
    println!("Encoder {}. Running the {title} head in slot {slot} for {seconds:.0} seconds.", hex(&info.encoder_id));
    dev.select_head(slot).await?;
    dev.start().await?;
    dev.set_predictions(true).await?;

    let (mut n, mut total, mut flagged) = (0usize, 0.0f64, 0usize);
    let until = tokio::time::sleep(Duration::from_secs_f64(seconds));
    tokio::pin!(until);
    loop {
        let p = tokio::select! {
            _ = &mut until => break,
            _ = tokio::signal::ctrl_c() => break,
            e = dev.next_event() => match e {
                None => break,
                Some(Event::Prediction(p)) if p.head_slot == slot => p,
                Some(_) => continue,
            },
        };
        let value = p.outputs[0] as f64;
        let mut notes = Vec::new();
        if p.gap_in_window {
            notes.push("samples lost in this window");
        }
        if p.leadoff_in_window {
            notes.push("an electrode was off in this window");
        }
        if notes.is_empty() {
            n += 1;
            total += value;
        } else {
            flagged += 1;
            notes.push("kept out of the mean");
        }
        let mean = if n > 0 { format!("{:.digits$}", total / n as f64) } else { "no mean yet".into() };
        println!("window {}: {value:.digits$}{unit}   mean of {n}: {mean}   {}", p.index, notes.join(", "));
    }
    let _ = dev.set_predictions(false).await;
    let _ = dev.stop().await;
    dev.close().await;
    if n > 0 {
        println!("\nAfter {n} windows, with {flagged} flagged and left out, the mean is {:.digits$}{unit}.", total / n as f64);
    }
    println!("{published}");
    println!("The heads repository says this head shows what the embedding carries and is not a useful predictor.");
    println!("Source: {SOURCE}");
    Ok(())
}
