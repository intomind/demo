// Which flickering patch the eyes are on, from the raw signal: the power at
// each patch's rate against the power beside it, averaged over channels,
// with a hold so a glance does not steer and a release so letting go stops.
//
// Power at an exact frequency comes from Goertzel's algorithm, which needs
// no transform length to divide the rate evenly. Resolution is set by the
// window: two seconds resolves half a hertz.

import { hann } from "./fft.js";

/** Power of the Hann-windowed signal `x` at exactly `hz`, sampled at `fs`. */
export function goertzelPower(x, fs, hz, window = null) {
  const n = x.length;
  const w = window ?? hann(n);
  const k = (2 * Math.PI * hz) / fs;
  const coeff = 2 * Math.cos(k);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  for (let i = 0; i < n; i++) {
    s0 = (x[i] - mean) * w[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const re = s1 - s2 * Math.cos(k);
  const im = s2 * Math.sin(k);
  return (re * re + im * im) / (n * n);
}

/** Offsets, in hertz, of the bins that stand for the noise beside a rate. */
const NEIGHBORS = [-2, -1.5, -1, 1, 1.5, 2];

/**
 * For every patch, the power at its rate over the mean power beside it,
 * plus half the same for its second harmonic, averaged across channels.
 * A score near 1 is nothing. A patch being looked at scores several.
 */
export function scores(lanes, fs, rates) {
  const out = {};
  const n = lanes[0]?.length ?? 0;
  if (n === 0) return out;
  const w = hann(n);
  const power = (hz) => {
    let p = 0;
    for (const lane of lanes) p += goertzelPower(lane, fs, hz, w);
    return p / lanes.length;
  };
  const snr = (hz) => {
    let noise = 0;
    for (const d of NEIGHBORS) noise += power(hz + d);
    noise /= NEIGHBORS.length;
    return noise > 0 ? power(hz) / noise : 0;
  };
  for (const [dir, hz] of Object.entries(rates)) {
    out[dir] = snr(hz) + 0.5 * Math.max(0, snr(2 * hz) - 1);
  }
  return out;
}

export class Detector {
  /**
   * `threshold` is the score a patch must reach, `margin` how far ahead of
   * the next patch it must be, `hold` how many updates in a row before a
   * patch counts, `release` how many empty updates before letting go.
   */
  constructor({ rates = {}, threshold = 2.5, margin = 1.25, hold = 2, release = 2 } = {}) {
    this.rates = rates;
    this.threshold = threshold;
    this.margin = margin;
    this.hold = hold;
    this.release = release;
    this.baseline = null;
    this.current = null;
    this.pending = null;
    this.pendingCount = 0;
    this.emptyCount = 0;
    this.last = {};
  }

  /** What the scores say right now, before the hold and release. */
  decide(raw) {
    const adjusted = {};
    for (const [dir, s] of Object.entries(raw)) adjusted[dir] = this.baseline ? s / Math.max(1, this.baseline[dir] ?? 1) : s;
    const ranked = Object.entries(adjusted).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) return { dir: null, scores: adjusted };
    const [bestDir, best] = ranked[0];
    const second = ranked[1]?.[1] ?? 0;
    const dir = best >= this.threshold && best >= second * this.margin ? bestDir : null;
    return { dir, scores: adjusted };
  }

  /** One update from the latest window. Returns the held decision. */
  update(lanes, fs) {
    const raw = scores(lanes, fs, this.rates);
    const { dir, scores: adjusted } = this.decide(raw);
    this.last = adjusted;
    if (dir === null) {
      this.pending = null;
      this.pendingCount = 0;
      this.emptyCount += 1;
      if (this.emptyCount >= this.release) this.current = null;
    } else {
      this.emptyCount = 0;
      if (dir === this.current) {
        this.pending = null;
        this.pendingCount = 0;
      } else if (dir === this.pending) {
        this.pendingCount += 1;
        if (this.pendingCount >= this.hold) {
          this.current = dir;
          this.pending = null;
          this.pendingCount = 0;
        }
      } else {
        this.pending = dir;
        this.pendingCount = 1;
      }
    }
    return this.current;
  }

  /** Remember what each rate scores with no patch on screen, so a person's own rhythm is not taken for a patch. */
  setBaseline(samples) {
    const base = {};
    for (const dir of Object.keys(this.rates)) {
      const vals = samples.map((s) => s[dir] ?? 1);
      base[dir] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 1;
    }
    this.baseline = base;
  }

  clearBaseline() {
    this.baseline = null;
  }

  reset() {
    this.current = null;
    this.pending = null;
    this.pendingCount = 0;
    this.emptyCount = 0;
  }
}
