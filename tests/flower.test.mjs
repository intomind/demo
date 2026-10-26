// Alpha Flower's fractal only ever grows: a generation read from the signal
// is kept, and more signal adds to every style's drawing without moving
// anything already drawn.

import test from "node:test";
import assert from "node:assert/strict";
import { Fractal, sampleSignal, sampleChannels } from "../lib/electric.js";
import { drawPhasePortrait, drawSpectralMandala, drawFlowBloom } from "../lib/blooms.js";

const FS = 250;
const X = sampleSignal(FS, 24, 1);
/** The last 12 seconds at `s` seconds in, as the demo reads them. */
const at = (s) => X.subarray(Math.max(0, Math.round((s - 12) * FS)), Math.round(s * FS));

function grownFractal() {
  const f = new Fractal(at(2), FS);
  for (let d = 1; d < 6; d++) f.grow(at(4 * d), FS);
  return f;
}

test("a generation once read is kept as the next ones grow", () => {
  const f = new Fractal(at(2), FS);
  for (let d = 1; d < 6; d++) {
    const kept = JSON.stringify(f.generations);
    f.grow(at(4 * d), FS);
    assert.equal(JSON.stringify(f.generations.slice(0, d)), kept);
  }
  assert.equal(f.generations.length, 6);
});

test("growing moves nothing already drawn: whole generations stay put and the newest only lengthens", () => {
  const f = grownFractal();
  const place = (s) => [s.x0, s.y0, s.mx, s.my, s.x1, s.y1, s.depth].map((v) => Math.round(v * 1e9)).join();
  let before = null;
  for (let grown = 0.05; grown <= 6; grown += 0.05) {
    const segs = f.segments(grown);
    if (before !== null) {
      const whole = Math.floor(before.grown);
      const was = before.segs.filter((s) => s.depth < whole).map(place);
      const now = segs.filter((s) => s.depth < whole).map(place);
      assert.deepEqual(now, was);
      // The newest generation starts where it was, and its ends move only outward along their own curves.
      for (const [i, s] of segs.filter((x) => x.depth === whole).entries()) {
        const p = before.segs.filter((x) => x.depth === whole)[i];
        if (p) assert.deepEqual([s.x0, s.y0], [p.x0, p.y0]);
      }
    }
    before = { grown, segs };
  }
});

test("the same signal gives the same fractal, and a different signal another", () => {
  assert.equal(JSON.stringify(grownFractal().generations), JSON.stringify(grownFractal().generations));
  const other = new Fractal(sampleSignal(FS, 2, 2), FS);
  assert.notEqual(JSON.stringify(other.generations[0]), JSON.stringify(grownFractal().generations[0]));
});

/** A drawing surface that remembers every stroke as its ends, its width and its color. */
function recorder() {
  const strokes = [];
  let path = [];
  const g = {
    save() {}, restore() {}, translate() {}, scale() {}, fillRect() {},
    beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
    stroke() { strokes.push(`${path.map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`).join(" ")} ${g.lineWidth} ${g.strokeStyle}`); },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  return { g, strokes };
}

/** Whether every stroke of `a` is also in `b`, as many times. */
function within(a, b) {
  const count = new Map();
  for (const s of b) count.set(s, (count.get(s) ?? 0) + 1);
  for (const s of a) {
    const n = count.get(s) ?? 0;
    if (n === 0) return false;
    count.set(s, n - 1);
  }
  return true;
}

test("the other three styles only add to what they drew as more signal comes", () => {
  const all = sampleChannels(FS, 12, 1);
  const first = 2 * FS;
  const styles = [
    (g, ch, growth) => drawPhasePortrait(g, 0, 0, 100, ch, FS, { growth, first }),
    (g, ch, growth) => drawSpectralMandala(g, 0, 0, 100, ch, FS, { growth, total: ch.length * 6 }),
    (g, ch, growth) => drawFlowBloom(g, 0, 0, 100, ch, FS, { growth, first, motes: 24 }),
  ];
  for (const draw of styles) {
    let before = null;
    for (const seconds of [2, 4, 6, 9, 12]) {
      const ch = all.map((x) => Array.from(x.subarray(0, seconds * FS)));
      const { g, strokes } = recorder();
      draw(g, ch, seconds / 24);
      if (before !== null) assert.ok(within(before, strokes), `${draw} moved something it drew at less signal`);
      before = strokes;
    }
  }
});
