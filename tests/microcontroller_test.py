"""The Mind-Controlled Microcontroller's MicroPython program, run under
Python against stand-ins for the board and the intomind library for
MicroPython: what it asks the IntoMind One, what the LED shows, what it
hands on_switch and on_reading, and when it forgets its pairings."""
from __future__ import annotations

import asyncio
import importlib.util
import pathlib
import sys
import time
import types

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROGRAM = ROOT / "micropython" / "mind_controlled_microcontroller.py"


class Refused(Exception):
    def __init__(self, op, status):
        super().__init__("op 0x%02x -> status %d" % (op, status))
        self.op = op
        self.status = status


class Device:
    """An IntoMind One that refuses what it is told to and sends the readings it is given."""

    def __init__(self, name, no_head=0, start=(), readings=(), drops=True):
        self.name = name
        self.no_head = no_head
        self.start = list(start)
        self.readings = list(readings)
        self.drops = drops
        self.connected = True
        self.on_prediction = None
        self.asked = []

    async def select_head(self, slot):
        self.asked.append(("select_head", slot))
        if self.no_head:
            self.no_head -= 1
            raise Refused(0x81, 1)

    async def command(self, name, arg=None):
        self.asked.append((name, arg))
        if name == "start_stream" and self.start:
            raise Refused(0x01, self.start.pop(0))

    async def set_predictions(self, on):
        self.asked.append(("set_predictions", on))
        asyncio.get_running_loop().create_task(self.send())

    async def send(self):
        for slot, outputs, gap, leadoff in self.readings:
            await asyncio.sleep(0.01)
            self.on_prediction(self, types.SimpleNamespace(head_slot=slot, outputs=outputs, gap_in_window=gap, leadoff_in_window=leadoff))
        await asyncio.sleep(0.01)
        if self.drops:
            self.connected = False

    async def disconnect(self):
        self.connected = False


def load(world, connect_failures=0):
    """The program, with the stand-ins in place of the board and the library."""
    record = types.SimpleNamespace(connects=[], forgotten=0, shows=[], switched=[], readings=[])
    lib = types.ModuleType("intomind")
    lib.Refused = Refused
    lib.protocol = types.SimpleNamespace(STATUS_BUSY=3, STATUS_USB_POWER=7)
    failures = [connect_failures]

    async def scan(seconds=5):
        await asyncio.sleep(0.001)
        return [types.SimpleNamespace(name=d.name, device=d) for d in world]

    async def connect(found):
        record.connects.append(found.name)
        if failures[0]:
            failures[0] -= 1
            raise OSError("pairing failed")
        return found.device

    def forget_pairings():
        record.forgotten += 1

    lib.scan, lib.connect, lib.forget_pairings = scan, connect, forget_pairings
    machine = types.ModuleType("machine")

    class Pin:
        OUT = 1

        def __init__(self, *args, **kwargs):
            pass

        def value(self, v=None):
            pass

    machine.Pin = Pin
    asyncio.sleep_ms = lambda ms: asyncio.sleep(ms / 1000)
    time.ticks_ms = lambda: int(time.monotonic() * 1000)
    time.ticks_diff = lambda a, b: a - b
    saved = {k: sys.modules.get(k) for k in ("intomind", "machine")}
    sys.modules.update({"intomind": lib, "machine": machine})
    try:
        spec = importlib.util.spec_from_file_location("mind_controlled_microcontroller", PROGRAM)
        program = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(program)
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    program.RETRY_MS, program.READING_MS = 10, 200
    program.print = lambda *args, **kwargs: None

    class Light:
        @property
        def show(self):
            return record.shows[-1] if record.shows else None

        @show.setter
        def show(self, s):
            if not record.shows or record.shows[-1] != s:
                record.shows.append(s)

        async def run(self):
            await asyncio.Event().wait()

    program.light = Light()
    program.on_switch = record.switched.append
    program.on_reading = lambda score, clean: record.readings.append((score, clean))
    return program, record


async def until(done, seconds=3.0):
    end = time.monotonic() + seconds
    while not done() and time.monotonic() < end:
        await asyncio.sleep(0.005)


async def scenarios(check):
    # No head at first, then on the charger, then a stream already running,
    # then readings: On, Off, one from a bad stretch, one from another slot.
    ada = Device("Ada's IntoMind One", no_head=1, start=[7, 3],
                 readings=[(2, [0.8], False, False), (2, [0.3], False, False), (2, [0.9], True, False), (1, [0.99], False, False)])
    program, record = load([ada])
    task = asyncio.create_task(program.main())
    await until(lambda: not ada.connected and record.switched[-1:] == [False] and len(record.shows) >= 7)
    task.cancel()
    p = program
    check(ada.asked == [("select_head", 2), ("select_head", 2), ("start_stream", None), ("start_stream", None), ("set_predictions", True)],
          "the program selects slot 2, asks again while it is empty, starts the stream, and counts a running stream as started")
    check(record.shows[:7] == [p.LOOKING, p.NO_HEAD, p.CHARGING, p.OFF, p.ON, p.OFF, p.SIGNAL],
          "the LED shows looking, no head, charging, then Off, On, Off, and a bad stretch of signal")
    check(record.readings == [(0.8, True), (0.3, True), (0.9, False)],
          "on_reading hears every reading from slot 2, clean or not, and nothing from another slot")
    check(record.switched == [False, True, False], "on_switch hears Off at the start, then every change, and nothing for a bad stretch")

    # Readings stop with the link still up: after READING_MS the program lets go.
    quiet = Device("Ada's IntoMind One", readings=[(2, [0.8], False, False)], drops=False)
    program, record = load([quiet])
    task = asyncio.create_task(program.main())
    await until(lambda: not quiet.connected)
    task.cancel()
    check(not quiet.connected and record.switched == [False, True, False],
          "readings that stop end the link, and the switch goes Off")

    # Two links in a row that cannot be made: the board forgets its pairings.
    ada = Device("Ada's IntoMind One", readings=[])
    program, record = load([ada], connect_failures=2)
    task = asyncio.create_task(program.main())
    await until(lambda: len(record.connects) >= 3)
    task.cancel()
    check(record.forgotten == 1 and len(record.connects) >= 3, "two failed links in a row forget the pairings, and the third pairs again")

    # A name to look for: someone else's IntoMind One is never connected to.
    other = Device("Bo's IntoMind One")
    program, record = load([other])
    program.DEVICE_NAME_PREFIX = "Ada's"
    task = asyncio.create_task(program.main())
    await asyncio.sleep(0.1)
    task.cancel()
    check(record.connects == [], "with a name set, an IntoMind One by another name is left alone")


def run(check) -> None:
    asyncio.run(scenarios(check))
