// Relative alpha power: the power in the alpha band, 8 to 13 hertz, as a
// fraction of the power from 4 to 30 hertz, from the last few seconds of
// every channel.

import { welch, bandPower, nfftFor } from "./fft.js";

export const ALPHA = [8, 13];
const WIDE = [4, 30];

/**
 * The seconds relative alpha power is computed from: one and a half
 * transform lengths, so Welch's method averages two periodograms
 * overlapping by half, and the second ends at the newest sample.
 */
export function windowSeconds(fs) {
  return (1.5 * nfftFor(fs)) / fs;
}

/** Relative alpha power, averaged over channels. Null before there is enough signal. */
export function relativeAlphaPower(lanes, fs) {
  const nfft = nfftFor(fs);
  const values = [];
  for (const lane of lanes) {
    const s = welch(lane, fs, nfft);
    if (s === null) continue;
    const wide = bandPower(s.freqs, s.psd, WIDE[0], WIDE[1]);
    if (wide > 0) values.push(bandPower(s.freqs, s.psd, ALPHA[0], ALPHA[1]) / wide);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Whether the eyes count as closed, from relative alpha power four times a
 * second. How far closing the eyes raises it differs from person to
 * person, so the thresholds are set from the wearer's baseline: the median
 * of the last `keep` values while the eyes counted as open. The eyes count
 * as closed at 0.1 or more above the baseline, and as open again at 0.05 or
 * less above it, which is hysteresis. Until there are `least` such values,
 * and wherever the wearer's thresholds would be higher, the thresholds are
 * 0.36 and 0.27.
 */
export class EyesClosed {
  constructor({ close = 0.36, open = 0.27, closeAbove = 0.1, openAbove = 0.05, keep = 80, least = 8 } = {}) {
    this.start = { close, open };
    this.closeAbove = closeAbove;
    this.openAbove = openAbove;
    this.keep = keep;
    this.least = least;
    this.reset();
  }

  /** Forget the wearer: the starting thresholds again, with the eyes open. */
  reset() {
    this.openValues = [];
    this.closed = false;
  }

  /** The wearer's baseline, or null until there are `least` values with the eyes open. */
  baseline() {
    if (this.openValues.length < this.least) return null;
    const s = [...this.openValues].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** The two thresholds now: closed at or above `close`, open again at or below `open`. */
  thresholds() {
    const b = this.baseline();
    if (b === null) return this.start;
    return { close: Math.min(this.start.close, b + this.closeAbove), open: Math.min(this.start.open, b + this.openAbove) };
  }

  /** One value of relative alpha power. Returns whether the eyes count as closed. */
  update(value) {
    const { close, open } = this.thresholds();
    if (!this.closed && value >= close) this.closed = true;
    else if (this.closed && value <= open) this.closed = false;
    if (!this.closed) {
      this.openValues.push(value);
      if (this.openValues.length > this.keep) this.openValues.shift();
    }
    return this.closed;
  }
}

/** A second-order band pass, run forward over `x`. */
export function bandpass(x, fs, lo = ALPHA[0], hi = ALPHA[1]) {
  const f0 = Math.sqrt(lo * hi);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) * Math.sinh(((Math.log(2) / 2) * (Math.log2(hi / lo))) * (w0 / Math.sin(w0)));
  const b0 = alpha;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha;
  const out = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = Number.isNaN(x[i]) ? 0 : x[i];
    const y = (b0 * xi + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** The channel whose signal has the most alpha right now, for drawing from one channel. */
export function bestLane(lanes, fs) {
  let best = 0;
  let most = -1;
  lanes.forEach((lane, i) => {
    const value = relativeAlphaPower([lane], fs);
    if (value !== null && value > most) { most = value; best = i; }
  });
  return best;
}
