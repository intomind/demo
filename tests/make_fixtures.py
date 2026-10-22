"""Fixtures for the trainer's tests, made once with the published Python API.

The browser trainer is a port of `intomind.model.train_head`. These files
hold embeddings in the integers a device sends, two-class targets, the
ridge the Python API chose for them, and the head it produced, so the
JavaScript port is held to the real thing rather than to itself.

    python3 tests/make_fixtures.py

Deterministic: the same seed gives the same files.
"""
from __future__ import annotations

import json
import pathlib

import numpy as np

from intomind import protocol as P
from intomind.model import gap_ridge, train_head

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "fixtures" / "train"
ENCODER = "e2f9b60f411f0e73"


def main() -> None:
    rng = np.random.default_rng(20261020)
    n, d = 150, 76
    x = rng.normal(0.0, 0.6, (n, d))
    # The encoder ends in a layer normalization, so every embedding it makes
    # sums to about zero. The fixture does too, so the ridge choice sees the
    # same near-dead direction a real recording shows.
    x -= x.mean(axis=1, keepdims=True)
    direction = rng.normal(size=d)
    score = x @ direction + rng.normal(0.0, 1.5, n)
    y = (score > np.median(score)).astype(float)
    q = [P.quantize_embedding(row) for row in x]
    ridge = gap_ridge(q)
    blob = train_head(q, y, name="fixture", encoder_id=ENCODER)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "embeddings.json").write_text(json.dumps([list(map(int, r)) for r in q]))
    (OUT / "targets.json").write_text(json.dumps([int(v) for v in y]))
    (OUT / "ridge.json").write_text(json.dumps({"ridge": ridge, "encoder_id": ENCODER, "name": "fixture"}))
    (OUT / "head.imh").write_bytes(blob)
    print(f"{n} windows of {d}, ridge {ridge:.6f}, head of {len(blob)} bytes")


if __name__ == "__main__":
    main()
