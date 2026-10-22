// The alpha band's share of the signal, from the last few seconds of every channel.

import { welch, bandPower, nfftFor } from "./fft.js";

export const ALPHA = [8, 13];
const WIDE = [4, 30];

/** The share of 4 to 30 hertz power that lies in the alpha band, averaged over channels. Null before there is enough signal. */
export function alphaShare(lanes, fs) {
  const nfft = nfftFor(fs);
  const shares = [];
  for (const lane of lanes) {
    const s = welch(lane, fs, nfft);
    if (s === null) continue;
    const wide = bandPower(s.freqs, s.psd, WIDE[0], WIDE[1]);
    if (wide > 0) shares.push(bandPower(s.freqs, s.psd, ALPHA[0], ALPHA[1]) / wide);
  }
  return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
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
  let bestShare = -1;
  lanes.forEach((lane, i) => {
    const share = alphaShare([lane], fs);
    if (share !== null && share > bestShare) { bestShare = share; best = i; }
  });
  return best;
}
