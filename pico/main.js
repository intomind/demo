// The Mind-Controlled Light Switch on a Raspberry Pi Pico 2 W: the guide.
// Every picture is the measured board in lib/board.js, lit in the dark and
// drawn in line in the light, showing what the step is about.

import { shell, ready, fit, isDark, siteAddress } from "../lib/shell.js";
import { boardCamera, drawBoardThemed, ledAt, at } from "../lib/board.js";

shell({ title: "Mind-Controlled Microcontroller" });
document.getElementById("address").textContent = siteAddress();

/** The two files the steps name: IntoMind's MicroPython, and the program that runs on it. */
const FIRMWARE = "intomind-micropython-pico-2-w.uf2";
const PROGRAM = "mind_controlled_microcontroller.py";
const SIGNAL = "#FF4A1C";

/** What the LED can say, the way the program on the board says it. */
const SAYS = [
  ["looking", "One short blink a second", "looking for your IntoMind One"],
  ["charging", "Two short blinks a second", "your IntoMind One is on its charger"],
  ["nohead", "Three short blinks a second", "no custom AI head installed yet"],
  ["off", "Off", "your custom AI head reads Off"],
  ["on", "On", "your custom AI head reads On"],
  ["signal", "Fast blinking", "the signal dropped, or an electrode came loose"],
];

/** The LED at time `t`, in the same patterns as board/main.c. */
function led(pattern, t) {
  const ms = ((t * 1000) % 1000 + 1000) % 1000;
  if (pattern === "looking") return ms < 100 ? 1 : 0;
  if (pattern === "charging") return ms < 100 || (ms >= 250 && ms < 350) ? 1 : 0;
  if (pattern === "nohead") return ms < 100 || (ms >= 250 && ms < 350) || (ms >= 500 && ms < 600) ? 1 : 0;
  if (pattern === "on") return 1;
  if (pattern === "signal") return Math.floor(ms / 100) % 2 === 0 ? 1 : 0;
  return 0;
}

const ease = (k) => (k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k));

/** The colors of the moment: the dark room or the paper. */
function palette() {
  const dark = isDark();
  return dark
    ? { dark, bg: "#0b0d12", ink: "#f3f1ea", dim: "rgba(243,241,234,.55)", faint: "rgba(243,241,234,.15)", link: "rgba(120,200,255,.6)", on: "#7dff9e" }
    : { dark, bg: "#e4e4de", ink: "#111111", dim: "#77776F", faint: "rgba(17,17,17,.15)", link: "#111111", on: SIGNAL };
}

function mono(g, px, weight = 500) { g.font = `${weight} ${px}px "Geist Mono", ui-monospace, monospace`; g.letterSpacing = `${px * 0.08}px`; }
function sans(g, px, weight = 620) { g.font = `${weight} ${px}px Geist, system-ui, sans-serif`; g.letterSpacing = `${-px * 0.03}px`; }
function label(g, text, x, y, color, px, align = "start") {
  mono(g, px); g.fillStyle = color; g.textAlign = align; g.textBaseline = "middle"; g.fillText(text.toUpperCase(), x, y); g.textAlign = "start";
}
function background(g, w, h, p) {
  if (p.dark) {
    const v = g.createRadialGradient(w * 0.55, h * 0.6, 0, w * 0.55, h * 0.6, Math.max(w, h) * 0.8);
    v.addColorStop(0, "#0e1118"); v.addColorStop(1, "#07080c");
    g.fillStyle = v;
  } else g.fillStyle = p.bg;
  g.fillRect(0, 0, w, h);
}
function board(g, cam, dpr, p, opts) {
  drawBoardThemed(g, cam, { dark: p.dark, dpr, paper: p.bg, ...opts });
}

/** The whole system, playing: the demo installs the custom AI head, your IntoMind One runs it, the board follows over Bluetooth. */
function system(g, w, h, t, dpr) {
  const p = palette();
  background(g, w, h, p);
  const say = SAYS[[3, 4, 3, 4, 0][Math.floor(t / 2.6) % 5]];
  if (w / h < 1.7) {
    // Narrow, on a phone: the board, and what its LED is saying.
    const cam = boardCamera(w, h, { yaw: 0.42 + Math.sin(t * 0.22) * 0.12, pitch: 0.7, size: w * 0.8, cy: h * 0.42 });
    board(g, cam, dpr, p, { led: led(say[0], t), t });
    const k = w / 390;
    sans(g, 17 * k, 600); g.fillStyle = p.ink; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillText(say[1], w / 2, h - 46 * k);
    mono(g, 10 * k); g.fillStyle = p.dim; g.fillText(say[2].toUpperCase(), w / 2, h - 26 * k); g.textAlign = "start";
    return;
  }
  const k = w / 1500;
  const cam = boardCamera(w, h, { yaw: 0.42 + Math.sin(t * 0.22) * 0.12, pitch: 0.62, size: w * 0.4, cx: w * 0.6, cy: h * 0.55 });
  board(g, cam, dpr, p, { led: led(say[0], t), t });
  const x0 = w * 0.06, y0 = h * 0.3;
  const node = (title, line, x, y) => {
    sans(g, 30 * k, 620); g.fillStyle = p.ink; g.textAlign = "start"; g.textBaseline = "alphabetic"; g.fillText(title, x, y);
    mono(g, 11 * k); g.fillStyle = p.dim; g.fillText(line.toUpperCase(), x, y + 22 * k);
  };
  node("Mind-Controlled Light Switch", "the demo, in your browser · once", x0, y0);
  node("IntoMind One", "runs your custom AI head", x0, y0 + h * 0.36);
  g.strokeStyle = p.dim; g.lineWidth = 1;
  const ax = x0 + 8 * k, ay0 = y0 + 36 * k, ay1 = y0 + h * 0.36 - 40 * k;
  g.beginPath(); g.moveTo(ax, ay0); g.lineTo(ax, ay1); g.stroke();
  g.beginPath(); g.moveTo(ax - 5 * k, ay1 - 8 * k); g.lineTo(ax, ay1); g.lineTo(ax + 5 * k, ay1 - 8 * k); g.stroke();
  label(g, "installs your custom AI head", ax + 14 * k, (ay0 + ay1) / 2, p.dim, 11 * k);
  const a = at(cam, 3, 0.5, 10.5);
  const from = [x0 + 230 * k, y0 + h * 0.36 - 9 * k];
  if (a) {
    const mid = [(from[0] + a.x) / 2, Math.min(from[1], a.y) - h * 0.12];
    g.setLineDash([4 * k, 6 * k]); g.strokeStyle = p.link;
    g.beginPath(); g.moveTo(from[0], from[1]); g.quadraticCurveTo(mid[0], mid[1], a.x, a.y); g.stroke(); g.setLineDash([]);
    const q = (u) => [(1 - u) * (1 - u) * from[0] + 2 * (1 - u) * u * mid[0] + u * u * a.x, (1 - u) * (1 - u) * from[1] + 2 * (1 - u) * u * mid[1] + u * u * a.y];
    if (say[0] === "off" || say[0] === "on") {
      const [px, py] = q((t / 3) % 1);
      g.fillStyle = p.dark ? "rgba(160,220,255,.95)" : SIGNAL;
      g.beginPath(); g.arc(px, py, 3.2 * k + 1, 0, Math.PI * 2); g.fill();
    }
    const [lx, ly] = q(0.5);
    label(g, "Bluetooth · a reading every few seconds", lx, ly - 14 * k, p.dark ? "rgba(160,220,255,.85)" : p.ink, 11 * k, "center");
  }
  const l = ledAt(cam);
  if (l) {
    g.strokeStyle = p.dim; g.lineWidth = 1;
    const lx = l.x + 30 * k, ly = l.y - h * 0.16;
    g.beginPath(); g.moveTo(l.x + 4, l.y - 4); g.lineTo(lx, ly); g.lineTo(lx + 40 * k, ly); g.stroke();
    sans(g, 18 * k, 600); g.fillStyle = p.ink; g.textAlign = "start"; g.textBaseline = "alphabetic"; g.fillText(say[1], lx + 48 * k, ly + 6 * k);
    mono(g, 10.5 * k); g.fillStyle = p.dim; g.fillText(say[2].toUpperCase(), lx + 48 * k, ly + 24 * k);
  }
}

/** One step's picture. */
function step(n, g, w, h, t, dpr) {
  const p = palette();
  background(g, w, h, p);
  const k = w / 480;
  if (n === 1) {
    // The Mind-Controlled Light Switch demo: the board drawn on it, and its controls.
    const on = Math.floor(t / 2.4) % 2 === 1;
    board(g, boardCamera(w, h, { yaw: 0, pitch: 1.25, size: w * 0.5, cy: h * 0.44 }), dpr, p, { led: on ? 1 : 0, t, desk: false });
    sans(g, 11 * k, 620); g.fillStyle = p.ink; g.textAlign = "start"; g.textBaseline = "alphabetic"; g.fillText("Mind-Controlled Light Switch", 14 * k, h - 14 * k);
    mono(g, 7.4 * k);
    const items = ["START TEACHING", "RUN IT ON YOUR INTOMIND ONE", "PICO 2 W GUIDE"];
    let x = w - 14 * k; g.textAlign = "end";
    for (let i = items.length - 1; i >= 0; i--) {
      const hot = i === 1;
      g.fillStyle = hot ? p.ink : p.dim; g.fillText(items[i], x, h - 15 * k);
      const wd = g.measureText(items[i]).width;
      if (hot) { g.fillStyle = SIGNAL; g.fillRect(x - wd, h - 12 * k, wd, 1.6 * k); }
      x -= wd + 12 * k;
    }
    g.textAlign = "start";
    label(g, on ? "holding the On thought" : "resting", 14 * k, 16 * k, on ? SIGNAL : p.dim, 8 * k);
  } else if (n === 2) {
    // Hold the button, plug in, the drive appears, MicroPython goes on, the drive closes.
    const T = t % 9;
    const plug = 18 - 18 * ease((T - 1.0) / 1.0);
    const cam = boardCamera(w, h, { yaw: 0.62, pitch: 0.78, size: w * 0.56, cx: w * 0.4, cy: h * 0.56 });
    const done = T > 6.1;
    board(g, cam, dpr, p, { ring: done ? null : "bootsel", plug, t, led: 0, cableTo: [120, -8, -20] });
    const b = at(cam, 39.05, 1.4, 6.9);
    if (b && !done) {
      g.strokeStyle = SIGNAL; g.lineWidth = 1;
      g.beginPath(); g.moveTo(b.x, b.y - 18 * k); g.lineTo(b.x, b.y - 46 * k); g.stroke();
      label(g, T < 2.3 ? "hold" : "let go", b.x + 5 * k, b.y - 46 * k, SIGNAL, 8.5 * k);
    }
    if (done) label(g, "MicroPython on the board · ready for the program", 14 * k, 16 * k, SIGNAL, 7.6 * k);
    const show = ease((T - 2.6) / 0.4) * (1 - ease((T - 5.6) / 0.5));
    if (show > 0) {
      g.globalAlpha = show;
      const x = w * 0.66, y = h * 0.14, bw = w * 0.28, bh = 30 * k;
      g.strokeStyle = p.ink; g.lineWidth = 1; g.strokeRect(x, y, bw, bh);
      mono(g, 9.5 * k); g.fillStyle = p.ink; g.textAlign = "start"; g.textBaseline = "middle"; g.fillText("RP2350", x + 9 * k, y + bh / 2);
      const fk = ease((T - 3.3) / 0.9);
      mono(g, 6.6 * k); g.fillStyle = SIGNAL;
      g.fillText(FIRMWARE.toUpperCase(), x - 14 * k + fk * 22 * k, y + bh + 14 * k - fk * 14 * k);
      g.globalAlpha = 1;
    }
  } else if (n === 3) {
    // The program: one Python file, its name, and where it goes.
    const x = 40 * k, y = h * 0.2, fw = 70 * k, fh = 90 * k, fold = 18 * k;
    g.strokeStyle = p.ink; g.lineWidth = 1.4; g.lineJoin = "round";
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + fw - fold, y); g.lineTo(x + fw, y + fold); g.lineTo(x + fw, y + fh); g.lineTo(x, y + fh); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(x + fw - fold, y); g.lineTo(x + fw - fold, y + fold); g.lineTo(x + fw, y + fold); g.stroke();
    label(g, "py", x + fw / 2, y + fh * 0.62, SIGNAL, 10 * k, "center");
    const tx = x + fw + 26 * k;
    mono(g, 11 * k, 500); g.letterSpacing = "0px"; g.fillStyle = p.ink; g.textBaseline = "alphabetic"; g.textAlign = "start";
    g.fillText(PROGRAM, tx, y + 26 * k);
    g.fillStyle = SIGNAL; g.fillRect(tx, y + 32 * k, g.measureText(PROGRAM).width, 2 * k);
    mono(g, 7.4 * k); g.fillStyle = p.dim;
    ["One file, the whole program", "Open it and change it in Thonny", "Saved on the board as main.py"].forEach((line, i) => g.fillText(line.toUpperCase(), tx, y + 58 * k + i * 15 * k));
  } else if (n === 4) {
    // Pairing: looking, then paired and resting, then the On thought.
    const cam = boardCamera(w, h, { yaw: 0.45, pitch: 0.82, size: w * 0.44, cx: w * 0.7, cy: h * 0.58 });
    const T = t % 9;
    const pattern = T < 2.4 ? "looking" : T < 4.6 ? "off" : T < 7.2 ? "on" : "off";
    board(g, cam, dpr, p, { led: led(pattern, t), plug: 0, t, cableTo: [120, -8, -20] });
    const x = 16 * k, y = 18 * k;
    sans(g, 14 * k, 620); g.fillStyle = p.ink; g.textBaseline = "alphabetic"; g.textAlign = "start"; g.fillText("IntoMind One", x, y + 14 * k);
    const a = at(cam, 3, 0.5, 10.5);
    if (a) {
      g.setLineDash([3 * k, 5 * k]); g.strokeStyle = p.link; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 100 * k, y + 9 * k); g.quadraticCurveTo((x + a.x) / 2 + 40 * k, y, a.x, a.y); g.stroke(); g.setLineDash([]);
    }
    const says = { looking: ["One short blink a second", "looking for your IntoMind One"], off: ["Off", T < 4.6 ? "paired · your custom AI head reads Off" : "your custom AI head reads Off"], on: ["On", "your custom AI head reads On"] }[pattern];
    sans(g, 10 * k, 620); g.fillStyle = p.ink; g.fillText(says[0], x, y + 42 * k);
    mono(g, 7 * k); g.fillStyle = p.dim; g.fillText(says[1].toUpperCase(), x, y + 56 * k);
  } else if (n === 5) {
    // On a charger anywhere: the six things the LED can say, each at its own pattern.
    const cam = boardCamera(w, h, { yaw: 0.3, pitch: 0.86, size: w * 0.36, cx: w * 0.76, cy: h * 0.5 });
    const cycle = Math.floor(t / 2.6) % SAYS.length;
    board(g, cam, dpr, p, { led: led(SAYS[cycle][0], t), plug: 0, t, cableTo: [100, -12, 34] });
    const x = 20 * k, y0 = 18 * k;
    SAYS.forEach(([pat, how, what], i) => {
      const y = y0 + i * 22 * k;
      const v = led(pat, t);
      g.beginPath(); g.arc(x, y + 4 * k, 3.2 * k, 0, Math.PI * 2);
      if (p.dark) { g.fillStyle = v ? p.on : p.faint; g.fill(); }
      else { g.fillStyle = v ? SIGNAL : p.bg; g.fill(); g.strokeStyle = p.ink; g.lineWidth = 1; g.stroke(); }
      sans(g, 8.4 * k, i === cycle ? 640 : 520); g.fillStyle = i === cycle ? p.ink : p.dim; g.textAlign = "start"; g.textBaseline = "alphabetic"; g.fillText(how, x + 10 * k, y + 5 * k);
      mono(g, 6 * k); g.fillStyle = p.dim; g.fillText(what.toUpperCase(), x + 10 * k, y + 14 * k);
    });
  }
}

// ---- Only the pictures in view are drawn, every frame. ----

const canvases = [...document.querySelectorAll("canvas[data-draw]")];
const visible = new Set();
const watch = new IntersectionObserver((entries) => { for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); } }, { rootMargin: "100px" });
canvases.forEach((c) => watch.observe(c));

await document.fonts.ready;
const t0 = performance.now();
/** Draw one picture at time `t`. */
function draw(c, t) {
  const { g, w, h, dpr } = fit(c);
  if (c.dataset.draw === "system") system(g, w, h, t, dpr);
  else step(Number(c.dataset.n), g, w, h, t, dpr);
}
// Every picture once, so none is ever blank, then only those in view, every frame.
for (const c of canvases) draw(c, 0);
window.addEventListener("themechange", () => { for (const c of canvases) draw(c, (performance.now() - t0) / 1000); });
function frame() {
  const t = (performance.now() - t0) / 1000;
  for (const c of visible) draw(c, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
ready();
