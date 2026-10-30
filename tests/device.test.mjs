// The IntoMind One a demo holds, against a stand-in made of nothing: the
// page in front of the person gets it, nothing is left for them to tidy,
// and every problem comes with what to do about it.

import test from "node:test";
import assert from "node:assert/strict";
import { protocol as P } from "../vendor/intomind-sdk-1.4.2/index.js";
import { Device, MOVED, ANOTHER_PROGRAM, RECONNECTING, OUT_OF_REACH, NO_ANSWER, CHOOSE, BLUETOOTH_OFF, USB } from "../lib/device.js";

const NAMES = Object.fromEntries(Object.entries(P.OPCODES).map(([name, op]) => [op, name]));

// Made-up values: four channels, as the public pages say, and nothing else from a real device.
const INFO = P.encodeDeviceInfo({
  protocol: [1, 4], firmware: [0, 0, 1], channels: 4, adcBits: 24, tickHz: 1000, vrefUv: 1_000_000,
  capabilities: P.CAPABILITIES.model | P.CAPABILITIES.heads | P.CAPABILITIES.embeddings,
  supportedRates: 0, deviceId: "0000000000000001",
});
const MODEL = P.encodeModelInfo({ modelState: 2, encoderId: "0000000000000002", weightsVersion: [0, 0, 1], tokensPerChannel: 1 });

/** Quick to give up, for tests that reconnect. */
const QUICK = { retryMs: 5, giveUpS: 0.3, connectS: 0.1, settleMs: 0 };

class Characteristic extends EventTarget {
  constructor(uuid, log, value) {
    super();
    this.uuid = uuid;
    this.log = log;
    this.notifying = false;
    this.heard = new Set();
    this.onWrite = null;
    if (value !== undefined) this.value = new DataView(value.buffer.slice(0));
  }
  addEventListener(type, fn, options) { if (type === "characteristicvaluechanged") this.heard.add(fn); super.addEventListener(type, fn, options); }
  removeEventListener(type, fn, options) { if (type === "characteristicvaluechanged") this.heard.delete(fn); super.removeEventListener(type, fn, options); }
  readValue() { return Promise.resolve(this.value); }
  writeValueWithResponse(v) { return this.write(v); }
  writeValueWithoutResponse(v) { return this.write(v); }
  startNotifications() { this.notifying = true; this.log.push(`subscribe ${this.uuid}`); return Promise.resolve(this); }
  stopNotifications() { this.notifying = false; this.log.push(`unsubscribe ${this.uuid}`); return Promise.resolve(this); }
  notify(bytes) { this.value = new DataView(bytes.buffer.slice(0)); this.dispatchEvent(new Event("characteristicvaluechanged")); }
  write(v) {
    this.onWrite?.(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
    return Promise.resolve();
  }
}

/**
 * One page's view of a device that answers as the contract says: it streams
 * when told, and its status says whether it is. As in a browser, every
 * connection hands out new characteristics. Two tabs pass the same `state`
 * and `log`, being two views of one device.
 */
function stand_in({ state = { streaming: false, usb: false, off: false }, log = [] } = {}) {
  const device = new EventTarget();
  let chars = new Map();
  const fresh = () => {
    chars = new Map();
    const add = (uuid, value) => { const c = new Characteristic(uuid, log, value); chars.set(uuid, c); return c; };
    add(P.DEVICE_INFO, INFO);
    const control = add(P.CONTROL);
    const answers = add(P.CONTROL_RESPONSE);
    for (const uuid of [P.EEG_DATA, P.STATUS, P.PREDICTIONS, P.EMBEDDINGS]) add(uuid);
    control.onWrite = (bytes) => {
      const op = bytes[0];
      log.push(`write ${NAMES[op]}${bytes.length > 1 ? ` ${bytes[1]}` : ""}`);
      let code = 0;
      let payload;
      if (op === P.OPCODES.start_stream) state.streaming = true;
      if (op === P.OPCODES.stop_stream) { code = state.streaming ? 0 : 4; state.streaming = false; }
      if (op === P.OPCODES.get_model_info) payload = MODEL;
      queueMicrotask(() => answers.notify(P.encodeResponse(op, code, payload)));
    };
  };
  const server = {
    connected: false,
    connect() {
      if (state.off) return Promise.reject(new Error("no answer"));
      server.connected = true;
      fresh();
      return Promise.resolve(server);
    },
    disconnect() {
      if (!server.connected) return;
      server.connected = false;
      log.push("drop");
      device.dispatchEvent(new Event("gattserverdisconnected"));
    },
    getPrimaryService() {
      return Promise.resolve({ getCharacteristic: (uuid) => (chars.has(uuid) ? Promise.resolve(chars.get(uuid)) : Promise.reject(new Error(`no ${uuid}`))) });
    },
  };
  Object.assign(device, { id: "stand-in", name: "IntoMind One", gatt: server });
  const bluetooth = { asked: 0, requestDevice() { bluetooth.asked += 1; return Promise.resolve(device); } };
  return {
    bluetooth, server, state, log,
    get chars() { return chars; },
    writes() { return log.filter((l) => l.startsWith("write")); },
    /** The radio loses the device, as when it is turned off or carried away. */
    vanish() { state.off = true; server.connected = false; device.dispatchEvent(new Event("gattserverdisconnected")); },
    /** The device sends its status, as it does about once a second. */
    status(over = {}) {
      chars.get(P.STATUS).notify(P.encodeStatus({
        state: state.streaming ? 1 : 0, mode: 0, gainCode: 0, rateCode: 6, chargerState: 0, batteryPercent: 50,
        loffStatp: 0, usbPresent: state.usb, bufferHighWatermark: false, droppedTotal: 0, bufferFill: 0, ...over,
      }));
    },
    packet(index) {
      chars.get(P.EEG_DATA).notify(P.encodePacket({ index, deviceTime: BigInt(1000 + index), counts: [[1, 2, 3, 4]], gainCode: 0, rateCode: 6 }));
    },
  };
}

/** Web Locks as one site's tabs share them, with a later page able to take a lock from an earlier one. */
class Locks {
  holders = new Map();
  async query() { return { held: [...this.holders.keys()].map((name) => ({ name, mode: "exclusive" })), pending: [] }; }
  request(name, options, callback) {
    assert.ok(options.steal, "a page takes the device rather than waiting for it");
    return new Promise((resolve, reject) => {
      this.holders.get(name)?.take();
      const me = { take: () => { this.holders.delete(name); reject(Object.assign(new Error("taken"), { name: "AbortError" })); } };
      this.holders.set(name, me);
      Promise.resolve().then(() => callback({ name, mode: "exclusive" })).then((v) => {
        if (this.holders.get(name) === me) this.holders.delete(name);
        resolve(v);
      });
    });
  }
}

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function page(bluetooth, locks = new Locks()) {
  navigator.bluetooth = bluetooth;
  navigator.locks = locks;
  return locks;
}

function said(device) {
  const out = [];
  device.on((e) => { if (e.type === "disconnected" || e.type === "warning") out.push(e.why); });
  return out;
}

test("connecting in a second tab moves the device there, and the first tab takes it back with one press", async () => {
  const a = stand_in();
  const b = stand_in({ state: a.state, log: a.log });
  const locks = page(a.bluetooth);
  const first = new Device();
  const firstSaid = said(first);
  await first.connect();
  await first.start();

  page(b.bluetooth, locks);
  const second = new Device();
  await second.connect();
  await settle();
  assert.ok(second.connected && !first.connected);
  assert.ok(first.moved, "the first tab offers Use it here");
  assert.deepEqual(firstSaid, [MOVED]);
  assert.ok(!a.state.streaming, "the second tab starts from a quiet device");

  await first.connect();
  await settle();
  assert.ok(first.connected && !second.connected);
  assert.equal(a.bluetooth.asked + b.bluetooth.asked, 2, "taking it back does not open the chooser");
  assert.ok(second.moved);
});

test("two tabs connecting at the same moment: one ends up with the device, never both", async () => {
  const a = stand_in();
  const b = stand_in({ state: a.state, log: a.log });
  const locks = new Locks();
  navigator.locks = locks;
  let turn = 0;
  navigator.bluetooth = { requestDevice: () => (turn++ === 0 ? a : b).bluetooth.requestDevice() };
  const tabs = [new Device(), new Device()];
  const results = await Promise.allSettled(tabs.map((t) => t.connect()));
  await settle();
  assert.equal(tabs.filter((t) => t.connected).length, 1);
  const lost = results.find((r) => r.status === "rejected");
  if (lost) assert.equal(lost.reason.message, MOVED);
  assert.equal(locks.holders.size, 1);
});

test("a stream left running is taken over, and the device starts from a known state", async () => {
  const d = stand_in({ state: { streaming: true, usb: false, off: false } });
  page(d.bluetooth);
  const device = new Device();
  await device.connect();
  assert.ok(device.connected);
  assert.ok(!d.state.streaming);
  assert.deepEqual(d.writes(), ["write stop_stream", "write set_predictions 0", "write set_embeddings 0", "write get_model_info"]);
});

test("two presses connect once", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const device = new Device();
  await Promise.all([device.connect(), device.connect()]);
  assert.equal(d.bluetooth.asked, 1);
  assert.ok(device.connected);
});

test("a packet heard twice means another program is subscribed: the page lets go without a word to the device", async () => {
  const d = stand_in();
  const locks = page(d.bluetooth);
  const device = new Device();
  const words = said(device);
  await device.connect();
  await device.start();
  const before = d.writes().length;
  d.packet(0);
  d.packet(0);
  await settle();
  assert.ok(!device.connected);
  assert.deepEqual(words, [ANOTHER_PROGRAM]);
  assert.equal(d.writes().length, before, "whatever the other program runs is left to it");
  assert.equal(locks.holders.size, 0);
});

test("the device starting or stopping when this page did not tell it means another program is telling it", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const device = new Device({ settleMs: 0 });
  const words = said(device);
  await device.connect();
  d.status({ state: 1 });
  assert.ok(device.connected, "one message in disagreement is not enough");
  d.status({ state: 1 });
  await settle();
  assert.ok(!device.connected);
  assert.deepEqual(words, [ANOTHER_PROGRAM]);
});

test("right after this page told it something, the device's status is not held against it", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const device = new Device({ settleMs: 60_000 });
  await device.connect();
  d.status({ state: 1 });
  d.status({ state: 1 });
  await settle();
  assert.ok(device.connected);
});

test("USB power stops the stream: the page says to unplug, and starts again once it is out", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const device = new Device({ settleMs: 0 });
  const words = said(device);
  const resumed = [];
  device.on((e) => { if (e.type === "resumed") resumed.push(true); });
  await device.connect();
  await device.start();
  d.state.usb = true;
  d.state.streaming = false;
  d.status();
  assert.deepEqual(words, [USB]);
  assert.ok(device.connected, "USB power is not another program");
  d.state.usb = false;
  d.status();
  await settle();
  assert.ok(d.state.streaming, "the stream starts again");
  assert.deepEqual(resumed, [true]);
});

test("Disconnect stops what the page started, ends its subscriptions, then drops the link", async () => {
  const d = stand_in();
  const locks = page(d.bluetooth);
  const device = new Device();
  const words = said(device);
  await device.connect();
  await device.start();
  d.log.length = 0;
  await device.disconnect();
  assert.equal(d.log[0], "write stop_stream");
  assert.equal(d.log.at(-1), "drop");
  assert.ok(d.log.slice(1, -1).every((l) => l.startsWith("unsubscribe")));
  assert.deepEqual(words, [null], "nothing to explain when the person asked");
  assert.equal(locks.holders.size, 0);
  await device.connect();
  assert.equal(d.bluetooth.asked, 2, "connecting again opens the chooser, in case it is another device");
});

test("leaving the page stops the stream with one write", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const window = new EventTarget();
  globalThis.addEventListener = window.addEventListener.bind(window);
  try {
    const device = new Device();
    await device.connect();
    await device.start();
    d.log.length = 0;
    window.dispatchEvent(new Event("pagehide"));
    assert.deepEqual(d.log, ["write stop_stream"]);
  } finally {
    delete globalThis.addEventListener;
  }
});

test("a device that drops out is reconnected by itself, without the chooser, once it is back", async () => {
  const d = stand_in();
  const locks = page(d.bluetooth);
  const device = new Device(QUICK);
  const words = said(device);
  const events = [];
  device.on((e) => events.push(e.type));
  await device.connect();
  d.vanish();
  assert.ok(device.reconnecting);
  assert.deepEqual(words, [RECONNECTING]);
  assert.equal(locks.holders.size, 1, "the device stays held for this page while it is away");
  await settle(30);
  d.state.off = false;
  await settle(150);
  assert.ok(device.connected);
  assert.ok(events.includes("reconnected"));
  assert.equal(d.bluetooth.asked, 1);
});

test("a device that stays away: the page stops trying and says what to do", async () => {
  const d = stand_in();
  const locks = page(d.bluetooth);
  const device = new Device(QUICK);
  const words = said(device);
  await device.connect();
  d.vanish();
  await settle(600);
  assert.ok(!device.reconnecting && !device.connected);
  assert.deepEqual(words, [RECONNECTING, OUT_OF_REACH]);
  assert.equal(locks.holders.size, 0);
});

test("pressing while it reconnects stops trying", async () => {
  const d = stand_in();
  const locks = page(d.bluetooth);
  const device = new Device(QUICK);
  await device.connect();
  d.vanish();
  await device.disconnect();
  await settle();
  assert.ok(!device.reconnecting);
  assert.equal(locks.holders.size, 0);
});

test("a device that does not answer: the page says what to do, and the next press opens the chooser", async () => {
  const d = stand_in({ state: { streaming: false, usb: false, off: true } });
  const locks = page(d.bluetooth);
  const device = new Device(QUICK);
  await assert.rejects(device.connect(), { message: NO_ANSWER });
  assert.equal(locks.holders.size, 0);
  d.state.off = false;
  await device.connect();
  assert.equal(d.bluetooth.asked, 2);
});

test("switching devices: with the first one off, a press opens the chooser and connects the one chosen there", async () => {
  const one = stand_in();
  const other = stand_in();
  const locks = new Locks();
  navigator.locks = locks;
  let asked = 0;
  navigator.bluetooth = { requestDevice: () => [one, other][asked++].bluetooth.requestDevice() };
  const device = new Device(QUICK);
  const words = said(device);
  await device.connect();
  one.vanish();
  assert.ok(device.reconnecting);
  await device.connect();
  assert.equal(asked, 2, "the press opened the chooser");
  assert.ok(device.connected && other.server.connected);
  // The first one coming back on does not take over.
  one.state.off = false;
  await settle(100);
  assert.ok(other.server.connected && !one.server.connected && !device.reconnecting);
  assert.deepEqual(words, [RECONNECTING]);
  assert.equal(locks.holders.size, 1);
});

test("closing the chooser, or Bluetooth being off, says what to do", async () => {
  const notFound = (message) => ({ requestDevice: () => Promise.reject(Object.assign(new Error(message), { name: "NotFoundError" })) });
  page(notFound("User cancelled the requestDevice() chooser."));
  await assert.rejects(new Device().connect(), { message: CHOOSE });
  page(notFound("Bluetooth adapter not available."));
  await assert.rejects(new Device().connect(), { message: BLUETOOTH_OFF });
});

test("a page inside the suite: what it listens to ends, and what it started stops, when it goes, and the device stays connected", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const device = new Device();
  const win = new EventTarget();
  const seen = device.adopt(win);
  const heard = [];
  seen.on((e) => heard.push(e.type));
  await seen.connect();
  await seen.start();
  assert.ok(heard.includes("connected"));
  win.dispatchEvent(new Event("pagehide"));
  await device.settling;
  assert.ok(device.connected);
  assert.ok(!d.state.streaming);
  const count = heard.length;
  d.status();
  assert.equal(heard.length, count, "the page that went hears nothing more");
  await device.adopt(new EventTarget()).start();
  assert.ok(d.state.streaming, "the next page starts after the last one's stop");
});

test("asking for embeddings again does not double them", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const device = new Device();
  await device.connect();
  await device.embeddings();
  await device.stopEmbeddings();
  await device.embeddings();
  assert.equal(d.chars.get(P.EMBEDDINGS).heard.size, 1);
});

test("a refusal says what to do", async () => {
  const d = stand_in();
  page(d.bluetooth);
  const device = new Device();
  await device.connect();
  const busy = { ok: false, status: 3, statusName: "busy" };
  const hardware = { ok: false, status: 5, statusName: "hardware" };
  device.link.request = async () => busy;
  await assert.rejects(device.start(), { message: /Wait a few seconds, then try again/ });
  device.link.request = async () => hardware;
  await assert.rejects(device.start(), { message: /Turn it off and on, then try again/ });
});
