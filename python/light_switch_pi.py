"""The Mind-Controlled Light Switch as a script, on a Raspberry Pi: run your custom
AI head in slot 2 and drive an LED on a GPIO pin from it. The same loop as the board, through the
published API.

    python3 light_switch_pi.py ["Ada's IntoMind One"]

Needs gpiozero for the pin, which Raspberry Pi OS carries. Without it the
script prints what the light would do.
"""
from __future__ import annotations

import asyncio
import sys

from common import connect, name_arg

SLOT = 2
PIN = 17
THRESHOLD = 0.5


async def main() -> None:
    try:
        from gpiozero import LED
        led = LED(PIN)
    except ImportError:
        led = None
        print("gpiozero is not installed, so this prints instead of lighting a pin: pip install gpiozero")
    session, dev = await connect(name_arg(sys.argv))

    def on_prediction(_dev, p):
        if p.head_slot != SLOT:
            return
        value = p.outputs[0]
        if p.gap_in_window or p.leadoff_in_window:
            state = "flagged, not saying either"
            if led:
                led.blink(on_time=0.1, off_time=0.1)
        else:
            on = value > THRESHOLD
            state = "on" if on else "off"
            if led:
                led.on() if on else led.off()
        print(f"window {p.index}: {value:.2f}  {state}")

    dev.on_prediction = on_prediction
    await dev.select_head(SLOT)
    await dev.start()
    await dev.set_predictions(True)
    print(f"Running the head in slot {SLOT}. The light follows a window or two behind you. Ctrl-C to stop.")
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        try:
            await dev.set_predictions(False)
            await dev.stop()
        finally:
            if led:
                led.off()
            await session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
