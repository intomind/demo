/**
 * Six ways out of a recording, each written as the Python library writes
 * it, with the same summary.
 *
 * Every summary carries the same keys, `label`, `format`, `channels`,
 * `samples` and `sample_rate_hz`, and then what that format cost on the
 * file just written. Written to a file by `capture/node`, it carries the
 * file's `path` too. A recording that fails verification is not exported at
 * all. An export can always be made again, and the recording it came from
 * cannot.
 *
 * `bdf`, `edf`, `csv` and `tsv` are byte for byte the files the Python
 * library writes from the same recording. `npz` and `mat` hold the same
 * arrays and fields, and differ only in what their containers stamp: the
 * time a member was written, and the order a library lays out its records.
 * The fixtures in `contract/recordings` hold both claims.
 */
import * as edf from "./edf.js";
import { CaptureError } from "./errors.js";
import * as hdf5 from "./hdf5.js";
import * as npy from "./npy.js";
import { fixed } from "./pyfmt.js";
import * as J from "./pyjson.js";
import { checkLabel, partsOf } from "./recording.js";
import * as zip from "./zip.js";
/** Every format, in the order a program may offer them: the record first, then the two clinical containers, then text, then MATLAB. */
export const FORMATS = ["npz", "edf", "bdf", "csv", "tsv", "mat"];
/** Channels the lead-off status covers: one byte per packet, one bit per channel. */
const LEADOFF_CHANNELS = 8;
/** The format a name means, or a refusal naming the ones that exist. */
export function formatOf(format) {
    const name = J.trim(format).toLowerCase().replace(/^\.+/, "");
    if (!FORMATS.includes(name)) {
        throw new CaptureError(`unknown export format ${J.reprStr(format)}. Known formats: ${FORMATS.join(", ")}`);
    }
    return name;
}
/** The file name an export of `label` as `format` takes. */
export function fileName(label, format) {
    return `${checkLabel(label)}.${format}`;
}
/**
 * Export `label` from `collection` as `format`. Refused, as the Python
 * library refuses it, when the recording fails verification, cannot be
 * read, or cannot be written in that format.
 */
export function exportRecording(collection, label, format, options = {}) {
    const name = formatOf(format);
    // Refuse, then load, in that order.
    const v = collection.verify(label);
    if (!v.ok)
        throw new CaptureError(`refusing to export ${label}: ${v.problems.join("; ")}`);
    const cap = collection.load(label);
    // A recording with no samples has nothing any format can hold.
    if (cap.samples === 0 || cap.channels === 0)
        throw new CaptureError(`refusing to export ${label}: it holds no samples`);
    const now = options.now ?? Math.floor(Date.now() / 1000);
    let out;
    switch (name) {
        case "npz":
            out = exportNpz(cap, v.problems, now);
            break;
        case "edf":
            out = exportEdfFamily(collection, cap, v.problems, edf.EDF);
            break;
        case "bdf":
            out = exportEdfFamily(collection, cap, v.problems, edf.BDF);
            break;
        case "csv":
            out = exportDelimited(cap, v.problems, "csv", ",");
            break;
        case "tsv":
            out = exportDelimited(cap, v.problems, "tsv", "\t");
            break;
        case "mat":
            out = exportMat(cap, v.problems, now);
            break;
    }
    const [bytes, summaryValue] = out;
    return {
        bytes,
        format: name,
        summary: J.toPlain(summaryValue),
        summaryJson: J.dumpsSorted(summaryValue),
        summaryValue,
    };
}
/** The keys every format answers with, and the problems verification reported, then the format's own. */
function summary(cap, fmt, samples, problems, extra) {
    return J.object([
        ["label", J.str(cap.label)],
        ["format", J.str(fmt)],
        ["channels", J.int(cap.channels)],
        ["samples", J.int(samples)],
        ["sample_rate_hz", J.float(cap.fs)],
        ["provenance_problems", strs(problems)],
        ...extra,
    ]);
}
function strs(xs) {
    return J.array(xs.map(J.str));
}
function column(cap, c) {
    return cap.synthetic ? `ch${c + 1}_synthetic_uv` : `ch${c + 1}_uv`;
}
/**
 * Every per-sample array except the microvolts, each only where it lines up
 * with `n` samples, and a sentence for each one left out. A recording made
 * before detection was kept has no `leadoff_active`, and `contact` says so
 * instead of a sentence here.
 */
function perSample(cap, n) {
    const p = partsOf(cap);
    const found = [];
    const omitted = [];
    const all = [
        ["index", p.index],
        ["device_ticks", p.deviceTicks],
        ["host_time", p.hostTime],
        ["leadoff", p.leadoff],
        ["gap_before", p.gapBefore],
        ["leadoff_active", p.leadoffActive],
    ];
    for (const [name, a] of all) {
        if (a === null) {
            if (name !== "leadoff_active")
                omitted.push(`${name}: the capture does not carry it`);
            continue;
        }
        const got = a.shape.length === 0 ? 0 : a.shape[0];
        if (a.shape.length === 0 || got !== n) {
            omitted.push(`${name}: ${got} values for ${n} samples, so it cannot be lined up with them`);
        }
        else {
            found.push([name, a]);
        }
    }
    return [found, omitted];
}
function find(found, name) {
    return found.find(([k]) => k === name)?.[1] ?? null;
}
/** Whether electrode contact was checked: "checked", "partly checked", "not checked", or "not known" where the recording does not say whether detection was running. */
function contactState(leadoff, active) {
    if (leadoff === null || active === null)
        return "not known";
    const n = npy.len(active);
    let on = 0;
    for (let k = 0; k < n; k++)
        if (npy.boolAt(active, k))
            on++;
    if (on === 0)
        return "not checked";
    return on === n ? "checked" : "partly checked";
}
/** Decimal places that carry one count with room to spare. */
function decimals(lsbUv) {
    if (lsbUv <= 0 || !Number.isFinite(lsbUv))
        return 6;
    return Math.min(Math.max(Math.ceil(-Math.log10(lsbUv / 100)), 3), 12);
}
function uvAll(cap) {
    const out = [];
    for (let c = 0; c < cap.channels; c++)
        out.push(cap.uv(c));
    return out;
}
// ---------------------------------------------------------------- npz
function exportNpz(cap, problems, now) {
    const n = cap.samples;
    const uv = uvAll(cap);
    const arrays = [];
    uv.forEach((u, c) => arrays.push([column(cap, c), npy.vector({ kind: "f4", values: Float32Array.from(u) })]));
    const [found, omitted] = perSample(cap, n);
    for (const [name, a] of found)
        arrays.push([name, a]);
    arrays.push(["manifest_json", npy.text(J.dumpsSorted(cap.manifest))]);
    const members = arrays.map(([k, a]) => [`${k}.npy`, npy.write(a)]);
    const bytes = zip.write(members, now);
    const lsb = cap.lsbUv;
    let err = 0;
    uv.forEach((u, c) => {
        const stored = arrays[c][1].data.values;
        let worst = -Infinity;
        let nan = false;
        for (let k = 0; k < u.length; k++) {
            const e = Math.abs(stored[k] - u[k]);
            if (Number.isNaN(e))
                nan = true;
            else if (e > worst)
                worst = e;
        }
        const w = n === 0 ? 0 : nan ? NaN : worst;
        if (w > err)
            err = w;
    });
    const recovered = err < 0.5 * lsb;
    const names = arrays.map(([k]) => k).sort();
    return [
        bytes,
        summary(cap, "npz", n, problems, [
            ["lossy", J.bool(!recovered)],
            ["counts_recovered", J.bool(recovered)],
            ["max_error_uv", J.float(err)],
            ["lsb_uv", J.float(lsb)],
            ["omitted", strs(omitted)],
            ["arrays", strs(names)],
            ["contact", J.str(contactState(find(found, "leadoff")?.data ?? null, find(found, "leadoff_active")?.data ?? null))],
        ]),
    ];
}
// ---------------------------------------------------------------- csv, tsv
function exportDelimited(cap, problems, fmt, d) {
    const n = cap.samples;
    const nch = cap.channels;
    const uv = uvAll(cap);
    const lsb = cap.lsbUv;
    const dec = decimals(lsb);
    const [found, omitted] = perSample(cap, n);
    const host = find(found, "host_time")?.data ?? null;
    const ticks = find(found, "device_ticks")?.data ?? null;
    const byte = find(found, "leadoff")?.data ?? null;
    const active = find(found, "leadoff_active")?.data ?? null;
    const checked = contactState(byte, active);
    const off = checked === "checked" || checked === "partly checked" ? Math.min(nch, LEADOFF_CHANNELS) : 0;
    const header = ["host_time_s", "device_time"];
    for (let c = 0; c < nch; c++)
        header.push(column(cap, c));
    for (let c = 0; c < off; c++)
        header.push(`ch${c + 1}_leadoff`);
    const rows = [header.join(d)];
    for (let i = 0; i < n; i++) {
        let row = host === null ? "" : fixed(npy.f64At(host, i), 6);
        row += d;
        if (ticks !== null)
            row += npy.i64At(ticks, i).toString();
        for (const u of uv)
            row += d + fixed(u[i], dec);
        for (let c = 0; c < off; c++) {
            row += d;
            if (npy.boolAt(active, i))
                row += ((npy.i64At(byte, i) >> BigInt(c)) & 1n).toString();
        }
        rows.push(row);
    }
    const bytes = new TextEncoder().encode(rows.join("\n") + "\n");
    const resolution = Number(`1e-${dec}`);
    const recovered = resolution / 2 < 0.5 * lsb;
    const kept = omitted.filter((o) => o.startsWith("host_time") || o.startsWith("device_ticks"));
    return [
        bytes,
        summary(cap, fmt, n, problems, [
            ["delimiter", J.str(d)],
            ["decimals", J.int(dec)],
            ["resolution_uv", J.float(resolution)],
            ["lsb_uv", J.float(lsb)],
            ["counts_recovered", J.bool(recovered)],
            ["lossy", J.bool(!recovered)],
            ["omitted", strs(kept)],
            ["contact", J.str(checked)],
        ]),
    ];
}
// ---------------------------------------------------------------- edf, bdf
/** What made this recording, in the words its manifest carries. */
function deviceOf(meta) {
    for (const k of ["device_name", "device_id"]) {
        const v = J.field(meta, k);
        if (J.truthy(v))
            return J.pyStr(v);
    }
    return "unknown device";
}
function take80(s) {
    let out = "";
    let k = 0;
    for (const c of s) {
        if (k++ >= 80)
            break;
        out += c;
    }
    return out;
}
function prefilterOf(meta) {
    const proc = J.field(meta, "processing");
    if (proc.kind === "object") {
        const d = J.field(proc, "description");
        if (J.truthy(d))
            return take80(J.pyStr(d));
    }
    const sig = J.field(meta, "signal");
    if (sig.kind === "null" || (sig.kind === "str" && (sig.value === "" || sig.value === "raw"))) {
        return "none (natural signal)";
    }
    return take80(J.pyStr(sig));
}
function transducerOf(meta) {
    const m = J.field(meta, "montage");
    if (!J.truthy(m))
        return "";
    if (m.kind !== "object")
        throw new CaptureError("the manifest's montage is not an object");
    const e = J.field(m, "electrode");
    return J.truthy(e) ? J.pyStr(e) : "";
}
function exportEdfFamily(collection, cap, problems, w) {
    const fmt = w.sampleBytes === 2 ? "edf" : "bdf";
    const label = cap.label;
    const fs = cap.fs;
    if (fs <= 0) {
        throw new CaptureError(`refusing to export ${label} as ${fmt.toUpperCase()}: the capture states no sample rate, and this container ` +
            "places every sample by rate");
    }
    const meta = cap.manifest;
    const start = edf.startOf(J.asStr(J.field(meta, "started_utc")));
    // A recording that armed before its count was reset begins with samples
    // from before it, and the file starts at the reset.
    const index = cap.index;
    const fsRound = Number.isFinite(fs) ? Math.max(1, edf.roundHalfEven(fs)) : 1;
    let lastBack = -1;
    for (let i = index.length - 1; i >= 1; i--) {
        if (index[i] - index[i - 1] < 1n) {
            lastBack = i;
            break;
        }
    }
    const skip = lastBack >= 0 && lastBack < fsRound ? lastBack : 0;
    const events = [];
    let eventsText = null;
    const eventsBytes = collection.file(`${checkLabel(label)}.events.json`);
    if (eventsBytes !== null) {
        try {
            eventsText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(eventsBytes);
        }
        catch {
            eventsText = null;
        }
    }
    if (eventsText !== null) {
        let raw;
        try {
            raw = J.loads(eventsText);
        }
        catch (e) {
            throw new CaptureError(`${label}.events.json: ${e.message}`);
        }
        const host = cap.hostTime;
        const t0 = host.length === 0 ? 0 : host[skip];
        if (raw.kind === "array") {
            for (const e of raw.items) {
                const ht = J.get(e, "host_time");
                if (ht === undefined)
                    continue;
                const t = J.asF64(ht);
                if (t === null)
                    throw new CaptureError(`${label}: an event's host_time is not a number`);
                const cond = J.get(e, "cond");
                const kind = J.get(e, "kind");
                const text = cond !== undefined ? J.pyStr(cond) : kind !== undefined ? J.pyStr(kind) : "";
                events.push({ t: t - t0, label: text });
            }
        }
    }
    const synthetic = J.truthy(J.field(meta, "synthetic"));
    const labelOf = (c) => (synthetic ? `ch${c + 1} synthetic` : `ch${c + 1}`);
    const uv = uvAll(cap);
    const signals = uv.map((u, c) => [labelOf(c), u.slice(Math.min(skip, u.length))]);
    // Lead-off, labeled only where detection was running.
    const [found] = perSample(cap, index.length);
    const byteA = find(found, "leadoff");
    const activeA = find(found, "leadoff_active");
    const byte = byteA === null ? null : npy.skip(byteA.data, skip);
    const active = activeA === null ? null : npy.skip(activeA.data, skip);
    const checked = contactState(byte, active);
    const stretches = [];
    if (checked === "checked" || checked === "partly checked") {
        const b = byte;
        const a = active;
        const m = npy.len(a);
        for (let c = 0; c < Math.min(cap.channels, LEADOFF_CHANNELS); c++) {
            const flags = new Array(m);
            for (let i = 0; i < m; i++)
                flags[i] = npy.boolAt(a, i) && ((npy.i64At(b, i) >> BigInt(c)) & 1n) !== 0n;
            stretches.push([`${edf.LEADOFF_LABEL} ${labelOf(c)}`, flags]);
        }
        if (checked === "partly checked") {
            const flags = new Array(m);
            for (let i = 0; i < m; i++)
                flags[i] = !npy.boolAt(a, i);
            stretches.push([edf.NOT_CHECKED_LABEL, flags]);
        }
    }
    const revV = J.get(meta, "board_revision");
    const rev = revV === undefined ? "unknown" : J.pyStr(revV);
    const recBits = J.field(meta, "adc_bits");
    const bits = w.sampleBytes === 2 ? 16 : 24;
    let note = "";
    if (J.truthy(recBits)) {
        const rb = J.asI64(recBits);
        if (rb === null)
            throw new CaptureError("adc_bits is not a whole number");
        if (BigInt(bits) < rb)
            note = " lossy";
    }
    const generated = synthetic ? "SYNTHETIC, not measured: " : "";
    const recording = `${generated}${deviceOf(meta)} ${rev} ${bits}-bit${note}; raw record is ${label}.npz`;
    const prefilter = prefilterOf(meta);
    const transducer = transducerOf(meta);
    const idx = index.slice(Math.min(skip, index.length));
    const [bytes, info] = edf.write({
        signals,
        fs,
        start,
        index: idx,
        events,
        patient: "X X X X",
        recording,
        prefilter,
        transducer,
        stretches,
    }, w);
    const lsb = cap.lsbUv;
    const recovered = info.maxErrorUv < 0.5 * lsb;
    let offStretches = 0;
    for (const [k, v] of info.stretchCounts)
        if (k.startsWith(edf.LEADOFF_LABEL))
            offStretches += v;
    return [
        bytes,
        summary(cap, fmt, info.samplesWritten, problems, [
            ["lossy", J.bool(bits === 16 ? true : !recovered)],
            ["counts_recovered", J.bool(recovered)],
            ["max_error_uv", J.float(info.maxErrorUv)],
            ["quantum_uv", J.float(info.quantumUv)],
            ["lsb_uv", J.float(lsb)],
            ["bits", J.int(bits)],
            ["family", J.str(w.family)],
            ["continuity", J.str(info.continuity)],
            ["samples_dropped", J.int(0)],
            ["samples_filled", J.int(info.samplesFilled)],
            ["gaps", J.int(info.gaps)],
            ["tail_filled", J.int(info.tailFilled)],
            ["contact", J.str(checked)],
            ["electrode_off_stretches", J.int(offStretches)],
            ["samples_before_restart", J.int(skip)],
            ["n_annotations", J.int(info.nAnnotations)],
        ]),
    ];
}
// ---------------------------------------------------------------- mat
/** Python's `sys.platform` for where this runs: Node's own name, which is the same, or `browser`. */
function platform() {
    const p = globalThis.process?.platform;
    return typeof p === "string" && p !== "" ? p : "browser";
}
/** The 128 bytes MATLAB reads before the HDF5 data: a description, the subsystem offset, the version and the byte order mark, as the Python library writes them. */
function matHeader(unix) {
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const t = new Date(unix * 1000);
    const two = (v) => String(v).padStart(2, "0");
    const when = `${DAYS[t.getUTCDay()]} ${MONTHS[t.getUTCMonth()]} ${two(t.getUTCDate())} ` +
        `${two(t.getUTCHours())}:${two(t.getUTCMinutes())}:${two(t.getUTCSeconds())} ${t.getUTCFullYear()}`;
    const text = `MATLAB 7.3 MAT-file, Platform: ${platform()}, Created on: ${when} HDF5 schema 1.00 .`;
    const h = new Uint8Array(128).fill(0x20);
    let k = 0;
    for (const c of text) {
        if (k >= 116)
            break;
        const code = c.codePointAt(0);
        h[k++] = code < 0x80 ? code : 0x3f;
    }
    h.fill(0, 116, 124);
    h.set([0x00, 0x02, 0x49, 0x4d], 124);
    return h;
}
/** One MATLAB variable from one array, as the Python library writes it: a boolean as `logical`, a type MATLAB names by its own name, and anything else as `double`. */
function matVariable(name, dims, data) {
    const plain = (elem, cls) => ({
        name,
        dims,
        elem,
        data: npy.bytesOf(data),
        matlabClass: cls,
        intDecode: null,
    });
    switch (data.kind) {
        case "b1":
            return { name, dims, elem: "u8", data: npy.bytesOf(data), matlabClass: "logical", intDecode: 1 };
        case "u1":
            return plain("u8", "uint8");
        case "u2":
            return plain("u16", "uint16");
        case "u4":
            return plain("u32", "uint32");
        case "u8":
            return plain("u64", "uint64");
        case "i2":
            return plain("i16", "int16");
        case "i4":
            return plain("i32", "int32");
        case "i8":
            return plain("i64", "int64");
        case "f4":
            return plain("f32", "single");
        case "f8":
            return plain("f64", "double");
        default: {
            const n = npy.len(data);
            const values = new Float64Array(n);
            for (let k = 0; k < n; k++)
                values[k] = npy.f64At(data, k);
            return { name, dims, elem: "f64", data: npy.bytesOf({ kind: "f8", values }), matlabClass: "double", intDecode: null };
        }
    }
}
function exportMat(cap, problems, now) {
    const n = cap.samples;
    const nch = cap.channels;
    const uv = uvAll(cap);
    const [found, omitted] = perSample(cap, n);
    const matrix = cap.synthetic ? "synthetic_uv" : "uv";
    const vars = [];
    // Channels by samples, which MATLAB opens as samples by channels.
    const flat = new Float64Array(nch * n);
    uv.forEach((u, c) => flat.set(u, c * n));
    vars.push(matVariable(matrix, [nch, n], { kind: "f8", values: flat }));
    for (const [name, a] of found)
        vars.push(matVariable(name, [1, npy.len(a.data)], a.data));
    // The manifest as MATLAB text: UTF-16 code units, written as one column,
    // which MATLAB opens as one row of characters, the way it holds text.
    const json = J.dumpsSorted(cap.manifest);
    const units = new Uint16Array(json.length);
    for (let k = 0; k < json.length; k++)
        units[k] = json.charCodeAt(k);
    const text = matVariable("manifest_json", [units.length, 1], { kind: "u2", values: units });
    text.matlabClass = "char";
    text.intDecode = 2;
    vars.push(text);
    const bytes = hdf5.write(matHeader(now), vars);
    const lsb = cap.lsbUv;
    const names = [matrix, "manifest_json", ...found.map(([k]) => k)].sort();
    return [
        bytes,
        summary(cap, "mat", n, problems, [
            ["lossy", J.bool(false)],
            ["counts_recovered", J.bool(true)],
            ["max_error_uv", J.float(0)],
            ["lsb_uv", J.float(lsb)],
            ["stored_dtype", J.str("float64")],
            ["omitted", strs(omitted)],
            ["variables", strs(names)],
            ["contact", J.str(contactState(find(found, "leadoff")?.data ?? null, find(found, "leadoff_active")?.data ?? null))],
        ]),
    ];
}
//# sourceMappingURL=export.js.map