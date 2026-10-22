// The two readouts the open heads feed: a number arriving with its
// published error, and a score landing between male and female.

import { mono, sans } from "./shell.js";
import { probit } from "./heads.js";

const LIGHT = "#f3f1ea", INK = "#111111", GOLD = "255,181,71";

/** Toward a value, a little every frame. */
export function ease(current, target, k = 0.08) { return current + (target - current) * k; }

/**
 * The age: the number large, the published error as a glow around it on a
 * dark field and as a rule under it on a light one. `shown` is the number
 * as it is now, `error` the published mean error in years.
 */
export function drawAge(g, w, h, { shown, error, windows, dark }) {
  const cx = w * 0.5, cy = h * 0.5;
  const span = w * 0.7, x = (v) => cx - span / 2 + (v / 100) * span;
  if (dark) {
    g.globalCompositeOperation = "lighter";
    const glow = g.createRadialGradient(x(shown), cy, 0, x(shown), cy, (x(shown + error) - x(shown - error)) * 1.3);
    glow.addColorStop(0, `rgba(${GOLD},0.3)`); glow.addColorStop(0.5, `rgba(${GOLD},0.1)`); glow.addColorStop(1, `rgba(${GOLD},0)`);
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "source-over";
  }
  const size = Math.min(w * 0.3, h * 0.5);
  const under = cy + size * 0.42;
  const band = g.createLinearGradient(x(shown - error), 0, x(shown + error), 0);
  band.addColorStop(0, dark ? `rgba(${GOLD},0)` : "rgba(255,74,28,0)"); band.addColorStop(0.5, dark ? `rgba(${GOLD},0.95)` : "#FF4A1C"); band.addColorStop(1, dark ? `rgba(${GOLD},0)` : "rgba(255,74,28,0)");
  g.fillStyle = band; g.fillRect(x(shown - error), under, x(shown + error) - x(shown - error), 2);
  g.fillStyle = dark ? LIGHT : INK;
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  sans(g, size, 650);
  g.fillText(String(Math.round(shown)), cx, cy + size * 0.34);
  g.fillStyle = dark ? "rgba(243,241,234,.62)" : "#77776F";
  mono(g, Math.max(12, w * 0.011));
  g.fillText(`± ${Math.round(error)} YEARS · ${windows} WINDOW${windows === 1 ? "" : "S"}`, cx, under + Math.max(12, w * 0.011) * 2.4);
  g.textAlign = "start";
}

/**
 * The sex: two clouds, male and female, drawn from the published AUC as
 * two equal groups whose means sit the separation that AUC implies apart,
 * and the score landing between them. The head was fitted with 0 male and
 * 1 female.
 */
export function drawSex(g, w, h, { shown, auc, windows, dark }) {
  const dprime = Math.SQRT2 * probit(auc);
  const SD = 1 / dprime;
  const lo = -2.6 * SD, hi = 1 + 2.6 * SD;
  const x = (v) => w * 0.1 + ((v - lo) / (hi - lo)) * w * 0.8;
  const base = h * 0.66, height = h * 0.26;
  g.globalCompositeOperation = dark ? "lighter" : "multiply";
  for (const [m, col] of [[0, "76,141,255"], [1, "255,107,157"]]) {
    g.beginPath(); g.moveTo(x(lo), base);
    for (let v = lo; v <= hi; v += (hi - lo) / 400) { const z = (v - m) / SD; g.lineTo(x(v), base - height * Math.exp(-0.5 * z * z)); }
    g.lineTo(x(hi), base); g.closePath();
    const f = g.createLinearGradient(0, base - height, 0, base);
    f.addColorStop(0, `rgba(${col},${dark ? 0.32 : 0.5})`); f.addColorStop(1, `rgba(${col},0.02)`);
    g.fillStyle = f; g.fill();
  }
  g.globalCompositeOperation = "source-over";
  const px = x(Math.max(lo, Math.min(hi, shown)));
  g.strokeStyle = dark ? "rgba(243,241,234,.9)" : "rgba(17,17,17,.9)"; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(px, base - height * 1.12); g.lineTo(px, base + 4); g.stroke();
  g.fillStyle = dark ? LIGHT : INK; g.textAlign = "center";
  const size = Math.min(w * 0.14, h * 0.26);
  sans(g, size, 650);
  g.fillText(shown.toFixed(2), w * 0.5, h * 0.34);
  mono(g, Math.max(12, w * 0.011));
  g.textAlign = "start"; g.fillStyle = dark ? "rgba(76,141,255,.95)" : "#2f5fd0"; g.fillText("MALE", x(lo), base + h * 0.07);
  g.textAlign = "end"; g.fillStyle = dark ? "rgba(255,107,157,.95)" : "#d1336f"; g.fillText("FEMALE", x(hi), base + h * 0.07);
  g.textAlign = "center"; g.fillStyle = dark ? "rgba(243,241,234,.62)" : "#77776F";
  g.fillText(`${windows} WINDOW${windows === 1 ? "" : "S"}`, w * 0.5, base + h * 0.07);
  g.textAlign = "start";
}
