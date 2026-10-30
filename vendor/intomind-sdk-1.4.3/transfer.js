/**
 * Carrying an image or a head to a device, without doing any input or
 * output.
 *
 * The same three things go over this path: an application image, the
 * model weights, and a head. The first two are ours, signed and
 * encrypted, and the device checks the signature against the key in its
 * own flash. A head is the user's, carries its own hash, and is checked
 * for that hash and for its shape. Nothing here can forge any of them,
 * which is the point: a host carries an update without being able to
 * read or write one.
 *
 * Nothing is activated by a transfer. The image lands in the idle slot
 * and is verified there, and putting it in force is a separate act.
 *
 * This is a state machine, like the session. Ask it what to do, do that,
 * and hand back what came of it. `Connection.transfer` drives it for you
 * in a browser.
 */
import { crc32, sha256 } from "./digest.js";
import { CAPABILITIES, FILL, decodeHead, decodeUpdateQuery, decodeUpdateResponse, decodeUpdateStart, encodeUpdateOp, encodeUpdateStart, } from "./protocol.js";
import { NotCapable, Session } from "./session.js";
/** How many writes go out before the device is asked what it has. */
const WRITES_PER_CHECK = 32;
/** The largest write this contract allows, whatever a device claims. */
const CHUNK_CEILING = 244;
/** Why a transfer stopped. */
export class TransferError extends Error {
    /** Always "TransferError". */
    name = "TransferError";
}
/** The device refused a request. */
export class Refused extends TransferError {
    /** Always "Refused". */
    name = "Refused";
    /** Which operation the device refused. */
    op;
    /** The device's status for that operation, in words. */
    status;
    /** Build one naming the refused operation and the device's status. */
    constructor(op, status) {
        super(`the device refused ${op}: ${status}`);
        this.op = op;
        this.status = status;
    }
}
/** The device holds a different number of bytes than were sent. */
export class OffsetMismatch extends TransferError {
    /** Always "OffsetMismatch". */
    name = "OffsetMismatch";
    /** Bytes this side has sent. */
    sent;
    /** Bytes the device says it holds. */
    device;
    /** Build one with what was sent and what the device reports holding. */
    constructor(sent, device) {
        super(`the device accepted ${device} bytes where ${sent} were sent`);
        this.sent = sent;
        this.device = device;
    }
}
/** The bytes arrived changed. */
export class ChecksumMismatch extends TransferError {
    /** Always "ChecksumMismatch". */
    name = "ChecksumMismatch";
    /** Bytes checked. */
    sent;
    /** This side's checksum over those bytes. */
    ours;
    /** The device's checksum over the same bytes. */
    device;
    /** Build one with the bytes checked and the two checksums. */
    constructor(sent, ours, device) {
        super(`over ${sent} bytes our checksum is ${hex32(ours)} and the device's is ${hex32(device)}`);
        this.sent = sent;
        this.ours = ours;
        this.device = device;
    }
}
/** The device refused the finished image, and said why. */
export class Rejected extends TransferError {
    /** Always "Rejected". */
    name = "Rejected";
    /** Why the device refused the image, or null when it gave no reason. */
    result;
    /** Build one with the device's reason, or null when it gave none. */
    constructor(result) {
        super(`the device refused the image: ${result ?? "no reason given"}`);
        this.result = result;
    }
}
/** An answer arrived that this transfer did not ask for. */
export class Unexpected extends TransferError {
    /** Always "Unexpected". */
    name = "Unexpected";
    /** Build one, with a default message or one of your own. */
    constructor(message = "an answer arrived that this transfer did not ask for") {
        super(message);
    }
}
function hex32(n) {
    return `0x${(n >>> 0).toString(16).padStart(8, "0")}`;
}
/** One image, on its way to one device. */
export class Transfer {
    #target;
    #slot;
    #total;
    #id;
    #offset = 0;
    #chunk;
    #sinceCheck = 0;
    #phase = "starting";
    #result = null;
    constructor(target, slot, image, chunk) {
        this.#target = target;
        this.#slot = slot;
        this.#total = image.length;
        // A transfer names itself by what is being sent, so an interrupted
        // one resumes only against the same bytes and never against
        // different ones that happen to be the same length.
        this.#id = sha256(image).subarray(0, 8);
        this.#chunk = chunk;
    }
    /** An application image, for the slot the device is not running from. */
    static app(session, slot, image) {
        return new Transfer("app", slot, image, chunkFor(session, image));
    }
    /** The model weights. There is one copy of them, so no slot. */
    static weights(session, image) {
        return new Transfer("weights", 0xff, image, chunkFor(session, image));
    }
    /**
     * A head, into one of the device's head slots.
     *
     * The blob is checked here against the width of the embedding this
     * device's model produces, so a head trained for a different encoder is
     * refused before any of it goes on the wire.
     */
    static head(session, slot, blob) {
        const info = session.info;
        if (info === null)
            throw new NotCapable("heads");
        if ((info.capabilities & CAPABILITIES.heads) === 0)
            throw new NotCapable("heads");
        if (info.modelEmbedDim === null || info.headMaxOutputs === null)
            throw new NotCapable("heads");
        const head = decodeHead(blob);
        if (head.inDim !== info.modelEmbedDim) {
            throw new TransferError(`this head takes an embedding of ${head.inDim} and the device's model produces ${info.modelEmbedDim}`);
        }
        if (head.outDim > info.headMaxOutputs) {
            throw new TransferError(`this head has ${head.outDim} outputs and the device takes at most ${info.headMaxOutputs}`);
        }
        return new Transfer("head", slot, blob, chunkFor(session, blob));
    }
    /** How much the device has taken, of how much there is. */
    get progress() {
        return { taken: this.#offset, total: this.#total };
    }
    /** What to do next. */
    step(image) {
        switch (this.#phase) {
            case "starting":
                return send(encodeUpdateStart(this.#target, this.#slot, this.#total, this.#id));
            case "checking":
                return send(encodeUpdateOp("query"));
            case "finishing":
                return send(encodeUpdateOp("finish"));
            case "done":
                return { type: "verified", result: this.#result };
            case "sending": {
                const to = Math.min(this.#offset + this.#chunk, image.length);
                return { type: "data", characteristic: FILL.UPDATE_DATA, from: this.#offset, to };
            }
        }
    }
    /** Say how many bytes went out, after writing what `step` asked for. */
    sent(n) {
        if (this.#phase !== "sending")
            return;
        this.#offset = Math.min(this.#offset + n, this.#total);
        this.#sinceCheck += 1;
        if (this.#sinceCheck >= WRITES_PER_CHECK || this.#offset === this.#total) {
            this.#sinceCheck = 0;
            this.#phase = "checking";
        }
    }
    /** Hand in the answer to whatever `step` last asked to be sent. */
    onAnswer(bytes, image) {
        let answer;
        try {
            answer = decodeUpdateResponse(bytes);
        }
        catch (e) {
            throw new Unexpected(`that is not an update answer: ${e.message}`);
        }
        if (this.#phase === "starting" && answer.opName === "start") {
            this.#refuse(answer);
            const start = decodeUpdateStart(answer.payload);
            // The device may already hold part of this transfer, and says so.
            // Believe it, and test the claim at the next checkpoint like any
            // other.
            this.#offset = Math.min(start.resumeOffset, this.#total);
            if (start.chunkMax > 0)
                this.#chunk = Math.min(this.#chunk, start.chunkMax);
            this.#sinceCheck = 0;
            this.#phase = this.#offset === this.#total ? "checking" : "sending";
            return;
        }
        if (this.#phase === "checking" && answer.opName === "query") {
            this.#refuse(answer);
            const q = decodeUpdateQuery(answer.payload);
            if (q.offset !== this.#offset)
                throw new OffsetMismatch(this.#offset, q.offset);
            const ours = crc32(image.subarray(0, this.#offset));
            if ((q.crc32 >>> 0) !== (ours >>> 0)) {
                throw new ChecksumMismatch(this.#offset, ours, q.crc32);
            }
            this.#phase = this.#offset === this.#total ? "finishing" : "sending";
            return;
        }
        if (this.#phase === "finishing" && answer.opName === "finish") {
            if (!answer.ok)
                throw new Rejected(answer.verifyResultName);
            this.#result = answer.verifyResultName;
            this.#phase = "done";
            return;
        }
        throw new Unexpected();
    }
    /** Give up. The device drops what it has. */
    abort() {
        return send(encodeUpdateOp("abort")).command;
    }
    #refuse(answer) {
        if (!answer.ok)
            throw new Refused(answer.opName ?? "an update", answer.statusName);
    }
}
/**
 * Put a transferred image in force.
 *
 * The device resets, so the link drops and everything a caller knows
 * about it is stale. An application comes back on trial and rolls itself
 * back if it cannot confirm. Weights are verified at every boot, so
 * restarting is what puts new ones in force.
 */
export function activate() {
    return send(encodeUpdateOp("activate")).command;
}
function send(bytes) {
    return {
        type: "send",
        command: { characteristic: FILL.UPDATE_CONTROL, bytes, withResponse: true },
    };
}
function chunkFor(session, image) {
    const info = session.info;
    if (info === null)
        throw new NotCapable("update");
    if ((info.capabilities & CAPABILITIES.update) === 0)
        throw new NotCapable("update");
    if (image.length === 0)
        throw new TransferError("nothing is not an image");
    const claimed = info.updateChunkMax ?? CHUNK_CEILING;
    return Math.min(claimed > 0 ? claimed : CHUNK_CEILING, CHUNK_CEILING);
}
//# sourceMappingURL=transfer.js.map