// A simulated IntoMind One, for working on a demo with no device in the room.
// Only loaded when the address carries ?dev. It makes a signal that looks
// the part, with an alpha rhythm when "closed" is held, frontal theta when
// "focus" is held, muscle when "jaw" is held, and a flicker response at a
// patch's rate when "look" is held, and it makes the numbers a head would
// send. Keys while it runs: c closed, f focus, j jaw, arrows look.

import { protocol as P } from "../vendor/intomind-sdk-1.4.0/index.js";

function gaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const RATES = { up: 8, right: 10, down: 12, left: 15 };

export class Sim {
  constructor(q = new URLSearchParams()) {
    this.q = q;
    this.fs = 250;
    this.channels = 4;
    this.keep = 10;
    this.lanes = Array.from({ length: 4 }, () => []);
    this.listeners = new Set();
    this.connected = false;
    this.battery = 84;
    this.streaming = false;
    this.predicting = false;
    this.slot = null;
    this.embeddingsOn = false;
    this.model = { ready: true, modelStateName: "ready", encoderId: "e2f9b60f411f0e73", tokensPerChannel: 1, intervalS: 0 };
    this.uploaded = new Map();
    const theirs = () => P.buildHead([Array.from({ length: 76 }, (_, i) => (i % 7) - 3)], [0], [0.001], { name: "someone else", encoderId: this.model.encoderId });
    if (q.has("swapped")) this.uploaded.set(1, theirs());
    if (q.has("taken")) this.uploaded.set(2, theirs());
    this.received = 0;
    this.t = 0;
    this.closed = q.has("closed");
    this.focus = q.has("focus");
    this.jaw = q.has("jaw");
    this.look = q.get("look");
    this.lookAfter = Number(q.get("after") ?? 0);
    this.levels = { alpha: this.closed ? 1 : 0, theta: this.focus ? 1 : 0, jaw: this.jaw ? 1 : 0 };
    this.pink = Array.from({ length: 4 }, () => [0, 0, 0]);
    this.phase = [0, 1.3, 2.6, 3.9];
    this.alphaHz = 9.4 + (q.has("closed") ? 0.9 : Math.random() * 2);
    this.nextBlink = 3;
    this.blinkT = -1;
    this.timer = null;
    this.windowTimer = null;
    this.windowIndex = 0;
    const r = seeded(7);
    this.base = Array.from({ length: 76 }, () => Math.round((r() - 0.5) * 3000));
    this.patterns = { theta: Array.from({ length: 76 }, () => Math.round((r() - 0.5) * 1400)), alpha: Array.from({ length: 76 }, () => Math.round((r() - 0.5) * 1800)), jaw: Array.from({ length: 76 }, () => Math.round((r() - 0.5) * 2600)) };
    window.addEventListener("keydown", (e) => {
      if (e.key === "c") this.closed = !this.closed;
      if (e.key === "f") this.focus = !this.focus;
      if (e.key === "j") this.jaw = !this.jaw;
      const look = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.key];
      if (look) this.look = look;
    });
    window.addEventListener("keyup", (e) => { if (e.key.startsWith("Arrow")) this.look = null; });
    if (!q.has("idle")) setTimeout(() => this.connect().then(() => this.emit({ type: "auto" })), 50);
  }

  get available() { return true; }
  get unavailableWhy() { return ""; }
  get encoderId() { return this.model.encoderId; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  async connect() {
    this.connected = true;
    this.emit({ type: "connected" });
    this.emit({ type: "status", usb: false });
  }

  async disconnect() {
    await this.stop();
    this.connected = false;
    this.emit({ type: "disconnected" });
  }

  async start() {
    if (this.streaming) return;
    this.streaming = true;
    this.timer = setInterval(() => this.step(0.04), 40);
  }

  async stop() {
    this.streaming = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  step(dt) {
    const n = Math.round(dt * this.fs);
    const per = 1 / this.fs;
    for (let i = 0; i < n; i++) {
      this.t += per;
      const L = this.levels;
      L.alpha += ((this.closed ? 1 : 0) - L.alpha) * Math.min(1, per / 0.8);
      L.theta += ((this.focus ? 1 : 0) - L.theta) * Math.min(1, per / 1.2);
      L.jaw += ((this.jaw ? 1 : 0) - L.jaw) * Math.min(1, per / 0.3);
      if (!this.closed && this.t >= this.nextBlink) { this.blinkT = 0; this.nextBlink = this.t + 3 + Math.random() * 5; }
      let blink = 0;
      if (this.blinkT >= 0) { blink = 70 * Math.exp(-((this.blinkT - 0.12) ** 2) / 0.004); this.blinkT += per; if (this.blinkT > 0.4) this.blinkT = -1; }
      for (let c = 0; c < this.channels; c++) {
        const w = gaussian();
        const p = this.pink[c];
        p[0] = 0.99886 * p[0] + w * 0.0555179; p[1] = 0.99332 * p[1] + w * 0.0750759; p[2] = 0.969 * p[2] + w * 0.153852;
        // The background of a real recording, broad and much bigger than a trace of alpha, so the Alpha Flower's
        // number reads about a fifth with the eyes open and about two thirds with them closed, either side of its lines.
        const pinkv = (p[0] + p[1] + p[2] + w * 0.5362) * 10 + gaussian() * 5;
        const env = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.23 * this.t + this.phase[c]);
        const alpha = L.alpha * env * (c < 2 ? 14 : 24) * Math.sin(2 * Math.PI * (this.alphaHz + c * 0.05) * this.t + this.phase[c]);
        const alphaOpen = (1 - L.alpha) * 1 * Math.sin(2 * Math.PI * this.alphaHz * this.t + this.phase[c]);
        const theta = L.theta * (c < 2 ? 9 : 4) * Math.sin(2 * Math.PI * 6.2 * this.t + this.phase[c] * 2);
        const jaw = L.jaw * 40 * gaussian();
        const hz = this.look && this.t >= this.lookAfter ? RATES[this.look] : 0;
        const ssvep = hz ? 3.5 * Math.sin(2 * Math.PI * hz * this.t + c) + 1.2 * Math.sin(2 * Math.PI * 2 * hz * this.t) : 0;
        const mains = 1.2 * Math.sin(2 * Math.PI * 60 * this.t);
        this.lanes[c].push(pinkv + alpha + alphaOpen + theta + jaw + ssvep + mains + (c < 2 ? blink : blink * 0.15));
      }
    }
    this.received += n;
    const keep = this.fs * this.keep;
    for (const lane of this.lanes) if (lane.length > keep * 1.5) lane.splice(0, lane.length - keep);
    this.emit({ type: "samples", rows: n, leadoff: 0 });
  }

  recent(seconds) {
    const n = Math.round(seconds * this.fs);
    if (this.lanes.some((l) => l.length < n)) return null;
    return this.lanes.map((l) => Float64Array.from(l.slice(l.length - n)));
  }

  seconds() { return this.lanes[0].length / this.fs; }

  /** The built-in slot and the four that are yours, as the device lists them. `taken` puts someone else's custom AI head in slot 2, `swapped` puts it in slot 1, and `emptied` leaves slot 1 empty. */
  async heads() {
    const user = (slot) => {
      const blob = this.uploaded.get(slot);
      if (!blob) return { slot, state: 0, usable: false, name: "", headId: P.NO_ENCODER_ID, outDim: 0 };
      const h = P.decodeHead(blob);
      return { slot, state: 1, usable: true, name: h.name, headId: h.headId, outDim: h.outDim };
    };
    if (!this.uploaded.has(1) && !this.q.has("emptied")) {
      this.uploaded.set(1, new Uint8Array(await (await fetch(new URL("../vendor/heads/e2f9b60f411f0e73/sex.imh", import.meta.url))).arrayBuffer()));
    }
    return { activeSlot: this.slot, heads: [
      { slot: 0, state: 1, usable: true, name: "age", headId: "a9e0000000000000", outDim: 1 },
      user(1), user(2), user(3), user(4),
    ] };
  }

  embedding() {
    const L = this.levels;
    return this.base.map((b, i) => Math.round(b + L.theta * this.patterns.theta[i] + L.alpha * this.patterns.alpha[i] + L.jaw * this.patterns.jaw[i] + gaussian() * 260));
  }

  windows() {
    if (this.windowTimer !== null) return;
    this.windowTimer = setInterval(() => {
      this.windowIndex += 1;
      const emb = this.embedding();
      if (this.embeddingsOn) this.emit({ type: "embedding", index: this.windowIndex, embedding: emb, flagged: false });
      if (this.predicting) {
        let value;
        if (this.slot === 0) value = 38 + gaussian() * 5.5;
        else if (this.slot === 1) value = 0.55 + gaussian() * 0.28;
        else if (this.uploaded.has(this.slot)) value = P.evaluateHead(P.decodeHead(this.uploaded.get(this.slot)), emb)[0];
        else value = 0;
        this.emit({ type: "prediction", slot: this.slot, index: this.windowIndex, value, outputs: [value], flagged: false, dutyReduced: false });
      }
    }, this.q.has("fast") ? 700 : 4000);
  }

  async predictions(slot) {
    this.slot = slot;
    await this.start();
    this.predicting = true;
    this.windows();
    return { slot, usable: true, name: slot === 0 ? "age" : slot === 1 ? "sex" : "yours" };
  }

  async stopPredictions() { this.predicting = false; }

  async embeddings() { await this.start(); this.embeddingsOn = true; this.windows(); }
  async stopEmbeddings() { this.embeddingsOn = false; }

  async removeHead(slot) {
    if (slot < 1) throw new Error("Slot 0 is the device's own and cannot be removed.");
    this.uploaded.delete(slot);
    if (this.slot === slot) { this.slot = null; this.predicting = false; }
  }

  async upload(slot, blob, onProgress) {
    for (let taken = 0; taken <= blob.length; taken += 64) { onProgress?.({ taken: Math.min(taken, blob.length), total: blob.length }); await new Promise((r) => setTimeout(r, 20)); }
    P.decodeHead(blob);
    this.uploaded.set(slot, blob);
  }
}
