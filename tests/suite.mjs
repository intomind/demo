// The suite in headless Chrome: pages change inside one tab, which keeps
// its state, the tab's address and title follow the page, links to other
// sites leave the suite, keys reach the page, and nothing throws.
//
//   node tests/suite.mjs
//
// Needs google-chrome on the path, or CHROME set to it, and a server on
// PORT (default 8000) serving the repository.
import { spawn } from "node:child_process";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = `http://127.0.0.1:${process.env.PORT ?? "8000"}`;
const chrome = spawn(process.env.CHROME ?? "google-chrome", ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const port = await new Promise((resolve) => { let t = ""; chrome.stderr.on("data", (d) => { t += d; const m = t.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(Number(m[1])); }); });
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const waiting = new Map(); const problems = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result ?? m); waiting.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description?.split("\n")[0] ?? m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description).join(" "));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const top = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const inFrame = (expr) => top(`(() => { const w = document.querySelector("iframe.page").contentWindow; return w.eval(${JSON.stringify(expr)}); })()`);
const results = [];
const check = (name, ok, got) => { results.push(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  (got ${JSON.stringify(got)})`}`); };
const clickInFrame = async (selector) => {
  const r = await top(`(() => { const f = document.querySelector("iframe.page"); const fr = f.getBoundingClientRect(); const el = f.contentDocument.querySelector(${JSON.stringify(selector)}); const b = el.getBoundingClientRect(); return { x: fr.x + b.x + Math.min(20, b.width / 2), y: fr.y + b.y + b.height / 2 }; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

await send("Page.navigate", { url: `${BASE}/` });
await sleep(1500);
check("home: the tab's address is the page's own", await top("location.href") === `${BASE}/`, await top("location.href"));
check("home: the page inside carries the mark", (await top(`document.querySelector("iframe.page").contentWindow.location.search`)) === "?in", await top(`document.querySelector("iframe.page").contentWindow.location.search`));
check("home: the tab's own copy of the page is hidden", await top(`getComputedStyle(document.querySelector("main.home")).display`) === "none");
check("home: the page inside is shown", await top(`getComputedStyle(document.querySelector("iframe.page")).visibility`) === "visible");
await top("window.__kept = 42");

await clickInFrame('a[href="alpha-flower/"]');
await sleep(2000);
check("a link: the tab did not reload", await top("window.__kept") === 42, await top("window.__kept"));
check("a link: the address follows", await top("location.href") === `${BASE}/alpha-flower/`, await top("location.href"));
check("a link: the title follows", await top("document.title") === "Alpha Flower · IntoMind Demo Suite", await top("document.title"));
check("a demo inside: its opening card is up", await inFrame(`!!document.querySelector(".veil .card")`) === true);
check("a demo inside: it says it is ready", await inFrame(`document.body.dataset.ready`) === "1");
check("a demo inside: the IntoMind One is the suite's", await top(`typeof window.__intomind?.adopt`) === "function");

await clickInFrame("a.mark");
await sleep(1500);
check("the mark: home again, same tab", await top("location.href") === `${BASE}/` && await top("window.__kept") === 42, [await top("location.href"), await top("window.__kept")]);

await top("history.back()");
await sleep(1500);
check("back: the demo again, address follows", await top("location.href") === `${BASE}/alpha-flower/` && await top("window.__kept") === 42, [await top("location.href"), await top("window.__kept")]);

await top(`document.querySelector("iframe.page").contentWindow.location.href = "${BASE}/pico/"`);
await sleep(1800);
const external = await inFrame(`(() => { const a = document.createElement("a"); a.href = "https://example.com/"; a.textContent = "out"; document.body.append(a); document.addEventListener("click", (e) => e.preventDefault(), { once: true }); a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); return [a.href, a.target]; })()`);
check("another site's link opens in the whole tab", external && external[1] === "_top", external);
check("a page reached from code gets the mark too", (await top(`document.querySelector("iframe.page").contentWindow.location.search`)) === "?in", await top(`document.querySelector("iframe.page").contentWindow.location.search`));
check("…and the tab shows its own address", await top("location.href") === `${BASE}/pico/`, await top("location.href"));

await send("Page.navigate", { url: `${BASE}/alpha-flower/?dev&closed` });
await sleep(2500);
check("?dev: the tab keeps it", await top("location.href") === `${BASE}/alpha-flower/?dev&closed`, await top("location.href"));
check("?dev: the page inside runs the simulated device", await inFrame(`document.querySelector(".pill.conn")?.textContent`) !== undefined && (await inFrame(`location.search`)) === "?dev&closed&in", await inFrame(`location.search`));

await inFrame(`window.__keys = []; addEventListener("keydown", (e) => __keys.push(e.key));`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC", text: "c", windowsVirtualKeyCode: 67 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
await sleep(200);
check("keys go to the page inside", JSON.stringify(await inFrame("__keys")) === '["c"]', await inFrame("__keys"));

const before = await top("document.documentElement.dataset.theme");
await clickInFrame("button.theme");
await sleep(300);
const after = [await top("document.documentElement.dataset.theme"), await inFrame("document.documentElement.dataset.theme")];
check("the theme: the tab follows the page", after[0] === after[1] && after[0] !== before, [before, ...after]);
await clickInFrame("button.theme");

check("nothing threw", problems.length === 0, problems);
console.log(results.join("\n"));
chrome.kill();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
