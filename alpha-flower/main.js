// Alpha Flower. Eyes closed, the alpha rhythm comes up, and a fractal grows
// from the signal: its symmetry from the alpha peak, its splits from theta
// against alpha, its reach from relative alpha power, every bend from the
// samples, and its color from the peak. Each generation is read from the
// signal when it begins, and what has grown is kept, so the fractal only
// ever grows. Eyes open, it stays.

import { shell, ready, fit, field, mono, sans, isDark, pickDevice, download, today, siteAddress } from "../lib/shell.js";
import { Fractal, drawElectric, colorOf } from "../lib/electric.js";
import { drawPhasePortrait, drawSpectralMandala, drawFlowBloom } from "../lib/blooms.js";
import { relativeAlphaPower, windowSeconds, EyesClosed } from "../lib/alpha.js";
import { flowerPreview } from "../lib/previews.js";

const STYLES = ["electric", "phase", "mandala", "flow"];
/** Seconds of closed-eyes signal the fractal is read from, the newest kept. */
const KEEP = 12;
/** Seconds with eyes closed until the electric form has opened every generation. */
const FULL = 24;
/** The electric form's generations, each beginning after an equal fraction of the growth. */
const DEPTH = 6;
/** Seconds of closed-eyes signal before the fractal appears. */
const FIRST = 2;

const canvas = document.getElementById("stage");
const ui = shell({ title: "Alpha Flower", line: "Connect your IntoMind One.", about: `
  <p><b>EEG</b>, electroencephalography, is a recording of the brain's electrical activity from the scalp. Billions of neurons firing together make tiny voltages, millionths of a volt, that electrodes resting on the skin can pick up. The IntoMind One has four of them.</p>
  <p>When you close your eyes, the <b>visual cortex</b>, the part of the brain that processes vision, settles into a steady rhythm of 8 to 13 cycles a second, 8 to 13 <b>hertz</b>, called <b>alpha</b>. It was the first EEG rhythm ever recorded, in 1924, and it is still the strongest and most reliable signal in EEG.</p>
  <p>This page measures your alpha rhythm: its peak frequency, its relative power, and the shape of every wave. Those measurements set the rules of a <b>fractal</b>, a pattern made by repeating one rule at smaller and smaller scales. So the fractal is a picture of your own rhythm, and it grows only while your eyes are closed, because that is when alpha is there.</p>
  <p>The percentage at the bottom right is your <b>relative alpha power</b>: the power from 8 to 13 hertz as a percentage of the power from 4 to 30 hertz. Write it down with your eyes open, then with them closed.</p>` });
const device = await pickDevice();

const st = {
  style: STYLES.includes(new URLSearchParams(location.search).get("style")) ? new URLSearchParams(location.search).get("style") : "electric",
  running: false,
  closed: false,
  // Whether the eyes count as closed, from thresholds set from the wearer's baseline.
  eyes: new EyesClosed(),
  relative: null,
  grown: 0,
  buffer: [],
  // The first 12 seconds of closed-eyes signal, kept as they came, for the other three styles.
  signal: [],
  taken: 0,
  fractal: null,
  segs: null,
  color: null,
  tick: null,
  t0: performance.now(),
};

const styleButtons = {};
for (const s of STYLES) styleButtons[s] = ui.opt(s, () => setStyle(s), { on: s === st.style });
ui.sep();
// Relative alpha power as a percentage, to write down with the eyes open and with them closed.
const reading = document.createElement("span");
reading.className = "mono";
reading.title = "Relative alpha power: the power from 8 to 13 hertz as a percentage of the power from 4 to 30 hertz";
ui.opts.append(reading);
const clock = document.createElement("span");
clock.className = "mono";
clock.style.color = "var(--muted)";
clock.textContent = "0:00";
ui.opts.append(clock);
ui.sep();
const saveBtn = ui.opt("Save image", save);
const againBtn = ui.opt("Start over", again);
saveBtn.disabled = againBtn.disabled = true;
ui.sep();
ui.link("Source", "main.js");

function setStyle(s) {
  st.style = s;
  for (const [k, b] of Object.entries(styleButtons)) b.classList.toggle("on", k === s);
}

ui.connect(device, { onConnect: begin, onDisconnect: () => { stopTick(); st.running = false; ui.say("Connect your IntoMind One."); } });
device.on((e) => { if (e.type === "auto") { ui.closeCard(); begin(); } });

ui.openingCard(device, {
  title: "Alpha Flower",
  html: `<p>Put on your IntoMind One and connect it. Then close your eyes.</p>
    <p>When your eyes close, your brain produces a rhythm called alpha, about 10 cycles a second. Your IntoMind One picks it up, and this page grows a fractal from the signal itself. The shape, the branching and the color all come from your own waves, so no two fractals are the same.</p>
    <p>Open your eyes and the fractal stays. Save it as an image if you like it.</p>`,
  onConnect: begin,
  preview: flowerPreview,
});

async function begin() {
  try {
    await device.start();
  } catch (e) {
    ui.warn(e.message);
    return;
  }
  st.running = true;
  st.eyes.reset();
  st.taken = device.received;
  ui.say("Close your eyes.");
  startTick();
}

function startTick() {
  stopTick();
  st.tick = setInterval(tick, 250);
}
function stopTick() { if (st.tick !== null) clearInterval(st.tick); st.tick = null; }

function tick() {
  const lanes = device.recent(windowSeconds(device.fs));
  if (lanes === null) return;
  const relative = relativeAlphaPower(lanes, device.fs);
  st.relative = relative;
  reading.textContent = relative === null ? "" : `Relative alpha power ${Math.round(relative * 100)}%`;
  if (relative === null) return;
  st.closed = st.eyes.update(relative);
  const fresh = Math.max(0, Math.min(device.received - st.taken, device.lanes[0]?.length ?? 0));
  st.taken = device.received;
  if (!st.closed) return;
  if (st.buffer.length !== device.lanes.length) { st.buffer = device.lanes.map(() => []); st.signal = device.lanes.map(() => []); }
  const keep = Math.round(KEEP * device.fs);
  for (let c = 0; c < st.buffer.length; c++) {
    const lane = device.lanes[c];
    for (let i = lane.length - fresh; i < lane.length; i++) {
      st.buffer[c].push(lane[i]);
      if (st.signal[c].length < keep) st.signal[c].push(lane[i]);
    }
    if (st.buffer[c].length > keep) st.buffer[c].splice(0, st.buffer[c].length - keep);
  }
  st.grown += 0.25;
  if (st.fractal === null && st.buffer[0].length >= device.fs * FIRST) {
    st.fractal = new Fractal(Float64Array.from(st.buffer[0]), device.fs);
    st.color = colorOf(st.fractal, null, device.fs, "peak");
  }
  if (st.fractal !== null) {
    // Each generation begins after a sixth of the growth, read from the last 12 seconds of the first channel at that moment.
    while (st.fractal.generations.length < DEPTH && st.grown >= (st.fractal.generations.length * FULL) / DEPTH) st.fractal.grow(Float64Array.from(st.buffer[0]), device.fs);
    st.segs = st.fractal.segments(Math.min(1, st.grown / FULL) * DEPTH);
  }
  saveBtn.disabled = againBtn.disabled = st.fractal === null;
  clock.textContent = `${Math.floor(st.grown / 60)}:${String(Math.floor(st.grown % 60)).padStart(2, "0")}`;
}

function drawFlower(g, cx, cy, R, t, dark) {
  if (st.fractal === null) return;
  const growth = Math.min(1, st.grown / FULL);
  const first = Math.round(FIRST * device.fs);
  const ch = st.signal;
  if (st.style === "electric") drawElectric(g, cx, cy, R, { segs: st.segs }, { ...st.color, t, paper: !dark, depths: DEPTH });
  else if (st.style === "phase") drawPhasePortrait(g, cx, cy, R * 1.1, ch, device.fs, { paper: !dark, growth, first });
  else if (st.style === "mandala") drawSpectralMandala(g, cx, cy, R * 1.1, ch, device.fs, { paper: !dark, growth, total: ch.length * Math.floor(KEEP / 2) });
  else drawFlowBloom(g, cx, cy, R * 1.1, ch, device.fs, { paper: !dark, growth, first });
}

function frame() {
  const { g, w, h } = fit(canvas);
  const dark = isDark();
  const t = (performance.now() - st.t0) / 1000;
  field(g, w, h, dark);
  const R = Math.min(w, h) * 0.36;
  if (st.fractal === null && st.running) {
    // A heart, waiting. Its pulse follows relative alpha power.
    const s = st.relative ?? 0;
    const r = R * (0.05 + 0.06 * Math.min(1, s / st.eyes.thresholds().close)) * (1 + 0.04 * Math.sin(t * 2.2));
    g.globalCompositeOperation = dark ? "lighter" : "multiply";
    const heart = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
    heart.addColorStop(0, dark ? "rgba(243,241,234,.85)" : "rgba(17,17,17,.7)");
    heart.addColorStop(1, dark ? "rgba(243,241,234,0)" : "rgba(17,17,17,0)");
    g.fillStyle = heart;
    g.fillRect(w / 2 - r, h / 2 - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over";
  }
  drawFlower(g, w / 2, h / 2, R, t, dark);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function save() {
  if (st.fractal === null) return;
  const W = 1600, H = 2000;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const dark = isDark();
  field(g, W, H, dark);
  drawFlower(g, W / 2, H * 0.47, W * 0.36, 0, dark);
  g.fillStyle = dark ? "#f3f1ea" : "#111";
  sans(g, 44, 650); g.textAlign = "start"; g.fillText("IntoMind", 96, 140);
  g.fillStyle = dark ? "rgba(243,241,234,.5)" : "#77776F";
  sans(g, 44, 500); g.fillText("Demo Suite", 96 + g.measureText("IntoMind ").width + 10, 140);
  mono(g, 22); g.textAlign = "start";
  const mins = Math.floor(st.grown / 60), secs = Math.floor(st.grown % 60);
  g.fillText(`ALPHA FLOWER · ${st.fractal.alphaHz.toFixed(1)} HZ · ${mins} MIN ${secs} S · ${today()}`, 96, H - 120);
  g.fillText(siteAddress().toUpperCase(), 96, H - 84);
  download(c, "alpha-flower.png");
}

function again() {
  // A new fractal may be a new wearer: the baseline is measured again.
  st.eyes.reset();
  st.closed = false;
  st.grown = 0;
  st.buffer = [];
  st.signal = [];
  st.fractal = null;
  st.segs = null;
  st.color = null;
  saveBtn.disabled = againBtn.disabled = true;
  clock.textContent = "0:00";
}

window.addEventListener("keydown", (e) => {
  const i = Number(e.key) - 1;
  if (i >= 0 && i < STYLES.length) setStyle(STYLES[i]);
});

ready();
