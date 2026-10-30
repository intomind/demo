// What Age Detector and Biological Sex Detector share: connect, run one of
// the open source AI heads on the IntoMind One, and show what it says of every window as
// a running mean, flagged windows left out.

import { shell, ready, fit, field, mono, sans, isDark, pickDevice, download, today, siteAddress, esc } from "./shell.js";
import { ENCODER } from "./numbers.js";
import { protocol as P } from "../vendor/intomind-sdk-1.4.3/index.js";
import { Running } from "./heads.js";
import { ease } from "./readout.js";

/**
 * `published`, for a head in one of the slots that are yours, is its published file and what it is called: anything can be
 * installed over it, so the demo checks the slot still holds it before running it, and offers to put it back.
 */
export async function openHead({ title, slot, line = "Sit still.", intro, about = "", draw, card, file, preview = null, published = null }) {
  const canvas = document.getElementById("stage");
  const ui = shell({ title, line: "Connect your IntoMind One.", about });
  const device = await pickDevice();
  const running = new Running();
  const st = { shown: null, on: false };

  const saveBtn = ui.opt("Save image", save);
  saveBtn.disabled = true;
  ui.sep();
  ui.link("Source", "main.js");

  ui.connect(device, { onConnect: begin, onDisconnect: () => { st.on = false; ui.say("Connect your IntoMind One."); } });
  device.on((e) => {
    if (e.type === "auto") { ui.closeCard(); begin(); }
    if (e.type === "prediction" && e.slot === slot) {
      running.add(e.value, e.flagged);
      if (running.n > 0) saveBtn.disabled = false;
    }
  });

  ui.openingCard(device, { title, html: intro, onConnect: begin, preview });

  async function begin() {
    try {
      if (published && !(await inPlace())) return;
      await device.predictions(slot);
      st.on = true;
      ui.say(line);
    } catch (e) {
      ui.warn(e.message);
    }
  }

  /** True when the slot holds the published head, or once it is back. False when the person would rather it stayed as it is. */
  async function inPlace() {
    // Another version of the AI model on the chip comes with its own heads, so only this one's are checked.
    if (device.encoderId !== ENCODER.id) return true;
    const blob = new Uint8Array(await (await fetch(published.url)).arrayBuffer());
    const id = P.decodeHead(blob).headId;
    const there = (await device.heads()).heads.find((h) => h.slot === slot);
    if (there?.usable && there.headId === id) return true;
    const other = there?.usable;
    const named = other && there.name ? `, named “${esc(there.name)}”,` : "";
    const yes = await new Promise((resolve) => ui.card({
      title: other ? "Put the open source AI head back?" : "Install the open source AI head?",
      html: other
        ? `<p>Your IntoMind One has a different AI head${named} where ${published.name} belongs, so this demo cannot run. Put the published one back? It replaces the one there now, which can only come back from a saved file.</p>`
        : `<p>Your IntoMind One does not have ${published.name}, which this demo runs. Install the published one?</p>`,
      actions: [{ label: other ? "Put it back" : "Install it", primary: true, onClick: () => resolve(true) }, { label: "Cancel", onClick: () => resolve(false) }],
    }));
    if (!yes) {
      ui.say(`This demo needs ${published.name}. Connect again when you want to install it.`);
      return false;
    }
    await device.upload(slot, blob, ({ taken, total }) => ui.say(`Installing ${published.name}: ${taken} of ${total} bytes.`));
    return true;
  }

  function frame() {
    const { g, w, h } = fit(canvas);
    const dark = isDark();
    field(g, w, h, dark);
    if (running.mean !== null) {
      st.shown = st.shown === null ? running.mean : ease(st.shown, running.mean);
      draw(g, w, h, { shown: st.shown, windows: running.n, dark });
    } else if (st.on) {
      const t = performance.now() / 1000;
      const r = Math.min(w, h) * 0.02 * (1 + 0.15 * Math.sin(t * 2.2));
      g.globalCompositeOperation = dark ? "lighter" : "multiply";
      const heart = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
      heart.addColorStop(0, dark ? "rgba(243,241,234,.85)" : "rgba(17,17,17,.7)");
      heart.addColorStop(1, dark ? "rgba(243,241,234,0)" : "rgba(17,17,17,0)");
      g.fillStyle = heart; g.fillRect(w / 2 - r, h / 2 - r, r * 2, r * 2);
      g.globalCompositeOperation = "source-over";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function save() {
    if (running.mean === null) return;
    const W = 1600, H = 900;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const dark = isDark();
    field(g, W, H, dark);
    draw(g, W, H, { shown: running.mean, windows: running.n, dark });
    g.fillStyle = dark ? "#f3f1ea" : "#111";
    sans(g, 36, 650); g.textAlign = "start"; g.fillText("IntoMind", 72, 92);
    g.fillStyle = dark ? "rgba(243,241,234,.5)" : "#77776F";
    sans(g, 36, 500); g.fillText("Demo Suite", 72 + g.measureText("IntoMind ").width + 8, 92);
    mono(g, 18);
    g.fillText(`${card.toUpperCase()} · ${today()}`, 72, H - 76);
    g.textAlign = "end"; g.fillText(siteAddress().toUpperCase(), W - 72, H - 76); g.textAlign = "start";
    download(c, file);
  }

  ready();
}
