"""The Python side of the tests, with no device and no pytest.

    python3 tests/run_python.py

- The fixture head reproduces from its embeddings with the published
  train_head, byte for byte, so the fixture is what the Node tests think.
- The vendored heads decode with the published library, name their
  encoder, and evaluate as the device does.
- The scripts in python/ and micropython/ compile.
- The Mind-Controlled Microcontroller's MicroPython program behaves as the
  program in C does, against stand-ins for the board and the library.
"""
from __future__ import annotations

import json
import pathlib
import py_compile
import sys

from intomind import protocol as P
from intomind.model import gap_ridge, train_head

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
FX = HERE / "fixtures" / "train"
ENCODER = "e2f9b60f411f0e73"


def check(condition: bool, what: str, failures: list[str]) -> None:
    print(("ok   " if condition else "FAIL ") + what)
    if not condition:
        failures.append(what)


def main() -> int:
    failures: list[str] = []
    rows = json.loads((FX / "embeddings.json").read_text())
    targets = json.loads((FX / "targets.json").read_text())
    meta = json.loads((FX / "ridge.json").read_text())
    blob = train_head(rows, [float(t) for t in targets], name=meta["name"], encoder_id=meta["encoder_id"])
    check(blob == (FX / "head.imh").read_bytes(), "the fixture head reproduces byte for byte", failures)
    check(abs(gap_ridge(rows) - meta["ridge"]) < 1e-9 * meta["ridge"], "the fixture ridge reproduces", failures)

    sums = (ROOT / "vendor" / "heads" / "SHA256SUMS").read_text()
    for name in ("age.imh", "sex.imh"):
        path = ROOT / "vendor" / "heads" / ENCODER / name
        head = P.decode_head(path.read_bytes())
        check(head.encoder_id == ENCODER, f"{name} names encoder {ENCODER}", failures)
        check(head.in_dim == 76 and head.out_dim == 1, f"{name} is 76 in, 1 out", failures)
        zero = [0] * head.in_dim
        check(P.evaluate_head(head, zero)[0] == head.scale[0] * head.bias[0], f"{name} evaluates as the device does", failures)
        check(f"  {ENCODER}/{name}" in sums, f"{name} is listed in SHA256SUMS", failures)

    for script in sorted((ROOT / "python").glob("*.py")) + sorted((ROOT / "micropython").glob("*.py")):
        try:
            py_compile.compile(str(script), doraise=True)
            check(True, f"{script.parent.name}/{script.name} compiles", failures)
        except py_compile.PyCompileError as e:
            check(False, f"{script.parent.name}/{script.name} compiles: {e}", failures)
    for script in [HERE / "make_fixtures.py", ROOT / "check.py"]:
        try:
            py_compile.compile(str(script), doraise=True)
            check(True, f"{script.relative_to(ROOT)} compiles", failures)
        except py_compile.PyCompileError as e:
            check(False, f"{script.relative_to(ROOT)} compiles: {e}", failures)

    sys.path.insert(0, str(HERE))
    import microcontroller_test

    microcontroller_test.run(lambda ok, what: check(ok, what, failures))

    print("-" * 52)
    if failures:
        print(f"{len(failures)} failures")
        return 1
    print("every Python check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
