// The Alpha Flower's measurement: relative alpha power is computed from
// signal that ends at the newest sample, and the thresholds that count the
// eyes as closed are set from the wearer's baseline, never higher than 0.36
// and 0.27.

import test from "node:test";
import assert from "node:assert/strict";
import { relativeAlphaPower, windowSeconds, EyesClosed } from "../lib/alpha.js";

const FS = 250;
const near = (a, b) => Math.abs(a - b) < 1e-9;

/** White noise, the same every run. */
function noise(n, seed = 7) {
  let a = seed;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  }
  return out;
}

test("relative alpha power includes the newest signal: alpha in the last 0.9 seconds shows", () => {
  const n = Math.round(windowSeconds(FS) * FS);
  const quiet = noise(n);
  const late = quiet.map((v, i) => (i >= n - 0.9 * FS ? v + Math.sin((2 * Math.PI * 10 * i) / FS) : v));
  assert.ok(relativeAlphaPower([late], FS) > relativeAlphaPower([quiet], FS) + 0.1);
  // Three seconds hold only one periodogram, which ends 0.95 seconds before the newest sample.
  const old = Math.round(3 * FS);
  assert.equal(relativeAlphaPower([late.subarray(n - old)], FS), relativeAlphaPower([quiet.subarray(n - old)], FS));
});

test("until the eyes have been open for 2 seconds, the thresholds are 0.36 and 0.27", () => {
  const e = new EyesClosed();
  assert.deepEqual(e.thresholds(), { close: 0.36, open: 0.27 });
  for (let i = 0; i < 7; i++) e.update(0.15);
  assert.equal(e.baseline(), null);
  assert.deepEqual(e.thresholds(), { close: 0.36, open: 0.27 });
  e.update(0.15);
  assert.ok(near(e.thresholds().close, 0.25));
});

test("a wearer whose relative alpha power never reaches 0.36 with the eyes closed is caught from their baseline", () => {
  const e = new EyesClosed();
  for (let i = 0; i < 40; i++) assert.equal(e.update([0.14, 0.15, 0.16][i % 3]), false);
  assert.ok(near(e.baseline(), 0.15));
  const { close, open } = e.thresholds();
  assert.ok(near(close, 0.25) && near(open, 0.2), `${close} ${open}`);
  assert.equal(e.update(0.26), true, "closed at 0.26, which 0.36 would miss");
  assert.equal(e.update(0.21), true);
  assert.equal(e.update(0.19), false);
});

test("values while the eyes count as closed never move the baseline", () => {
  const e = new EyesClosed();
  for (let i = 0; i < 40; i++) e.update(0.15);
  const before = e.thresholds();
  for (let i = 0; i < 200; i++) assert.equal(e.update(0.3 + 0.01 * (i % 5)), true);
  assert.deepEqual(e.thresholds(), before);
});

test("the thresholds are never higher than 0.36 and 0.27", () => {
  const e = new EyesClosed();
  for (let i = 0; i < 40; i++) e.update(0.33);
  assert.deepEqual(e.thresholds(), { close: 0.36, open: 0.27 });
});

test("the baseline is the median of the last 20 seconds with the eyes open", () => {
  const e = new EyesClosed();
  for (let i = 0; i < 80; i++) e.update(0.2);
  assert.ok(near(e.thresholds().close, 0.3));
  for (let i = 0; i < 80; i++) e.update(0.1);
  assert.ok(near(e.thresholds().close, 0.2));
});

test("reset forgets the wearer, so a baseline from one wearer cannot hold the next one's eyes closed", () => {
  const e = new EyesClosed();
  for (let i = 0; i < 40; i++) e.update(0.12);
  // The next wearer's eyes are open at 0.25: above the first wearer's close threshold, 0.22.
  assert.equal(e.update(0.25), true);
  for (let i = 0; i < 20; i++) assert.equal(e.update(0.25), true, "held closed by the first wearer's baseline");
  e.reset();
  assert.equal(e.closed, false);
  assert.deepEqual(e.thresholds(), { close: 0.36, open: 0.27 });
  for (let i = 0; i < 40; i++) assert.equal(e.update(0.25), false);
  assert.ok(near(e.baseline(), 0.25));
});
