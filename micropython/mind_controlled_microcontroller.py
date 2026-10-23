# The Mind-Controlled Microcontroller, in MicroPython, on a Raspberry Pi
# Pico 2 W. The board connects to your IntoMind One by itself and turns its
# LED on while your custom AI head reads On. Your IntoMind One runs the head
# on its own chip. Teach it and install it on the Mind-Controlled Light
# Switch demo first.
#
# The board needs the IntoMind MicroPython firmware. Save this file on the
# board as main.py and it runs whenever the board has power. What it is
# doing prints in Thonny's shell.

import asyncio
import time

from machine import Pin

import intomind

# ---- Settings you might change. ----

# Where the Mind-Controlled Light Switch demo installs your custom AI head.
HEAD_SLOT = 2
# A reading above this means On, the same line the demo draws.
SWITCH_THRESHOLD = 0.5
# The start of your IntoMind One's name, like "Ada's", to choose one among
# several. Empty takes the one heard most strongly.
DEVICE_NAME_PREFIX = ""

# ---- Your code goes here. ----

# To drive a pin, uncomment this line and the one in on_switch. GP15 is the
# board's pin 20, with ground on pin 18. The pin goes high, to 3.3 volts,
# while your custom AI head reads On: a signal any circuit, robot or project
# of your own can act on.
# pin = Pin(15, Pin.OUT, value=0)


def on_switch(on):
    # Runs whenever your custom AI head's decision changes: True when it
    # reads On, False when it reads Off, and False when the link to your
    # IntoMind One is lost. The board's own LED already follows it.
    # pin.value(on)
    pass


def on_reading(score, clean):
    # Runs for every reading, every few seconds: your custom AI head's score,
    # near 0 for Off and near 1 for On, and whether the signal behind it was
    # clean. For anything finer than on and off.
    pass


# ---- The program. ----

# How long without a reading before the link counts as lost, and how long
# to wait before asking again.
READING_MS = 20000
RETRY_MS = 5000

# What the LED shows.
LOOKING = 0   # one short blink a second: looking for your IntoMind One
CHARGING = 1  # two short blinks a second: it is on its charger
NO_HEAD = 2   # three short blinks a second: no custom AI head installed yet
OFF = 3       # your custom AI head reads Off
ON = 4        # your custom AI head reads On
SIGNAL = 5    # fast blinking: the last reading had a gap or an electrode off


class Light:
    def __init__(self):
        self.pin = Pin("LED", Pin.OUT, value=0)
        self.show = LOOKING
        # Kept here rather than read back from the LED, which on the Pico 2 W
        # sits behind the wireless chip.
        self.lit = False

    async def run(self):
        while True:
            show = self.show
            if show in (ON, OFF):
                self.pin.value(show == ON)
                await asyncio.sleep_ms(50)
            elif show == SIGNAL:
                self.lit = not self.lit
                self.pin.value(self.lit)
                await asyncio.sleep_ms(100)
            else:
                blinks = {LOOKING: 1, CHARGING: 2, NO_HEAD: 3}[show]
                for _ in range(blinks):
                    self.pin.value(1)
                    await asyncio.sleep_ms(100)
                    self.pin.value(0)
                    await asyncio.sleep_ms(150)
                await asyncio.sleep_ms(1000 - blinks * 250)


light = Light()
decided = None


def switch(on):
    global decided
    if on != decided:
        decided = on
        on_switch(on)


async def run(device):
    """Run your custom AI head on your IntoMind One and follow it, until the
    link is lost or the readings stop."""
    while True:
        try:
            await device.select_head(HEAD_SLOT)
            break
        except intomind.Refused:
            print("No custom AI head in slot %d. Asking again shortly." % HEAD_SLOT)
            light.show = NO_HEAD
            await asyncio.sleep_ms(RETRY_MS)
    # This program reads no EEG itself, so it only starts the stream, as the
    # program in C does. A stream already running counts as started.
    while True:
        try:
            await device.command("start_stream")
            break
        except intomind.Refused as e:
            if e.status == intomind.protocol.STATUS_BUSY:
                break
            if e.status != intomind.protocol.STATUS_USB_POWER:
                raise
            print("Your IntoMind One is charging. Asking again shortly.")
            light.show = CHARGING
            await asyncio.sleep_ms(RETRY_MS)

    last = time.ticks_ms()

    def on_prediction(device, prediction):
        nonlocal last
        if prediction.head_slot != HEAD_SLOT or not prediction.outputs:
            return
        last = time.ticks_ms()
        score = prediction.outputs[0]
        clean = not (prediction.gap_in_window or prediction.leadoff_in_window)
        on_reading(score, clean)
        if clean:
            switch(score > SWITCH_THRESHOLD)
            light.show = ON if decided else OFF
        else:
            # A reading from a bad stretch of signal changes nothing. The LED says why.
            light.show = SIGNAL
        print("Reading %.2f%s" % (score, "" if clean else ", the signal had a gap or an electrode off"))

    device.on_prediction = on_prediction
    await device.set_predictions(True)
    print("Running your custom AI head.")
    light.show = OFF
    while device.connected and time.ticks_diff(time.ticks_ms(), last) < READING_MS:
        await asyncio.sleep_ms(250)
    print("The link was lost." if not device.connected else "No reading for %d seconds." % (READING_MS // 1000))


async def main():
    asyncio.create_task(light.run())
    switch(False)
    failures = 0
    while True:
        light.show = LOOKING
        print("Looking for your IntoMind One.")
        try:
            found = [f for f in await intomind.scan(3) if f.name.startswith(DEVICE_NAME_PREFIX)]
        except Exception as e:
            print("Could not scan:", e)
            await asyncio.sleep_ms(RETRY_MS)
            continue
        if not found:
            continue
        print("Found %s. Connecting." % found[0].name)
        try:
            device = await intomind.connect(found[0])
        except Exception as e:
            print("Could not connect:", e)
            failures += 1
            if failures >= 2:
                # Two links in a row that could not be made usually mean your
                # IntoMind One has forgotten this board. Forget it too, and pair again.
                print("Forgetting this board's pairings, to pair again.")
                intomind.forget_pairings()
                failures = 0
            await asyncio.sleep_ms(RETRY_MS)
            continue
        failures = 0
        try:
            await run(device)
        except Exception as e:
            print("Lost the link:", e)
        finally:
            switch(False)
            await device.disconnect()
        await asyncio.sleep_ms(RETRY_MS)


if __name__ == "__main__":
    asyncio.run(main())
