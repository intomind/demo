"""Record a minute and keep it: a capture with provenance and checksums,
exported to BDF, and opened in MNE if MNE is installed.

    python3 record_and_export.py [--seconds 60] [--label my-first-minute] ["Ada's IntoMind One"]

Recordings go to ~/.local/share/intomind/captures unless INTOMIND_CAPTURES
says otherwise. This is the one script here that writes anything, and it
writes only to your own disk.
"""
from __future__ import annotations

import argparse
import asyncio
import time

from intomind import export, provenance
from intomind.experiments import Recorder

from common import connect


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", nargs="?", help="the device's name, when several answer")
    ap.add_argument("--seconds", type=float, default=60.0)
    ap.add_argument("--label", default=time.strftime("demo-%Y%m%d-%H%M%S"))
    args = ap.parse_args()

    session, dev = await connect(args.name)
    rec = Recorder()
    dev.on_sample = rec.on_sample
    dev.on_packet = rec.on_packet
    rec.arm(dev)
    await dev.start()
    print(f"Recording {args.seconds:.0f} seconds. Sit still, blink, close your eyes for a while.")
    try:
        await asyncio.sleep(args.seconds)
    finally:
        await dev.stop()
    meta = rec.save(dev, args.label, {"experiment": "demo-record"})
    await session.close()
    print(f"Saved {meta['n']} samples as {args.label} in {provenance.captures_dir()}, with its manifest and checksums.")

    result = export.export(args.label, "bdf")
    exact = "every value exact" if not result.get("lossy") else f"largest error {result.get('max_error_uv')} microvolts"
    print(f"BDF at {result['path']}: {result['samples']} samples, {result['channels']} channels at "
          f"{result['sample_rate_hz']:.0f} per second, {exact}.")
    try:
        import mne
    except ImportError:
        print("MNE is not installed. To open the file there: pip install mne, then mne.io.read_raw_bdf(path).")
        return
    raw = mne.io.read_raw_bdf(result["path"], preload=True, verbose="error")
    print(raw)
    print("Try raw.plot(), or raw.compute_psd(fmax=45).plot(), with matplotlib installed.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
