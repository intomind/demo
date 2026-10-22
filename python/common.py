"""Connect to one IntoMind One: the one named on the command line, or the
only one that answered."""
from __future__ import annotations

import sys

from intomind.client import display_names, scan
from intomind.session import Session


async def connect(name: str | None = None):
    """Scan, pick, connect. Returns the session and the device."""
    found = await scan()
    if not found:
        raise SystemExit("No IntoMind device answered. Turn it on and take it off the charger.")
    names = display_names(found)
    if name is None:
        if len(found) > 1:
            raise SystemExit("Several devices answered: " + ", ".join(names.values()) + ". Pass one of their names.")
        chosen = found[0]
    else:
        chosen = next((d for d in found if names[d.address] == name), None)
        if chosen is None:
            raise SystemExit(f"No device named {name!r}. Heard: " + ", ".join(names.values()))
    session = Session()
    await session.connect(chosen)
    device = session.devices[0]
    print(f"Connected to {names[chosen.address]}, {device.info.channels} channels.")
    return session, device


def name_arg(argv=None) -> str | None:
    """The device name from the command line, if one was given."""
    argv = sys.argv if argv is None else argv
    return argv[1] if len(argv) > 1 else None
