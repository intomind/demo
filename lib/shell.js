// What every demo shares: the mark, the light toggle, the connect pill,
// the demo's name with its one line at the bottom, the controls beside
// it, and the card that says what the demo needs before it starts.

import { whyNoBluetooth } from "./bluetooth.js";

const KEY = "intomind-demo-theme";
const ICON = '<svg class="sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg><svg class="moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/></svg>';

export function theme() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
export function isDark() { return theme() === "dark"; }

export function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* private mode keeps no preference */ }
  window.dispatchEvent(new Event("themechange"));
}

/**
 * Build the chrome around a stage. `title` is the demo's name, shown at
 * the bottom left. Returns the handles a demo talks to.
 */
export function shell({ home = "../", title = "", line = "", about = "" } = {}) {
  const header = document.createElement("header");
  header.className = "chrome";
  header.innerHTML = `
    <a class="mark" href="${home}">IntoMind<span>Demo Suite</span></a>
    <div class="tools">
      ${about ? `<div class="helpwrap"><button class="help" type="button" aria-label="What is this?" aria-expanded="false">?</button><div class="tip" role="tooltip"><h3>What is this?</h3>${about}</div></div>` : ""}
      <button class="theme" type="button" aria-label="Light or dark">${ICON}</button>
    </div>`;
  const footer = document.createElement("footer");
  footer.className = "foot";
  footer.innerHTML = `<div class="title"><h1>${title}</h1><p class="line" aria-live="polite"></p></div><div class="side"><div class="opts"></div><p class="note small">Unplug the USB-C cable before wearing your IntoMind One.</p></div>`;
  document.body.append(header, footer);
  header.querySelector(".theme").addEventListener("click", () => applyTheme(isDark() ? "light" : "dark"));
  const helpwrap = header.querySelector(".helpwrap");
  if (helpwrap) {
    // Hover shows it. A tap or a click pins it until the next tap, a click elsewhere, or Escape.
    const help = helpwrap.querySelector(".help");
    let pinned = false;
    const show = (on) => { helpwrap.classList.toggle("open", on); help.setAttribute("aria-expanded", String(on)); };
    helpwrap.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(true); });
    helpwrap.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pinned) show(false); });
    help.addEventListener("click", () => { pinned = !pinned; show(pinned); });
    document.addEventListener("click", (e) => { if (pinned && !helpwrap.contains(e.target)) { pinned = false; show(false); } });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && pinned) { pinned = false; show(false); } });
  }
  const lineEl = footer.querySelector(".line");
  let veil = null;
  let stopPreview = null;
  const api = {
    tools: header.querySelector(".tools"),
    opts: footer.querySelector(".opts"),
    say(text) { lineEl.textContent = text; lineEl.classList.remove("warn"); },
    warn(text) { lineEl.textContent = text; lineEl.classList.add("warn"); },
    /** A control at the bottom right. Returns the button. */
    opt(label, onClick, { on = false } = {}) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (on) b.classList.add("on");
      b.addEventListener("click", onClick);
      api.opts.append(b);
      return b;
    },
    sep() { const s = document.createElement("span"); s.className = "sep"; api.opts.append(s); },
    /** A link at the bottom right, to this demo's own code or to another page. */
    link(label, href) {
      const a = document.createElement("a");
      a.className = "mono";
      a.href = href;
      a.textContent = label;
      a.style.color = "var(--muted)";
      a.style.textDecoration = "none";
      api.opts.append(a);
      return a;
    },
    /**
     * The card: a title, paragraphs or steps as HTML, and actions. Each
     * action is a label and what it does. It closes when an action says so.
     */
    card({ title: t, html, actions, preview = null }) {
      api.closeCard();
      veil = document.createElement("div");
      veil.className = "veil";
      veil.innerHTML = `<div class="card" role="dialog" aria-modal="true"><h2>${t}</h2><div class="body"><div class="scroll">${preview ? '<div class="preview"><canvas></canvas></div>' : ""}${html}</div><button class="more" type="button" aria-label="Scroll down"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button></div><div class="actions"></div></div>`;
      const box = veil.querySelector(".actions");
      for (const a of actions) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `pill${a.primary ? " primary" : ""}`;
        b.textContent = a.label;
        b.addEventListener("click", async () => {
          b.classList.add("busy");
          const keep = await a.onClick?.(b);
          b.classList.remove("busy");
          if (keep !== true) api.closeCard();
        });
        box.append(b);
      }
      document.body.append(veil);
      // When the text runs past the bottom, a pulsing arrow says so. The buttons never scroll away.
      const body = veil.querySelector(".body"), scroll = veil.querySelector(".scroll"), more = veil.querySelector(".more");
      const check = () => { const over = scroll.scrollHeight - scroll.clientHeight > 4; const atEnd = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4; body.classList.toggle("over", over && !atEnd); };
      scroll.addEventListener("scroll", check);
      more.addEventListener("click", () => scroll.scrollBy({ top: scroll.clientHeight * 0.8, behavior: "smooth" }));
      const ro = new ResizeObserver(check);
      ro.observe(scroll);
      for (const child of scroll.children) ro.observe(child);
      check();
      if (preview) stopPreview = preview(veil.querySelector(".preview canvas")) ?? null;
      return veil;
    },
    closeCard() {
      if (stopPreview) { stopPreview(); stopPreview = null; }
      if (veil !== null) { veil.remove(); veil = null; }
    },
    /**
     * The card a demo opens with when no IntoMind One is connected: what it
     * needs, and Connect, or what is in the way and what to do about it.
     * `also` is a second choice that does not need the IntoMind One.
     * `warning`, when given, leads the card in either case.
     */
    async openingCard(device, { title: t, html, also = null, onConnect, preview = null, warning = null }) {
      const problem = await whyNoBluetooth();
      const connect = async (b) => {
        b.textContent = "Connecting";
        try {
          await device.connect();
          onConnect?.();
        } catch (e) {
          b.textContent = "Connect your IntoMind One";
          const p = veil?.querySelector(".fail");
          if (p) p.textContent = e.message;
          return true;
        }
      };
      const actions = [];
      // A warning leads the card whether or not this browser can reach Bluetooth yet.
      const lead = warning ? `<p>${warning}</p>` : "";
      let body = lead + html;
      if (problem === null) {
        actions.push({ label: "Connect your IntoMind One", primary: true, onClick: connect });
        body += `<p class="line warn fail"></p>`;
      } else {
        body = lead + `<p class="why">${problem.why}</p><p>${problem.text}</p>` + (problem.steps ? `<ol>${problem.steps.map((s) => `<li>${s}</li>`).join("")}</ol>` : "");
        if (problem.copy) actions.push({ label: "Copy the address", onClick: async (b) => { await navigator.clipboard?.writeText(problem.copy); b.textContent = "Copied"; return true; } });
        actions.push({ label: "Check again", primary: true, onClick: () => { location.reload(); return true; } });
      }
      if (also) actions.push({ label: also.label, onClick: also.onClick });
      return api.card({ title: t, html: body, actions, preview });
    },
    /** The connect pill, wired to an IntoMind One. */
    connect(device, { onConnect, onDisconnect } = {}) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "pill";
      pill.textContent = "Connect";
      api.tools.prepend(pill);
      const render = () => {
        if (device.connected) {
          pill.classList.add("on");
          pill.classList.remove("busy");
          pill.textContent = device.battery === null ? "Connected" : `Connected · ${device.battery}%`;
        } else {
          pill.classList.remove("on", "busy");
          pill.textContent = "Connect";
        }
      };
      pill.addEventListener("click", async () => {
        if (device.connected) { await device.disconnect(); return; }
        pill.classList.add("busy");
        pill.textContent = "Connecting";
        try {
          await device.connect();
          render();
          api.closeCard();
          onConnect?.();
        } catch (e) {
          render();
          api.warn(e.message);
        }
      });
      device.on((e) => {
        if (e.type === "status" || e.type === "connected") render();
        if (e.type === "disconnected") { render(); onDisconnect?.(); }
      });
      if (!device.available) pill.disabled = true;
      render();
      return pill;
    },
  };
  api.say(line);
  return api;
}

/** Said once, when a page has built itself. The screenshot tool reads it. */
export function ready() { document.body.dataset.ready = "1"; }

/** A canvas filling the stage, sized to its pixels. Returns a draw context each call. */
export function fit(canvas, max = 2) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const dpr = Math.min(max, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  return { g, w, h, dpr };
}

/** The field behind a demo: a soft dark pool, or the light paper. */
export function field(g, w, h, dark = isDark()) {
  if (dark) {
    const bg = g.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.75);
    bg.addColorStop(0, "#0d1017"); bg.addColorStop(1, "#05060a");
    g.fillStyle = bg;
  } else {
    g.fillStyle = "#ECECE7";
  }
  g.fillRect(0, 0, w, h);
}

export function mono(g, size, weight = 500) { g.font = `${weight} ${size}px "Geist Mono", ui-monospace, monospace`; g.letterSpacing = "0.08em"; }
export function sans(g, size, weight = 650) { g.font = `${weight} ${size}px Geist, system-ui, sans-serif`; g.letterSpacing = "-0.045em"; }

/** Where this site lives, for a saved image. */
export function siteAddress() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "" || /^\d+\.\d+\.\d+\.\d+$/.test(h) ? "demo.intomind.com" : h;
}

/** Text from a device or a file, safe inside HTML. */
export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

export function today() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}

export function download(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

export function downloadBytes(bytes, filename, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The dev source, only when the address says so. Never on a device. */
export async function pickDevice() {
  const q = new URLSearchParams(location.search);
  if (q.has("dev")) {
    const { Sim } = await import("./sim.js");
    return new Sim(q);
  }
  const { Device } = await import("./device.js");
  return new Device();
}
