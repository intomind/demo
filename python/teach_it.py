"""The Mind-Controlled Light Switch as a script: two states, spoken cues, a
custom AI head trained with the published train_head, scored on held-out
blocks, uploaded to slot 2, and run on your IntoMind One.

    python3 teach_it.py [--pair mental|eyes|jaw] [--per 15] [--bouts 8] ["Ada's IntoMind One"]

Or reproduce a custom AI head, with no device, from the training data the
Mind-Controlled Light Switch demo saves:

    python3 teach_it.py --from light-switch-training-data-2026-10-22-1405.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math

import numpy as np

from intomind import protocol as P
from intomind.experiments import say
from intomind.model import train_head

from common import connect

SLOT = 2
#: Windows delivered after a cue that began before it: the one that straddles it, and the one before that.
SETTLE = 2

PRESETS = {
    "mental": (("Relaxed", "Relax. Breathe slowly and let your mind wander."),
               ("Mental math", "Mental arithmetic. Start at three hundred and keep subtracting seven.")),
    "eyes": (("Eyes open", "Eyes open."),
             ("Eyes closed", "Close your eyes, and keep them closed until the next cue.")),
    "jaw": (("Relaxed", "Relax your face."),
            ("Jaw clenched", "Clench your jaw gently, and hold it.")),
}


def blocked_folds(rows, labels, encoder_id, folds=5):
    """Held-out accuracy by contiguous blocks, scored in the device's integer arithmetic."""
    n, d = len(rows), len(rows[0])
    k = folds
    while n - math.ceil(n / k) <= d and k < 20:
        k += 1
    if n - math.ceil(n / k) <= d:
        return None
    size = math.ceil(n / k)
    correct = total = 0
    for f in range(k):
        lo, hi = f * size, min(n, (f + 1) * size)
        if lo >= hi:
            continue
        train_rows = rows[:lo] + rows[hi:]
        train_y = labels[:lo] + labels[hi:]
        if 0 not in train_y or 1 not in train_y:
            continue
        head = P.decode_head(train_head(train_rows, train_y, name="fold", encoder_id=encoder_id))
        for i in range(lo, hi):
            out = P.evaluate_head(head, rows[i])[0]
            correct += int((1 if out > 0.5 else 0) == labels[i])
        total += hi - lo
    if total == 0:
        return None
    ones = sum(labels)
    return dict(accuracy=correct / total, correct=correct, total=total, chance=max(ones, n - ones) / n)


def report(rows, labels, encoder_id, name):
    score = blocked_folds(rows, labels, encoder_id)
    blob = train_head(rows, labels, name=name, encoder_id=encoder_id)
    if score is None:
        print(f"Trained on {len(rows)} windows, too few to hold any out, so there is no honest score.")
    else:
        pct, chance = round(score["accuracy"] * 100), round(score["chance"] * 100)
        line = f"Held out block by block: {score['correct']} of {score['total']} right, {pct} percent, where guessing the commoner state gets {chance}."
        if score["accuracy"] >= 0.85:
            line += " It separates the two states well."
        elif score["accuracy"] >= score["chance"] + 0.15:
            line += " It separates them somewhat."
        else:
            line += " Near chance. The device will not tell these apart reliably."
        print(line)
    print(f"Your custom AI head is {len(blob)} bytes.")
    return blob, score


async def collect(dev, pair, per, bouts):
    rows, labels = [], []
    dropped = dict(settle=0, flagged=0)
    for bout in range(bouts):
        label = bout % 2
        state_name, cue = pair[label]
        print(f"\nBout {bout + 1} of {bouts}: {state_name}")
        say(cue)
        windows = await dev.collect_embeddings(per + SETTLE + 2, form="window")
        kept = 0
        for i, w in enumerate(windows):
            if i < SETTLE:
                dropped["settle"] += 1
            elif w.gap_in_window or w.leadoff_in_window:
                dropped["flagged"] += 1
            elif kept < per:
                rows.append(list(w.embedding))
                labels.append(label)
                kept += 1
        print(f"  kept {kept}")
    say("Done.")
    print(f"\n{len(rows)} windows kept, {dropped['settle']} dropped for beginning before a cue, "
          f"{dropped['flagged']} dropped for a gap or an electrode off.")
    return rows, labels


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", nargs="?", help="the device's name, when several answer")
    ap.add_argument("--pair", choices=sorted(PRESETS), default="mental")
    ap.add_argument("--per", type=int, default=15, help="windows kept per bout")
    ap.add_argument("--bouts", type=int, default=8, help="bouts, alternating the two states")
    ap.add_argument("--from", dest="source", help="training data saved by the Mind-Controlled Light Switch demo, to reproduce its custom AI head without a device")
    ap.add_argument("--out", default=None, help="where to write the custom AI head file")
    args = ap.parse_args()

    if args.source:
        data = json.loads(open(args.source).read())
        rows = [w["embedding"] for w in data["windows"]]
        labels = [w["label"] for w in data["windows"]]
        a, b = data["states"]
        blob, _ = report(rows, labels, data["encoderId"], data.get("name", b[:15]))
        out = args.out or f"{b.lower().replace(' ', '-')}-vs-{a.lower().replace(' ', '-')}.imh"
        open(out, "wb").write(blob)
        print(f"Wrote {out}. Same numbers in, same custom AI head out as the browser.")
        return

    pair = PRESETS[args.pair]
    session, dev = await connect(args.name)
    info = await dev.model_info()
    if info.state != "ready":
        raise SystemExit(f"The device's model is {info.state}, so it sends no embeddings.")
    if info.interval_s > 0:
        await dev.set_model_interval(0)
        print(f"The device was describing one window every {info.interval_s} seconds. Set to every window, and it keeps that setting.")
    await dev.start()
    try:
        rows, labels = await collect(dev, pair, args.per, args.bouts)
        blob, _ = report(rows, labels, info.encoder_id, pair[1][0][:15])
        out = args.out or f"{pair[1][0].lower().replace(' ', '-')}-vs-{pair[0][0].lower().replace(' ', '-')}.imh"
        open(out, "wb").write(blob)
        print(f"Wrote {out}.")
        head_id = await dev.upload_head(blob, slot=SLOT, select=True)
        print(f"On the device in slot {SLOT}, identity {head_id}. Running it for two minutes: do one state, then the other.")

        def on_prediction(_dev, p):
            if p.head_slot != SLOT:
                return
            v = p.outputs[0]
            flags = " flagged" if (p.gap_in_window or p.leadoff_in_window) else ""
            print(f"window {p.index}: {v:.2f}  {pair[1][0] if v > 0.5 else pair[0][0]}{flags}")

        dev.on_prediction = on_prediction
        await dev.set_predictions(True)
        await asyncio.sleep(120)
        await dev.set_predictions(False)
    finally:
        try:
            await dev.stop()
        finally:
            await session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
