// One IntoMind One, through the published SDK, as the few things a demo
// needs: connect, the last seconds of every channel, the head's answers,
// the encoder's embeddings, and a head going up.
//
// The SDK's browser transport subscribes to samples, status, answers and
// predictions. It does not subscribe to embeddings, so that one
// subscription is added here through the public API and its bytes are
// handed to the link, which decodes them like everything else.

import { requestAndConnect, protocol as P, Transfer } from "../vendor/intomind-sdk-1.4.0/index.js";

/** The status the device answers when asked to stream its electrodes on USB power. */
const USB_POWER = 7;

export const NO_BLUETOOTH = "This browser cannot reach your IntoMind One. Open this in Chrome or Edge on a computer, or Chrome on Android.";

export function hasBluetooth() { return typeof navigator !== "undefined" && "bluetooth" in navigator; }

export class Device {
  constructor({ keep = 10 } = {}) {
    this.keep = keep;
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
  }

  get available() { return hasBluetooth(); }
  get unavailableWhy() { return NO_BLUETOOTH; }
  get connected() { return this.link !== null && this.link.connected; }
  get channels() { return this.link?.info.channels ?? 0; }
  get encoderId() { return this.model?.encoderId ?? null; }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }

  async connect() {
    if (this.connected) return;
    this.link = await requestAndConnect({
      onDisconnect: () => {
        this.link = null;
        this.embeddingsChar = null;
        this.streaming = false;
        this.predicting = false;
        this.embeddingsOn = false;
        this.lanes = [];
        this.emit({ type: "disconnected" });
      },
    });
    this.lanes = Array.from({ length: this.link.info.channels }, () => []);
    this.received = 0;
    this.link.on((e) => this.deliver(e));
    if (this.link.session.can("model")) {
      try {
        const a = await this.link.request(this.link.session.getModelInfo());
        if (a.ok) this.model = P.decodeModelInfo(a.payload);
      } catch { this.model = null; }
    }
    this.emit({ type: "connected" });
  }

  async disconnect() {
    const link = this.link;
    if (link === null) return;
    await this.stopEmbeddings().catch(() => {});
    try { await link.disconnect(); } catch { /* the link is what failed */ }
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
    } else if (e.type === "prediction") {
      const p = e.prediction;
      this.emit({ type: "prediction", slot: p.headSlot, index: p.index, value: p.outputs[0], outputs: p.outputs, flagged: p.gapInWindow || p.leadoffInWindow, dutyReduced: p.dutyReduced });
    } else if (e.type === "embedding" && this.assembler !== null) {
      const w = this.assembler.feed(e.embedding);
      if (w !== null && w.embedding !== null) this.emit({ type: "embedding", index: w.index, embedding: w.embedding, flagged: w.gapInWindow || w.leadoffInWindow });
    }
  }

  /** The last `seconds` of every channel, in microvolts. Null until there is that much. */
  recent(seconds) {
    const n = Math.round(seconds * this.fs);
    if (this.lanes.length === 0 || this.lanes.some((l) => l.length < n)) return null;
    return this.lanes.map((l) => Float64Array.from(l.slice(l.length - n)));
  }

  seconds() { return this.lanes.length ? this.lanes[0].length / this.fs : 0; }

  async request(command, what) {
    if (this.link === null) throw new Error("Not connected.");
    const a = await this.link.request(command);
    if (!a.ok) {
      let why = `Your IntoMind One refused ${what}: ${a.statusName}.`;
      if (a.status === USB_POWER) why = "Unplug the USB cable. Your IntoMind One does not read its electrodes on USB power.";
      throw new Error(why);
    }
    return a;
  }

  async start() {
    if (this.streaming) return;
    await this.request(this.link.session.startStream(), "to start");
    this.streaming = true;
  }

  async stop() {
    if (!this.streaming) return;
    this.streaming = false;
    await this.request(this.link.session.stopStream(), "to stop");
  }

  /** What the device's head slots hold. */
  async heads() {
    const a = await this.request(this.link.session.listHeads(), "to list its heads");
    return P.decodeHeads(a.payload);
  }

  /** Run the head in `slot` on the device and send what it says of every window. */
  async predictions(slot) {
    const s = this.link.session;
    if (!s.can("model") || !s.can("heads")) throw new Error("This IntoMind One reports no model with head slots.");
    if (this.model && !this.model.ready) throw new Error(`Your IntoMind One's model is ${this.model.modelStateName}.`);
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
    await this.request(this.link.session.setPredictions(false), "to stop the head");
  }

  /** Ask for every window's embedding. Events of type "embedding" follow, whole windows only. */
  async embeddings() {
    const s = this.link.session;
    if (!s.can("embeddings")) throw new Error("This IntoMind One does not send embeddings.");
    if (s.can("model")) {
      const a = await this.link.request(s.getModelInfo());
      if (a.ok) this.model = P.decodeModelInfo(a.payload);
    }
    if (!this.model || !this.model.ready) throw new Error(`Your IntoMind One's model is ${this.model ? this.model.modelStateName : "not readable"}.`);
    if (this.model.intervalS > 0 && s.can("model_cadence")) await this.request(s.setModelInterval(0), "to describe every window");
    if (this.embeddingsChar === null) {
      const service = await this.link.device.gatt.getPrimaryService(P.SERVICE);
      const c = await service.getCharacteristic(P.uuid(P.FILL.EMBEDDINGS));
      c.addEventListener("characteristicvaluechanged", (ev) => {
        const v = ev.target.value;
        if (v === undefined) return;
        this.link?.deliver(P.FILL.EMBEDDINGS, new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
      });
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
    if (c !== null) { try { await c.stopNotifications(); } catch { /* already gone */ } }
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
    const go = () => this.link.transfer(Transfer.head(s, slot, blob), blob, onProgress);
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
