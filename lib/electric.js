// The Alpha Flower: an electric fractal computed from the signal itself.
//
// Nothing here is random. The alpha peak sets the symmetry. The theta to
// alpha ratio sets how many times each filament splits. The alpha share
// sets how far each generation reaches. The beta share sets how wide the
// splits open. And every turn and bend of every filament is read, in
// order, from the band-passed samples of the signal. The same signal
// gives the same fractal. A different person gives a different one.

import { goertzelPower } from "./ssvep.js";
import { bandpass } from "./alpha.js";
import { hann } from "./fft.js";

/** What the form reads out of the signal. */
export function features(x, fs) {
  const w = hann(x.length);
  const p = (hz) => goertzelPower(x, fs, hz, w);
  let alphaHz = 10;
  let best = -1;
  for (let hz = 7; hz <= 14; hz += 0.1) {
    const v = p(hz);
    if (v > best) { best = v; alphaHz = hz; }
  }
  const band = (lo, hi) => { let s = 0; for (let hz = lo; hz < hi; hz += 0.5) s += p(hz); return s; };
  const theta = band(4, 7.5);
  const alpha = band(7.5, 13);
  const beta = band(13, 30);
  const total = theta + alpha + beta || 1;
  return { alphaHz, thetaRatio: theta / (alpha || 1), share: alpha / total, betaShare: beta / total };
}

function normalized(x, fs) {
  const y = bandpass(x, fs);
  const skip = Math.floor(y.length * 0.25);
  const out = Array.from(y.subarray(skip));
  const mags = out.map(Math.abs).sort((a, b) => a - b);
  const scale = Math.max(1e-9, mags[Math.floor(mags.length * 0.9)] ?? 1);
  return out.map((v) => Math.max(-1, Math.min(1, v / scale)));
}

/**
 * The filaments of the fractal, as segments in the fractal's own units,
 * from a stretch of signal. `growth` from 0 to 1 is how far it has grown:
 * each generation of filaments opens in turn, and the newest one extends.
 */
export function filaments(x, fs, { growth = 1, maxDepth = 6 } = {}) {
  const f = features(x, fs);
  const N = Math.max(6, Math.min(14, Math.round(f.alphaHz)));
  const children = f.thetaRatio > 0.7 ? 3 : 2;
  const scale = 0.56 + 0.2 * Math.max(0, Math.min(1, f.share));
  const spread = 0.38 + 0.55 * Math.max(0, Math.min(1, f.betaShare * 2));
  const xs = normalized(x, fs);
  const depthLimit = growth * maxDepth;
  const segs = [];
  for (let k = 0; k < N; k++) {
    let idx = 0;
    const next = () => xs[(idx++) % xs.length];
    const base = (k / N) * Math.PI * 2 - Math.PI / 2;
    const branch = (x0, y0, angle, len, depth) => {
      if (depth >= Math.ceil(depthLimit)) return;
      const reach = depth < Math.floor(depthLimit) ? 1 : depthLimit - Math.floor(depthLimit);
      const a = angle + 0.5 * next();
      const L = len * (0.82 + 0.3 * Math.abs(next())) * reach;
      const bend = 0.55 * L * next();
      const mx = x0 + Math.cos(a) * L * 0.5 - Math.sin(a) * bend;
      const my = y0 + Math.sin(a) * L * 0.5 + Math.cos(a) * bend;
      const x1 = x0 + Math.cos(a) * L;
      const y1 = y0 + Math.sin(a) * L;
      segs.push({ x0, y0, mx, my, x1, y1, depth, tip: depth === Math.ceil(depthLimit) - 1 });
      if (reach < 1) return;
      for (let c = 0; c < children; c++) {
        const off = spread * (c - (children - 1) / 2) + 0.18 * next();
        branch(x1, y1, a + off, len * scale, depth + 1);
      }
    };
    branch(0, 0, base, 0.3, 0);
  }
  return { segs, symmetry: N, children, scale, spread, alphaHz: f.alphaHz, share: f.share, thetaRatio: f.thetaRatio, betaShare: f.betaShare };
}

/**
 * Where the fractal's color comes from, each read from the signal:
 * "peak": the alpha peak frequency, 8 to 13 hertz spread over the whole wheel;
 * "phase": the mean phase lag between the first two channels;
 * "spectrum": each generation takes the hue of a frequency band, slow warm to fast cool;
 * "share": white light, tinted by how much of the signal is alpha.
 */
export function colorOf(form, channels, fs, mapping = "peak") {
  const f = form;
  if (mapping === "peak") return { hue: ((f.alphaHz - 8) / 5) * 360, perDepth: 6, sat: 100 };
  if (mapping === "phase" && channels && channels.length > 1) {
    const a = bandpass(channels[0], fs), b = bandpass(channels[1], fs);
    let sx = 0, sy = 0;
    for (let i = Math.floor(a.length * 0.3); i < a.length - 1; i++) {
      // The lag, from the sign of one channel against the slope of the other.
      sx += a[i] * b[i];
      sy += a[i] * (b[i + 1] - b[i - 1]);
    }
    const lag = Math.atan2(sy, sx);
    return { hue: ((lag + Math.PI) / (2 * Math.PI)) * 360, perDepth: 10, sat: 95 };
  }
  if (mapping === "spectrum") return { hue: 20, perDepth: 42, sat: 100, slowWarm: true };
  if (mapping === "share") return { hue: 40 + 200 * (1 - Math.min(1, f.share)), perDepth: 0, sat: 18 };
  return { hue: 338, perDepth: 6, sat: 100 };
}

/**
 * Draw the fractal: a wide soft glow pass, a thin hot core pass, light at
 * the tips, and a white heart. On a light field the same light is drawn
 * by multiplying into the paper, so the colors stay the signal's.
 */
export function drawElectric(g, cx, cy, R, form, { hue = 338, t = 0, perDepth = 6, sat = 100, paper = false } = {}) {
  const { segs } = form;
  const maxDepth = segs.reduce((m, s) => Math.max(m, s.depth), 0) + 1;
  g.save();
  g.translate(cx, cy);
  g.scale(R, R);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.globalCompositeOperation = paper ? "multiply" : "lighter";
  for (const pass of [0, 1]) {
    for (const s of segs) {
      const d = s.depth / maxDepth;
      const h = hue + perDepth * s.depth;
      if (paper) {
        const light = 46 - 8 * d;
        if (pass === 0) {
          g.strokeStyle = `hsla(${h}, ${sat}%, ${light + 10}%, ${0.1 + 0.05 * (1 - d)})`;
          g.lineWidth = 0.03 + 0.05 * (1 - d);
        } else {
          g.strokeStyle = `hsla(${h + 6}, ${sat}%, ${light}%, ${0.6 + 0.3 * d})`;
          g.lineWidth = 0.004 + 0.012 * (1 - d);
        }
      } else {
        const light = 48 + 40 * d;
        if (pass === 0) {
          g.strokeStyle = `hsla(${h}, ${sat}%, ${light}%, ${0.05 + 0.03 * (1 - d)})`;
          g.lineWidth = 0.03 + 0.05 * (1 - d);
        } else {
          g.strokeStyle = `hsla(${h + 6}, ${sat}%, ${light + 22}%, ${0.5 + 0.35 * d})`;
          g.lineWidth = 0.004 + 0.012 * (1 - d);
        }
      }
      g.beginPath();
      g.moveTo(s.x0, s.y0);
      g.quadraticCurveTo(s.mx, s.my, s.x1, s.y1);
      g.stroke();
    }
  }
  for (const s of segs) {
    if (!s.tip) continue;
    const tw = 0.9 + 0.1 * Math.sin(t * 3 + s.x1 * 7);
    const th = hue + perDepth * s.depth;
    const grad = g.createRadialGradient(s.x1, s.y1, 0, s.x1, s.y1, 0.035);
    if (paper) {
      grad.addColorStop(0, `hsla(${th + 10}, ${sat}%, 45%, ${0.7 * tw})`);
      grad.addColorStop(0.5, `hsla(${th}, ${sat}%, 50%, ${0.2 * tw})`);
      grad.addColorStop(1, `hsla(${th}, ${sat}%, 50%, 0)`);
    } else {
      grad.addColorStop(0, `hsla(${th + 20}, ${sat}%, 92%, ${0.85 * tw})`);
      grad.addColorStop(0.4, `hsla(${th + 10}, ${sat}%, 70%, ${0.35 * tw})`);
      grad.addColorStop(1, `hsla(${th}, ${sat}%, 60%, 0)`);
    }
    g.fillStyle = grad;
    g.fillRect(s.x1 - 0.035, s.y1 - 0.035, 0.07, 0.07);
  }
  const heart = g.createRadialGradient(0, 0, 0, 0, 0, 0.16);
  if (paper) {
    heart.addColorStop(0, `hsla(${hue + 12}, ${sat}%, 45%, 0.8)`);
    heart.addColorStop(0.4, `hsla(${hue}, ${sat}%, 50%, 0.3)`);
    heart.addColorStop(1, `hsla(${hue}, ${sat}%, 50%, 0)`);
  } else {
    heart.addColorStop(0, `hsla(${hue + 24}, ${sat}%, 96%, 0.95)`);
    heart.addColorStop(0.3, `hsla(${hue + 12}, ${sat}%, 74%, 0.55)`);
    heart.addColorStop(1, `hsla(${hue}, ${sat}%, 60%, 0)`);
  }
  g.fillStyle = heart;
  g.fillRect(-0.2, -0.2, 0.4, 0.4);
  if (!paper) {
    const halo = g.createRadialGradient(0, 0, 0.3, 0, 0, 1.25);
    halo.addColorStop(0, `hsla(${hue}, ${sat}%, 60%, 0.09)`);
    halo.addColorStop(1, `hsla(${hue}, ${sat}%, 60%, 0)`);
    g.fillStyle = halo;
    g.fillRect(-1.3, -1.3, 2.6, 2.6);
  }
  g.restore();
}

/** Four channels of a fixed sample signal, with phase lags between them, for the options that read phase. Never used on a device. */
export function sampleChannels(fs = 250, seconds = 6, variant = 0) {
  const out = [];
  for (let c = 0; c < 4; c++) {
    const x = new Float64Array(fs * seconds);
    const alphaHz = [10.3, 9.1, 11.6][variant % 3] + c * 0.04;
    const lag = c * (0.35 + 0.2 * variant);
    for (let i = 0; i < x.length; i++) {
      const t = i / fs;
      const env = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.21 * t + variant + c * 0.5);
      x[i] = (22 - 3 * c) * env * Math.sin(2 * Math.PI * alphaHz * t + 0.4 * variant + lag)
        + 6 * Math.sin(2 * Math.PI * 6.3 * t + 1.1 + c)
        + 3 * Math.sin(2 * Math.PI * 18.7 * t + 2.2 + variant + c * 0.3)
        + 2.5 * Math.sin(2 * Math.PI * 1.3 * t) * Math.sin(2 * Math.PI * 10.9 * t + 0.7 + lag)
        + 1.5 * Math.sin(2 * Math.PI * 0.07 * t * (3 + variant)) * Math.sin(2 * Math.PI * 24.1 * t + c);
    }
    out.push(x);
  }
  return out;
}

/** A fixed stretch of signal for a comp, so the deck shows one fractal. Never used on a device. */
export function sampleSignal(fs = 250, seconds = 6, variant = 0) {
  const out = new Float64Array(fs * seconds);
  const alphaHz = [10.3, 9.1, 11.6][variant % 3];
  for (let i = 0; i < out.length; i++) {
    const t = i / fs;
    const env = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.21 * t + variant);
    out[i] = 22 * env * Math.sin(2 * Math.PI * alphaHz * t + 0.4 * variant)
      + 6 * Math.sin(2 * Math.PI * 6.3 * t + 1.1)
      + 3 * Math.sin(2 * Math.PI * 18.7 * t + 2.2 + variant)
      + 2.5 * Math.sin(2 * Math.PI * 1.3 * t) * Math.sin(2 * Math.PI * 10.9 * t + 0.7)
      + 1.5 * Math.sin(2 * Math.PI * 0.07 * t * (3 + variant)) * Math.sin(2 * Math.PI * 24.1 * t);
  }
  return out;
}
