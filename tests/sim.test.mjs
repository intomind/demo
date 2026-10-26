// The simulated IntoMind One behaves like a person for the demos that read its raw signal: the Alpha
// Flower's relative alpha power is low with the eyes open and high with them closed, and the flight simulator finds
// the light being looked at. Math.random is seeded, so every run sees the same signal.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.window ??= { addEventListener() {} };
const { Sim } = await import("../lib/sim.js");
const { relativeAlphaPower, windowSeconds, EyesClosed } = await import("../lib/alpha.js");
const { Detector, scores } = await import("../lib/ssvep.js");

function seed(n) {
  let a = n >>> 0;
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A quarter of a second of signal, in the steps the simulation takes. */
function quarter(sim) { for (let k = 0; k < 6; k++) sim.step(k === 5 ? 0.05 : 0.04); }

/** Thirty seconds of the Alpha Flower: relative alpha power four times a second, and the fraction of that time its flower grows. */
function flower(closed, runSeed) {
  seed(runSeed);
  const sim = new Sim(new URLSearchParams(closed ? "closed&idle" : "idle"));
  const values = [];
  const eyes = new EyesClosed();
  let growing = 0, ticks = 0;
  for (let t = 0; t < 33; t += 0.25) {
    quarter(sim);
    if (t < 3) continue;
    const s = relativeAlphaPower(sim.recent(windowSeconds(sim.fs)), sim.fs);
    values.push(s);
    // The page's own thresholds, set from the wearer's baseline.
    const closed = eyes.update(s);
    ticks++;
    if (closed) growing++;
  }
  values.sort((a, b) => a - b);
  return { median: values[values.length >> 1], grows: growing / ticks };
}

test("with the eyes open, relative alpha power stays low and the flower does not grow", () => {
  for (const s of [1, 2, 3, 4, 5]) {
    const { median, grows } = flower(false, s);
    assert.ok(median < 0.27, `median ${median}`);
    assert.ok(grows < 0.05, `grew ${grows} of the time`);
  }
});

test("with the eyes closed, relative alpha power is high and the flower grows", () => {
  for (const s of [1, 2, 3, 4, 5]) {
    const { median, grows } = flower(true, s);
    assert.ok(median > 0.45, `median ${median}`);
    assert.ok(grows > 0.95, `grew ${grows} of the time`);
  }
});

test("the flight simulator turns toward the light being looked at", () => {
  const RATES = { up: 8, right: 10, down: 12, left: 15 };
  for (const dir of Object.keys(RATES)) {
    seed(dir.length * 7);
    const sim = new Sim(new URLSearchParams("idle"));
    const detector = new Detector({ rates: RATES, threshold: 2.5, hold: 2, release: 2 });
    const baseline = [];
    for (let t = 0; t < 12; t += 0.25) { quarter(sim); if (t >= 2) baseline.push(scores(sim.recent(2), sim.fs, RATES)); }
    detector.setBaseline(baseline);
    sim.look = dir;
    let held = null;
    for (let t = 0; t < 6; t += 0.25) { quarter(sim); held = detector.update(sim.recent(2), sim.fs); }
    assert.equal(held, dir);
  }
});
