// What a demo looks like running, on sample data, for the card that opens
// it: so a visitor with no IntoMind One sees the thing before they connect.
// Each preview takes a canvas and returns a function that stops it.

import { fit, field, isDark } from "./shell.js";
import { filaments, drawElectric, colorOf, sampleChannels } from "./electric.js";
import { drawAge, drawSex, ease } from "./readout.js";
import { boardCamera, drawBoardThemed } from "./board.js";

function loop(draw) {
  let raf = 0;
  let last = null;
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.max(0, (now - t0) / 1000);
    const dt = last === null ? 0 : Math.min(0.1, t - last);
    last = t;
    draw(t, dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** The fractal growing from a fixed sample signal, over and over. */
export function flowerPreview(canvas) {
  const FS = 250;
  const CH = sampleChannels(FS, 6, 0);
  let form = null, color = null, lastStep = null;
  return loop((t) => {
    const { g, w, h } = fit(canvas);
    const dark = isDark();
    field(g, w, h, dark);
    const cycle = t % 18;
    const growth = Math.min(1, cycle / 12);
    const step = Math.floor(growth * 60);
    if (step !== lastStep) { form = filaments(CH[0], FS, { growth }); color = colorOf(form, CH, FS, "peak"); lastStep = step; }
    drawElectric(g, w / 2, h / 2, Math.min(w, h) * 0.42, form, { ...color, t, paper: !dark });
  });
}

/** The age arriving: a number settling over a dozen windows. */
export function agePreview(error) {
  return (canvas) => {
    let shown = 46;
    return loop((t) => {
      const { g, w, h } = fit(canvas);
      const dark = isDark();
      field(g, w, h, dark);
      const windows = 1 + Math.floor((t % 16) / 1.3);
      const target = 34 + 4 * Math.sin(windows * 1.7) / Math.sqrt(windows);
      shown = ease(shown, target, 0.05);
      drawAge(g, w, h, { shown, error, windows, dark });
    });
  };
}

/** The sex score landing between the two groups. */
export function sexPreview(auc) {
  return (canvas) => {
    let shown = 0.3;
    return loop((t) => {
      const { g, w, h } = fit(canvas);
      const dark = isDark();
      field(g, w, h, dark);
      const windows = 1 + Math.floor((t % 16) / 1.3);
      const target = 0.62 + 0.2 * Math.sin(windows * 2.3) / Math.sqrt(windows);
      shown = ease(shown, target, 0.05);
      drawSex(g, w, h, { shown, auc, windows, dark });
    });
  };
}

/** The Pico 2 W, its LED following a thought that comes and goes. */
export function picoPreview(canvas) {
  let led = 0;
  return loop((t) => {
    const { g, w, h, dpr } = fit(canvas);
    const dark = isDark();
    field(g, w, h, dark);
    const on = Math.floor(t / 3) % 2 === 1 ? 1 : 0;
    led += (on - led) * 0.12;
    drawBoardThemed(g, boardCamera(w, h, { yaw: 0.3, pitch: 0.9, size: Math.min(w * 0.72, h * 1.4) }), { dark, dpr, led, t });
  });
}
