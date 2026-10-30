/**
 * A recording written as the Python library's recorder writes one: the
 * samples in `name.npz`, the manifest in `name.meta.json`, the markers in
 * `name.events.json`, and `name.sha256` last, so that a run which dies on the
 * way leaves no checksums and is never taken for a whole recording.
 *
 * `Take` holds what a run collected: every sample and every packet that
 * carried them. `save` makes the recording's files from it, with the
 * manifest the library writes at its current version, built the way it
 * builds one, from what the device said, what the application declares in a
 * `Setup`, and what the run adds in a `Run`. Every recording made here reads
 * back through `Collection` and every IntoMind program, and is held to the
 * Python library's own recordings by the fixture in `contract/recorder`.
 *
 * Nothing here writes a disk: `save` hands back the files' bytes, in the
 * order the library writes them, for a browser to keep however it keeps
 * files. `capture/node` writes them into a folder.
 */
import { sha256 } from "../digest.js";
import { GAIN_BY_CODE, INDICATOR_LEVELS, MODE_BY_CODE, RATE_BY_CODE, composeName, lowPassAutoDhz } from "../protocol.js";
import { CaptureError } from "./errors.js";
import * as montage from "./montage.js";
import { Fail } from "./montage.js";
import * as npy from "./npy.js";
import * as placement from "./placement.js";
import { general } from "./pyfmt.js";
import * as J from "./pyjson.js";
import { checkLabel } from "./recording.js";
import { PACKAGE_VERSION } from "./version.js";
import * as zip from "./zip.js";
/** The manifest version this writes. 7 is the version whose npz carries `leadoff_active`, whether lead-off detection ran at each sample. */
export const MANIFEST_VERSION = 7;
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** A typed array that grows as it is appended to. */
class Grow {
    #buf;
    #n = 0;
    #make;
    constructor(make) {
        this.#make = make;
        this.#buf = make(1024);
    }
    push(v) {
        if (this.#n === this.#buf.length) {
            const grown = this.#make(this.#buf.length * 2);
            grown.set(this.#buf);
            this.#buf = grown;
        }
        this.#buf[this.#n++] = v;
    }
    get length() {
        return this.#n;
    }
    /** The values appended, as their own array. */
    values() {
        return this.#buf.slice(0, this.#n);
    }
}
/** What a run collected: every sample, and every packet that carried them. */
export class Take {
    #index = new Grow((n) => new BigInt64Array(n));
    #ticks = new Grow((n) => new BigInt64Array(n));
    #host = new Grow((n) => new Float64Array(n));
    #counts = new Grow((n) => new Int32Array(n));
    #leadoff = new Grow((n) => new Uint8Array(n));
    #gap = new Grow((n) => new Uint8Array(n));
    #active = new Grow((n) => new Int8Array(n));
    #packets = [];
    #channels = null;
    #mixed = false;
    /** One packet, as it arrived. */
    packet(p) {
        this.#packets.push(p);
    }
    /**
     * One sample: its index and time on the device, its time on the host, its
     * counts across the channels, the lead-off byte of its packet, whether a
     * break comes before it, and whether lead-off detection was running, null
     * where the source did not say.
     */
    sample(index, deviceTicks, hostTime, counts, leadoff, gapBefore, leadoffActive) {
        if (this.#channels === null)
            this.#channels = counts.length;
        else if (this.#channels !== counts.length)
            this.#mixed = true;
        this.#index.push(index);
        this.#ticks.push(deviceTicks);
        this.#host.push(hostTime);
        for (let c = 0; c < counts.length; c++)
            this.#counts.push(counts[c]);
        this.#leadoff.push(leadoff);
        this.#gap.push(gapBefore ? 1 : 0);
        this.#active.push(leadoffActive === null ? -1 : leadoffActive ? 1 : 0);
    }
    /** How many samples were collected. */
    get samples() {
        return this.#index.length;
    }
    /** The packets, in the order they arrived. */
    get packets() {
        return this.#packets;
    }
    /** Each sample's index. */
    get index() {
        return this.#index.values();
    }
    /** Each sample's device time, in its ticks. */
    get deviceTicks() {
        return this.#ticks.values();
    }
    /** The arrays as `np.savez_compressed` writes them for the recorder, in its order. */
    arrays() {
        if (this.#mixed)
            throw new CaptureError("the samples of one recording carry different numbers of channels");
        const n = this.samples;
        const channels = this.#channels ?? 0;
        // The counts channels by samples, stored sample after sample, which
        // numpy marks as Fortran order wherever both dimensions exceed one.
        const flat = this.#counts.values();
        // Each count widened to 64 bits, its sign carried into the high word,
        // in the platform's own order, without making a bigint of every one.
        const words = new Int32Array(flat.length * 2);
        const [low, high] = LITTLE ? [0, 1] : [1, 0];
        for (let k = 0; k < flat.length; k++) {
            words[2 * k + low] = flat[k];
            words[2 * k + high] = flat[k] >> 31;
        }
        const values = new BigInt64Array(words.buffer);
        const counts = n === 0
            ? npy.vector({ kind: "i8", values: new BigInt64Array(0) })
            : { shape: [channels, n], fortran: channels > 1 && n > 1, data: { kind: "i8", values } };
        const out = [
            ["counts", counts],
            ["index", npy.vector({ kind: "i8", values: this.#index.values() })],
            ["device_ticks", npy.vector({ kind: "i8", values: this.#ticks.values() })],
            ["host_time", npy.vector({ kind: "f8", values: this.#host.values() })],
            ["leadoff", npy.vector({ kind: "u1", values: this.#leadoff.values() })],
            ["gap_before", npy.vector({ kind: "b1", values: this.#gap.values() })],
        ];
        // Kept beside the lead-off byte only when every sample said, because a
        // zero byte means an attached electrode only where detection ran.
        const active = this.#active.values();
        if (active.every((a) => a >= 0)) {
            out.push(["leadoff_active", npy.vector({ kind: "b1", values: Uint8Array.from(active) })]);
        }
        return out;
    }
}
/** What a recording made by this package says made it. */
export function hostVersions() {
    const p = globalThis.process;
    const platform = p !== undefined && typeof p.platform === "string" ? `${p.platform}-${p.arch}` : "browser";
    return J.object([
        ["intomind_js", J.str(PACKAGE_VERSION)],
        ["platform", J.str(platform)],
    ]);
}
function hex(b) {
    let s = "";
    for (const x of b)
        s += x.toString(16).padStart(2, "0");
    return s;
}
/** The checksum file the library writes over `files`: each file's sha256 and name, in name order. */
export function checksums(files) {
    const sums = files.map(([name, bytes]) => [name, hex(sha256(bytes))]);
    sums.sort((a, b) => J.compareKeys(a[0], b[0]));
    return new TextEncoder().encode(sums.map(([k, v]) => `${v}  ${k}\n`).join(""));
}
/**
 * The recording `label` from `take`, as the files the Python library writes
 * for it, with its manifest. `versions` names the software that made it,
 * this package by default.
 */
export function save(label, take, device, setup = {}, run = {}, versions = hostVersions()) {
    checkLabel(label);
    const finished = run.finishedUnix ?? Date.now() / 1000;
    const npzBytes = zip.write(take.arrays().map(([k, a]) => [`${k}.npy`, npy.write(a)]), Math.trunc(Math.max(0, finished)));
    const given = J.fromPlain(run.extra ?? {});
    if (given.kind !== "object")
        throw new CaptureError("a run's extra fields are an object");
    const extra = J.copyObject(given);
    const protocol = J.pop(extra, "experiment");
    const regsBefore = J.pop(extra, "regs_before");
    const params = J.copyObject(extra);
    let meta;
    try {
        meta = build(label, device, setup, take.packets, regsBefore, J.fromPlain(run.regsAfter), protocol, params, extra, take.index, take.deviceTicks, J.fromPlain(run.configAfter), finished, versions);
    }
    catch (e) {
        if (e instanceof Fail)
            throw new CaptureError(e.message);
        throw e;
    }
    J.set(meta, "n", J.int(take.samples));
    // The names every earlier reader reads.
    for (const [k, v] of [
        ["fw", J.str(device.firmware)],
        ["experiment", protocol],
        ["regs_before", regsBefore],
    ]) {
        if (J.get(meta, k) === undefined)
            J.set(meta, k, v);
    }
    const aborted = run.aborted ?? null;
    if (aborted !== null && aborted !== "")
        J.set(meta, "aborted", J.str(aborted));
    const manifestJson = J.dumpsIndented(meta, 2);
    const encode = (s) => new TextEncoder().encode(s);
    const files = [
        [`${label}.npz`, npzBytes],
        [`${label}.meta.json`, encode(manifestJson)],
    ];
    const events = run.events === undefined ? J.NULL : J.fromPlain(run.events);
    if (events.kind !== "null")
        files.push([`${label}.events.json`, encode(J.dumpsIndented(events, 2))]);
    // Checksums mark a recording finalized. An aborted run never gets them.
    const finalized = aborted === null || aborted === "";
    if (finalized)
        files.push([`${label}.sha256`, checksums(files)]);
    return { label, files, manifest: meta, manifestJson, sessionLine: sessionLine(meta), finalized };
}
/** One line for the recordings folder's session log, as the library appends it. */
function sessionLine(meta) {
    const row = J.object([]);
    for (const k of [
        "label",
        "started_utc",
        "finished_utc",
        "protocol_id",
        "board_revision",
        "firmware_version",
        "gain",
        "rate_sps",
        "device_config_changed_by_run",
        "git_commit",
    ]) {
        J.set(row, k, J.field(meta, k));
    }
    J.set(row, "n", J.field(meta, "n"));
    J.set(row, "samples_lost", J.field(J.field(meta, "quality"), "samples_lost"));
    return J.dumps(row) + "\n";
}
/** The library's `site()`: every fact it records, unknown until declared. */
function site(declared) {
    const s = J.object([
        ["board_revision", J.str("unknown")],
        ["mains_hz", J.NULL],
        ["psu_volts", J.NULL],
        ["firmware_sha256", J.NULL],
        ["firmware_artifact", J.NULL],
        ["electrode_montage", J.NULL],
        ["subject_id", J.NULL],
        ["notes", J.str("")],
    ]);
    const d = J.fromPlain(declared);
    if (d.kind === "object")
        for (const [k, v] of d.entries)
            J.set(s, k, v);
    return s;
}
/**
 * The structured montage, from where the electrodes were put or from the
 * site, and whether it agrees with the device. A montage that cannot be true
 * is recorded with its error rather than refusing a recording that has
 * already been made.
 */
export function montageFields(siteCfg, devChannels, layout, place) {
    const ok = (m) => (devChannels === null ? J.NULL : J.bool(montage.channelCount(m) === devChannels));
    const fields = (m, err, matches, source, lay, placed) => J.object([
        ["montage", m],
        ["montage_error", err],
        ["montage_matches_device", matches],
        ["montage_source", source],
        ["electrode_layout", lay],
        ["placement", placed],
    ]);
    const recorded = (e, kinds) => e instanceof Fail && kinds.includes(e.kind) ? e : null;
    if (layout.kind !== "null" && place.kind !== "null") {
        let m;
        let r;
        try {
            const lay = placement.layoutFrom(layout) ?? J.NULL;
            m = placement.toMontage(lay, place);
            r = placement.resolve(lay, place);
        }
        catch (e) {
            const f = recorded(e, ["montage", "placement"]);
            if (f === null)
                throw e;
            return fields(J.NULL, J.str(f.message), J.bool(false), J.str("placement"), layout, J.NULL);
        }
        return fields(m, J.NULL, ok(m), J.str("placement"), layout, r);
    }
    let m;
    try {
        m = montage.fromSite(siteCfg);
    }
    catch (e) {
        const f = recorded(e, ["montage"]);
        if (f === null)
            throw e;
        return fields(J.NULL, J.str(f.message), J.bool(false), J.str("site"), J.NULL, J.NULL);
    }
    if (m === null)
        return fields(J.NULL, J.NULL, J.NULL, J.NULL, J.NULL, J.NULL);
    return fields(m, J.NULL, ok(m), J.str("site"), J.NULL, J.NULL);
}
/** Where the breaks are, not only how many. A count that steps back is an epoch reset and lost nothing. */
export function gapLedger(index) {
    const gaps = [];
    let resets = 0;
    let lost = 0n;
    for (let i = 0; i + 1 < index.length; i++) {
        const d = index[i + 1] - index[i];
        if (d > 1n) {
            gaps.push(J.object([["after_sample", J.int(index[i])], ["lost", J.int(d - 1n)]]));
            lost += d - 1n;
        }
        else if (d < 0n) {
            resets += 1;
        }
    }
    const received = BigInt(index.length);
    return J.object([
        ["gaps", J.array(gaps)],
        ["n_gaps", J.int(gaps.length)],
        ["epoch_resets", J.int(resets)],
        ["samples_received", J.int(received)],
        ["samples_expected", J.int(received + lost)],
        ["samples_lost", J.int(lost)],
    ]);
}
/** The rate from the device's clock: samples over the span of their ticks. */
export function fsFromTicks(ticks, tickHz) {
    if (ticks.length < 2 || tickHz === 0)
        return 0;
    const span = (Number(ticks[ticks.length - 1]) - Number(ticks[0])) / tickHz;
    return span > 0 ? (ticks.length - 1) / span : 0;
}
/** The rate from the first and last packets' index and device time. */
function fsFromPackets(packets, tickHz) {
    if (packets.length < 2)
        return 0;
    const p0 = packets[0];
    const p1 = packets[packets.length - 1];
    const span = Number(p1.deviceTime - p0.deviceTime) / tickHz;
    return span > 0 ? (p1.index - p0.index) / span : 0;
}
/** What `for x in value` yields: a list's items, a string's characters, an object's keys. */
function pyIter(v) {
    if (v.kind === "array")
        return [...v.items];
    if (v.kind === "str")
        return Array.from(v.value, (c) => J.str(c));
    if (v.kind === "object")
        return v.entries.map(([k]) => J.str(k));
    throw new Fail("other", `TypeError: ${J.pyRepr(v)} is not iterable`);
}
/**
 * What `dict(v)` makes of a value a program declared: an object as itself,
 * and a list of key and value pairs as an object, keys Python holds equal
 * (`1`, `1.0` and `True`) kept once in their first form with the last
 * value, and written as `json.dumps` writes a key that is not text.
 */
function pyDict(v) {
    if (v.kind === "object")
        return v;
    const out = [];
    pyIter(v).forEach((item, i) => {
        if (item.kind !== "array" && item.kind !== "str" && item.kind !== "object") {
            throw new Fail("other", `TypeError: cannot convert dictionary update sequence element #${i} to a sequence`);
        }
        const pair = pyIter(item);
        if (pair.length !== 2) {
            throw new Fail("other", `ValueError: dictionary update sequence element #${i} has length ${pair.length}; 2 is required`);
        }
        const [key, value] = pair;
        if (J.jsonKey(key) === null)
            throw new Fail("other", `TypeError: unhashable type: ${J.pyRepr(key)}`);
        const slot = out.find(([have]) => J.pyEq(have, key));
        if (slot)
            slot[1] = value;
        else
            out.push([key, value]);
    });
    return J.object(out.map(([k, x]) => [J.jsonKey(k), x]));
}
/** Which adapter produced the recording, and where it was filtered. */
export function signalChain(setup) {
    const declared = J.fromPlain(setup.adapter);
    const adapter = J.truthy(declared)
        ? pyDict(declared)
        : J.object([
            ["name", J.str("unknown")],
            ["version", J.NULL],
            ["first_party", J.bool(false)],
            ["transport", J.NULL],
        ]);
    // `getattr(dev, "filter", None) or {}`, read with `.get`, which only a dict has.
    const f = J.fromPlain(setup.filter);
    if (J.truthy(f) && f.kind !== "object")
        throw new Fail("other", `AttributeError: ${J.pyRepr(f)} has no attribute 'get'`);
    const on = J.truthy(J.field(f, "on"));
    let filters = J.NULL;
    if (on) {
        // `[list(b) for b in (f.get("bands") or [])]`
        const bands = J.field(f, "bands");
        const each = J.truthy(bands) ? pyIter(bands) : [];
        filters = J.object([
            ["hp_hz", J.field(f, "hp_hz")],
            ["lp_hz", J.field(f, "lp_hz")],
            ["bands", J.array(each.map((b) => J.array(pyIter(b))))],
        ]);
    }
    return J.object([
        ["adapter", adapter],
        ["filtering", J.str(on ? (setup.filtersIn ?? "device") : "none")],
        ["filters", filters],
    ]);
}
/** What the samples were, off the packets that carried them. */
function signalSource(packets) {
    const modes = [...new Set(packets.map((p) => p.mode))].sort(J.compareKeys);
    const synthetic = J.bool(packets.some((p) => p.synthetic));
    if (modes.length === 0)
        return [J.NULL, J.NULL];
    if (modes.length === 1)
        return [J.str(modes[0]), synthetic];
    return [J.array(modes.map(J.str)), synthetic];
}
/** UTC as `YYYY-MM-DDTHH:MM:SSZ`, from seconds since 1970. */
function utc(unix) {
    const secs = Math.floor(unix);
    const days = Math.floor(secs / 86400);
    const rem = secs - days * 86400;
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const m = mp < 10 ? mp + 3 : mp - 9;
    const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    const two = (v) => String(v).padStart(2, "0");
    return `${String(y).padStart(4, "0")}-${two(m)}-${two(d)}T${two(Math.floor(rem / 3600))}:${two(Math.floor(rem / 60) % 60)}:${two(rem % 60)}Z`;
}
/** What changed between two readings of the instrument, in key order. */
function diff(before, after) {
    if (before.kind !== "object" || after.kind !== "object")
        return J.object([]);
    const keys = [...new Set([...before.entries.map(([k]) => k), ...after.entries.map(([k]) => k)])].sort(J.compareKeys);
    const out = [];
    for (const k of keys) {
        const x = J.field(before, k);
        const y = J.field(after, k);
        if (!J.pyEq(x, y))
            out.push([k, J.array([x, y])]);
    }
    return J.object(out);
}
/** The manifest, built as the library's `build_manifest` builds it. */
function build(label, device, setup, packets, regsBefore, regsAfter, protocol, params, extra, index, ticks, configAfter, finished, versions) {
    const s = site(setup.site);
    const layout = J.pop(extra, "electrode_layout");
    const place = J.pop(extra, "placement");
    const fs = ticks.length >= 2 ? fsFromTicks(ticks, device.tickHz) : fsFromPackets(packets, device.tickHz);
    const configBefore = J.field(extra, "config_before");
    const changed = J.truthy(regsBefore) && J.truthy(regsAfter)
        ? diff(regsBefore, regsAfter)
        : J.truthy(configBefore) && J.truthy(configAfter)
            ? diff(configBefore, configAfter)
            : J.object([]);
    const started = J.pop(extra, "started_utc");
    const opt = (v) => (v === null ? J.NULL : J.int(v));
    const m = J.object([
        ["manifest_version", J.int(MANIFEST_VERSION)],
        ["label", J.str(label)],
        ["started_utc", started],
        ["finished_utc", J.str(utc(finished))],
        ["captured_unix", J.float(finished)],
        ["device_id", J.str(device.deviceId)],
        ["firmware_version", J.str(device.firmware)],
        ["firmware_sha256", J.field(s, "firmware_sha256")],
        ["firmware_artifact", J.field(s, "firmware_artifact")],
        ["tick_hz", J.int(device.tickHz)],
        ["vref_uv", J.int(device.vrefUv)],
        ["adc_bits", opt(device.adcBits)],
        ["channels", opt(device.channels)],
        ["device_proto", device.protocol === null ? J.NULL : J.str(device.protocol)],
        ["board_revision", J.field(s, "board_revision")],
        ["electrode_montage", J.field(s, "electrode_montage")],
    ]);
    const placed = montageFields(s, device.channels, layout, place);
    if (placed.kind === "object")
        for (const [k, v] of placed.entries)
            J.set(m, k, v);
    const last = packets.length > 0 ? packets[packets.length - 1] : null;
    const [source, synthetic] = signalSource(packets);
    const git = setup.git ?? null;
    const pairs = [
        ["mains_hz", J.field(s, "mains_hz")],
        ["psu_volts", J.field(s, "psu_volts")],
        ["subject_id", J.field(s, "subject_id")],
        ["regs_before", regsBefore],
        ["regs_after", regsAfter],
        ["regs_diff", changed],
        ["config_after", configAfter],
        ["device_config_changed_by_run", J.bool(J.truthy(changed))],
        ["gain", last === null ? J.NULL : J.int(last.gain)],
        ["rate_sps", last === null || last.sampleRateHz === null ? J.NULL : J.int(last.sampleRateHz)],
        ["fs_effective", J.float(fs)],
        ["protocol_id", protocol],
        ["protocol_params", params],
        ["signal_chain", signalChain(setup)],
        ["signal_source", source],
        ["synthetic", synthetic],
        ["quality", gapLedger(index)],
        ["gaps_announced", J.int(device.gapsInRun)],
        ["clock", device.clock ?? J.NULL],
        ["git_commit", git === null || git.commit === null ? J.NULL : J.str(git.commit)],
        ["git_dirty", git === null || git.dirty === null ? J.NULL : J.bool(git.dirty)],
        ["host_versions", versions],
    ];
    for (const [k, v] of pairs)
        J.set(m, k, v);
    // A run's fields may add to the manifest. They may not erase a
    // measurement: a null never wins against a value the device gave.
    if (extra.kind === "object") {
        for (const [k, v] of extra.entries) {
            if (v.kind === "null" && J.field(m, k).kind !== "null")
                continue;
            J.set(m, k, v);
        }
    }
    return m;
}
/** A stage's kind in words, `kind N` for one the contract does not define. */
function kindName(kind) {
    switch (kind) {
        case 1:
            return "highpass";
        case 2:
            return "lowpass";
        case 3:
            return "notch";
        default:
            return `kind ${kind}`;
    }
}
/**
 * A processing chain in words, as the Python library says it in a manifest
 * and in a BDF or EDF header: `natural signal` for no stage, corners in
 * hertz, and the automatic low-pass at the rate it follows.
 */
export function describeChain(stages, rateSps = null) {
    if (stages.length === 0)
        return "natural signal";
    const hz = (dhz) => general(dhz / 10, 6);
    const words = [];
    for (const s of stages) {
        const p = s.params;
        if (s.kind === 1 && p.length >= 1) {
            words.push(`high-pass ${hz(p[0])} Hz`);
        }
        else if (s.kind === 2 && p.length >= 1 && p[0] !== 0) {
            words.push(`low-pass ${hz(p[0])} Hz`);
        }
        else if (s.kind === 2 && p.length >= 1) {
            words.push(rateSps !== null && rateSps !== 0
                ? `low-pass ${general(lowPassAutoDhz(rateSps) / 10, 6)} Hz (automatic at ${rateSps} SPS)`
                : "low-pass automatic");
        }
        else if (s.kind === 3 && p.length >= 2) {
            words.push(`notch ${hz(p[0])} to ${hz(p[1])} Hz`);
        }
        else {
            words.push(`${kindName(s.kind)} [${p.join(", ")}]`);
        }
    }
    return words.join(", ");
}
/** A chain in force as a manifest stores it: whose it is, its stages, and the chain in words at the rate given. */
function chainValue(state, rateSps) {
    const origin = state.origin === 0 ? "default" : state.origin === 1 ? "host" : `origin ${state.origin}`;
    return J.object([
        ["origin", J.str(origin)],
        [
            "stages",
            J.array(state.stages.map((s) => J.object([
                ["kind", J.int(s.kind)],
                ["name", J.str(kindName(s.kind))],
                ["params", J.array(s.params.map((x) => J.int(x)))],
            ]))),
        ],
        ["description", J.str(describeChain(state.stages, rateSps))],
    ]);
}
/**
 * What a recording stores as `processing`, the chain the device ran on the
 * signal, as the Python library reads it after a run: the chain in force at
 * the rate the device was set to, read from a device that claims a
 * processing chain, or the natural signal from one that does not. Null where
 * a device that claims one did not answer.
 */
export function processing(capable, state, rateSps) {
    if (!capable) {
        return J.object([
            ["origin", J.str("none")],
            ["stages", J.array([])],
            ["description", J.str("natural signal")],
        ]);
    }
    return state === null ? null : chainValue(state, rateSps);
}
const INDICATOR_NAMES = Object.fromEntries(Object.entries(INDICATOR_LEVELS).map(([name, level]) => [level, name]));
/**
 * What the device said it was set to, read after a run, as the Python
 * library reads it back: the status, which every device has, the lead-off
 * setting as last known, and then what the device claims: the chain in
 * force, the lamp's level, the model's cadence in seconds, and the name and
 * adjective it composes its name from. Pass null for what the device does
 * not claim.
 */
export function configAfter(status, leadoffSetting, pipeline = null, indicator = null, modelInterval = null, name = null) {
    const gain = GAIN_BY_CODE[status.gainCode];
    const rate = RATE_BY_CODE[status.rateCode] ?? null;
    const c = J.object([
        ["gain", gain === undefined ? J.NULL : J.int(gain)],
        ["rate_sps", rate === null ? J.NULL : J.int(rate)],
        ["mode", J.str(MODE_BY_CODE[status.mode] ?? `mode ${status.mode}`)],
        ["leadoff", leadoffSetting === null ? J.NULL : J.bool(leadoffSetting)],
        ["leadoff_status", J.int(status.loffStatp)],
    ]);
    if (pipeline !== null)
        J.set(c, "processing", chainValue(pipeline, rate));
    if (indicator !== null)
        J.set(c, "indicator", J.str(INDICATOR_NAMES[indicator] ?? `level ${indicator}`));
    if (modelInterval !== null) {
        J.set(c, "model_interval_s", J.int(modelInterval.intervalS));
        J.set(c, "model_interval_min_s", J.int(modelInterval.minimumS));
    }
    if (name !== null) {
        J.set(c, "name", J.str(name.name));
        J.set(c, "adjective", J.str(name.adjective));
        J.set(c, "composed_name", J.str(composeName(name.name, name.adjective)));
    }
    return c;
}
//# sourceMappingURL=record.js.map