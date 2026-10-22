// The Raspberry Pi Pico 2 W, measured, drawn two ways: lit, and in line.
//
// Every position is in millimetres, read from Raspberry Pi's Pico 2 W
// datasheet: the mechanical drawing (Figure 3) for the outline, the pins,
// the castellations, the holes and the debug pads, and the photographs
// (Figure 1) for each part on the board, its size, its color and its
// marking. x runs from the antenna end (0) to the USB end (51), z across
// from the edge with pins 1 to 20 (0) to the edge with pins 21 to 40 (21),
// and y up from the top of the board, which is 1 mm thick.

import { Camera, add, sub, scale, dot, cross, unit, length } from "./space.js";

export const L = 51, W = 21, T = 1;
const PITCH = 2.54, END = 1.37, ROW = 1.61;
const S = 40; // texture pixels per millimetre
const PX = (v) => v * S;

/** Pin n: pins 1 to 20 along z = 0 from the USB end, 21 to 40 along z = 21 from the antenna end. */
export function pinAt(n) { return n <= 20 ? [L - END - (n - 1) * PITCH, ROW] : [END + (n - 21) * PITCH, W - ROW]; }
const PINS = Array.from({ length: 40 }, (_, i) => pinAt(i + 1));
const PIN_NAMES = ["GP0", "GP1", "GND", "GP2", "GP3", "GP4", "GP5", "GND", "GP6", "GP7", "GP8", "GP9", "GND", "GP10", "GP11", "GP12", "GP13", "GND", "GP14", "GP15",
  "GP16", "GP17", "GND", "GP18", "GP19", "GP20", "GP21", "GND", "GP22", "RUN", "GP26_A0", "GP27_A1", "AGND", "GP28_A2", "ADC_VREF", "3V3", "3V3_EN", "GND", "VSYS", "VBUS"];
const MOUNT = [[2, 4.8], [2, 16.2], [49, 4.8], [49, 16.2]];
const DEBUG = [[19.7, 10.95], [19.7, 13.49], [19.7, 16.03]];

/** A model point in the world: the board's center at the origin, its length along x, the pin 1 edge away from the viewer. */
export const world = (x, y, z) => [x - L / 2, y, W / 2 - z];
const worldNormal = (n) => [n[0], n[1], -n[2]];

/** The light the site's solids are lit by: from the upper left, a little toward the viewer. */
const SUN = unit([-0.45, 0.85, -0.3]);

const COL = {
  mask: "#55a37c", trace: "#61ae88", gap: "#3b7764", deep: "#2f6151",
  antenna: "#4c946f", antennaIn: "#59a780",
  gold: "#ecca7e", goldDeep: "#9b7b3d", copper: "#9c6a38",
  silk: "rgba(246,246,240,0.95)", solder: "#d3d5d6",
};

const MAT = {
  edge: { c: [178, 202, 166], spec: 0.04, shine: 8 },
  notch: { c: [222, 188, 112], spec: 0.7, shine: 24, metal: true },
  shield: { c: [186, 188, 186], spec: 0.28, shine: 22, metal: true },
  chip: { c: [44, 44, 47], spec: 0.32, shine: 22 },
  ceramic: { c: [64, 62, 60], spec: 0.14, shine: 14 },
  lid: { c: [178, 170, 158], spec: 0.35, shine: 26, metal: true },
  frame: { c: [196, 199, 200], spec: 0.3, shine: 24, metal: true },
  cap: { c: [238, 228, 210], spec: 0.2, shine: 16 },
  usb: { c: [192, 195, 196], spec: 0.4, shine: 30, metal: true },
  inductor: { c: [84, 88, 92], spec: 0.12, shine: 12 },
  beige: { c: [207, 187, 150], spec: 0.25, shine: 20 },
  black: { c: [30, 30, 32], spec: 0.3, shine: 20 },
  solder: { c: [212, 214, 216], spec: 0.8, shine: 38, metal: true },
  white: { c: [228, 230, 230], spec: 0.4, shine: 26 },
  led: { c: [236, 228, 214], spec: 0.3, shine: 24 },
  overmold: { c: [34, 35, 38], spec: 0.28, shine: 16 },
  tip: { c: [200, 203, 205], spec: 0.85, shine: 44, metal: true },
};

// ---- The parts on top, from the photograph.

function box(x0, x1, y0, y1, z0, z1, mat) {
  return [
    { p: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], n: [0, 1, 0], mat, top: true },
    { p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], n: [0, -1, 0], mat },
    { p: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], n: [-1, 0, 0], mat },
    { p: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], n: [1, 0, 0], mat },
    { p: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], n: [0, 0, -1], mat },
    { p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], n: [0, 0, 1], mat },
  ];
}

/** A two-terminal part, its body in `mat` and a metal cap at each end, along x or along z. */
function chipPart(x0, x1, z0, z1, h, mat, alongZ) {
  if (alongZ) {
    const e = (z1 - z0) * 0.18;
    return [...box(x0, x1, 0, h, z0 + e, z1 - e, mat), ...box(x0, x1, 0, h, z0, z0 + e, MAT.solder), ...box(x0, x1, 0, h, z1 - e, z1, MAT.solder)];
  }
  const e = (x1 - x0) * 0.18;
  return [...box(x0 + e, x1 - e, 0, h, z0, z1, mat), ...box(x0, x0 + e, 0, h, z0, z1, MAT.solder), ...box(x1 - e, x1, 0, h, z0, z1, MAT.solder)];
}

function buildParts() {
  const P = [];
  const put = (name, faces, extra = {}) => {
    let c = [0, 0, 0], n = 0;
    for (const f of faces) for (const q of f.p) { c = add(c, q); n++; }
    P.push({ name, faces, center: scale(c, 1 / n), ...extra });
  };
  put("shield", box(7.9, 18.35, 0, 1.25, 4.35, 16.45, MAT.shield), { top: shieldTop, rect: [7.9, 18.35, 4.35, 16.45, 1.25] });
  put("crystal", [...box(20.0, 22.5, 0, 0.32, 4.15, 7.55, MAT.ceramic), ...box(20.15, 22.35, 0.32, 0.8, 4.3, 7.4, MAT.lid)], { top: crystalTop, rect: [20.15, 22.35, 4.3, 7.4, 0.8] });
  put("rp2350", box(24.25, 31.4, 0, 0.85, 6.8, 13.95, MAT.chip), { top: rpTop, rect: [24.25, 31.4, 6.8, 13.95, 0.85] });
  put("flash", box(33.7, 35.8, 0, 0.6, 5.0, 8.6, MAT.chip), { top: flashTop, rect: [33.7, 35.8, 5.0, 8.6, 0.6] });
  put("bootsel", [...box(36.5, 41.6, 0, 0.8, 5.2, 8.6, MAT.frame), ...oval(39.05, 6.9, 1.62, 1.08, 0.8, 1.32, MAT.cap)], { top: bootselTop, rect: [36.5, 41.6, 5.2, 8.6, 0.8], cap: true });
  put("led", [...box(45.75, 46.55, 0, 0.45, 3.95, 5.45, MAT.led), ...box(45.7, 46.6, 0, 0.12, 3.55, 3.95, MAT.solder), ...box(45.7, 46.6, 0, 0.12, 5.45, 5.85, MAT.solder)], { led: true, top: ledTop, rect: [45.75, 46.55, 3.95, 5.45, 0.45] });
  put("usb", [
    ...box(47.2, 52.6, 0, 2.55, 6.75, 14.05, MAT.usb),
    ...box(45.8, 47.2, 0, 0.35, 6.6, 8.5, MAT.solder), ...box(45.8, 47.2, 0, 0.35, 12.3, 14.2, MAT.solder),
    ...box(48.0, 49.2, 0, 1.0, 6.2, 6.75, MAT.usb), ...box(48.0, 49.2, 0, 1.0, 14.05, 14.6, MAT.usb),
  ], { top: usbTop, front: usbFront, rect: [47.2, 52.6, 6.75, 14.05, 2.55] });
  put("power", box(39.0, 42.0, 0, 0.8, 10.9, 15.1, MAT.chip), { top: textTop(["0E=9D", "U1Q"], 0.62), rect: [39.0, 42.0, 10.9, 15.1, 0.8] });
  put("inductor", box(39.1, 41.9, 0, 1.2, 15.5, 17.8, MAT.inductor));
  put("diode", [...box(43.6, 46.0, 0, 1.0, 15.2, 16.6, MAT.black), ...box(42.9, 43.6, 0, 0.45, 15.4, 16.4, MAT.solder), ...box(46.0, 46.7, 0, 0.45, 15.4, 16.4, MAT.solder)], { top: textTop(["K1 44"], 0.55), rect: [43.6, 46.0, 15.2, 16.6, 1.0] });
  put("regulator", box(34.0, 35.8, 0, 0.75, 11.3, 13.6, MAT.black));
  put("c1", chipPart(36.2, 37.7, 10.9, 13.8, 0.9, MAT.beige, true));
  put("c2", chipPart(36.2, 37.7, 14.9, 17.3, 0.9, MAT.beige, true));
  put("c3", chipPart(43.2, 44.6, 11.5, 14.2, 0.9, MAT.beige, true));
  put("sot", box(28.0, 29.4, 0, 0.7, 16.2, 17.6, MAT.black));
  // The small parts, 1 mm by half a millimetre: capacitors in tan, resistors in black, each with metal ends.
  const small = [
    [22.2, 10.1, 1, 0], [22.6, 11.6, 0, 0], [22.6, 12.9, 0, 0], [20.4, 8.7, 1, 1], [23.8, 9.5, 0, 1],
    [30.8, 5.9, 0, 1], [32.1, 6.1, 0, 0], [32.35, 12.5, 0, 0], [33.15, 12.5, 0, 0], [33.5, 14.9, 1, 1],
    [32.9, 16.0, 1, 0], [26.2, 16.6, 1, 1], [27.1, 15.8, 0, 0], [23.2, 15.6, 1, 1], [4.6, 3.6, 1, 1],
    [5.5, 3.6, 1, 1], [44.4, 7.4, 0, 1], [44.5, 17.6, 1, 1], [35.6, 4.4, 1, 1], [42.8, 8.9, 0, 0],
    [32.3, 9.8, 1, 0], [30.0, 15.2, 1, 0], [25.0, 15.0, 0, 1], [37.9, 9.6, 1, 1], [43.2, 10.3, 0, 0],
  ];
  small.forEach(([x, z, alongX, black], i) => {
    const a = alongX ? 0.5 : 0.25, b = alongX ? 0.25 : 0.5;
    put(`small${i}`, chipPart(x - a, x + a, z - b, z + b, 0.35, black ? MAT.black : MAT.beige, !alongX));
  });
  // The antenna's tuning parts, white, at the far end.
  for (const [x, z] of [[0.6, 9.3], [0.6, 12.1], [3.75, 9.3], [3.75, 12.1]]) put(`tune${x}${z}`, chipPart(x - 0.27, x + 0.27, z - 0.7, z + 0.7, 0.4, MAT.white, true));
  return P;
}

/** An oval button: a prism of sixteen sides, `rx` by `rz`, from y0 to y1. */
function oval(cx, cz, rx, rz, y0, y1, mat) {
  const n = 16, f = [];
  const at = (k, y) => [cx + Math.cos((k / n) * Math.PI * 2) * rx, y, cz + Math.sin((k / n) * Math.PI * 2) * rz];
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) / n * Math.PI * 2;
    f.push({ p: [at(k, y0), at(k + 1, y0), at(k + 1, y1), at(k, y1)], n: unit([Math.cos(a) / rx, 0, Math.sin(a) / rz]), mat });
  }
  f.push({ p: Array.from({ length: n }, (_, k) => at(k, y1)), n: [0, 1, 0], mat, top: true });
  return f;
}

function ledTop(g, w, h) {
  // The die, a speck of amber under the clear top.
  g.fillStyle = "rgba(196,120,96,.75)"; g.fillRect(w * 0.3, h * 0.38, w * 0.4, h * 0.24);
}

// Markings drawn on a part's top face, in tenths of a millimetre from its corner at the lowest x and z.
function vertical(g, text, x, z, size, color = "rgba(150,150,148,.9)", weight = 500) {
  g.save(); g.translate(x, z); g.rotate(Math.PI / 2);
  g.fillStyle = color; g.font = `${weight} ${size}px "Geist Mono", monospace`; g.textBaseline = "alphabetic"; g.textAlign = "start";
  g.fillText(text, 0, 0); g.restore();
}
function rpTop(g) {
  // Read top to bottom, the letters' tops toward the USB end, as the photograph shows them.
  vertical(g, "RP2350A0A2 25", 20, 10, 5.4, "rgba(156,156,152,.95)");
  vertical(g, "PAKV44.00  24", 13.5, 10, 5.4, "rgba(156,156,152,.95)");
  // The maker's mark: a raspberry of drupes under two leaves, its stalk toward the USB end, in outline.
  g.save(); g.translate(45, 38); g.rotate(Math.PI / 2);
  g.strokeStyle = "rgba(150,150,146,.9)"; g.lineWidth = 1.3;
  for (const [cx, cy, r] of [[0, 2, 4.2], [-6.4, -0.6, 3.8], [6.4, -0.6, 3.8], [-3.6, 6.8, 3.8], [3.6, 6.8, 3.8], [0, 11.2, 3.4], [-7.6, 6.0, 2.8], [7.6, 6.0, 2.8], [-3.2, -4.6, 3.0], [3.2, -4.6, 3.0]]) {
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }
  for (const s of [-1, 1]) {
    g.beginPath(); g.ellipse(s * 4.8, -10.2, 5.6, 2.6, s * -0.5, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
  g.fillStyle = "rgba(170,170,166,.8)"; g.beginPath(); g.arc(61.5, 11, 2.6, 0, Math.PI * 2); g.fill();
}
function flashTop(g) { vertical(g, "VA4mH", 12.5, 6, 4.2); vertical(g, "JQ02CA", 7.5, 6, 4.2); g.fillStyle = "rgba(170,170,166,.8)"; g.beginPath(); g.arc(17, 5, 1.6, 0, Math.PI * 2); g.fill(); }
function textTop(lines, size) { return (g, w, h) => lines.forEach((t, i) => vertical(g, t, w / 2 + (lines.length / 2 - i - 0.5) * size * 10 + size * 3, h * 0.12, size * 10 * 0.9)); }
function crystalTop(g, w, h) { g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 0.8; g.strokeRect(1.5, 1.5, w - 3, h - 3); vertical(g, "4621", w / 2 + 1, 6, 4.4, "rgba(110,104,96,.85)"); }
function shieldTop(g, w, h) {
  // Brushed, with a rim a shade darker where the can folds down.
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "rgba(255,255,255,.10)"); grad.addColorStop(0.5, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,.08)");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(0,0,0,.14)"; g.lineWidth = 2.2; g.strokeRect(1.1, 1.1, w - 2.2, h - 2.2);
  g.strokeStyle = "rgba(255,255,255,.28)"; g.lineWidth = 0.6; g.strokeRect(3, 3, w - 6, h - 6);
}
function bootselTop(g, w, h) {
  // Four metal tabs at the corners of the frame.
  g.fillStyle = "rgba(255,255,255,.55)";
  for (const [x, z] of [[2, 2], [w - 9, 2], [2, h - 9], [w - 9, h - 9]]) { g.beginPath(); g.roundRect(x, z, 7, 7, 2); g.fill(); }
}
function usbTop(g, w, h) {
  // The latch windows near the mouth, and the seam where the shell folds.
  g.strokeStyle = "rgba(40,42,44,.6)"; g.lineWidth = 1.6; g.fillStyle = "rgba(120,124,128,.5)";
  g.beginPath(); g.roundRect(w - 32, 9, 15, 13, 4); g.fill(); g.stroke();
  g.beginPath(); g.roundRect(w - 32, h - 22, 15, 13, 4); g.fill(); g.stroke();
  g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(4, 2); g.lineTo(4, h - 2); g.stroke();
  g.fillStyle = "rgba(30,30,32,.6)";
  g.beginPath(); g.roundRect(-1, 7, 8, 20, 2); g.fill();
  g.beginPath(); g.roundRect(-1, h - 27, 8, 20, 2); g.fill();
}
function usbFront(g, w, h) {
  // The mouth of a micro B socket: a trapezoid, wider at the top, with its tongue.
  g.fillStyle = "#16171a";
  g.beginPath(); g.moveTo(6, 4); g.lineTo(w - 6, 4); g.lineTo(w - 6, h - 10); g.lineTo(w - 14, h - 4); g.lineTo(14, h - 4); g.lineTo(6, h - 10); g.closePath(); g.fill();
  g.fillStyle = "#3a3c40"; g.fillRect(14, 9, w - 28, 4);
}

// ---- The board's own surface, painted once from the photograph.

const TRACES = (() => {
  // Plausible copper, following what the photograph shows: a fan of thin traces around the chip,
  // buses along the margins to the pins, wide power runs at the USB end.
  const t = [];
  const seg = (pts, w = 0.2) => t.push({ pts, w });
  for (let i = 0; i < 8; i++) {
    const x = 24.9 + i * 0.85, pin = [4, 5, 6, 7, 9, 10, 11, 12][i];
    const [px] = pinAt(pin), lane = 2.95 + (i % 4) * 0.24;
    seg([[x, 6.8], [x, 5.6 - (i % 3) * 0.3], [x + (5.6 - (i % 3) * 0.3 - lane), lane], [px, lane], [px, 2.4]]);
  }
  for (let i = 0; i < 7; i++) {
    const x = 24.7 + i * 0.95, pin = [29, 30, 31, 32, 34, 35, 36][i];
    const [px] = pinAt(pin), lane = 18.05 - (i % 4) * 0.24;
    seg([[x, 13.95], [x, 15.0 + (i % 3) * 0.25], [x + (lane - 15.0 - (i % 3) * 0.25) * (px > x ? 1 : -1), lane], [px, lane], [px, 18.6]]);
  }
  for (let i = 0; i < 6; i++) {
    const z = 7.6 + i * 0.85, pin = [24, 25, 26, 27, 21, 22][i];
    const [px] = pinAt(pin);
    seg([[24.25, z], [23.2 - i * 0.12, z], [22.4 - i * 0.12, z + 0.8], [22.4 - i * 0.12, 17.7 - i * 0.18], [px, 17.7 - i * 0.18], [px, 18.6]]);
  }
  for (let i = 0; i < 5; i++) {
    const z = 7.3 + i * 0.9;
    seg([[31.4, z], [32.6 + i * 0.15, z], [33.2 + i * 0.15, z - 0.6], [33.2 + i * 0.15, 4.9 - i * 0.1]]);
  }
  for (let i = 0; i < 4; i++) seg([[24.25, 9.0 + i * 0.7], [21.6, 9.0 + i * 0.7], [20.6, 8.0 + i * 0.7], [18.4, 8.0 + i * 0.7]]);
  for (let i = 0; i < 5; i++) seg([[46.0, 9.9 + i * 0.65], [43.8, 9.9 + i * 0.65], [42.6, 8.7 + i * 0.4], [38.6, 8.7 + i * 0.4]], 0.18);
  seg([[44.6, 14.6], [44.6, 15.9], [46.9, 17.6], [pinAt(39)[0], 18.6]], 0.55);
  seg([[47.0, 13.2], [48.6, 14.9], [48.6, 17.0], [pinAt(40)[0], 18.6]], 0.55);
  seg([[40.5, 17.8], [40.5, 18.3], [43.2, 18.3]], 0.5);
  seg([[18.35, 10.4], [13.2, 10.4], [9.4, 10.4]], 0.0);
  for (let i = 0; i < 4; i++) { const [px] = pinAt([1, 2, 14, 15][i]); seg([[px, 2.4], [px, 3.8], [px - 1.0, 4.8]], 0.2); }
  for (let i = 0; i < 6; i++) seg([[31.4, 11.8 + i * 0.36], [32.0, 11.8 + i * 0.36], [33.4 + i * 0.2, 13.2 + i * 0.36], [33.4 + i * 0.2, 16.8 + i * 0.12]], 0.16);
  for (let i = 0; i < 5; i++) seg([[25.2 + i * 1.3, 13.95], [25.2 + i * 1.3, 14.6], [24.4 + i * 1.3, 15.4]], 0.16);
  for (let i = 0; i < 4; i++) seg([[26.0 + i * 1.4, 6.8], [26.0 + i * 1.4, 6.2], [26.8 + i * 1.4, 5.4]], 0.16);
  for (let i = 0; i < 3; i++) seg([[35.8, 6.0 + i * 0.85], [36.5, 6.0 + i * 0.85]], 0.18);
  return t;
})();

function paintTop() {
  const c = document.createElement("canvas");
  c.width = PX(L); c.height = PX(W);
  const g = c.getContext("2d");
  g.fillStyle = COL.mask; g.fillRect(0, 0, c.width, c.height);
  // The antenna end has no copper under it: a darker field, with the ground's lighter edge pointing into it.
  g.fillStyle = COL.antenna; g.fillRect(0, 0, PX(7.4), PX(W));
  const arrow = [[7.4, 3.4], [3.9, 3.4], [1.3, 6.4], [1.3, 14.6], [3.9, 17.6], [7.4, 17.6]];
  g.fillStyle = COL.antennaIn; poly(g, arrow); g.fill();
  g.strokeStyle = COL.gap; g.lineWidth = PX(0.22); poly(g, arrow); g.stroke();
  // Copper: each trace with its clearance, the clearance darker than the mask over copper.
  g.lineJoin = "round"; g.lineCap = "round";
  for (const tr of TRACES) if (tr.w > 0) { g.strokeStyle = COL.gap; g.lineWidth = PX(tr.w + 0.36); line(g, tr.pts); g.stroke(); }
  for (const tr of TRACES) if (tr.w > 0) { g.strokeStyle = COL.trace; g.lineWidth = PX(tr.w); line(g, tr.pts); g.stroke(); }
  // Stitching vias: a ring around the wireless can, and along the antenna's edge.
  g.fillStyle = COL.deep;
  const dots = [];
  for (let x = 7.5; x <= 18.8; x += 0.62) dots.push([x, 3.95], [x, 16.85]);
  for (let z = 3.95; z <= 16.85; z += 0.62) dots.push([7.5, z], [18.75, z]);
  for (let z = 4.2; z <= 16.8; z += 0.7) dots.push([0.25, z]);
  for (const [x, z] of [[23.0, 5.4], [33.0, 10.0], [36.0, 9.4], [38.2, 15.0], [42.6, 6.1], [27.8, 15.4], [31.9, 15.0], [44.8, 8.6], [35.2, 16.2], [25.6, 5.6], [42.4, 17.3],
    [24.4, 15.4], [25.7, 15.4], [27.0, 15.4], [28.3, 15.4], [26.8, 5.4], [28.2, 5.4], [29.6, 5.4], [31.0, 5.4], [33.4, 16.8], [33.6, 17.2], [36.0, 14.3], [38.4, 9.2], [43.0, 15.0], [47.6, 16.2], [47.9, 5.2]]) dots.push([x, z]);
  for (const [x, z] of dots) { g.beginPath(); g.arc(PX(x), PX(z), PX(0.13), 0, Math.PI * 2); g.fill(); }
  // Pads.
  pinPads(g, false);
  for (const [x, z] of MOUNT) { ring(g, x, z, 1.65, COL.gold); }
  DEBUG.forEach(([x, z], i) => {
    g.fillStyle = COL.gap;
    if (i === 0) { g.fillRect(PX(x - 1.0), PX(z - 1.0), PX(2.0), PX(2.0)); g.fillStyle = COL.gold; g.fillRect(PX(x - 0.8), PX(z - 0.8), PX(1.6), PX(1.6)); }
    else { g.beginPath(); g.arc(PX(x), PX(z), PX(1.0), 0, Math.PI * 2); g.fill(); g.fillStyle = COL.gold; g.beginPath(); g.arc(PX(x), PX(z), PX(0.82), 0, Math.PI * 2); g.fill(); }
  });
  // The test point beside the LED: gold, with copper showing in the middle.
  g.fillStyle = COL.gold; g.beginPath(); g.arc(PX(43.4), PX(4.6), PX(0.85), 0, Math.PI * 2); g.fill();
  g.fillStyle = COL.copper; g.beginPath(); g.arc(PX(43.4), PX(4.6), PX(0.42), 0, Math.PI * 2); g.fill();
  // Solder showing past the parts: the chip's pads all round, the memory's legs, the switch's tabs.
  g.fillStyle = COL.solder;
  for (let i = 0; i < 15; i++) {
    const o = 6.8 + 0.78 + i * 0.4, ox = 24.25 + 0.78 + i * 0.4;
    g.fillRect(PX(24.0), PX(o - 0.1), PX(0.3), PX(0.2)); g.fillRect(PX(31.35), PX(o - 0.1), PX(0.3), PX(0.2));
    g.fillRect(PX(ox - 0.1), PX(6.55), PX(0.2), PX(0.3)); g.fillRect(PX(ox - 0.1), PX(13.9), PX(0.2), PX(0.3));
  }
  for (let i = 0; i < 4; i++) { const z = 5.45 + i * 0.85; g.fillRect(PX(33.35), PX(z - 0.15), PX(0.4), PX(0.3)); g.fillRect(PX(35.75), PX(z - 0.15), PX(0.4), PX(0.3)); }
  for (let i = 0; i < 6; i++) { const z = 11.3 + i * 0.7; g.fillRect(PX(38.7), PX(z - 0.12), PX(0.36), PX(0.24)); g.fillRect(PX(41.95), PX(z - 0.12), PX(0.36), PX(0.24)); }
  for (let i = 0; i < 5; i++) { const z = 9.6 + i * 0.65; g.fillRect(PX(45.9), PX(z - 0.12), PX(1.1), PX(0.24)); }
  for (const [x, z] of [[19.85, 4.0], [22.3, 4.0], [19.85, 7.4], [22.3, 7.4]]) g.fillRect(PX(x), PX(z), PX(0.35), PX(0.35));
  // Silkscreen.
  silkTop(g);
  cutHoles(g);
  return c;
}

function silkTop(g) {
  g.fillStyle = COL.silk; g.strokeStyle = COL.silk; g.textBaseline = "alphabetic"; g.textAlign = "start";
  // The name: Pico, a white tile with the 2 cut out of it, W.
  g.font = `600 ${PX(2.1)}px Geist, sans-serif`; g.letterSpacing = "0px";
  g.fillText("Pico", PX(23.4), PX(4.65));
  g.beginPath(); g.roundRect(PX(28.0), PX(2.85), PX(2.1), PX(1.95), PX(0.25)); g.fill();
  g.fillStyle = COL.mask; g.font = `700 ${PX(1.95)}px Geist, sans-serif`; g.textAlign = "center"; g.fillText("2", PX(29.05), PX(4.6));
  g.fillStyle = COL.silk; g.font = `700 ${PX(2.1)}px Geist, sans-serif`; g.textAlign = "start"; g.fillText("W", PX(30.75), PX(4.65));
  g.font = `500 ${PX(1.1)}px Geist, sans-serif`; g.letterSpacing = `${PX(0.06)}px`;
  g.fillText("BOOTSEL", PX(36.4), PX(4.7));
  g.font = `500 ${PX(0.95)}px Geist, sans-serif`; g.letterSpacing = `${PX(0.05)}px`;
  g.fillText("KC:R-R-P2R-PICO2W", PX(8.5), PX(3.75));
  const rot = (text, x, z, size, weight = 500) => {
    g.save(); g.translate(PX(x), PX(z)); g.rotate(Math.PI / 2);
    g.font = `${weight} ${PX(size)}px Geist, sans-serif`; g.letterSpacing = `${PX(0.05)}px`; g.fillText(text, 0, 0); g.restore();
  };
  rot("LED", 44.55, 3.8, 0.95);
  rot("USB", 44.75, 9.5, 0.95);
  rot("DEBUG", 21.35, 12.0, 0.95);
  rot("FCC:2ABCB-PICO2W", 6.0, 5.15, 0.88);
  rot("IC:20953-PICO2W", 4.8, 5.6, 0.88);
  g.letterSpacing = "0px";
  g.font = `500 ${PX(0.95)}px Geist, sans-serif`;
  g.fillText("2", PX(46.7), PX(3.25)); g.fillText("1", PX(49.4), PX(3.25)); g.fillText("39", PX(46.5), PX(18.35));
  g.lineWidth = PX(0.14); g.strokeRect(PX(18.6), PX(9.7), PX(2.35), PX(7.8));
  g.beginPath(); g.arc(PX(46.15), PX(2.85), PX(0.18), 0, Math.PI * 2); g.fill();
}

function paintBottom() {
  const c = document.createElement("canvas");
  c.width = PX(L); c.height = PX(W);
  const g = c.getContext("2d");
  // Drawn as the board is seen from underneath, turned over its length: the pin 21 to 40 edge at the top.
  g.fillStyle = COL.mask; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = COL.antenna; g.fillRect(PX(0.9), PX(2.8), PX(7.0), PX(15.4));
  pinPads(g, true);
  for (const [x, z] of MOUNT) ring(g, x, W - z, 1.65, COL.gold);
  DEBUG.forEach(([x, z], i) => {
    g.fillStyle = COL.gold;
    if (i === 0) g.fillRect(PX(x - 0.8), PX(W - z - 0.8), PX(1.6), PX(1.6));
    else { g.beginPath(); g.arc(PX(x), PX(W - z), PX(0.82), 0, Math.PI * 2); g.fill(); }
  });
  for (const [x, v, w, h] of [[45.9, 10.2, 1.5, 1.5], [49.6, 9.2, 1.4, 1.4], [49.6, 11.2, 1.4, 1.4], [41.0, 12.6, 1.5, 1.5], [38.6, 12.6, 1.5, 1.5], [36.1, 12.6, 1.5, 1.5]]) {
    g.fillStyle = COL.gold; g.beginPath(); g.roundRect(PX(x - w / 2), PX(v - h / 2), PX(w), PX(h), PX(0.2)); g.fill();
  }
  g.fillStyle = COL.silk; g.textBaseline = "alphabetic";
  const rot = (text, x, v, size, weight = 500) => {
    g.save(); g.translate(PX(x), PX(v)); g.rotate(Math.PI / 2);
    g.font = `${weight} ${PX(size)}px Geist, sans-serif`; g.letterSpacing = `${PX(0.04)}px`; g.textAlign = "start"; g.fillText(text, 0, 0); g.restore();
  };
  for (let n = 1; n <= 40; n++) {
    const [x] = pinAt(n);
    if (n > 20) rot(PIN_NAMES[n - 1], x - 0.45, 3.0, 0.9);
    else { g.save(); g.translate(PX(x + 0.45), PX(18.0)); g.rotate(-Math.PI / 2); g.font = `500 ${PX(0.9)}px Geist, sans-serif`; g.textAlign = "start"; g.fillText(PIN_NAMES[n - 1], 0, 0); g.restore(); }
  }
  g.font = `500 ${PX(0.85)}px Geist, sans-serif`; g.textAlign = "start";
  g.fillText("SWDIO", PX(20.9), PX(7.8)); g.fillText("GND", PX(20.9), PX(10.3)); g.fillText("SWCLK", PX(20.9), PX(12.8));
  for (const [t, x, v] of [["TP1", 44.2, 12.2], ["TP2", 47.6, 7.2], ["TP3", 47.6, 13.2], ["TP4", 40.5, 10.2], ["TP5", 38.0, 10.2], ["TP6", 35.5, 10.2]]) g.fillText(t, PX(x), PX(v));
  g.font = `700 ${PX(4.0)}px Geist, sans-serif`; g.fillText("FC", PX(1.8), PX(12.6));
  g.font = `600 ${PX(3.4)}px Geist, sans-serif`; g.fillText("CE", PX(14.6), PX(12.2));
  g.font = `700 ${PX(2.0)}px Geist, sans-serif`; g.fillText("UK", PX(28.2), PX(10.0)); g.fillText("CA", PX(28.2), PX(12.2));
  for (const [i, t] of ["Uses technology", "licensed from", "Proant AB"].entries()) rot(t, 11.6 - i * 1.0, 6.0, 0.8);
  cutHoles(g, true);
  return c;
}

function pinPads(g, under) {
  for (let n = 1; n <= 40; n++) {
    const [x, zt] = pinAt(n);
    const z = under ? W - zt : zt;
    const edge = z < W / 2 ? 0 : W;
    const z0 = edge === 0 ? 0 : W - 2.45, z1 = edge === 0 ? 2.45 : W;
    g.fillStyle = COL.gap; g.beginPath(); g.roundRect(PX(x - 1.15), PX(Math.max(0, z0 - 0.2)), PX(2.3), PX(2.65), PX(0.45)); g.fill();
    g.fillStyle = COL.gold; g.beginPath(); g.roundRect(PX(x - 0.95), PX(z0), PX(1.9), PX(z1 - z0), PX(0.38)); g.fill();
    g.strokeStyle = COL.goldDeep; g.lineWidth = PX(0.12);
    g.beginPath(); g.arc(PX(x), PX(z), PX(0.56), 0, Math.PI * 2); g.stroke();
  }
}

function ring(g, x, z, r, color) {
  g.fillStyle = COL.gap; g.beginPath(); g.arc(PX(x), PX(z), PX(r + 0.2), 0, Math.PI * 2); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(PX(x), PX(z), PX(r), 0, Math.PI * 2); g.fill();
  g.strokeStyle = COL.goldDeep; g.lineWidth = PX(0.14); g.beginPath(); g.arc(PX(x), PX(z), PX(1.13), 0, Math.PI * 2); g.stroke();
}

/** The holes go right through: the pins, the castellations on the edges, the mounting holes, the debug pads. */
function cutHoles(g, under = false) {
  g.save();
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "#000";
  const hole = (x, z, r) => { g.beginPath(); g.arc(PX(x), PX(z), PX(r), 0, Math.PI * 2); g.fill(); };
  for (let n = 1; n <= 40; n++) {
    const [x, zt] = pinAt(n);
    const z = under ? W - zt : zt;
    hole(x, z, 0.5);
    hole(x, z < W / 2 ? 0 : W, 0.5);
  }
  for (const [x, z] of MOUNT) hole(x, under ? W - z : z, 1.05);
  for (const [x, z] of DEBUG) hole(x, under ? W - z : z, 0.5);
  g.restore();
}

function poly(g, pts) { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(PX(x), PX(z)) : g.moveTo(PX(x), PX(z)))); g.closePath(); }
function line(g, pts) { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(PX(x), PX(z)) : g.moveTo(PX(x), PX(z)))); }

// ---- The outline, its castellations, and the sides.

const OUTLINE = (() => {
  const pts = [];
  const notch = (x, edge) => {
    // A half hole at the edge, curving into the board.
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI * (k / 8);
      if (edge === 0) pts.push([x - Math.cos(a) * 0.5, Math.sin(a) * 0.5, true]);
      else pts.push([x + Math.cos(a) * 0.5, W - Math.sin(a) * 0.5, true]);
    }
  };
  pts.push([0, 0, false]);
  for (let i = 0; i < 20; i++) notch(END + i * PITCH, 0);
  pts.push([L, 0, false], [L, W, false]);
  for (let i = 19; i >= 0; i--) notch(END + i * PITCH, W);
  pts.push([0, W, false]);
  return pts;
})();

function inside(x, z) {
  if (x <= 0 || x >= L || z <= 0 || z >= W) return false;
  for (let i = 0; i < 20; i++) {
    const px = END + i * PITCH;
    if (Math.hypot(x - px, z) < 0.5 || Math.hypot(x - px, z - W) < 0.5) return false;
  }
  return true;
}

const SIDES = (() => {
  const out = [];
  for (let i = 0; i < OUTLINE.length; i++) {
    const a = OUTLINE[i], b = OUTLINE[(i + 1) % OUTLINE.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    let n = [dz / len, 0, -dx / len];
    const mx = (a[0] + b[0]) / 2 + n[0] * 0.05, mz = (a[1] + b[1]) / 2 + n[2] * 0.05;
    if (inside(mx, mz)) n = [-n[0], 0, -n[2]];
    out.push({ p: [[a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], -T, b[1]], [a[0], -T, a[1]]], n, mat: a[2] && b[2] ? MAT.notch : MAT.edge });
  }
  return out;
})();

// ---- Cameras.

/** A camera looking at `target` from `dist` millimetres away, turned `yaw` round the board and raised `pitch` above it. */
export function orbit({ yaw = 0, pitch = 0.95, dist = 95, target = [0, 0, 0], focal, cx, cy, roll = 0 }) {
  const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const at = add(target, scale(dir, dist));
  const F = unit(sub(target, at));
  let R = cross([0, 1, 0], F);
  R = length(R) < 1e-6 ? [1, 0, 0] : unit(R);
  let U = cross(F, R);
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); [R, U] = [add(scale(R, c), scale(U, s)), add(scale(U, c), scale(R, -s))]; }
  return new Camera({ at, R, U, F, focal, cx, cy });
}

// ---- Drawing, lit.

let TOP = null, BOTTOM = null, PARTS = null;
function ready() {
  if (TOP === null) { TOP = paintTop(); BOTTOM = paintBottom(); PARTS = buildParts(); }
}

function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function shade(n, view, m, dark) {
  const lam = Math.max(0, dot(n, SUN));
  const h = unit(add(SUN, view));
  const sp = Math.pow(Math.max(0, dot(n, h)), m.shine) * m.spec;
  const k = (dark ? 0.32 : 0.46) + 0.7 * lam;
  const s = m.metal ? m.c : [255, 252, 245];
  return m.c.map((v, i) => Math.round(Math.min(255, v * k + s[i] * sp * 0.85)));
}

/** Map a canvas onto a quad in the world, triangle by triangle, so it bends with the perspective. */
function texture(g, cam, dpr, img, corner, nx = 14, ny = 6, flipV = false) {
  const pt = [];
  for (let j = 0; j <= ny; j++) {
    const row = [];
    for (let i = 0; i <= nx; i++) row.push(cam.project(corner(i / nx, j / ny), 0.5));
    pt.push(row);
  }
  const iw = img.width, ih = img.height;
  const tri = (a, b, c, ta, tb, tc) => {
    if (!a || !b || !c) return;
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
    const grow = (p) => { const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1; return [p.x + (dx / d) * 0.7, p.y + (dy / d) * 0.7]; };
    g.save();
    g.beginPath(); const A = grow(a), B = grow(b), C = grow(c); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(C[0], C[1]); g.closePath(); g.clip();
    const s1 = tb[0] - ta[0], t1 = tb[1] - ta[1], s2 = tc[0] - ta[0], t2 = tc[1] - ta[1];
    const x1 = b.x - a.x, y1 = b.y - a.y, x2 = c.x - a.x, y2 = c.y - a.y;
    const det = s1 * t2 - s2 * t1;
    if (Math.abs(det) < 1e-9) { g.restore(); return; }
    const m11 = (x1 * t2 - x2 * t1) / det, m21 = (x2 * s1 - x1 * s2) / det;
    const m12 = (y1 * t2 - y2 * t1) / det, m22 = (y2 * s1 - y1 * s2) / det;
    const e = a.x - m11 * ta[0] - m21 * ta[1], f = a.y - m12 * ta[0] - m22 * ta[1];
    g.setTransform(dpr * m11, dpr * m12, dpr * m21, dpr * m22, dpr * e, dpr * f);
    g.drawImage(img, 0, 0);
    g.restore();
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u0 = (i / nx) * iw, u1 = ((i + 1) / nx) * iw;
    let v0 = (j / ny) * ih, v1 = ((j + 1) / ny) * ih;
    if (flipV) { v0 = ih - v0; v1 = ih - v1; }
    tri(pt[j][i], pt[j][i + 1], pt[j + 1][i + 1], [u0, v0], [u1, v0], [u1, v1]);
    tri(pt[j][i], pt[j + 1][i + 1], pt[j + 1][i], [u0, v0], [u1, v1], [u0, v1]);
  }
}

/** Draw on a face of a part: a flat rectangle at height y, from (x0, z0) to (x1, z1), in tenths of a millimetre. */
function onFace(g, cam, dpr, x0, x1, z0, z1, y, draw) {
  const a = cam.project(world(x0, y, z0), 0.5), b = cam.project(world(x1, y, z0), 0.5), c = cam.project(world(x0, y, z1), 0.5);
  if (!a || !b || !c) return;
  const w = (x1 - x0) * 10, h = (z1 - z0) * 10;
  g.save();
  g.setTransform(dpr * (b.x - a.x) / w, dpr * (b.y - a.y) / w, dpr * (c.x - a.x) / h, dpr * (c.y - a.y) / h, dpr * a.x, dpr * a.y);
  g.beginPath(); g.rect(0, 0, w, h); g.clip();
  draw(g, w, h);
  g.restore();
}
/** The same for the front of the USB socket, the face at x = 52.6, from (y0, z0) to (y1, z1). */
function onFront(g, cam, dpr, x, y0, y1, z0, z1, draw) {
  const a = cam.project(world(x, y1, z0), 0.5), b = cam.project(world(x, y1, z1), 0.5), c = cam.project(world(x, y0, z0), 0.5);
  if (!a || !b || !c) return;
  const w = (z1 - z0) * 10, h = (y1 - y0) * 10;
  g.save();
  g.setTransform(dpr * (b.x - a.x) / w, dpr * (b.y - a.y) / w, dpr * (c.x - a.x) / h, dpr * (c.y - a.y) / h, dpr * a.x, dpr * a.y);
  draw(g, w, h);
  g.restore();
}

function facePath(g, cam, pts) {
  g.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = cam.project(world(...pts[i]), 0.5);
    if (!p) return false;
    if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
  }
  g.closePath();
  return true;
}
function faceVisible(cam, f) {
  const n = worldNormal(f.n);
  const p = world(...f.p[0]);
  return dot(n, sub(cam.at, p)) > 1e-6;
}
function faceDepth(cam, f) { let z = 0; for (const q of f.p) z += cam.local(world(...q))[2]; return z / f.p.length; }

/**
 * The board, lit, as `cam` sees it. `led` from 0 to 1 is how bright the
 * LED is, `ring` circles a part in the signal color, `plug` is how far a
 * micro USB plug stands out of the socket in millimetres (0 is all the way
 * in, null is no cable at all).
 */
export function drawBoard(g, cam, { dpr = 1, dark = true, led = 0, ring = null, plug = null, t = 0, cableTo = null, desk = true } = {}) {
  ready();
  const eyeAbove = dot(sub(cam.at, world(L / 2, 0, W / 2)), [0, 1, 0]) > 0;
  const view = (p) => unit(sub(cam.at, p));
  g.save();
  g.lineJoin = "round";
  const fill = (f, color) => { if (facePath(g, cam, f.p)) { g.fillStyle = color; g.strokeStyle = color; g.lineWidth = 0.6; g.fill(); g.stroke(); } };
  const drawPart = (part) => {
    const faces = part.faces.filter((f) => faceVisible(cam, f)).sort((a, b) => faceDepth(cam, b) - faceDepth(cam, a));
    for (const f of faces) {
      let m = f.mat;
      if (part.led && f.mat === MAT.led && led > 0.02) m = { c: [Math.round(246 - 120 * led), 255, Math.round(224 - 60 * led)], spec: 0.2, shine: 10 };
      const c = shade(worldNormal(f.n), view(world(...f.p[0])), m, dark);
      if (part.led && f.mat === MAT.led && led > 0.02) for (let i = 0; i < 3; i++) c[i] = Math.round(c[i] * (1 - led) + [200, 255, 210][i] * led);
      fill(f, rgb(c));
    }
    if (part.top && part.rect) {
      const [x0, x1, z0, z1, y] = part.rect;
      if (eyeAbove) onFace(g, cam, dpr, x0, x1, z0, z1, y + 0.001, part.top);
    }
    if (part.front) {
      const [, x1, z0, z1, y] = part.rect;
      if (dot([1, 0, 0], sub(cam.at, world(x1, 0, 0))) > 0) onFront(g, cam, dpr, x1 + 0.001, 0, y, z0, z1, part.front);
    }
  };
  const sides = SIDES.filter((f) => faceVisible(cam, f)).sort((a, b) => faceDepth(cam, b) - faceDepth(cam, a));
  const sorted = [...PARTS].sort((a, b) => length(sub(cam.at, world(...b.center))) - length(sub(cam.at, world(...a.center))));
  const plugParts = plug === null ? [] : plugFaces(plug);
  if (eyeAbove) {
    if (desk) groundAndShadow(g, cam, dark);
    for (const f of sides) fill(f, rgb(shade(worldNormal(f.n), view(world(...f.p[0])), f.mat, dark)));
    texture(g, cam, dpr, TOP, (u, v) => world(u * L, 0, v * W));
    const lit = (dark ? 0.32 : 0.46) + 0.7 * Math.max(0, SUN[1]);
    if (lit < 1) { g.setTransform(dpr, 0, 0, dpr, 0, 0); outlinePath(g, cam, 0); g.fillStyle = `rgba(0,0,0,${(1 - lit) * 0.55})`; g.fill(); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ring) ringAround(g, cam, ring, t, dark);
    for (const part of sorted) drawPart(part);
    if (led > 0.02) glow(g, cam, led, dark);
    for (const part of plugParts) drawPart(part);
    if (plug !== null) cable(g, cam, plug, cableTo);
  } else {
    const usb = PARTS.find((p) => p.name === "usb");
    drawPart(usb);
    for (const part of plugParts) drawPart(part);
    if (plug !== null) cable(g, cam, plug, cableTo);
    for (const f of sides) fill(f, rgb(shade(worldNormal(f.n), view(world(...f.p[0])), f.mat, dark)));
    texture(g, cam, dpr, BOTTOM, (u, v) => world(u * L, -T, W - v * W));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  g.restore();
}

/** The desk under the board: a soft pool of light, and the board's own shadow, offset away from the light. */
function groundAndShadow(g, cam, dark) {
  const y = -T - 0.02;
  const c = cam.project(world(L / 2, y, W / 2), 0.5);
  if (!c) return;
  g.save();
  // The pool: a circle on the desk, seen in perspective.
  const rim = cam.project(world(L / 2 + 52, y, W / 2), 0.5), rimZ = cam.project(world(L / 2, y, W / 2 + 52), 0.5);
  if (rim && rimZ) {
    const rx = Math.hypot(rim.x - c.x, rim.y - c.y), ry = Math.hypot(rimZ.x - c.x, rimZ.y - c.y);
    g.translate(c.x, c.y); g.scale(1, Math.max(0.15, ry / rx));
    const pool = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    pool.addColorStop(0, dark ? "rgba(150,170,200,.075)" : "rgba(255,255,255,.55)");
    pool.addColorStop(1, dark ? "rgba(150,170,200,0)" : "rgba(255,255,255,0)");
    g.fillStyle = pool; g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  g.restore();
  g.save();
  // The shadow: the outline on the desk, pushed away from the light and blurred by distance.
  const blur = Math.max(2, c.s * 1.4);
  g.filter = `blur(${blur}px)`;
  g.beginPath();
  for (const [x, z] of [[-0.6, -0.2], [L + 2.4, -0.2], [L + 2.4, W + 0.9], [-0.6, W + 0.9]]) {
    const p = cam.project(world(x + 0.9, y, z - 0.5), 0.5);
    if (!p) { g.restore(); return; }
    g.lineTo(p.x, p.y);
  }
  g.closePath();
  g.fillStyle = dark ? "rgba(0,0,0,.85)" : "rgba(20,24,20,.32)";
  g.fill();
  g.restore();
}

function outlinePath(g, cam, y) {
  g.beginPath();
  OUTLINE.forEach(([x, z], i) => { const p = cam.project(world(x, y, z), 0.5); if (!p) return; if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
  g.closePath();
}

/** Where the LED is on the screen, and how many pixels a millimetre is there. */
export function ledAt(cam) { return cam.project(world(46.15, 0.45, 4.7), 0.5); }
/** Where any point of the board is on the screen. */
export function at(cam, x, y, z) { return cam.project(world(x, y, z), 0.5); }

function glow(g, cam, led, dark) {
  const p = ledAt(cam);
  if (!p) return;
  g.save();
  g.globalCompositeOperation = dark ? "lighter" : "multiply";
  if (dark) {
    const r = p.s * 14;
    const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    halo.addColorStop(0, `rgba(235,255,238,${0.95 * led})`);
    halo.addColorStop(0.05, `rgba(150,255,175,${0.85 * led})`);
    halo.addColorStop(0.16, `rgba(70,240,120,${0.42 * led})`);
    halo.addColorStop(0.42, `rgba(40,210,100,${0.12 * led})`);
    halo.addColorStop(1, "rgba(40,210,100,0)");
    g.fillStyle = halo; g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  } else {
    const r = p.s * 9;
    const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    halo.addColorStop(0, `rgba(120,230,150,${0.6 * led})`); halo.addColorStop(1, "rgba(120,230,150,0)");
    g.fillStyle = halo; g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over";
    const core = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 2.2);
    core.addColorStop(0, `rgba(240,255,242,${led})`); core.addColorStop(1, "rgba(160,255,190,0)");
    g.fillStyle = core; g.fillRect(p.x - p.s * 2.2, p.y - p.s * 2.2, p.s * 4.4, p.s * 4.4);
  }
  g.restore();
}

/** A ring in the signal color on the board round a part, breathing. */
function ringAround(g, cam, name, t, dark) {
  const spots = { bootsel: [39.05, 6.9, 4.4, 1.4], usb: [50.0, 10.4, 5.6, 2.6], led: [46.15, 4.7, 2.6, 0.5] };
  const s = spots[name];
  if (!s) return;
  const [x, z, r0, y] = s;
  const k = 1 + 0.08 * Math.sin(t * 3.2);
  g.save();
  g.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const p = cam.project(world(x + Math.cos(a) * r0 * k, y, z + Math.sin(a) * r0 * k), 0.5);
    if (!p) { g.restore(); return; }
    if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
  }
  g.strokeStyle = "#FF4A1C"; g.lineWidth = 2.2; g.stroke();
  g.globalAlpha = 0.25; g.lineWidth = 7; g.stroke();
  g.restore();
}

// ---- The cable.

function plugFaces(d) {
  const x = 52.9 + d, zc = 10.4, yc = 1.25;
  const parts = [];
  const put = (name, faces) => {
    let c = [0, 0, 0], n = 0;
    for (const f of faces) for (const q of f.p) { c = add(c, q); n++; }
    parts.push({ name, faces, center: scale(c, 1 / n) });
  };
  if (d > 0.2) put("tip", box(x - 5.4, x, yc - 0.9, yc + 0.9, zc - 3.4, zc + 3.4, MAT.tip));
  put("overmold", [...box(x, x + 4.5, yc - 2.6, yc + 2.6, zc - 5.0, zc + 5.0, MAT.overmold), ...box(x + 4.5, x + 11.5, yc - 2.2, yc + 2.2, zc - 3.8, zc + 3.8, MAT.overmold)]);
  return parts;
}

function cable(g, cam, d, to) {
  const x = 52.9 + d + 11.5, zc = 10.4, yc = 1.25;
  const end = to ?? [x + 40, yc - 6, zc - 26];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const k = i / 24;
    // Out of the plug straight, then a long bend toward wherever it goes.
    const bx = x + 9 * k + (end[0] - x - 9) * k * k;
    const by = yc + (end[1] - yc) * k * k;
    const bz = zc + (end[2] - zc) * Math.pow(k, 1.6);
    pts.push(cam.project(world(bx, by, bz), 0.5));
  }
  g.save();
  g.lineCap = "round"; g.lineJoin = "round";
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!a || !b) continue;
    const w = 3.3 * (a.s + b.s) / 2;
    g.strokeStyle = "#202124"; g.lineWidth = w; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  const w0 = 3.3 * (pts[0]?.s ?? 1);
  g.strokeStyle = "rgba(255,255,255,.14)"; g.lineWidth = w0 * 0.2; g.lineCap = "butt";
  g.beginPath(); pts.forEach((p, i) => { if (!p) return; const x = p.x - w0 * 0.16, y = p.y - w0 * 0.22; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
  g.restore();
}

// ---- Drawing, in line.

/**
 * The same board as a technical drawing: ink on paper, hidden lines
 * removed, the part a step is about filled in the signal color.
 */
export function drawBoardLine(g, cam, { ink = "#111111", paper = "#ECECE7", accent = "#FF4A1C", led = 0, mark = null, plug = null, t = 0, cableTo = null } = {}) {
  ready();
  g.save();
  g.lineJoin = "round"; g.lineCap = "round";
  const eyeAbove = dot(sub(cam.at, world(L / 2, 0, W / 2)), [0, 1, 0]) > 0;
  const path = (f) => facePath(g, cam, f.p);
  // Sides, then the top, then the bottom edge where it shows.
  const sides = SIDES.filter((f) => faceVisible(cam, f)).sort((a, b) => faceDepth(cam, b) - faceDepth(cam, a));
  for (const f of sides) if (path(f)) { g.fillStyle = paper; g.fill(); }
  g.strokeStyle = ink; g.lineWidth = 1;
  for (const f of sides) {
    const a = cam.project(world(...f.p[2]), 0.5), b = cam.project(world(...f.p[3]), 0.5);
    if (a && b) { g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(a.x, a.y); g.stroke(); }
  }
  for (const corner of [[0, 0], [L, 0], [L, W], [0, W]]) {
    const a = cam.project(world(corner[0], 0, corner[1]), 0.5), b = cam.project(world(corner[0], -T, corner[1]), 0.5);
    if (a && b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  }
  outlinePath(g, cam, eyeAbove ? 0 : -T);
  g.fillStyle = paper; g.fill();
  g.lineWidth = 1.4; g.stroke();
  // Holes, and the pads round them, faint.
  const circle = (x, z, r, y = 0) => {
    g.beginPath();
    for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2; const p = cam.project(world(x + Math.cos(a) * r, y, z + Math.sin(a) * r), 0.5); if (!p) return false; if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }
    g.closePath(); return true;
  };
  g.lineWidth = 0.7;
  for (const [x, z] of PINS) if (circle(x, z, 0.5)) g.stroke();
  for (const [x, z] of DEBUG) if (circle(x, z, 0.5)) g.stroke();
  for (const [x, z] of MOUNT) { if (circle(x, z, 1.05)) g.stroke(); g.globalAlpha = 0.35; if (circle(x, z, 1.65)) g.stroke(); g.globalAlpha = 1; }
  g.globalAlpha = 0.28; g.lineWidth = 0.6;
  for (const [x, z] of PINS) {
    const z0 = z < W / 2 ? 0 : W - 2.45, z1 = z < W / 2 ? 2.45 : W;
    if (facePath(g, cam, [[x - 0.95, 0, z0], [x + 0.95, 0, z0], [x + 0.95, 0, z1], [x - 0.95, 0, z1]])) g.stroke();
  }
  g.globalAlpha = 1;
  if (eyeAbove) {
    const sorted = [...PARTS].sort((a, b) => length(sub(cam.at, world(...b.center))) - length(sub(cam.at, world(...a.center))));
    const plugParts = plug === null ? [] : plugFaces(plug);
    for (const part of [...sorted, ...plugParts]) {
      const faces = part.faces.filter((f) => faceVisible(cam, f)).sort((a, b) => faceDepth(cam, b) - faceDepth(cam, a));
      const small = part.name.startsWith("small") || part.name.startsWith("tune");
      for (const f of faces) {
        if (!path(f)) continue;
        const hot = (mark === "bootsel" && part.name === "bootsel" && f.mat === MAT.cap) || (mark === "led" && part.led && f.mat === MAT.led && led > 0.5);
        g.fillStyle = hot ? accent : paper;
        g.fill();
        g.strokeStyle = ink; g.lineWidth = small ? 0.5 : 0.85; g.stroke();
      }
    }
    if (plug !== null) cableLine(g, cam, plug, cableTo, ink, paper);
    if (led > 0.5) {
      const p = ledAt(cam);
      if (p) {
        g.strokeStyle = accent; g.lineWidth = 1.6;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + 0.2;
          const r0 = p.s * 1.6, r1 = p.s * (3.4 + 0.3 * Math.sin(t * 6));
          g.beginPath(); g.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0 * 0.7); g.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1 * 0.7); g.stroke();
        }
      }
    }
  }
  g.restore();
}

function cableLine(g, cam, d, to, ink, paper) {
  const x = 52.9 + d + 11.5, zc = 10.4, yc = 1.25;
  const end = to ?? [x + 40, yc - 6, zc - 26];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const k = i / 24;
    pts.push(cam.project(world(x + 9 * k + (end[0] - x - 9) * k * k, yc + (end[1] - yc) * k * k, zc + (end[2] - zc) * Math.pow(k, 1.6)), 0.5));
  }
  g.save(); g.lineCap = "butt"; g.lineJoin = "round";
  const stroke = (w, color) => { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => p && (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); };
  const s = pts[0]?.s ?? 1;
  stroke(3.3 * s + 2, ink); stroke(3.3 * s, paper);
  g.restore();
}

// ---- The board as the site draws it. ----

/** A camera that shows the board `size` pixels long, centered at (cx, cy), turned `yaw` and raised `pitch`. */
export function boardCamera(w, h, { yaw = 0.42, pitch = 0.7, size = w * 0.6, cx = w / 2, cy = h / 2, dist = 170 } = {}) {
  return orbit({ yaw, pitch, dist, focal: (size / L) * dist, cx, cy });
}

/** The board in the site's theme: lit in the dark, a technical drawing in the light, its LED `led` from 0 to 1. */
export function drawBoardThemed(g, cam, { dark = true, dpr = 1, led = 0, t = 0, ring = null, plug = null, cableTo = null, desk = true, paper = "#ECECE7" } = {}) {
  if (dark) drawBoard(g, cam, { dpr, dark: true, led, t, ring, plug, cableTo, desk });
  else drawBoardLine(g, cam, { led, mark: ring ?? "led", plug, t, cableTo, paper });
}
