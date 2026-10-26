"""Alpha Flower as a script: stream, and print relative alpha power, the power
from 8 to 13 Hz as a fraction of the power from 4 to 30 Hz, once a second.
Close your eyes and watch the bar grow.

    python3 eyes_closed.py ["Ada's IntoMind One"]

Needs the analysis extra: pip install 'intomind[analysis]'
"""
from __future__ import annotations

import asyncio
import collections
import statistics
import sys

import numpy as np
from scipy.signal import welch

from common import connect, name_arg

ALPHA = (8.0, 13.0)
WIDE = (4.0, 30.0)
SECONDS = 4.0


def band(freqs, psd, lo, hi):
    pick = (freqs >= lo) & (freqs < hi)
    return float(np.trapezoid(psd[pick], freqs[pick])) if pick.any() else 0.0


async def main() -> None:
    session, dev = await connect(name_arg(sys.argv))
    tick_hz = dev.info.tick_hz
    channels = dev.info.channels
    lanes = [collections.deque(maxlen=4000) for _ in range(channels)]
    ticks = collections.deque(maxlen=64)

    def on_sample(_dev, s):
        for c in range(channels):
            lanes[c].append(s.uv[c])
        ticks.append(s.device_time)

    dev.on_sample = on_sample
    await dev.start()
    print("Streaming. Blink, clench your jaw, then close your eyes and count to ten. Ctrl-C to stop.\n")
    try:
        while True:
            await asyncio.sleep(1.0)
            if len(ticks) < 16:
                continue
            # The rate, from the device's own clock rather than from a table.
            step = statistics.median(b - a for a, b in zip(list(ticks), list(ticks)[1:]))
            fs = tick_hz / step if step > 0 else 0
            if fs <= 0:
                continue
            n = int(SECONDS * fs)
            values = []
            for lane in lanes:
                if len(lane) < n:
                    continue
                x = np.array(list(lane)[-n:], dtype=float)
                f, p = welch(x - x.mean(), fs=fs, nperseg=min(len(x), int(2 * fs)))
                wide = band(f, p, *WIDE)
                if wide > 0:
                    values.append(band(f, p, *ALPHA) / wide)
            if not values:
                print(f"waiting for {SECONDS:.0f} seconds of signal")
                continue
            relative = sum(values) / len(values)
            print(f"relative alpha power: {relative:5.2f}  {'#' * int(relative * 60)}")
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
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
