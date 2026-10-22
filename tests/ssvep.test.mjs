// The decoder finds the patch being looked at, and is not fooled by a rhythm that is not a patch.
import test from "node:test";
import assert from "node:assert/strict";
import { goertzelPower, scores, Detector } from "../lib/ssvep.js";
import { DEFAULT_RATES } from "../lib/flicker.js";

const fs = 500;

function lanes(hz, amplitude, noise, seconds = 2, channels = 4, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  const out = [];
  for (let c = 0; c < channels; c++) {
    const lane = [];
    for (let i = 0; i < fs * seconds; i++) {
      const t = i / fs;
      lane.push((hz ? amplitude * Math.sin(2 * Math.PI * hz * t + c) : 0) + noise * (rnd() + rnd() + rnd()));
    }
    out.push(lane);
  }
  return out;
}

test("Goertzel finds the power of a sine at its own frequency and little beside it", () => {
  const [x] = lanes(10, 4, 0, 2, 1);
  const at = goertzelPower(x, fs, 10);
  const beside = goertzelPower(x, fs, 12);
  assert.ok(at > 100 * beside, `${at} vs ${beside}`);
});

test("a patch's rate in the signal scores that patch and no other", () => {
  const s = scores(lanes(12, 3, 2), fs, DEFAULT_RATES);
  assert.ok(s.down > 4, `down ${s.down}`);
  for (const dir of ["up", "right", "left"]) assert.ok(s[dir] < 2, `${dir} ${s[dir]}`);
});

test("noise alone decides nothing", () => {
  const d = new Detector({ rates: DEFAULT_RATES });
  for (let i = 0; i < 4; i++) d.update(lanes(0, 0, 2, 2, 4, 11 + i), fs);
  assert.equal(d.current, null);
});

test("a rhythm between two patch rates, like a person's alpha peak, decides nothing", () => {
  const d = new Detector({ rates: DEFAULT_RATES });
  for (let i = 0; i < 4; i++) d.update(lanes(9, 4, 1, 2, 4, 3 + i), fs);
  assert.equal(d.current, null);
});

test("the hold takes two updates and the release takes two", () => {
  const d = new Detector({ rates: DEFAULT_RATES, hold: 2, release: 2 });
  assert.equal(d.update(lanes(15, 3, 1), fs), null);
  assert.equal(d.update(lanes(15, 3, 1, 2, 4, 9), fs), "left");
  assert.equal(d.update(lanes(0, 0, 1), fs), "left");
  assert.equal(d.update(lanes(0, 0, 1, 2, 4, 5), fs), null);
});

test("a baseline takes a person's own rhythm out of a patch's score", () => {
  const d = new Detector({ rates: DEFAULT_RATES, threshold: 2.5 });
  const own = lanes(10, 2.2, 1);
  const raw = scores(own, fs, DEFAULT_RATES);
  d.setBaseline([raw, raw]);
  assert.equal(d.decide(raw).dir, null);
});
