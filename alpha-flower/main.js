// Alpha Flower. Eyes closed, the alpha rhythm comes up, and a flower grows
// from the signal: its symmetry from the alpha peak, its splits from theta
// against alpha, its reach from the alpha share, every bend from the
// samples, and its color from the peak. Eyes open, it stays.

import { shell, ready, fit, field, mono, sans, isDark, pickDevice, download, today, siteAddress } from "../lib/shell.js";
import { filaments, drawElectric, colorOf } from "../lib/electric.js";
import { drawPhasePortrait, drawSpectralMandala, drawFlowBloom } from "../lib/blooms.js";
import { alphaShare } from "../lib/alpha.js";
import { flowerPreview } from "../lib/previews.js";

const STYLES = ["electric", "phase", "mandala", "flow"];
/** Seconds of closed-eyes signal the flower is read from, the newest kept. */
const KEEP = 12;
/** Seconds with eyes closed until the electric form has opened every generation. */
const FULL = 24;
/** The alpha share that counts as eyes closed, and the one below which they count as open again. */
const CLOSE = 0.36, OPEN = 0.27;

const canvas = document.getElementById("stage");
const ui = shell({ title: "Alpha Flower", line: "Connect your IntoMind One.", about: `
  <p><b>EEG</b>, electroencephalography, is a recording of the brain's electrical activity from the scalp. Billions of neurons firing together make tiny voltages, millionths of a volt, that electrodes resting on the skin can pick up. The IntoMind One has four of them.</p>
  <p>When you close your eyes, the part of the brain that handles vision settles into a steady rhythm of about eight to twelve waves a second, called <b>alpha</b>. It was the first brainwave ever recorded, in 1924, and it is still the strongest and most reliable signal in EEG.</p>
  <p>This page reads your alpha rhythm: its exact frequency, how much of the signal it makes up, and the shape of every wave. Those numbers set the rules of a <b>fractal</b>, a pattern made by repeating one rule at smaller and smaller scales. So the flower is a picture of your own rhythm, and it grows only while your eyes are closed, because that is when alpha is there.</p>
  <p>The number at the bottom right is how much of your signal's power, from 4 to 30 waves a second, is alpha, from 8 to 13. Write it down with your eyes open, then with them closed.</p>` });
const device = await pickDevice();

const st = {
  style: STYLES.includes(new URLSearchParams(location.search).get("style")) ? new URLSearchParams(location.search).get("style") : "electric",
  running: false,
  closed: false,
  share: null,
  grown: 0,
  buffer: [],
  taken: 0,
  form: null,
  color: null,
  channels: null,
  tick: null,
  t0: performance.now(),
};

const styleButtons = {};
for (const s of STYLES) styleButtons[s] = ui.opt(s, () => setStyle(s), { on: s === st.style });
ui.sep();
// The alpha share as a number, to write down with eyes open and with eyes closed.
const reading = document.createElement("span");
reading.className = "mono";
reading.title = "How much of the signal's power from 4 to 30 waves a second is alpha, from 8 to 13";
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
    <p>When your eyes close, your brain produces a rhythm called alpha, about ten waves a second. Your IntoMind One picks it up, and this page grows a flower from the signal itself. The shape, the branching and the color all come from your own waves, so no two flowers are the same.</p>
    <p>Open your eyes and the flower stays. Save it as an image if you like it.</p>`,
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
  const lanes = device.recent(3);
  if (lanes === null) return;
  const share = alphaShare(lanes, device.fs);
  st.share = share;
  reading.textContent = share === null ? "" : `Alpha ${Math.round(share * 100)}%`;
  if (share === null) return;
  if (!st.closed && share >= CLOSE) st.closed = true;
  else if (st.closed && share <= OPEN) st.closed = false;
  const fresh = Math.max(0, Math.min(device.received - st.taken, device.lanes[0]?.length ?? 0));
  st.taken = device.received;
  if (!st.closed) return;
  if (st.buffer.length !== device.lanes.length) st.buffer = device.lanes.map(() => []);
  for (let c = 0; c < st.buffer.length; c++) {
    const lane = device.lanes[c];
    for (let i = lane.length - fresh; i < lane.length; i++) st.buffer[c].push(lane[i]);
    const keep = Math.round(KEEP * device.fs);
    if (st.buffer[c].length > keep) st.buffer[c].splice(0, st.buffer[c].length - keep);
  }
  st.grown += 0.25;
  if (st.buffer[0].length >= device.fs * 2) {
    const ch = st.buffer.map((b) => Float64Array.from(b));
    st.channels = ch;
    st.form = filaments(ch[0], device.fs, { growth: Math.min(1, st.grown / FULL) });
    st.color = colorOf(st.form, ch, device.fs, "peak");
  }
  saveBtn.disabled = againBtn.disabled = st.form === null;
  clock.textContent = `${Math.floor(st.grown / 60)}:${String(Math.floor(st.grown % 60)).padStart(2, "0")}`;
}

function drawFlower(g, cx, cy, R, t, dark) {
  if (st.form === null) return;
  const growth = Math.min(1, st.grown / FULL);
  const ch = st.channels;
  if (st.style === "electric") drawElectric(g, cx, cy, R, st.form, { ...st.color, t, paper: !dark });
  else if (st.style === "phase") drawPhasePortrait(g, cx, cy, R * 1.1, ch, device.fs, { paper: !dark, growth });
  else if (st.style === "mandala") drawSpectralMandala(g, cx, cy, R * 1.1, ch, device.fs, { paper: !dark, growth });
  else drawFlowBloom(g, cx, cy, R * 1.1, ch, device.fs, { paper: !dark, growth });
}

function frame() {
  const { g, w, h } = fit(canvas);
  const dark = isDark();
  const t = (performance.now() - st.t0) / 1000;
  field(g, w, h, dark);
  const R = Math.min(w, h) * 0.36;
  if (st.form === null && st.running) {
    // A heart, waiting. Its pulse is the alpha share.
    const s = st.share ?? 0;
    const r = R * (0.05 + 0.06 * Math.min(1, s / CLOSE)) * (1 + 0.04 * Math.sin(t * 2.2));
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
  if (st.form === null) return;
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
  g.fillText(`ALPHA FLOWER · ${st.form.alphaHz.toFixed(1)} HZ · ${mins} MIN ${secs} S · ${today()}`, 96, H - 120);
  g.fillText(siteAddress().toUpperCase(), 96, H - 84);
  download(c, "alpha-flower.png");
}

function again() {
  st.grown = 0;
  st.buffer = [];
  st.form = null;
  st.color = null;
  saveBtn.disabled = againBtn.disabled = true;
  clock.textContent = "0:00";
}

window.addEventListener("keydown", (e) => {
  const i = Number(e.key) - 1;
  if (i >= 0 && i < STYLES.length) setStyle(STYLES[i]);
});

ready();
