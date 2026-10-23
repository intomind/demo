// Three other ways to grow Alpha Flower's fractal from the signal, for the
// options deck. Each is deterministic: the same channels give the same
// form, and the color is read from the signal too.

import { bandpass } from "./alpha.js";
import { welch } from "./fft.js";

function norm(x, fs) {
  const y = bandpass(x, fs);
  const skip = Math.floor(y.length * 0.25);
  const out = Array.from(y.subarray(skip));
  const mags = out.map(Math.abs).sort((a, b) => a - b);
  const s = Math.max(1e-9, mags[Math.floor(mags.length * 0.95)] ?? 1);
  return out.map((v) => Math.max(-1.2, Math.min(1.2, v / s)));
}

/**
 * B. Phase portrait. One channel's alpha against another's, drawn as a
 * curve of light and repeated around the circle. The hue at each point is
 * the angle of the point, which is the phase relation of the two channels
 * at that instant.
 */
export function drawPhasePortrait(g, cx, cy, R, channels, fs, { paper = false, fold = 6, growth = 1 } = {}) {
  const a = norm(channels[0], fs);
  const b = norm(channels[1] ?? channels[0], fs);
  const c = norm(channels[2] ?? channels[0], fs);
  const n = Math.floor(Math.min(a.length, b.length, c.length) * Math.max(0.05, Math.min(1, growth)));
  g.save();
  g.translate(cx, cy);
  g.globalCompositeOperation = paper ? "multiply" : "lighter";
  g.lineCap = "round";
  for (let k = 0; k < fold; k++) {
    const rot = (k / fold) * Math.PI * 2;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 3; i < n; i += 3) {
        const x0 = a[i - 3] * 0.5, y0 = b[i - 3] * 0.5, x1 = a[i] * 0.5, y1 = b[i] * 0.5;
        const hue = ((Math.atan2(y1, x1) + Math.PI) / (2 * Math.PI)) * 360;
        const bright = 0.5 + 0.5 * Math.min(1, Math.abs(c[i]));
        if (pass === 0) {
          g.strokeStyle = paper ? `hsla(${hue}, 90%, 45%, 0.03)` : `hsla(${hue}, 100%, 55%, ${0.018 * bright})`;
          g.lineWidth = R * 0.03;
        } else {
          g.strokeStyle = paper ? `hsla(${hue}, 90%, 40%, 0.35)` : `hsla(${hue}, 100%, 62%, ${0.16 * bright})`;
          g.lineWidth = R * 0.003;
        }
        const ca = Math.cos(rot), sa = Math.sin(rot);
        g.beginPath();
        g.moveTo((x0 * ca - y0 * sa) * R, (x0 * sa + y0 * ca) * R);
        g.lineTo((x1 * ca - y1 * sa) * R, (x1 * sa + y1 * ca) * R);
        g.stroke();
      }
    }
  }
  if (!paper) {
    const heart = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.1);
    heart.addColorStop(0, "rgba(255,255,255,0.7)");
    heart.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = heart;
    g.fillRect(-R, -R, R * 2, R * 2);
  }
  g.restore();
}

/**
 * C. Spectral mandala. One ring per two-second window of each channel.
 * Around each ring, the angle is frequency, slow to fast, repeated in
 * petals, and the ring's radius at that angle is how much of that
 * frequency the window held. Slow is warm, fast is cool.
 */
export function drawSpectralMandala(g, cx, cy, R, channels, fs, { paper = false, petals = 8, growth = 1 } = {}) {
  const rings = [];
  for (const x of channels) {
    const seg = fs * 2;
    for (let start = 0; start + seg <= x.length; start += seg) rings.push(welch(Array.from(x.slice(start, start + seg)), fs, 256));
  }
  g.save();
  g.translate(cx, cy);
  g.globalCompositeOperation = paper ? "multiply" : "lighter";
  g.lineJoin = "round";
  const shown = Math.max(1, Math.ceil(rings.length * Math.max(0.05, Math.min(1, growth))));
  rings.slice(0, shown).forEach((s, k) => {
    if (s === null) return;
    const base = R * (0.22 + 0.7 * (k / Math.max(1, rings.length - 1)));
    const depth = R * 0.14;
    let lo = Infinity, hi = -Infinity;
    const logs = [];
    for (let i = 0; i < s.freqs.length; i++) {
      if (s.freqs[i] < 2 || s.freqs[i] > 40) { logs.push(null); continue; }
      const v = Math.log10(s.psd[i] + 1e-9);
      logs.push(v); lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const steps = 720;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      const u = ((th * petals) / (Math.PI * 2)) % 1;
      const f = 2 + 38 * (u < 0.5 ? u * 2 : 2 - u * 2);
      const bin = Math.round((f / fs) * 256);
      const v = logs[bin] ?? lo;
      const m = hi > lo ? (v - lo) / (hi - lo) : 0;
      pts.push([base + depth * m, th, f]);
    }
    for (let i = 0; i < steps; i++) {
      const [r0, t0, f0] = pts[i], [r1, t1] = pts[i + 1];
      const hue = 30 + ((f0 - 2) / 38) * 200;
      g.strokeStyle = paper ? `hsla(${hue}, 85%, 42%, 0.55)` : `hsla(${hue}, 100%, 65%, 0.55)`;
      g.lineWidth = paper ? R * 0.006 : R * 0.008;
      g.beginPath();
      g.moveTo(r0 * Math.cos(t0), r0 * Math.sin(t0));
      g.lineTo(r1 * Math.cos(t1), r1 * Math.sin(t1));
      g.stroke();
      if (!paper) {
        g.strokeStyle = `hsla(${hue}, 100%, 60%, 0.08)`;
        g.lineWidth = R * 0.03;
        g.stroke();
      }
    }
  });
  g.restore();
}

/**
 * D. Flow bloom. The signal defines a field: at every point, the channels'
 * samples at that position say which way the light flows. Motes start at
 * the heart and follow the field outward, and the trails they leave are
 * the fractal. Hue follows the direction of flow.
 */
export function drawFlowBloom(g, cx, cy, R, channels, fs, { paper = false, motes = 220, steps = 140, growth = 1 } = {}) {
  steps = Math.max(8, Math.round(steps * Math.max(0.05, Math.min(1, growth))));
  const ch = channels.map((x) => norm(x, fs));
  const n = ch[0].length;
  const at = (x, y) => {
    // The first channel runs along x, the second along y, the third along the diagonal: a smooth field.
    const i = Math.max(0, Math.min(n - 1, Math.floor(((x + 1) / 2) * (n - 1))));
    const j = Math.max(0, Math.min(n - 1, Math.floor(((y + 1) / 2) * (n - 1))));
    const k = Math.max(0, Math.min(n - 1, Math.floor(((x + y + 2) / 4) * (n - 1))));
    return 0.9 * ch[0][i] + 0.9 * (ch[1] ?? ch[0])[j] + 0.5 * (ch[2] ?? ch[0])[k];
  };
  g.save();
  g.translate(cx, cy);
  g.globalCompositeOperation = paper ? "multiply" : "lighter";
  g.lineCap = "round";
  for (let m = 0; m < motes; m++) {
    const a0 = (m / motes) * Math.PI * 2;
    let x = Math.cos(a0) * 0.05, y = Math.sin(a0) * 0.05;
    for (let s = 0; s < steps; s++) {
      const turn = at(x, y);
      const heading = a0 + turn * 1.3;
      const step = 0.0075 * (1 + 0.5 * (s / steps));
      const nx = x + Math.cos(heading) * step, ny = y + Math.sin(heading) * step;
      const r = Math.hypot(nx, ny);
      if (r > 1) break;
      const hue = ((heading % (Math.PI * 2)) / (Math.PI * 2)) * 360;
      const fade = 1 - r;
      g.strokeStyle = paper ? `hsla(${hue}, 85%, 40%, ${0.35 * fade})` : `hsla(${hue}, 100%, ${60 + 30 * (1 - fade)}%, ${0.28 * fade + 0.05})`;
      g.lineWidth = R * (paper ? 0.004 : 0.006);
      g.beginPath();
      g.moveTo(x * R, y * R);
      g.lineTo(nx * R, ny * R);
      g.stroke();
      x = nx; y = ny;
    }
  }
  if (!paper) {
    const heart = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.14);
    heart.addColorStop(0, "rgba(255,255,255,0.9)");
    heart.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = heart;
    g.fillRect(-R, -R, R * 2, R * 2);
  }
  g.restore();
}
