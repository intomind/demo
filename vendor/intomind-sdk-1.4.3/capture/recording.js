/**
 * The recording every IntoMind program writes, read as the Python library
 * reads it.
 *
 * A recording is a set of files that share one name in a recordings folder:
 * `name.npz` with the samples, `name.meta.json` with the manifest,
 * `name.events.json` with the markers, `name.inputs.npz` when a controller
 * was recorded, and `name.sha256`, written last, with a checksum of each. The
 * Command Center, the Python library, the Rust crates and this package all
 * read this format, and docs.intomind.com/files.html states its promises.
 *
 * Reading follows the Python library's `analysis.load` exactly, including
 * the two corrections it makes in memory and never on disk: samples
 * delivered twice by two Bluetooth subscriptions, and sample times stretched
 * by an impossible clock fit. Each correction says what it did in
 * `Recording.repairs`.
 *
 * Nothing here reads a disk. A collection is handed the bytes of its files,
 * so the same code runs in a browser, where they came from a file picker or
 * from the recorder, and in Node, where `capture/node` reads them.
 */
import { sha256 } from "../digest.js";
import { CaptureError } from "./errors.js";
import * as npy from "./npy.js";
import { fixed, general, grouped, groupedFixed, numpyMean } from "./pyfmt.js";
import * as J from "./pyjson.js";
import * as zip from "./zip.js";
/**
 * Refuse a label that is not a plain name: letters, digits, dots, dashes and
 * underscores, starting with a letter or a digit, at most 128 characters,
 * and never `..`. A label becomes a file name, so this is checked wherever
 * one is joined to a path, as the Python library checks it.
 */
export function checkLabel(label) {
    const plain = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    let ok = label.length > 0 && label.length <= 128 && plain(label.charCodeAt(0));
    for (let k = 0; ok && k < label.length; k++) {
        const c = label.charCodeAt(k);
        ok = plain(c) || c === 0x2e || c === 0x5f || c === 0x2d;
    }
    if (!ok) {
        throw new CaptureError(`${J.reprStr(label)} is not a capture label. A label is letters, digits, dots, dashes and underscores, ` +
            "starts with a letter or a digit, and is at most 128 characters.");
    }
    if (label.includes(".."))
        throw new CaptureError(`${J.reprStr(label)} is not a capture label: it walks up a directory`);
    return label;
}
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** The hex sha256 of some bytes. */
function hexSha256(b) {
    let s = "";
    for (const x of sha256(b))
        s += x.toString(16).padStart(2, "0");
    return s;
}
/** Lines as Rust's `str::lines` splits them: at each line feed, a carriage return before it dropped, and no empty last line. */
function lines(text) {
    const out = text.split("\n");
    if (out.length > 0 && out[out.length - 1] === "")
        out.pop();
    return out.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}
/** A recordings folder, given as the bytes of its files. */
export class Collection {
    /** The folder, as messages name it. */
    dir;
    source;
    separator;
    /** A folder whose files are `files`: a map or object of file name to bytes, or a function answering a name with its bytes or null. */
    constructor(files, options = {}) {
        if (typeof files === "function")
            this.source = files;
        else if (files instanceof Map)
            this.source = (name) => files.get(name) ?? null;
        else
            this.source = (name) => (Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null);
        this.dir = options.dir ?? "";
        this.separator = options.separator ?? "/";
    }
    /** A file in the folder, as messages name it. */
    join(name) {
        if (this.dir === "")
            return name;
        return this.dir.endsWith(this.separator) ? this.dir + name : this.dir + this.separator + name;
    }
    /** The path of one of a recording's files, its label checked. */
    path(label, suffix) {
        return this.join(`${checkLabel(label)}${suffix}`);
    }
    /** The bytes of the file `name` in the folder, or null where there is none. */
    file(name) {
        return this.source(name);
    }
    /** A file read as text, or null where it is absent. A file that is not UTF-8 is refused, as Rust's `read_to_string` refuses it. */
    text(name) {
        const b = this.source(name);
        if (b === null)
            return null;
        try {
            return UTF8.decode(b);
        }
        catch {
            throw new CaptureError(`${this.join(name)}: stream did not contain valid UTF-8`);
        }
    }
    /** Hash lines checked against the files beside them. */
    checkLines(text) {
        const problems = [];
        for (const line of lines(text)) {
            if (J.trim(line) === "")
                continue;
            const rest = J.trimStart(line);
            let cut = 0;
            while (cut < rest.length && !J.isWhitespace(rest.charCodeAt(cut)))
                cut++;
            const want = rest.slice(0, cut);
            const name = cut < rest.length ? J.trim(rest.slice(cut + 1)) : "";
            // A name is a file in this folder. The Python library joins it to the
            // folder as it is, so a name that would leave the folder is a problem
            // here rather than a read somewhere else.
            const plain = name !== "" && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";
            const bytes = plain ? this.source(name) : null;
            if (bytes === null)
                problems.push(`missing: ${name}`);
            else if (hexSha256(bytes) !== want)
                problems.push(`CHECKSUM MISMATCH: ${name}`);
        }
        return problems;
    }
    /** The legacy ledger's lines for `label`: hashes taken after the fact for recordings made before checksums existed. */
    legacyLines(label) {
        let text;
        try {
            text = this.text("LEGACY.sha256");
        }
        catch {
            return null;
        }
        if (text === null)
            return null;
        const mine = [];
        for (const line of lines(text)) {
            if (J.trim(line) === "")
                continue;
            const rest = J.trimStart(line);
            let cut = 0;
            while (cut < rest.length && !J.isWhitespace(rest.charCodeAt(cut)))
                cut++;
            if (cut >= rest.length)
                continue;
            const name = J.trim(rest.slice(cut + 1));
            const dot = name.lastIndexOf(".");
            let l = dot >= 0 ? name.slice(0, dot) : name;
            for (const suffix of [".meta", ".events"])
                if (l.endsWith(suffix))
                    l = l.slice(0, -suffix.length);
            if (l === label)
                mine.push(line);
        }
        return mine.length > 0 ? mine.join("\n") : null;
    }
    /** Whether `label`'s bytes are the ones it was finalized with. */
    verify(label) {
        const cp = `${checkLabel(label)}.sha256`;
        const sums = this.text(cp);
        if (sums !== null) {
            const problems = this.checkLines(sums);
            return { ok: problems.length === 0, problems };
        }
        const why = this.aborted(label);
        if (why !== null)
            return { ok: false, problems: [`ABORTED (${why}): never finalized, do not analyze`] };
        const legacy = this.legacyLines(label);
        if (legacy !== null) {
            const problems = this.checkLines(legacy);
            if (problems.length > 0)
                return { ok: false, problems };
            return {
                ok: true,
                problems: [
                    "provenance incomplete: recorded before checksums existed; unchanged since it was marked, but its bytes " +
                        "at recording time were never attested",
                ],
            };
        }
        return { ok: true, problems: ["unverified: no checksum file, not marked (recorded before checksums were kept)"] };
    }
    /** Why the run was aborted, as its manifest says, or null. */
    aborted(label) {
        let text;
        try {
            text = this.text(`${checkLabel(label)}.meta.json`);
        }
        catch {
            return null;
        }
        if (text === null)
            return null;
        let v;
        try {
            v = J.loads(text);
        }
        catch {
            return null;
        }
        const why = J.get(v, "aborted");
        return why !== undefined && J.truthy(why) ? J.pyStr(why) : null;
    }
    /** `label`, verified, read, and corrected in memory where it was recorded by code with a defect since fixed. A recording that fails verification is refused. */
    load(label) {
        return this.loadWith(label, true, true);
    }
    /** `label` exactly as it is on disk: verified, but with no correction. */
    loadAsRecorded(label) {
        return this.loadWith(label, true, false);
    }
    loadWith(label, verify, repair) {
        if (verify) {
            const v = this.verify(label);
            if (!v.ok) {
                const list = J.array(v.problems.map(J.str));
                throw new CaptureError(`${label}: integrity check FAILED: ${J.pyRepr(list)}`);
            }
        }
        const npzName = `${checkLabel(label)}.npz`;
        const bytes = this.source(npzName);
        if (bytes === null)
            throw new CaptureError(`${this.join(npzName)}: No such file or directory (os error 2)`);
        let arrays;
        try {
            arrays = readNpz(bytes);
        }
        catch (e) {
            throw new CaptureError(`${this.join(npzName)}: ${e.message}`);
        }
        const metaName = `${label}.meta.json`;
        const manifestText = this.text(metaName);
        if (manifestText === null)
            throw new CaptureError(`${this.join(metaName)}: No such file or directory (os error 2)`);
        let meta;
        try {
            meta = J.loads(manifestText);
        }
        catch (e) {
            throw new CaptureError(`${this.join(metaName)}: ${e.message}`);
        }
        const take = (name) => {
            const at = arrays.findIndex(([n]) => n === name);
            if (at < 0)
                return null;
            const [, a] = arrays.splice(at, 1)[0];
            return a;
        };
        let counts = take("counts");
        if (counts === null)
            throw new CaptureError(`${label}: the recording has no 'counts'`);
        const index = take("index");
        if (index === null)
            throw new CaptureError(`${label}: the recording has no 'index'`);
        const hostTime = take("host_time");
        if (hostTime === null)
            throw new CaptureError(`${label}: the recording has no 'host_time'`);
        const deviceTicks = take("device_ticks");
        const leadoff = take("leadoff");
        const gapBefore = take("gap_before");
        const leadoffActive = take("leadoff_active");
        // A recorder armed and stopped before a packet came keeps its counts as
        // one empty list, which the library reads as no channels.
        if (counts.shape.length === 1 && counts.shape[0] === 0)
            counts = { shape: [0, 0], fortran: false, data: counts.data };
        if (counts.shape.length !== 2)
            throw new CaptureError(`${label}: the counts are not channels by samples`);
        const parts = { counts, index, hostTime, deviceTicks, leadoff, gapBefore, leadoffActive, meta, manifestText };
        const repairs = [];
        if (repair) {
            dedupeDelivery(label, parts, repairs);
            repinClock(parts, repairs);
        }
        return new Recording(label, parts, repairs);
    }
}
/** The arrays of an `.npz`, by name, without the `.npy` suffix. */
export function readNpz(bytes) {
    const members = zip.read(bytes);
    const out = [];
    for (const [name, data] of members) {
        const key = name.endsWith(".npy") ? name.slice(0, -4) : name;
        let a;
        try {
            a = npy.read(data);
        }
        catch (e) {
            throw new CaptureError(`${name}: ${e.message}`);
        }
        out.push([key, a]);
    }
    return out;
}
const PARTS = new WeakMap();
/** What a recording is made of, for the writers in this package. */
export function partsOf(r) {
    return PARTS.get(r);
}
/** One recording in memory: the converter's counts for every channel, each sample's index and clocks and marks, and the manifest that explains them. */
export class Recording {
    /** The recording's name. */
    label;
    fixes;
    /** A recording named `label` made of `parts`, with what reading corrected. `Collection.load` makes one. */
    constructor(label, parts, repairs = []) {
        this.label = label;
        this.fixes = [...repairs];
        PARTS.set(this, parts);
    }
    get parts() {
        return PARTS.get(this);
    }
    /** How many channels it holds. */
    get channels() {
        return this.parts.counts.shape[0];
    }
    /** How many samples it holds, counted on the counts, which are the record. */
    get samples() {
        return this.parts.counts.shape[1];
    }
    /** Channel `c`'s counts, as the converter gave them. */
    counts(c) {
        const rows = npy.rowIndices(this.parts.counts, c);
        const out = new BigInt64Array(rows.length);
        for (let k = 0; k < rows.length; k++)
            out[k] = npy.i64At(this.parts.counts.data, rows[k]);
        return out;
    }
    /** Each sample's index, as the device numbered it. */
    get index() {
        return i64s(this.parts.index);
    }
    /** Each sample's time on this computer's clock, in seconds. */
    get hostTime() {
        return f64s(this.parts.hostTime);
    }
    /** Each sample's time on the device's clock, in its ticks, when the recording kept it. */
    get deviceTicks() {
        return this.parts.deviceTicks === null ? null : i64s(this.parts.deviceTicks);
    }
    /** The lead-off byte that arrived with each sample, one bit per electrode, when the recording kept it. */
    get leadoff() {
        const a = this.parts.leadoff;
        if (a === null)
            return null;
        const out = new Uint8Array(npy.len(a.data));
        for (let k = 0; k < out.length; k++)
            out[k] = Number(BigInt.asUintN(8, npy.i64At(a.data, k)));
        return out;
    }
    /** Whether each sample is the first after a break in the timeline, when the recording kept it. */
    get gapBefore() {
        return this.parts.gapBefore === null ? null : bools(this.parts.gapBefore);
    }
    /** Whether lead-off detection was running at each sample. Null for a recording made before this was kept, which cannot say whether contact was checked at all. */
    get leadoffActive() {
        return this.parts.leadoffActive === null ? null : bools(this.parts.leadoffActive);
    }
    /** The manifest, as its file holds it. */
    get manifestJson() {
        return this.parts.manifestText;
    }
    /** The manifest, as Python reads it. */
    get manifest() {
        return this.parts.meta;
    }
    /** What reading had to correct, in sentences. Empty for every recording made by code with the fixes in it. */
    get repairs() {
        return [...this.fixes];
    }
    /** Whether the device generated this signal rather than measuring it. */
    get synthetic() {
        return J.truthy(J.field(this.parts.meta, "synthetic"));
    }
    /**
     * The effective sample rate. The manifest's `fs_effective`, unless it
     * disagrees with the host clock by more than five percent, which a
     * recording whose index reset before the fix did, and then the host
     * clock's.
     */
    get fs() {
        const stored = J.field(this.parts.meta, "fs_effective");
        const fs = J.truthy(stored) ? (J.asF64(stored) ?? 0) : 0;
        const ht = this.parts.hostTime.data;
        const n = npy.len(ht);
        if (n > 1) {
            const first = npy.f64At(ht, 0);
            const last = npy.f64At(ht, n - 1);
            if (last > first) {
                const fsHt = (n - 1) / (last - first);
                if (fs <= 0 || Math.abs(fs - fsHt) / fsHt > 0.05)
                    return fsHt;
            }
        }
        return fs;
    }
    /** Microvolts per count, from what the device said: its reference, its gain and its converter's width. A manifest that does not record the width, which version 1 does not, cannot be converted. */
    get lsbUv() {
        const meta = this.parts.meta;
        const bits = J.field(meta, "adc_bits");
        if (!J.truthy(bits)) {
            const l = J.get(meta, "label");
            const who = l !== undefined ? J.pyStr(l) : "this capture";
            throw new CaptureError(`${who} does not record adc_bits, so the microvolts it holds cannot be computed. ` +
                "Manifests from version 2 onward record it.");
        }
        if (bits.kind !== "int")
            throw new CaptureError("adc_bits is not a whole number");
        if (!/^\d+$/.test(bits.value) || BigInt(bits.value) > 0xffffffffn) {
            throw new CaptureError("adc_bits is not a converter width");
        }
        const b = Number(bits.value);
        const vrefV = J.get(meta, "vref_uv");
        const vref = vrefV === undefined ? null : J.asF64(vrefV);
        if (vref === null)
            throw new CaptureError("the manifest has no vref_uv");
        const gain = J.get(meta, "gain");
        if (gain === undefined)
            throw new CaptureError("the manifest has no gain");
        const scale = 2 ** b;
        let denom;
        if (gain.kind === "int") {
            // An integer product, exact, then one conversion, as Python's `gain * (1 << bits)` is.
            denom = Number(BigInt(gain.value) * (1n << BigInt(b)));
        }
        else if (gain.kind === "float") {
            denom = gain.value * scale;
        }
        else if (gain.kind === "bool") {
            denom = (gain.value ? 1 : 0) * scale;
        }
        else {
            throw new CaptureError("gain is not a number");
        }
        return (2 * vref) / denom;
    }
    /** Channel `c` in microvolts: its counts times `lsbUv`. */
    uv(c) {
        const lsb = this.lsbUv;
        const rows = npy.rowIndices(this.parts.counts, c);
        const d = this.parts.counts.data;
        const out = new Float64Array(rows.length);
        for (let k = 0; k < rows.length; k++)
            out[k] = npy.f64At(d, rows[k]) * lsb;
        return out;
    }
}
/**
 * Two subscriptions on one device deliver every packet twice, and an old
 * recorder stored each copy. The signature is exact: a device time
 * repeated with every channel's count the same. Copies are removed, the
 * first arrival kept, and the marks go with their samples.
 */
function dedupeDelivery(label, p, fixes) {
    const ticks = p.deviceTicks;
    if (ticks === null)
        return;
    const n = npy.len(ticks.data);
    if (n < 2)
        return;
    const t = new BigInt64Array(n);
    for (let k = 0; k < n; k++)
        t[k] = npy.i64At(ticks.data, k);
    // Increasing throughout, the case of every recording since the fix: nothing repeats.
    let increasing = true;
    for (let k = 1; k < n && increasing; k++)
        increasing = t[k] > t[k - 1];
    if (increasing)
        return;
    const order = Array.from({ length: n }, (_, k) => k);
    order.sort((a, b) => (t[a] < t[b] ? -1 : t[a] > t[b] ? 1 : a - b));
    // The first arrival of each device time, and which first each sample repeats.
    const firstOf = new Int32Array(n);
    const firsts = [];
    for (let k = 0; k < n;) {
        const f = order[k];
        firsts.push(f);
        let j = k;
        while (j < n && t[order[j]] === t[f]) {
            firstOf[order[j]] = f;
            j++;
        }
        k = j;
    }
    if (firsts.length === n)
        return;
    const nExtra = n - firsts.length;
    const nch = p.counts.shape[0];
    const rows = Array.from({ length: nch }, (_, c) => npy.rowIndices(p.counts, c));
    let same = true;
    for (let i = 0; i < n && same; i++) {
        for (const r of rows) {
            if (npy.i64At(p.counts.data, r[i]) !== npy.i64At(p.counts.data, r[firstOf[i]])) {
                same = false;
                break;
            }
        }
    }
    if (!same) {
        fixes.push(`${grouped(nExtra)} samples repeat a device time with DIFFERENT counts behind it. Not duplicate delivery, ` +
            "and not something this can correct: the sample stream is unusable as a timeline.");
        return;
    }
    const keep = [...firsts].sort((a, b) => a - b);
    for (let k = 1; k < keep.length; k++) {
        if (!(t[keep[k]] > t[keep[k - 1]])) {
            fixes.push(`${grouped(nExtra)} duplicated samples, and removing them still does not leave the device clock increasing.`);
            return;
        }
    }
    // `round(x, 3)`: the exact value rounded half to even at three places.
    const dupes = Number(fixed(n / firsts.length, 3));
    const lists = [
        [p.index, "index"],
        [p.hostTime, "host_time"],
        [p.leadoff, "leadoff"],
        [p.gapBefore, "gap_before"],
        [p.leadoffActive, "leadoff_active"],
    ];
    for (const [a, what] of lists) {
        if (a !== null && npy.len(a.data) < n) {
            throw new CaptureError(`${label}: ${what} is shorter than the samples, so its copies cannot be removed`);
        }
    }
    // The counts, channels by samples, kept in the order they were stored.
    const cols = keep.length;
    const kept = new Int32Array(nch * cols);
    let at = 0;
    if (p.counts.fortran) {
        for (const i of keep)
            for (const r of rows)
                kept[at++] = r[i];
    }
    else {
        for (const r of rows)
            for (const i of keep)
                kept[at++] = r[i];
    }
    p.counts = { shape: [nch, cols], fortran: p.counts.fortran && nch > 1, data: npy.take(p.counts.data, kept) };
    const takeKept = (a) => npy.vector(npy.take(a.data, keep));
    p.index = takeKept(p.index);
    p.hostTime = takeKept(p.hostTime);
    p.deviceTicks = takeKept(ticks);
    p.leadoff = p.leadoff === null ? null : takeKept(p.leadoff);
    p.gapBefore = p.gapBefore === null ? null : takeKept(p.gapBefore);
    p.leadoffActive = p.leadoffActive === null ? null : takeKept(p.leadoffActive);
    fixes.push(`every packet was delivered ${general(dupes, 6)} times over, so ${grouped(nExtra)} of ${grouped(n)} samples ` +
        `were copies. Removed: ${grouped(cols)} samples remain. (Two BLE subscriptions were open on the instrument ` +
        "at once.)");
}
/**
 * A clock fitted at a skew no pair of oscillators can have stretched every
 * sample time. Where the recording kept the sync exchanges, the times are
 * restamped from the device clock with the skew pinned at one, exactly as
 * the Python library restamps them.
 */
function repinClock(p, fixes) {
    const clock = J.get(p.meta, "clock");
    const c = clock !== undefined && J.truthy(clock) ? clock : J.object([]);
    const skewV = J.field(c, "skew");
    if (!J.truthy(skewV))
        return;
    const skew = J.asF64(skewV);
    if (skew === null)
        return;
    if (Math.abs(skew - 1) * 1e6 <= 5000)
        return;
    const ppm = Math.abs(skew - 1) * 1e6;
    const offV = J.field(c, "offset");
    const anchorsV = J.field(c, "anchors");
    const anchors = anchorsV.kind === "array" ? anchorsV.items : [];
    const tickV = J.field(p.meta, "tick_hz");
    if (offV.kind === "null" || anchors.length < 2 || !J.truthy(tickV) || p.deviceTicks === null) {
        fixes.push(`the clock was fitted at skew ${fixed(skew, 4)} (${groupedFixed(ppm, 0)} ppm), which no pair of oscillators ` +
            "can do, and this capture does not carry the exchanges needed to refit it. Every sample time is " +
            "stretched by that factor. Counts are unaffected.");
        return;
    }
    const off = J.asF64(offV);
    const tickHz = J.asF64(tickV);
    if (off === null || tickHz === null)
        return;
    const pair = (a, i) => {
        if (a.kind !== "array")
            return NaN;
        const x = a.items[i];
        return x === undefined ? NaN : (J.asF64(x) ?? NaN);
    };
    const real = anchors.map((a) => pair(a, 0));
    const mono = anchors.map((a) => pair(a, 1));
    const dev = mono.map((m) => (m - off) / skew);
    // numpy's argmin takes the first of equal minima, and a NaN wins.
    let at = 0;
    for (let i = 0; i < mono.length; i++) {
        if (Number.isNaN(mono[i])) {
            at = i;
            break;
        }
        if (mono[i] < mono[at])
            at = i;
    }
    const frame = real[at] - mono[at];
    const shift = numpyMean(mono) - numpyMean(dev);
    const td = p.deviceTicks.data;
    const ht = new Float64Array(npy.len(td));
    for (let i = 0; i < ht.length; i++)
        ht[i] = npy.f64At(td, i) / tickHz + shift + frame;
    const span = ht.length === 0 ? 0 : ht[ht.length - 1] - ht[0];
    const spanV = J.field(c, "span_s");
    const baseline = J.truthy(spanV) ? (J.asF64(spanV) ?? 0) : 0;
    p.hostTime = npy.vector({ kind: "f8", values: ht });
    fixes.push(`the clock was fitted at skew ${fixed(skew, 4)} (${groupedFixed(ppm, 0)} ppm) over a ${fixed(baseline, 2)} s ` +
        "baseline, stretching every sample time by that factor. Restamped from the device clock with the skew " +
        `pinned at 1.0; the samples now span ${groupedFixed(span, 0)} s.`);
}
function i64s(a) {
    const n = npy.len(a.data);
    const out = new BigInt64Array(n);
    for (let k = 0; k < n; k++)
        out[k] = npy.i64At(a.data, k);
    return out;
}
function f64s(a) {
    const n = npy.len(a.data);
    const out = new Float64Array(n);
    for (let k = 0; k < n; k++)
        out[k] = npy.f64At(a.data, k);
    return out;
}
function bools(a) {
    const n = npy.len(a.data);
    const out = new Array(n);
    for (let k = 0; k < n; k++)
        out[k] = npy.boolAt(a.data, k);
    return out;
}
//# sourceMappingURL=recording.js.map