/**
 * The browser transport.
 *
 * This is the only file that touches `navigator.bluetooth`. Everything
 * else in this package is bytes in and events out, so the protocol, the
 * session, and the timebase are all testable without a browser and without
 * a device.
 *
 * It stays thin on purpose: find a device, connect, resolve the
 * characteristics, subscribe, and hand every notification to the session.
 * What the notifications mean is the session's business.
 */
import { hostClocks } from "./capture/clock.js";
import { DEVICE_INFO, FILL, OPCODES, SERVICE, decodeTimeSync, uuid, } from "./protocol.js";
import { Session } from "./session.js";
/** Thrown when the page cannot reach Web Bluetooth at all. */
export class NoBluetooth extends Error {
    constructor() {
        super("this page has no Web Bluetooth: it needs a supporting browser, a secure context, and a user gesture");
        this.name = "NoBluetooth";
    }
}
function bluetooth() {
    const nav = globalThis.navigator;
    if (nav?.bluetooth === undefined)
        throw new NoBluetooth();
    return nav.bluetooth;
}
/**
 * The clock the exchanges are read on, in seconds.
 *
 * Monotonic where the runtime has one, because the fit between the two
 * clocks is a line and a wall clock step would bend it. A caller that puts
 * its own events on the same ruler reads this same function.
 */
export function hostClock() {
    const p = globalThis.performance;
    if (p !== undefined)
        return (p.timeOrigin ?? 0) / 1000 + p.now() / 1000;
    return Date.now() / 1000;
}
/**
 * Put the browser's device chooser up, filtered to devices that advertise
 * the IntoMind service. This has to be called from a user gesture.
 */
export function requestDevice(options = {}) {
    const filter = { services: [SERVICE] };
    if (options.namePrefix !== undefined)
        filter.namePrefix = options.namePrefix;
    return bluetooth().requestDevice({ filters: [filter], optionalServices: [SERVICE] });
}
/** A live link to one device. */
export class Connection {
    /** The device this link is to. */
    device;
    /** The session reading this device's notifications. */
    session;
    /** What the device said it is, read before anything else was asked of it. */
    info;
    #server;
    #characteristics;
    #listeners = new Set();
    #waiting = [];
    /** Whoever is waiting for the next update answer, in order. */
    #updateWaiting = [];
    #timeoutMs;
    /**
     * Verifying a finished image takes the device longer than answering a
     * command, because it hashes and checks a signature over the whole of
     * it before it says anything.
     */
    #updateTimeoutMs = 30_000;
    /** Build one from an open server and the characteristics `connect` resolved. */
    constructor(f) {
        this.device = f.device;
        this.session = f.session;
        this.info = f.info;
        this.#server = f.server;
        this.#characteristics = f.characteristics;
        this.#timeoutMs = f.timeoutMs;
    }
    /** Whether the link is currently connected. */
    get connected() {
        return this.#server.connected;
    }
    /** Take every event. The returned function stops taking them. */
    on(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    /** Write a command. The session says which characteristic it goes to. */
    async send(command) {
        const c = this.#characteristics.get(command.characteristic);
        if (c === undefined) {
            throw new Error(`this device has no characteristic ${uuid(command.characteristic)}`);
        }
        const bytes = command.bytes.slice();
        if (command.withResponse)
            await c.writeValueWithResponse(bytes);
        else
            await c.writeValueWithoutResponse(bytes);
    }
    /** Write a command and wait for the device's answer to it. */
    async request(command) {
        const answer = this.#await(command.bytes[0]);
        await this.send(command);
        return (await answer).answer;
    }
    /**
     * One time exchange, with the host clock read either side of it. The
     * device's answer is known to lie between those two readings, which is
     * the whole uncertainty in this one exchange. The session's `clock`, which
     * dates a recording, takes the same exchange on both host clocks, as the
     * Python library's device does.
     */
    async timeSync() {
        const waiting = this.#await(OPCODES.time_sync);
        const before = hostClock();
        const beforeClocks = hostClocks();
        await this.send(this.session.timeSync());
        const { answer, at, clocks } = await waiting;
        this.session.clock?.observe(decodeTimeSync(answer.payload), beforeClocks, clocks);
        return this.session.onTimeSync(answer.payload, before, at);
    }
    /**
     * Carry an image or a head to the device and have it verified there.
     *
     * Nothing is activated by this. Use `activate` afterwards, and expect
     * the link to drop when you do.
     *
     * ```javascript
     * const t = Transfer.head(link.session, 1, blob);
     * const result = await link.transfer(t, blob, ({ taken, total }) => {
     *   console.log(`${taken} of ${total}`);
     * });
     * ```
     */
    async transfer(transfer, image, onProgress) {
        try {
            for (;;) {
                const step = transfer.step(image);
                if (step.type === "verified")
                    return step.result;
                if (step.type === "send") {
                    const answer = this.#awaitUpdate();
                    await this.send(step.command);
                    transfer.onAnswer(await answer, image);
                    onProgress?.(transfer.progress);
                    continue;
                }
                await this.send({
                    characteristic: step.characteristic,
                    bytes: image.subarray(step.from, step.to),
                    withResponse: false,
                });
                transfer.sent(step.to - step.from);
            }
        }
        catch (e) {
            // A transfer that stopped leaves the device holding a part of
            // something. Tell it to drop that, then report what went wrong.
            try {
                await this.send(transfer.abort());
                this.#updateWaiting.shift();
            }
            catch {
                // The link is what failed. Nothing further to say to it.
            }
            throw e;
        }
    }
    /**
     * End every subscription this link started, then drop the link. The
     * order matters: on some platforms the browser keeps a subscribed link
     * open after a disconnect, and the next program on the same computer
     * then hears every packet twice.
     */
    async disconnect() {
        for (const fill of NOTIFYING) {
            const c = this.#characteristics.get(fill);
            if (c === undefined)
                continue;
            try {
                await c.stopNotifications();
            }
            catch {
                // A link that is already gone has nothing left to stop.
            }
        }
        if (this.#server.connected)
            this.#server.disconnect();
    }
    #awaitUpdate() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const i = this.#updateWaiting.indexOf(settle);
                if (i >= 0)
                    this.#updateWaiting.splice(i, 1);
                reject(new Error("the device did not answer the update service in time"));
            }, this.#updateTimeoutMs);
            const settle = (bytes) => {
                clearTimeout(timer);
                resolve(bytes);
            };
            this.#updateWaiting.push(settle);
        });
    }
    #await(opcode) {
        return new Promise((resolve, reject) => {
            const waiter = {
                opcode,
                settle: (answer, at, clocks) => {
                    clearTimeout(timer);
                    resolve({ answer, at, clocks });
                },
            };
            const timer = setTimeout(() => {
                const i = this.#waiting.indexOf(waiter);
                if (i >= 0)
                    this.#waiting.splice(i, 1);
                reject(new Error(`the device did not answer opcode 0x${opcode.toString(16)} in time`));
            }, this.#timeoutMs);
            this.#waiting.push(waiter);
        });
    }
    /** @internal Called by `connect` for every notification that arrives. */
    deliver(characteristic, bytes) {
        const at = hostClock();
        const clocks = hostClocks();
        if (characteristic === FILL.UPDATE_CONTROL) {
            // An update answer is not a session event. It goes to whichever
            // transfer asked for it.
            const settle = this.#updateWaiting.shift();
            if (settle !== undefined)
                settle(bytes);
            return;
        }
        for (const event of this.session.onNotification(characteristic, bytes)) {
            if (event.type === "answer") {
                const i = this.#waiting.findIndex((w) => w.opcode === event.answer.opcode);
                if (i >= 0)
                    this.#waiting.splice(i, 1)[0].settle(event.answer, at, clocks);
            }
            for (const listener of this.#listeners)
                listener(event);
        }
    }
}
/** The characteristics this transport subscribes to, in the order it tries them. */
const NOTIFYING = [
    FILL.EEG_DATA,
    FILL.STATUS,
    FILL.CONTROL_RESPONSE,
    FILL.PREDICTIONS,
    // The update service answers on its own characteristic, by indication.
    // Without this subscription a transfer writes into silence.
    FILL.UPDATE_CONTROL,
];
const WRITABLE = [FILL.CONTROL, FILL.UPDATE_CONTROL, FILL.UPDATE_DATA];
/**
 * Connect to a device the user chose, read what it is, and subscribe to
 * everything it notifies.
 */
export async function connect(device, options = {}) {
    if (device.gatt === undefined)
        throw new NoBluetooth();
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    const session = options.session ?? new Session();
    const infoCharacteristic = await service.getCharacteristic(DEVICE_INFO);
    const info = session.onDeviceInfo(asBytes(await infoCharacteristic.readValue()));
    const characteristics = new Map();
    characteristics.set(FILL.DEVICE_INFO, infoCharacteristic);
    // A device carries the characteristics its firmware offers, so one that
    // is absent is not an error. What is absent shows up as a capability the
    // device never claimed.
    for (const fill of [...NOTIFYING, ...WRITABLE]) {
        const c = await optional(service, fill);
        if (c !== null)
            characteristics.set(fill, c);
    }
    const connection = new Connection({ device, server, session, info, characteristics, timeoutMs: options.timeoutMs ?? 5000 });
    if (options.onEvent !== undefined)
        connection.on(options.onEvent);
    for (const fill of NOTIFYING) {
        const c = characteristics.get(fill);
        if (c === undefined)
            continue;
        c.addEventListener("characteristicvaluechanged", (event) => {
            const value = event.target.value;
            if (value !== undefined)
                connection.deliver(fill, asBytes(value));
        });
        await c.startNotifications();
    }
    if (options.onDisconnect !== undefined) {
        device.addEventListener("gattserverdisconnected", options.onDisconnect, { once: true });
    }
    return connection;
}
/** Ask for a device and connect to it, which is what most callers want. */
export async function requestAndConnect(options = {}) {
    return connect(await requestDevice(options), options);
}
async function optional(service, fill) {
    try {
        return await service.getCharacteristic(uuid(fill));
    }
    catch {
        return null;
    }
}
function asBytes(value) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}
//# sourceMappingURL=web-bluetooth.js.map