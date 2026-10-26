// Mind-Controlled Light Switch. Off is resting. On is a thought you hold.
// Teach your IntoMind One the two, your browser fits a custom AI head that
// tells them apart, the head is installed on your IntoMind One, and a Pico 2 W
// lights its LED whenever the head reads On. A real Pico 2 W can do the same
// with no computer in the room: pico/ has the program and the guide.

import { shell, ready, fit, field, isDark, pickDevice, downloadBytes, esc } from "../lib/shell.js";
import { boardCamera, drawBoardThemed } from "../lib/board.js";
import { trainHead, blockedFolds, roundPermutation, trainingFile, trainingText, savedHead } from "../lib/train.js";
import { ENCODER } from "../lib/numbers.js";
import { protocol as P } from "../vendor/intomind-sdk-1.4.0/index.js";
import { speak, beep } from "../lib/cues.js";
import { picoPreview } from "../lib/previews.js";

/** Where the custom AI head goes on the IntoMind One, and where the Pico 2 W looks for it. Slot 1 holds the open source AI head for biological sex, and this demo never touches it or any other. */
const SLOT = 2;
const HEAD_NAME = "light switch";
/** The most a head slot on the IntoMind One holds, in bytes. */
const SLOT_BYTES = 4096;
/** Windows delivered after a cue that began before it: the one that straddles it, and the one before that, still in the pipeline. */
const SETTLE = 2;
/** Eleven readings a round leave 77 to train on when one whole round is held back to test, one more than the 76 dimensions. */
const ROUNDS = 8, PER = 11;
/** A linear model on 76 numbers needs more windows than that, or it learns the noise. */
const NEEDED = 77;
/** Seconds of EEG in a window, and from one window to the next. */
const SECONDS = 4;

const OFF = { word: "Off", task: "Rest. Let your mind wander.", cue: "Rest. Let your mind wander." };
const ON = { word: "On", task: "Count down from 300 by sevens.", cue: "Hold your thought. Count down from three hundred by sevens, or think the thought you chose." };
const READY = "Off is resting. On is a thought you hold. Counting down from 300 by sevens works for most people.";
const DOING = "Do what the demo shows until it changes.";

const HOW = `<p>Off is resting with your eyes open. On is a thought you hold steadily. Counting down from 300 by sevens works for most people, but any thought you can keep up for a minute works, and your IntoMind One never needs to know what it is.</p>
  <ol>
    <li>You teach. For about seven minutes the demo shows Off or On, and you do that until it changes. Eight rounds, eleven readings each.</li>
    <li>Your browser learns. For every four seconds of EEG your IntoMind One sends a summary of 76 numbers. Your browser fits a custom AI head, a small model that tells your two states apart, and tests it on readings it held back so the score is honest.</li>
    <li>Your IntoMind One runs it. The custom AI head is installed on your IntoMind One, which runs it on its own chip.</li>
    <li>The light follows. Whenever your custom AI head reads On, the Pico 2 W drawn on the demo lights its LED. A real Pico 2 W can do the same with no computer in the room. The <a href="../pico/">Pico 2 W guide</a> shows how.</li>
  </ol>`;

const canvas = document.getElementById("stage");
const big = document.getElementById("big"), word = document.getElementById("word"), task = document.getElementById("task"), left = document.getElementById("left");
/** One segment for every round, in the color of Off or On, filling as its round goes by. */
const segments = Array.from({ length: ROUNDS }, (_, round) => {
  const s = document.createElement("span");
  s.className = round % 2 ? "b" : "a";
  const fill = document.createElement("i");
  s.append(fill);
  document.getElementById("rounds").append(s);
  return fill;
});
const ui = shell({ title: "Mind-Controlled Light Switch", line: "Connect your IntoMind One.", about: `
  <p><b>EEG</b>, electroencephalography, is a recording of the brain's electrical activity from electrodes on the scalp. The IntoMind One has a small <b>AI model</b> on its chip, the <b>encoder</b>, which reads four seconds of EEG and summarizes it as 76 numbers, an <b>embedding</b>.</p>
  <p>When you teach the switch, this page collects those embeddings while you rest and while you hold a thought, then fits a <b>custom AI head</b>: a small model that finds the direction through those 76 numbers that best separates your two states. That is <b>machine learning</b> at its plainest, a line drawn through examples. Counting down by sevens works because concentration changes the brain's rhythms in measurable ways, less alpha and more fast activity at the front. Your IntoMind One never knows what the thought is, only whether the signal looks like your On state or your Off state.</p>
  <p>The custom AI head is a few hundred bytes, so it is installed on your IntoMind One, which runs it on its own chip and reports a reading every few seconds. When the reading says On, the <b>Pico 2 W</b>, a small microcontroller board, lights its LED. A real board can connect to your IntoMind One by itself, with no computer in the room.</p>` });
const device = await pickDevice();

const st = {
  phase: "idle",
  led: 0,
  target: 0,
  windows: [],
  dropped: 0,
  current: null,
  abort: false,
  head: null,
  score: null,
  /** The head came from a saved file, so there is no training data to save. */
  loaded: false,
  /** The date and time in the names of the files saved from this head. */
  stamp: null,
  /** The head this page installed during this visit, which it replaces without asking. */
  installed: null,
  /** Whether the IntoMind One holds a usable custom AI head in the slot, read from it. */
  onDevice: false,
  /** For the time left while teaching: whether a window has arrived yet, when the last one did, and the seconds between the last few. */
  heard: false,
  last: 0,
  intervals: [],
  /** Whether the last window did not count: the line says so, and the time left holds still. */
  warned: false,
  dim: 1,
  t0: performance.now(),
};

const teachBtn = ui.opt(`Start teaching · ${Math.round((ROUNDS * (SETTLE + PER) * SECONDS) / 60)} min`, teach);
const runBtn = ui.opt("Run it on your IntoMind One", run);
const stopBtn = ui.opt("Stop", () => { if (st.phase === "teaching") st.abort = true; else stopRun(); });
const againBtn = ui.opt("Teach again", again);
const saveBtn = ui.opt("Save", saveCard);
const loadBtn = ui.opt("Install a saved head", () => picker.click());
const removeBtn = ui.opt("Remove it from your IntoMind One", removeCard);
const picker = Object.assign(document.createElement("input"), { type: "file", accept: ".imh", hidden: true });
picker.addEventListener("change", () => { const f = picker.files?.[0]; picker.value = ""; if (f) installSaved(f); });
document.body.append(picker);
const picoLink = ui.link("Pico 2 W guide", "../pico/");
const howBtn = ui.opt("How it works", () => ui.card({ title: "How it works", html: HOW, actions: [{ label: "Close", primary: true }] }));
ui.sep();
const rule = ui.opts.lastElementChild;
const sourceLink = ui.link("Source", "main.js");

function render() {
  const on = device.connected;
  const show = (b, yes) => b.classList.toggle("hide", !yes);
  const idle = st.phase === "idle";
  const teaching = st.phase === "teaching";
  show(teachBtn, idle);
  teachBtn.disabled = !on;
  show(runBtn, st.phase === "trained" || st.phase === "stopped");
  show(stopBtn, st.phase === "running" || teaching);
  show(againBtn, !idle && !teaching);
  show(saveBtn, st.head !== null && !st.loaded && st.windows.length > 0 && !teaching);
  show(loadBtn, on && !teaching);
  show(removeBtn, on && st.onDevice && !teaching);
  for (const b of [picoLink, howBtn, rule, sourceLink]) show(b, !teaching);
  if (idle && on) ui.say(READY);
}

ui.connect(device, { onConnect: () => { render(); refreshSlot(); }, onDisconnect: () => { st.abort = true; st.phase = st.head ? "trained" : "idle"; st.target = 0; st.onDevice = false; render(); ui.say("Connect your IntoMind One."); } });

/** Whether the slot on the IntoMind One holds a custom AI head, so Remove shows only when there is one. */
async function refreshSlot() {
  try {
    const there = (await device.heads()).heads.find((h) => h.slot === SLOT);
    st.onDevice = !!there?.usable;
  } catch {
    st.onDevice = false;
  }
  render();
}
device.on((e) => {
  if (e.type === "auto") { ui.closeCard(); render(); refreshSlot(); if (device.q?.has("teach")) teach(); }
  if (e.type === "embedding" && st.phase === "teaching" && st.current !== null) {
    const c = st.current;
    const now = performance.now();
    if (st.heard) {
      st.intervals.push((now - st.last) / 1000);
      if (st.intervals.length > 5) st.intervals.shift();
    }
    st.heard = true;
    st.last = now;
    if (c.settle > 0) { c.settle -= 1; st.dropped += 1; }
    else if (e.flagged) {
      st.dropped += 1;
      st.warned = true;
      ui.warn(e.leadoff ? "An electrode lost contact, so those seconds don't count." : "Those seconds had a gap in the signal, so they don't count.");
    } else {
      st.windows.push({ index: e.index, round: c.round, label: c.label, embedding: e.embedding });
      c.got += 1;
      if (st.warned) { st.warned = false; ui.say(DOING); }
    }
  }
  if (e.type === "prediction" && st.phase === "running" && e.slot === SLOT) {
    st.target = e.flagged ? st.target : (e.value > 0.5 ? 1 : 0);
  }
});

ui.openingCard(device, {
  title: "Mind-Controlled Light Switch",
  html: `<p>Put on your IntoMind One and connect it. Then teach it your two states, and the light will follow your mind.</p>${HOW}`,
  also: { label: "Pico 2 W guide", onClick: () => { location.href = "../pico/"; } },
  onConnect: render,
  preview: picoPreview,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function teach() {
  try {
    await device.embeddings();
  } catch (e) {
    ui.warn(e.message);
    return;
  }
  st.phase = "teaching";
  st.abort = false;
  st.windows = [];
  st.dropped = 0;
  st.head = null;
  st.score = null;
  st.loaded = false;
  st.heard = false;
  st.last = performance.now();
  st.intervals = [];
  st.warned = false;
  render();
  big.classList.remove("hide");
  ui.say(DOING);
  for (let round = 0; round < ROUNDS && !st.abort; round++) {
    const label = round % 2;
    const s = label ? ON : OFF;
    st.current = { label, got: 0, settle: SETTLE, round };
    if (device.q) device.focus = label === 1;
    big.className = `big ${label ? "b" : "a"}`;
    word.textContent = s.word;
    task.textContent = s.task;
    progress();
    beep(label ? 880 : 440);
    speak(s.cue);
    while (st.current.got < PER && !st.abort) await sleep(200);
  }
  st.current = null;
  big.classList.add("hide");
  try { await device.stopEmbeddings(); } catch { /* the link may be gone */ }
  if (st.abort) { st.phase = "idle"; render(); return; }
  beep(660, 300);
  ui.say(`Your browser is fitting your custom AI head on ${st.windows.length} readings.`);
  await sleep(50);
  train();
}

function train() {
  const rows = st.windows.map((w) => w.embedding);
  const labels = st.windows.map((w) => w.label);
  if (rows.length < NEEDED) {
    st.phase = "idle";
    render();
    ui.warn(`${rows.length} readings is too few to fit a custom AI head. It needs ${NEEDED}. Teach again.`);
    return;
  }
  try {
    st.score = blockedFolds(rows, labels, { folds: 5, encoderId: device.encoderId });
    st.head = trainHead(rows, labels, { name: HEAD_NAME, encoderId: device.encoderId });
    st.stamp = stamp();
  } catch (e) {
    st.phase = "idle";
    render();
    ui.warn(e.message);
    return;
  }
  st.phase = "trained";
  render();
  const s = st.score;
  if (s === null) {
    ui.say(`Fitted on ${rows.length} readings. Too few to test, so there is no score.`);
  } else {
    // Whole rounds trade labels, so readings next to each other are not counted as separate evidence.
    const test = roundPermutation(rows, labels, st.windows.map((w) => w.round), { encoderId: device.encoderId });
    s.p = test ? test.p : null;
    const guess = Math.round(s.chance * 100);
    if (s.p !== null && s.p < 0.05) ui.say(`Tested on readings it held back: ${s.correct} of ${s.total} right, clearly better than guessing, which gets about ${guess} in 100. Now run it on your IntoMind One.`);
    else ui.say(`Tested on readings it held back: ${s.correct} of ${s.total} right. Guessing gets about ${guess} in 100, so this could be luck. Teach it again, or pick another thought for On.`);
  }
  speak("Done.");
  if (device.q?.has("run")) setTimeout(run, 300);
}

async function run() {
  const blob = st.head.blob;
  const id = P.decodeHead(blob).headId;
  try {
    const there = (await device.heads()).heads.find((h) => h.slot === SLOT);
    const same = there?.usable && there.headId === id;
    if (there?.usable && !same && there.headId !== st.installed && !(await replaceOk(there))) {
      ui.say("Nothing was replaced. Your IntoMind One keeps the custom AI head it has.");
      return;
    }
    if (!same) await device.upload(SLOT, blob, ({ taken, total }) => ui.say(`Installing your custom AI head on your IntoMind One: ${taken} of ${total} bytes.`));
    st.installed = id;
    st.onDevice = true;
    await device.predictions(SLOT);
  } catch (e) {
    ui.warn(e.noHead ? "Your IntoMind One could not run that custom AI head." : e.message);
    return;
  }
  st.phase = "running";
  render();
  ui.say(`Your IntoMind One is running your ${st.loaded ? "saved " : ""}custom AI head on its own chip. Hold your On thought and watch the light. It follows a few seconds behind you.`);
}

/** Ask before replacing a custom AI head this page did not install, because it cannot be copied back off the IntoMind One. */
function replaceOk(there) {
  const named = there.name ? `, named “${esc(there.name)}”` : "";
  return new Promise((resolve) => ui.card({
    title: "Replace the custom AI head?",
    html: `<p>Your IntoMind One already has a different custom AI head installed${named}. Installing this one replaces it. It can only come back from a saved file, because a custom AI head can't be copied off your IntoMind One.</p>`,
    actions: [{ label: "Replace it", primary: true, onClick: () => resolve(true) }, { label: "Cancel", onClick: () => resolve(false) }],
  }));
}

async function installSaved(f) {
  try {
    if (f.size > SLOT_BYTES) throw new Error("That file is not a custom AI head, or it is damaged.");
    const blob = new Uint8Array(await f.arrayBuffer());
    savedHead(blob, { encoderId: device.encoderId, width: device.encoderId === ENCODER.id ? ENCODER.width : null });
    if (st.phase === "running") await device.stopPredictions();
    st.head = { blob };
  } catch (e) {
    ui.warn(e.message);
    return;
  }
  st.loaded = true;
  st.score = null;
  st.windows = [];
  st.dropped = 0;
  st.stamp = stamp();
  st.phase = "trained";
  st.target = 0;
  render();
  ui.say("Installing your saved custom AI head on your IntoMind One.");
  await run();
}

/** Ask, then take the custom AI head out of the slot on the IntoMind One. A head taught here stays on this page to run or save again. */
function removeCard() {
  ui.card({
    title: "Remove your custom AI head?",
    html: `<p>This takes the custom AI head out of slot ${SLOT} on your IntoMind One. It holds no recording of your EEG, and it can only come back from a saved file or by teaching again.</p>`,
    actions: [{ label: "Remove it", primary: true, onClick: removeHead }, { label: "Cancel" }],
  });
}

async function removeHead() {
  try {
    if (st.phase === "running") { st.phase = "stopped"; st.target = 0; }
    await device.removeHead(SLOT);
  } catch (e) {
    ui.warn(e.message);
    return;
  }
  st.installed = null;
  st.onDevice = false;
  render();
  ui.say(`Removed. Your IntoMind One holds no custom AI head in slot ${SLOT}.${st.head ? " Yours is still on this page, to run or save." : ""}`);
}

/** A head installed from a file is already saved, so Save is only for a head taught here. */
function saveCard() {
  ui.card({
    title: "Save",
    html: "<p>The head is your custom AI head, to install again later. The training data is every reading it learned from, each labeled Off or On.</p>",
    actions: [
      { label: "Save the head", primary: true, onClick: () => { downloadBytes(st.head.blob, `light-switch-${st.stamp}.imh`); return true; } },
      { label: "Save the training data", onClick: () => { saveData(); return true; } },
      { label: "Close" },
    ],
  });
}

function saveData() {
  const file = trainingFile({ name: HEAD_NAME, encoderId: device.encoderId, states: [OFF.word, ON.word], windows: st.windows, dropped: st.dropped, score: st.score });
  downloadBytes(new TextEncoder().encode(trainingText(file)), `light-switch-training-data-${st.stamp}.json`, "application/json");
}

/** The date and time, for file names, so two teachings never save over each other. */
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function stopRun() {
  try { await device.stopPredictions(); } catch (e) { ui.warn(e.message); }
  st.phase = "stopped";
  st.target = 0;
  render();
  ui.say("Stopped. Your custom AI head stays on your IntoMind One until you remove it.");
}

function again() {
  st.phase = "idle";
  st.target = 0;
  render();
}

/**
 * The segments and the time left, from the windows still to come. Between
 * windows they move on with the clock, up to one window, so they never stand
 * still, except while windows are not counting.
 */
function progress() {
  const c = st.current;
  if (st.phase !== "teaching" || c === null) return;
  const each = SETTLE + PER;
  const done = SETTLE - c.settle + c.got;
  // The median of the last few intervals, so one pause in the stream does not stretch the rest.
  const sorted = [...st.intervals].sort((a, b) => a - b);
  const interval = sorted.length ? sorted[sorted.length >> 1] : SECONDS;
  const since = st.warned ? 0 : Math.min(1, (performance.now() - st.last) / 1000 / interval);
  segments.forEach((fill, round) => {
    const f = round < c.round ? 1 : round > c.round ? 0 : Math.min(1, (done + since) / each);
    fill.style.width = `${(f * 100).toFixed(2)}%`;
  });
  const seconds = Math.max(0, Math.ceil(((ROUNDS - c.round) * each - done - since) * interval));
  const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
  if (left.textContent !== text) left.textContent = text;
}

function frame() {
  progress();
  const { g, w, h, dpr } = fit(canvas);
  const dark = isDark();
  const t = (performance.now() - st.t0) / 1000;
  field(g, w, h, dark);
  st.led += (st.target - st.led) * 0.12;
  st.dim += ((st.phase === "teaching" ? 0.12 : 1) - st.dim) * 0.08;
  drawBoardThemed(g, boardCamera(w, h, { yaw: 0, pitch: 1.25, size: Math.min(w * 0.62, h * 1.3) }), { dark, dpr, led: st.led, t });
  // While teaching, the background is laid back over the board, in either theme, so the words over it read.
  g.globalAlpha = 1 - st.dim;
  field(g, w, h, dark);
  g.globalAlpha = 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.phase === "teaching") st.abort = true; });

render();
ready();
