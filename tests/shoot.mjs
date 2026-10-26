// Load pages in headless Chrome for real seconds, report every runtime
// exception and console error, and save a screenshot of each. The smoke
// test, and the way to look at a scene mid-experience.
//
//   node tests/shoot.mjs                 every page, with the simulated IntoMind One, to /tmp/shots
//   node tests/shoot.mjs "alpha-flower/?dev&closed" 12 /tmp/a.png
//   node tests/shoot.mjs "./" 1 /tmp/h.png --width=390                 at a phone's width
//   node tests/shoot.mjs flight-simulator/ 6 /tmp/f.png --click="Fly with the keyboard" --key=ArrowLeft:1500
//   node tests/shoot.mjs flight-simulator/ 2 /tmp/f.png --click="Fly with the keyboard" --key=ArrowDown:hold   still held at the photograph
//
// Needs google-chrome on the path, or CHROME set to it, and a server on
// PORT (default 8000) serving the repository.

import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = process.env.CHROME ?? "google-chrome";
const PORT = process.env.PORT ?? "8000";
const BASE = `http://127.0.0.1:${PORT}/`;
const SCENES = [
  ["./", 2],
  ["alpha-flower/?dev&closed", 10],
  ["age-detector/?dev&fast", 5],
  ["biological-sex-detector/?dev&fast", 5],
  ["light-switch/?dev", 3],
  ["flight-simulator/?dev&fast&look=left&after=5", 9, ["Begin", "Start"]],
  ["pico/", 2],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Every page is shown inside the suite, so what a scene presses and reads is in the suite's frame.
const PAGE_WIN = 'document.querySelector("iframe.page")?.contentWindow ?? window';
const PAGE_DOC = 'document.querySelector("iframe.page")?.contentDocument ?? document';

async function launch() {
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--remote-debugging-port=0", "--window-size=1600,900", "--autoplay-policy=no-user-gesture-required", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const port = await new Promise((resolve, reject) => {
    let text = "";
    chrome.stderr.on("data", (d) => {
      text += d.toString();
      const m = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) resolve(Number(m[1]));
    });
    chrome.on("exit", () => reject(new Error("Chrome exited before it listened")));
    setTimeout(() => reject(new Error("Chrome did not start listening")), 15000);
  });
  return { chrome, port };
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.problems = [];
    this.loaded = false;
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const w = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) w?.reject(new Error(msg.error.message));
        else w?.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.problems.push(`exception: ${d.exception?.description?.split("\n")[0] ?? d.text} at ${d.url ?? "?"}:${d.lineNumber ?? "?"}`);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        this.problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
      } else if (msg.method === "Page.loadEventFired") {
        this.loaded = true;
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }
}

async function shoot(port, path, seconds, out, { full = false, width = 1600, height = 900, clicks = [], keys = [], js = null, profile = false } = {}) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const page = new Page(ws);
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Page.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  // Silent: the system speaks what a page says aloud, past the browser's own sound, which --mute-audio turns off.
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: "if (window.speechSynthesis) speechSynthesis.speak = () => {};" });
  await page.send("Page.navigate", { url: /^https?:\/\//.test(path) ? path : BASE + path });
  const start = Date.now();
  while (!page.loaded && Date.now() - start < 10000) await sleep(50);
  let spent = 0;
  for (const text of clicks) {
    // Wait for the button to be there, then press it. It is in the page the suite shows.
    const find = `[...(${PAGE_DOC}).querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const r = await page.send("Runtime.evaluate", { expression: `${find} ? (${find}.click(), true) : false`, returnByValue: true });
      if (r.result.value) break;
      await sleep(100);
    }
    await sleep(300);
    spent += (Date.now() - t0) / 1000;
  }
  for (const [key, ms] of keys) {
    const code = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[key] ?? 0;
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    if (ms === "hold") continue;
    await sleep(ms);
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    spent += ms / 1000;
  }
  await sleep(Math.max(0, seconds - spent) * 1000);
  if (js) { const r = await page.send("Runtime.evaluate", { expression: `(${PAGE_WIN}).eval(${JSON.stringify(js)})`, awaitPromise: true, returnByValue: true }); console.log(`     js -> ${JSON.stringify(r.result?.value)}`); await sleep(400); }
  if (profile) {
    // Three seconds of the page's own time, by function: where a frame goes.
    await page.send("Profiler.enable");
    await page.send("Profiler.setSamplingInterval", { interval: 500 });
    await page.send("Profiler.start");
    await sleep(3000);
    const { profile: prof } = await page.send("Profiler.stop");
    const self = new Map();
    const dt = prof.timeDeltas ?? [];
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    prof.samples.forEach((id, i) => {
      const n = byId.get(id);
      const f = n.callFrame;
      const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").slice(-2).join("/")}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
    });
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    console.log("     profile, self time:");
    for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)) console.log(`       ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
  }
  const ready = await page.send("Runtime.evaluate", { expression: `(${PAGE_DOC}).body?.dataset.ready === "1"`, returnByValue: true });
  if (!ready.result.value) page.problems.push("the page did not say it was ready");
  // Beyond the viewport, without resizing it, so a page spaced in viewport units keeps its proportions.
  const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  ws.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
  return page.problems;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const [one, secs, outPath] = args;
const full = flags.includes("--full");
const widthFlag = flags.find((f) => f.startsWith("--width="));
const heightFlag = flags.find((f) => f.startsWith("--height="));
const js = flags.find((f) => f.startsWith("--js="))?.slice(5) ?? null;
const profile = flags.includes("--profile");
const clicks = flags.filter((f) => f.startsWith("--click=")).map((f) => f.slice(8));
const keys = flags.filter((f) => f.startsWith("--key=")).map((f) => { const [k, ms] = f.slice(6).split(":"); return [k, ms === "hold" ? "hold" : Number(ms ?? 1000)]; });
const width = widthFlag ? Number(widthFlag.split("=")[1]) : 1600;
const height = heightFlag ? Number(heightFlag.split("=")[1]) : width < 600 ? 844 : 900;
const { chrome, port } = await launch();
let failed = 0;
try {
  const jobs = one ? [[one, Number(secs ?? 6), outPath ?? "/tmp/shot.png", clicks]] : SCENES.map(([s, secs, sceneClicks = []], i) => [s, secs, `/tmp/shots/${i}-${s.split("/")[0].replace(/[^a-z-]/g, "") || "home"}.png`, [...clicks, ...sceneClicks]]);
  mkdirSync("/tmp/shots", { recursive: true });
  for (const [path, seconds, out, sceneClicks] of jobs) {
    const problems = await shoot(port, path, seconds, out, { full, width, height, clicks: sceneClicks, keys, js, profile });
    if (problems.length) { failed++; console.log(`FAIL ${BASE}${path}`); for (const p of problems) console.log(`     ${p}`); }
    else console.log(`ok   ${BASE}${path} -> ${out}`);
  }
} finally {
  chrome.kill();
}
process.exit(failed ? 1 : 0);
