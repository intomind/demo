"""Run one of the heads that ship on the device, and print what it says
beside what was published about it. age.py and biological_sex.py call this."""
from __future__ import annotations

import asyncio
import math

from common import connect
from published import AGE, SEX, SOURCE

ABOUT = {
    AGE["slot"]: dict(
        title="age", unit=" years", fmt="{:.0f}",
        published=(f"The published mean error is {AGE['averaged']['head']} years when a person's windows are averaged, "
                   f"and {AGE['oneWindow']['head']} years on one window. Guessing the studies' mean age gets "
                   f"{AGE['averaged']['meanAge']} and {AGE['oneWindow']['meanAge']}."),
    ),
    SEX["slot"]: dict(
        title="biological sex", unit="", fmt="{:.2f}",
        published=(f"In the training studies the target was 0 for male and 1 for female, and the output is a score, "
                   f"not a probability. The published AUC is {SEX['averaged']['head']} averaged over a person's windows "
                   f"and {SEX['oneWindow']['head']} on one window, where 0.5 is chance."),
    ),
}


async def run(slot: int, name: str | None, seconds: float = 120.0) -> None:
    about = ABOUT[slot]
    session, dev = await connect(name)
    if not dev.can("model"):
        raise SystemExit("This device does not report a model, so there is no AI head to run.")
    info = await dev.model_info()
    if info.state != "ready":
        raise SystemExit(f"The device's model is {info.state}, so it cannot run an AI head yet.")
    print(f"Encoder {info.encoder_id}. Running the {about['title']} head in slot {slot} for {seconds:.0f} seconds.")

    n = 0
    total = 0.0
    flagged = 0

    def on_prediction(_dev, p):
        nonlocal n, total, flagged
        if p.head_slot != slot:
            return
        value = p.outputs[0]
        notes = []
        if p.gap_in_window:
            notes.append("samples lost in this window")
        if p.leadoff_in_window:
            notes.append("an electrode was off in this window")
        if notes:
            flagged += 1
            notes.append("kept out of the mean")
        else:
            n += 1
            total += value
        mean = total / n if n else math.nan
        shown = about["fmt"].format(value)
        shown_mean = about["fmt"].format(mean) if n else "no mean yet"
        print(f"window {p.index}: {shown}{about['unit']}   mean of {n}: {shown_mean}   {', '.join(notes)}")

    dev.on_prediction = on_prediction
    await dev.select_head(slot)
    await dev.start()
    await dev.set_predictions(True)
    try:
        await asyncio.sleep(seconds)
    finally:
        try:
            await dev.set_predictions(False)
            await dev.stop()
        finally:
            await session.close()
    if n:
        print(f"\nAfter {n} windows, with {flagged} flagged and left out, the mean is "
              f"{about['fmt'].format(total / n)}{about['unit']}.")
    print(about["published"])
    print("The heads repository says this head shows what the embedding carries and is not a useful predictor.")
    print(f"Source: {SOURCE}")
