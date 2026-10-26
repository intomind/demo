// The Alpha Flower: an electric fractal computed from the signal itself.
//
// Nothing here is random. The alpha peak sets the symmetry. The theta to
// alpha ratio sets how many times each filament splits. Relative alpha
// power sets how far each generation reaches. Relative beta power sets how
// wide the splits open. And every turn and bend of every filament is read, in
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
  return { alphaHz, thetaRatio: theta / (alpha || 1), relativeAlpha: alpha / total, relativeBeta: beta / total };
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
 * The fractal, grown from the signal a generation at a time. The signal
 * when it first appears sets the form: the alpha peak the symmetry, theta
 * against alpha how many times each filament splits, relative alpha
 * power how far each generation reaches, relative beta power how wide the
 * splits open, and its samples the first filaments' turns and bends. Each later
 * generation's turns and bends are read, in order, from the signal when
 * that generation begins. What has grown never changes: new signal only
 * adds the next generation.
 */
export class Fractal {
  /** From one channel's signal when the fractal first appears, sampled at `fs`. */
  constructor(first, fs) {
    const f = features(first, fs);
    this.alphaHz = f.alphaHz;
    this.relativeAlpha = f.relativeAlpha;
    this.thetaRatio = f.thetaRatio;
    this.relativeBeta = f.relativeBeta;
    this.symmetry = Math.max(6, Math.min(14, Math.round(f.alphaHz)));
    this.children = f.thetaRatio > 0.7 ? 3 : 2;
    this.scale = 0.56 + 0.2 * Math.max(0, Math.min(1, f.relativeAlpha));
    this.spread = 0.38 + 0.55 * Math.max(0, Math.min(1, f.relativeBeta * 2));
    /** One arm's filaments, generation by generation. Every arm is the same arm, turned. */
    this.generations = [];
    this.tips = [];
    this.grow(first, fs);
  }

  /** The next generation, its turns and bends read in order from the signal `x`. */
  grow(x, fs) {
    const xs = normalized(x, fs);
    let i = 0;
    const next = () => xs[(i++) % xs.length];
    const depth = this.generations.length;
    const segs = [];
    const tips = [];
    const branch = (x0, y0, angle, len) => {
      const a = angle + 0.5 * next();
      const L = len * (0.82 + 0.3 * Math.abs(next()));
      const bend = 0.55 * L * next();
      const x1 = x0 + Math.cos(a) * L;
      const y1 = y0 + Math.sin(a) * L;
      segs.push({ x0, y0, mx: x0 + Math.cos(a) * L * 0.5 - Math.sin(a) * bend, my: y0 + Math.sin(a) * L * 0.5 + Math.cos(a) * bend, x1, y1, depth });
      tips.push({ x: x1, y: y1, a, len });
    };
    if (depth === 0) branch(0, 0, -Math.PI / 2, 0.3);
    for (const t of this.tips) {
      for (let c = 0; c < this.children; c++) branch(t.x, t.y, t.a + this.spread * (c - (this.children - 1) / 2) + 0.18 * next(), t.len * this.scale);
    }
    this.generations.push(segs);
    this.tips = tips;
  }

  /**
   * Every filament around every arm, as far as `grown` generations reach:
   * those before the last whole, the last at its fraction, its tips lit.
   */
  segments(grown) {
    const out = [];
    const shown = Math.min(this.generations.length, Math.ceil(grown));
    for (let d = 0; d < shown; d++) {
      const reach = Math.max(0, Math.min(1, grown - d));
      for (let k = 0; k < this.symmetry; k++) {
        const th = (k / this.symmetry) * Math.PI * 2;
        const c = Math.cos(th), s = Math.sin(th);
        const turn = (x, y) => [x * c - y * s, x * s + y * c];
        for (const g of this.generations[d]) {
          const [x0, y0] = turn(g.x0, g.y0);
          const [mx, my] = turn(g.x0 + (g.mx - g.x0) * reach, g.y0 + (g.my - g.y0) * reach);
          const [x1, y1] = turn(g.x0 + (g.x1 - g.x0) * reach, g.y0 + (g.y1 - g.y0) * reach);
          out.push({ x0, y0, mx, my, x1, y1, depth: d, tip: d === shown - 1 });
        }
      }
    }
    return out;
  }
}

/**
 * Where the fractal's color comes from, each read from the signal:
 * "peak": the alpha peak frequency, 8 to 13 hertz spread over the whole wheel;
 * "phase": the mean phase lag between the first two channels;
 * "spectrum": each generation takes the hue of a frequency band, slow warm to fast cool;
 * "relative": white light, tinted by relative alpha power.
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
  if (mapping === "relative") return { hue: 40 + 200 * (1 - Math.min(1, f.relativeAlpha)), perDepth: 0, sat: 18 };
  return { hue: 338, perDepth: 6, sat: 100 };
}

/**
 * Draw the fractal: a wide soft glow pass, a thin hot core pass, light at
 * the tips, and a white heart. On a light field the same light is drawn
 * by multiplying into the paper, so the colors stay the signal's.
 */
export function drawElectric(g, cx, cy, R, form, { hue = 338, t = 0, perDepth = 6, sat = 100, paper = false, depths = null } = {}) {
  const { segs } = form;
  // Shades by depth are measured against every generation there will be, so a new generation never recolors the old ones.
  const maxDepth = depths ?? segs.reduce((m, s) => Math.max(m, s.depth), 0) + 1;
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
