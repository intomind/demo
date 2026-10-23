"""Take a custom AI head off your IntoMind One.

    python3 remove_head.py [--slot 2] ["Ada's IntoMind One"]

Slot 2 is where the Mind-Controlled Light Switch demo installs a custom AI
head, so that is the slot removed unless --slot names another of the four
user slots. Slot 0 holds the open source AI head for age and is the
device's own, so it cannot be removed. Slot 1 holds the open source AI head
for biological sex, which the Biological Sex Detector demo puts back when
it finds the slot empty.
"""
from __future__ import annotations

import argparse
import asyncio

from common import connect


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", nargs="?", help="the device's name, when several answer")
    ap.add_argument("--slot", type=int, default=2, help="the user slot to empty, 1 to 4")
    args = ap.parse_args()
    if args.slot < 1:
        raise SystemExit("Slot 0 is the device's own head and cannot be removed.")

    session, dev = await connect(args.name)
    try:
        if not dev.can("heads"):
            raise SystemExit("This device reports no head slots.")
        _active, heads = await dev.heads()
        entry = next((h for h in heads if h.slot == args.slot), None)
        if entry is None:
            raise SystemExit(f"This device has no slot {args.slot}. It has slots 1 to {len(heads) - 1}.")
        if not entry.usable:
            print(f"Slot {args.slot} is empty. Nothing to remove.")
            return
        shown = entry.name or "a custom AI head"
        await dev.remove_head(args.slot)
        _active, heads = await dev.heads()
        after = next(h for h in heads if h.slot == args.slot)
        if after.usable:
            raise SystemExit(f"The device still lists a head in slot {args.slot}.")
        print(f"Removed {shown} from slot {args.slot}. The slot is empty.")
    finally:
        await session.close()


if __name__ == "__main__":
    asyncio.run(main())
