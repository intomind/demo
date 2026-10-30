/**
 * The IntoMind instrument client, for a browser and for Node.
 *
 * The protocol, the session, and the timebase do no input and no output.
 * They are handed bytes that arrived and they hand back bytes to send,
 * which means they work over whatever Bluetooth stack you already have and
 * can be tested without one. `web-bluetooth.ts` is the browser transport,
 * and it is the only file in this package that touches a radio. `capture`
 * reads recordings and writes their exports as bytes in the same way, and
 * `capture/node` is the one part of it that touches a disk.
 *
 * ```ts
 * import { requestAndConnect } from "@intomind/sdk";
 *
 * const device = await requestAndConnect({
 *   onEvent(event) {
 *     if (event.type === "samples") write(event.batch);
 *     // Written down, never smoothed over.
 *     if (event.type === "gap") writeGap(event.gap);
 *   },
 * });
 * await device.send(device.session.startStream());
 * ```
 *
 * What a device can do is what the device says it can do. Nothing here
 * holds a table of hardware, and a capability is a bit the device reports
 * rather than a version number this package compares against.
 */
export * as protocol from "./protocol.js";
export * as capture from "./capture/index.js";
export { CAPABILITIES, CAPABILITIES_HIGH, DeviceInfo, EMBED_SCALE, FILL, GAIN_BY_CODE, Invalid, MODES, NAME_MAX_COMPOSED, NAME_PREFIX, NO_ENCODER_ID, OPCODES, PRODUCT_NAME, ProtocolError, RATE_BY_CODE, Reserved, SERVICE, Truncated, VERSION, buildHead, composeName, continuity, decodeHead, decodeModelInterval, decodeNameParts, decodePacket, displayNames, evaluateHead, microvolts, nameFits, quantizeEmbedding, uuid, } from "./protocol.js";
export { Batch, NoDeviceInfo, NotCapable, Session, SessionError } from "./session.js";
export { Exchange, MAX_SKEW_PPM, MAX_SKEW_STDERR_PPM, Timebase } from "./timebase.js";
export { ChecksumMismatch, OffsetMismatch, Refused, Rejected, Transfer, TransferError, Unexpected, activate, } from "./transfer.js";
export { Connection, NoBluetooth, connect, hostClock, requestAndConnect, requestDevice } from "./web-bluetooth.js";
//# sourceMappingURL=index.js.map