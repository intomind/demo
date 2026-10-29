// One IntoMind One, through the published SDK, as the few things a demo
// needs: connect, the last seconds of every channel, the head's answers,
// the encoder's embeddings, and a head going up.
//
// The SDK's browser transport subscribes to samples, status, answers and
// predictions. It does not subscribe to embeddings, so that one
// subscription is added here through the public API and its bytes are
// handed to the link, which decodes them like everything else.
//
// The person never tidies up after a page. The page in front of them gets
// the device: connecting in a second tab moves it there, and the first tab
// offers it back with one press. A stream nobody is using is taken over.
// When the device drops out, the page reconnects by itself. When another
// program on this computer is using it, the page lets go and says how to
// free it. Every message says what to do next.

import { requestDevice, connect, protocol as P, Transfer } from "../vendor/intomind-sdk-1.4.1/index.js";

/** What the device answers when it is busy, when its hardware failed, and when it is on USB power. */
const BUSY = 3, HARDWARE = 5, USB_POWER = 7;

/** The lock the page using the device holds, so that no two pages of this site use it at once. */
const HOLD = "intomind-one";

/** What a page says when something is in the way, each with what to do next. */
export const MOVED = "Your IntoMind One moved to another tab. To use it here, press Use it here.";
export const ANOTHER_PROGRAM = "Another program on this computer is using your IntoMind One. Close that program, or turn your IntoMind One off and on, then press Connect.";
export const RECONNECTING = "Your IntoMind One dropped out. Reconnecting. Keep it on and close to this computer.";
export const OUT_OF_REACH = "Your IntoMind One is out of reach. Turn it on, bring it close to this computer, then press Connect.";
export const NO_ANSWER = "Your IntoMind One didn't answer. Turn it off and on, bring it close to this computer, then press Connect.";
export const CHOOSE = "Choose your IntoMind One in the list to connect. If it isn't there, turn it on, bring it close, then press Connect again.";
export const BLUETOOTH_OFF = "Bluetooth is off on this computer. Turn it on in the system settings, then press Connect.";
export const NOT_CONNECTED = "Your IntoMind One isn't connected. Press Connect.";
export const USB = "Unplug the USB cable. Your IntoMind One does not read its electrodes on USB power.";
const UPDATE = "Update its firmware, as the manual at docs.intomind.com explains, then press Connect again.";

export const NO_BLUETOOTH = "This browser cannot reach your IntoMind One. Open this in Chrome or Edge on a computer, or Chrome on Android.";

export function hasBluetooth() { return typeof navigator !== "undefined" && "bluetooth" in navigator; }

const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Device {
  /**
   * `retryMs`, `giveUpS` and `connectS` pace reconnecting. `settleMs` is how
   * long after this page tells the device something its status is taken as
   * settled. All are shorter in the tests.
   */
  constructor({ keep = 10, retryMs = 1000, giveUpS = 60, connectS = 15, settleMs = 2000 } = {}) {
    this.keep = keep;
    this.settleMs = settleMs;
    this.retryMs = retryMs;
    this.giveUpS = giveUpS;
    this.connectS = connectS;
    this.link = null;
    this.model = null;
    this.battery = null;
    this.fs = 500;
    this.lanes = [];
    this.listeners = new Set();
    this.streaming = false;
    this.predicting = false;
    this.embeddingsChar = null;
    this.assembler = null;
    this.embeddingsOn = false;
    this.received = 0;
    /** The device the person chose, kept so this page can connect to it again without asking. */
    this.chosen = null;
    this.opening = null;
    this.closing = null;
    this.free = null;
    this.why = null;
    /** Another tab took the device. */
    this.moved = false;
    this.reconnecting = false;
    /** USB power ended the stream, which starts again when the cable comes out. */
    this.paused = false;
    this.settling = Promise.resolve();
    this.commanded = 0;
    this.odd = 0;
    this.onEmbedding = (ev) => {
      const v = ev.target.value;
      if (v === undefined) return;
      this.link?.deliver(P.FILL.EMBEDDINGS, new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
    };
    globalThis.addEventListener?.("pagehide", () => this.leave());
  }

  get available() { return hasBluetooth(); }
  get unavailableWhy() { return NO_BLUETOOTH; }
  get connected() { return this.link !== null && this.link.connected; }
  get channels() { return this.link?.info.channels ?? 0; }
  get encoderId() { return this.model?.encoderId ?? null; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  /** Whether another tab of this site has the device now. */
  async elsewhere() { return this.free === null && heldElsewhere(); }

  /**
   * Connect, from a press. The browser asks which device, since the person
   * may have switched to another. Only taking the device back from another
   * tab uses the one chosen before, so that is one press.
   */
  connect() {
    if (this.connected) return Promise.resolve();
    // A second press while the first is still connecting waits for the first.
    this.opening ??= this.open().finally(() => { this.opening = null; });
    return this.opening;
  }

  async open() {
    this.reconnecting = false;
    let chosen = this.moved ? this.chosen : null;
    if (chosen === null) {
      try {
        chosen = await requestDevice();
      } catch (e) {
        if (e?.name === "NotFoundError") throw new Error(/adapter/i.test(e.message) ? BLUETOOTH_OFF : CHOOSE);
        throw new Error(NO_ANSWER);
      }
    }
    this.moved = false;
    // This page takes the device from any other tab of this site, which is told and lets go.
    const free = this.free ?? await hold(() => this.taken());
    this.free = null;
    let link = null;
    try {
      link = await within(this.connectS, connect(chosen, { onDisconnect: () => this.dropped(link) }), () => chosen.gatt.disconnect());
    } catch {
      free();
      // The next press asks again, in case it is another device.
      this.chosen = null;
      throw new Error(this.moved ? MOVED : NO_ANSWER);
    }
    this.chosen = chosen;
    // Another tab took the device while this one was connecting: it is that tab's.
    if (this.moved) {
      link.disconnect().catch(() => {});
      throw new Error(MOVED);
    }
    this.free = free;
    await this.ready(link);
  }

  /** A new link: listen, put the device in a known state, and say so. */
  async ready(link) {
    this.link = link;
    this.lanes = Array.from({ length: link.info.channels }, () => []);
    this.received = 0;
    this.odd = 0;
    this.paused = false;
    link.on((e) => this.deliver(e));
    const s = link.session;
    // Whatever was running stops: another tab's stream, one a closed page
    // left behind, predictions or embeddings left on. This page starts
    // what it needs itself.
    this.commanded = now();
    await link.request(s.stopStream()).catch(() => {});
    if (s.can("model")) await link.request(s.setPredictions(false)).catch(() => {});
    if (s.can("embeddings")) await link.request(s.setEmbeddings("off")).catch(() => {});
    this.commanded = now();
    if (s.can("model")) {
      try {
        const a = await link.request(s.getModelInfo());
        if (a.ok) this.model = P.decodeModelInfo(a.payload);
      } catch { this.model = null; }
    }
    if (this.link === link) this.emit({ type: "connected" });
  }

  /**
   * Let go of the device, from a press: stop what this page started on it,
   * end the page's subscriptions, then drop the link, in that order.
   */
  async disconnect() {
    const link = this.link;
    if (link === null) {
      // Pressed while reconnecting: stop trying.
      if (!this.reconnecting) return;
      this.reconnecting = false;
      this.free?.();
      this.free = null;
      this.emit({ type: "disconnected", why: null });
      return;
    }
    if (this.closing === link) return;
    this.closing = link;
    this.why = null;
    await this.stopEmbeddings().catch(() => {});
    await this.stopPredictions().catch(() => {});
    await this.stop().catch(() => {});
    try { await link.disconnect(); } catch { /* the link is what failed */ }
    this.dropped(link);
  }

  /** The link is down, whoever dropped it. When nobody here meant it to, the page reconnects by itself. */
  dropped(link) {
    if (link === null || link !== this.link) return;
    const meant = this.closing === link;
    if (meant) {
      this.free?.();
      this.free = null;
      const why = this.why;
      this.why = null;
      this.clear(why);
      return;
    }
    this.reconnecting = true;
    this.clear(RECONNECTING);
    this.reconnect();
  }

  /** Forget the link and say so. */
  clear(why) {
    this.link = null;
    this.closing = null;
    this.embeddingsChar = null;
    this.assembler = null;
    this.streaming = false;
    this.predicting = false;
    this.embeddingsOn = false;
    this.paused = false;
    this.lanes = [];
    this.emit({ type: "disconnected", why });
  }

  /** Try the chosen device again for a while, holding it for this page. */
  async reconnect() {
    const until = now() + this.giveUpS * 1000;
    this.emit({ type: "reconnecting" });
    for (let wait = this.retryMs; this.reconnecting && now() < until; wait = Math.min(wait * 2, 8 * this.retryMs)) {
      await sleep(wait);
      if (!this.reconnecting) return;
      const chosen = this.chosen;
      let link = null;
      try {
        link = await within(this.connectS, connect(chosen, { onDisconnect: () => this.dropped(link) }), () => chosen.gatt.disconnect());
      } catch {
        continue;
      }
      if (!this.reconnecting) { link.disconnect().catch(() => {}); return; }
      this.reconnecting = false;
      await this.ready(link);
      this.emit({ type: "reconnected" });
      return;
    }
    if (!this.reconnecting) return;
    this.reconnecting = false;
    this.free?.();
    this.free = null;
    this.emit({ type: "disconnected", why: OUT_OF_REACH });
  }

  /** Another tab took the device. Nothing is said to the device, which is that tab's now. */
  taken() {
    this.free = null;
    this.moved = true;
    this.reconnecting = false;
    const link = this.link;
    this.clear(MOVED);
    link?.disconnect().catch(() => {});
  }

  /** Another program is using the device: let go without a word to it, and say how to free it. */
  letGo(why) {
    const link = this.link;
    if (link === null) return;
    this.free?.();
    this.free = null;
    this.clear(why);
    link.disconnect().catch(() => {});
  }

  /**
   * Stop what a page inside the suite had running, as it goes, so the next
   * page finds the device connected and quiet.
   */
  settle() {
    this.settling = this.settling.then(async () => {
      await this.stopEmbeddings().catch(() => {});
      await this.stopPredictions().catch(() => {});
      await this.stop().catch(() => {});
    });
    return this.settling;
  }

  /**
   * The device as one page inside the suite sees it. What the page listens
   * to ends when the page goes, and what it started stops.
   */
  adopt(win) {
    const mine = new Set();
    win.addEventListener("pagehide", () => {
      for (const off of mine) off();
      mine.clear();
      this.settle();
    });
    const on = (fn) => {
      const off = this.on(fn);
      mine.add(off);
      return () => { off(); mine.delete(off); };
    };
    return new Proxy(this, {
      get(target, key) {
        if (key === "on") return on;
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }

  /**
   * The page is going, so one write stops the stream. The write leaves the
   * page as it is made, and on some platforms a second write to the same
   * characteristic is refused until the first is answered, which a page
   * that is going never hears. Predictions and embeddings flow only while
   * the device streams. The browser ends the page's subscriptions and its
   * part of the link as the page goes, but on Linux and ChromeOS it keeps a
   * paired device's link open, so the device cannot tell the page has gone.
   */
  leave() {
    const link = this.link;
    if (link === null || !this.streaming) return;
    this.streaming = false;
    link.send(link.session.stopStream()).catch(() => {});
  }

  deliver(e) {
    if (e.type === "samples") {
      const b = e.batch;
      if (b.sampleRateHz) this.fs = b.sampleRateHz;
      const info = this.link.info;
      if (this.lanes.length !== b.channels) this.lanes = Array.from({ length: b.channels }, () => []);
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.channels; c++) this.lanes[c].push(b.microvolts(r, c, info));
      this.received += b.rows;
      const keep = Math.round(this.fs * this.keep);
      for (const lane of this.lanes) if (lane.length > keep * 1.5) lane.splice(0, lane.length - keep);
      this.emit({ type: "samples", rows: b.rows, leadoff: b.leadoff });
    } else if (e.type === "gap") {
      // A break in the timeline cannot be read across. Start the window again.
      this.lanes = this.lanes.map(() => []);
      this.emit({ type: "gap" });
    } else if (e.type === "status") {
      this.battery = e.status.batteryPercent ?? null;
      this.emit({ type: "status", usb: e.status.usbPresent });
      this.heard(e.status);
    } else if (e.type === "prediction") {
      const p = e.prediction;
      this.emit({ type: "prediction", slot: p.headSlot, index: p.index, value: p.outputs[0], outputs: p.outputs, flagged: p.gapInWindow || p.leadoffInWindow, dutyReduced: p.dutyReduced });
    } else if (e.type === "embedding" && this.assembler !== null) {
      const w = this.assembler.feed(e.embedding);
      if (w !== null && w.embedding !== null) this.emit({ type: "embedding", index: w.index, embedding: w.embedding, flagged: w.gapInWindow || w.leadoffInWindow, leadoff: w.leadoffInWindow });
    } else if (e.type === "duplicate") {
      // On Linux the system's Bluetooth service sends each packet once for
      // every program subscribed, and every subscriber hears all the copies,
      // so a copy means another program is subscribed to this device. The
      // session dropped the copy.
      this.letGo(ANOTHER_PROGRAM);
    }
  }

  /** What the device's status says, against what this page told it. */
  heard(status) {
    // USB power ends a stream at once, and the device does not start it
    // again when the cable comes out. This page does, once it is out.
    if (status.usbPresent) {
      if (this.streaming && !status.streaming) {
        this.streaming = false;
        this.paused = true;
        this.emit({ type: "warning", why: USB });
      }
      this.odd = 0;
      return;
    }
    if (this.paused) {
      this.paused = false;
      this.start().then(() => this.emit({ type: "resumed" }), (e) => this.emit({ type: "warning", why: e.message }));
      return;
    }
    // The device streams only when told to. Two status messages in a row
    // that disagree with what this page told it, well after it told it,
    // mean another program is telling it too.
    if (now() - this.commanded < this.settleMs || status.streaming === this.streaming) { this.odd = 0; return; }
    if (++this.odd >= 2) this.letGo(ANOTHER_PROGRAM);
  }

  /** The last `seconds` of every channel, in microvolts. Null until there is that much. */
  recent(seconds) {
    const n = Math.round(seconds * this.fs);
    if (this.lanes.length === 0 || this.lanes.some((l) => l.length < n)) return null;
    return this.lanes.map((l) => Float64Array.from(l.slice(l.length - n)));
  }

  seconds() { return this.lanes.length ? this.lanes[0].length / this.fs : 0; }

  async request(command, what) {
    if (this.link === null) throw new Error(this.moved ? MOVED : this.reconnecting ? RECONNECTING : NOT_CONNECTED);
    this.commanded = now();
    const a = await this.link.request(command);
    this.commanded = now();
    if (!a.ok) throw new Error(refusal(a, what));
    return a;
  }

  async start() {
    await this.settling;
    if (this.streaming) return;
    await this.request(this.link?.session.startStream(), "to start");
    this.streaming = true;
  }

  async stop() {
    if (!this.streaming) return;
    this.streaming = false;
    await this.request(this.link?.session.stopStream(), "to stop");
  }

  /** What the device's head slots hold. */
  async heads() {
    const a = await this.request(this.link?.session.listHeads(), "to list its heads");
    return P.decodeHeads(a.payload);
  }

  /** Run the head in `slot` on the device and send what it says of every window. */
  async predictions(slot) {
    await this.settling;
    if (this.link === null) throw new Error(this.moved ? MOVED : NOT_CONNECTED);
    const s = this.link.session;
    if (!s.can("model") || !s.can("heads")) throw new Error(`This IntoMind One has no AI model to run heads on. ${UPDATE}`);
    if (this.model && !this.model.ready) throw new Error(notReady(this.model.modelStateName));
    const list = await this.heads();
    const entry = list.heads.find((h) => h.slot === slot);
    if (!entry || !entry.usable) throw Object.assign(new Error(`Slot ${slot} on this IntoMind One holds no usable AI head.`), { noHead: true });
    await this.request(s.selectHead(slot), `to select slot ${slot}`);
    await this.start();
    await this.request(s.setPredictions(true), "to run the head");
    this.predicting = true;
    return entry;
  }

  async stopPredictions() {
    if (!this.predicting) return;
    this.predicting = false;
    await this.request(this.link?.session.setPredictions(false), "to stop the head");
  }

  /** Ask for every window's embedding. Events of type "embedding" follow, whole windows only. */
  async embeddings() {
    await this.settling;
    if (this.link === null) throw new Error(this.moved ? MOVED : NOT_CONNECTED);
    const s = this.link.session;
    if (!s.can("embeddings")) throw new Error(`This IntoMind One can't send embeddings. ${UPDATE}`);
    if (s.can("model")) {
      const a = await this.link.request(s.getModelInfo());
      if (a.ok) this.model = P.decodeModelInfo(a.payload);
    }
    if (!this.model || !this.model.ready) throw new Error(notReady(this.model ? this.model.modelStateName : "not readable"));
    if (this.model.intervalS > 0 && s.can("model_cadence")) await this.request(s.setModelInterval(0), "to describe every window");
    if (this.embeddingsChar === null) {
      const service = await this.link.device.gatt.getPrimaryService(P.SERVICE);
      const c = await service.getCharacteristic(P.uuid(P.FILL.EMBEDDINGS));
      // One listener however often this is asked: the browser hands back the same characteristic on the same link.
      c.addEventListener("characteristicvaluechanged", this.onEmbedding);
      await c.startNotifications();
      this.embeddingsChar = c;
    }
    this.assembler = new P.EmbeddingAssembler(this.link.info.channels, this.model.tokensPerChannel > 0 ? this.model.tokensPerChannel : 1, "window");
    await this.start();
    await this.request(s.setEmbeddings("window"), "to send embeddings");
    this.embeddingsOn = true;
  }

  async stopEmbeddings() {
    if (this.link !== null && this.embeddingsOn) {
      this.embeddingsOn = false;
      await this.request(this.link.session.setEmbeddings("off"), "to stop embeddings").catch(() => {});
    }
    const c = this.embeddingsChar;
    this.embeddingsChar = null;
    this.assembler = null;
    if (c !== null) {
      c.removeEventListener("characteristicvaluechanged", this.onEmbedding);
      try { await c.stopNotifications(); } catch { /* already gone */ }
    }
  }

  /** Take the head out of `slot` on the device. The device refuses while streaming, so the head stops and the stream pauses if it must. */
  async removeHead(slot) {
    const s = this.link.session;
    await this.stopPredictions();
    const was = this.streaming;
    if (was) await this.stop();
    await this.request(s.removeHead(slot), `to remove the head in slot ${slot}`);
    if (was) await this.start();
  }

  /** Put a head on the device in `slot`, verified there. The device will not take one while streaming, so the stream pauses if it must. */
  async upload(slot, blob, onProgress) {
    const s = this.link.session;
    // A copy made here, so the bytes belong to this page even when the head came from a page inside the suite.
    const bytes = new Uint8Array(blob);
    const go = () => { this.commanded = now(); return this.link.transfer(Transfer.head(s, slot, bytes), bytes, onProgress); };
    try {
      await go();
    } catch (e) {
      if (!/busy/i.test(String(e.message))) throw e;
      const was = this.streaming;
      await this.stop();
      await go();
      if (was) await this.start();
    }
  }
}

/** A refusal in words, with what to do about it. */
function refusal(a, what) {
  if (a.status === USB_POWER) return USB;
  if (a.status === BUSY) return "Your IntoMind One is busy. Wait a few seconds, then try again.";
  if (a.status === HARDWARE) return "Your IntoMind One reported a hardware problem. Turn it off and on, then try again.";
  return `Your IntoMind One refused ${what}: ${a.statusName}. Turn it off and on, then try again.`;
}

function notReady(state) {
  return `Your IntoMind One's AI model is ${state}. Wait a moment and try again. If it stays ${state}, turn your IntoMind One off and on.`;
}

/** Whether another page of this site holds the device now. */
async function heldElsewhere() {
  const locks = globalThis.navigator?.locks;
  if (!locks) return false;
  const { held } = await locks.query();
  return held.some((l) => l.name === HOLD);
}

/**
 * Hold the device for this page, taking it from any other page of this
 * site, until the function this gives is called or the page goes.
 * `lost` runs if another page takes it in turn.
 */
function hold(lost) {
  const locks = globalThis.navigator?.locks;
  if (!locks) return Promise.resolve(() => {});
  return new Promise((resolve) => {
    locks.request(HOLD, { steal: true }, () => new Promise((free) => resolve(free)))
      .catch((e) => { if (e?.name === "AbortError") lost(); else resolve(() => {}); });
  });
}

/** The promise, or a refusal after `seconds`, with `cancel` run to stop what it waits for. */
function within(seconds, promise, cancel) {
  let timer = null;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => { try { cancel(); } catch { /* nothing to stop */ } reject(new Error("timed out")); }, seconds * 1000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
