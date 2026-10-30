/**
 * EDF+ and BDF+, written byte for byte as the Python library writes them.
 *
 * Every sample is written at the time it was recorded, counted from its
 * index. A hole holds one placeholder for each lost sample, repeating the
 * last recorded value, under a `BAD_ACQ_SKIP` annotation over exactly the
 * hole. The file is whole records, and the last one is completed after the
 * last sample the same way. A stretch where an electrode was off is a
 * `BAD_LEADOFF` annotation, and the part of a recording where detection was
 * off is `LEADOFF_NOT_CHECKED`, written only when it ran for the rest. The
 * record duration carries the measured rate, and each signal's range is
 * rounded outward so no sample is clipped. docs.intomind.com/files.html
 * states these rules, and this module follows the Python library's `edf.py`
 * line by line.
 */
import { fixed, general, quantize } from "./pyfmt.js";
import { CaptureError } from "./errors.js";
/** The annotation over each hole where samples were lost. */
export const SKIP_LABEL = "BAD_ACQ_SKIP";
/** The annotation over each stretch an electrode was off, followed by the channel's label. */
export const LEADOFF_LABEL = "BAD_LEADOFF";
/** The annotation over the part of a recording where detection was off, written only when it ran for the rest. */
export const NOT_CHECKED_LABEL = "LEADOFF_NOT_CHECKED";
/** EDF+: 16-bit samples. */
export const EDF = {
    digMin: -32768,
    digMax: 32767,
    sampleBytes: 2,
    version: new TextEncoder().encode("0       "),
    annot: "EDF Annotations",
    family: "EDF+",
};
/** BDF+: 24-bit samples. */
export const BDF = {
    digMin: -8388608,
    digMax: 8388607,
    sampleBytes: 3,
    version: new Uint8Array([0xff, 0x42, 0x49, 0x4f, 0x53, 0x45, 0x4d, 0x49]),
    annot: "BDF Annotations",
    family: "BDF+",
};
/** ASCII, left-justified, exactly `width` bytes: the first `width` characters, each outside ASCII written as `?`, padded with spaces. */
export function field(s, width) {
    const b = new Uint8Array(width).fill(0x20);
    let k = 0;
    for (const c of s) {
        if (k >= width)
            break;
        const code = c.codePointAt(0);
        b[k++] = code < 0x80 ? code : 0x3f;
    }
    return b;
}
/** A number in eight characters, losing no more than it must: `.8g`, and failing that the most fixed places that fit, and failing that cut. */
export function num(x) {
    let s = general(x, 8);
    if (s.length > 8) {
        for (let prec = 6; prec >= 1; prec--) {
            s = fixed(x, prec);
            if (s.length <= 8)
                break;
        }
    }
    if (s.length > 8)
        s = s.slice(0, 8);
    return s;
}
/** `float(text)` for what `num` writes. */
function parse(s) {
    const t = s.trim();
    if (t === "inf" || t === "+inf" || t === "infinity")
        return Infinity;
    if (t === "-inf" || t === "-infinity")
        return -Infinity;
    if (t === "nan" || t === "+nan" || t === "-nan")
        return NaN;
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) ? Number(t) : null;
}
/** A bound as the header field will hold it. */
function written(x) {
    return parse(num(x)) ?? x;
}
/** A bound as the field will hold it, moved away from the samples where the field cannot hold it exactly. Null where Python's decimal context refuses the bound and the export fails. */
function bound(x, below) {
    if (!Number.isFinite(x))
        return written(x);
    const toward = below ? "floor" : "ceiling";
    for (let places = 7; places >= 0; places--) {
        const s = quantize(x, places, toward);
        if (s === null)
            return null;
        const v = parse(s);
        if (v === null)
            return null;
        if (s.length <= 8 && written(v) === v)
            return v;
    }
    return written(x);
}
/** The physical range of one signal: its own extent with a one percent margin, and never degenerate. */
function scale(x) {
    let lo = Infinity;
    let hi = -Infinity;
    let nan = false;
    for (let i = 0; i < x.length; i++) {
        const v = x[i];
        if (Number.isNaN(v)) {
            nan = true;
            continue;
        }
        if (v < lo)
            lo = v;
        if (v > hi)
            hi = v;
    }
    if (nan) {
        lo = NaN;
        hi = NaN;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) {
        lo -= 1;
        hi += 1;
    }
    const pad = 0.01 * (hi - lo);
    return [lo - pad, hi + pad];
}
/** `x` rounded to the nearest integer, a tie to the even one. */
export function roundHalfEven(x) {
    if (!Number.isFinite(x))
        return x;
    const f = Math.floor(x);
    const d = x - f;
    if (d < 0.5)
        return f;
    if (d > 0.5)
        return f + 1;
    return f % 2 === 0 ? f : f + 1;
}
/** numpy's `round(...).clip(...).astype(int32)` for one value. */
function digitize(x, pmin, pmax, dmin, dmax) {
    const g = (dmax - dmin) / (pmax - pmin);
    const d = roundHalfEven((x - pmin) * g + dmin);
    // numpy's clip keeps a NaN, and its conversion to int32 then gives the smallest int32.
    if (Number.isNaN(d))
        return -2147483648;
    return Math.min(Math.max(d, dmin), dmax);
}
/** One time-stamped annotation list. */
function tal(onset, duration, text) {
    let s = (onset >= 0 ? "+" : "-") + fixed(Math.abs(onset), 6);
    if (duration !== null)
        s += "\x15" + fixed(duration, 6);
    s += "\x14" + text + "\x14\x00";
    return new TextEncoder().encode(s);
}
const DEFAULT_START = [2000, 1, 1, 0, 0, 0];
/** The start of a recording, as Python's `strptime(started, "%Y-%m-%dT%H:%M:%SZ")` reads it, or 2000-01-01 where it cannot. */
export function startOf(started) {
    if (started === null)
        return DEFAULT_START;
    return parseStart(started) ?? DEFAULT_START;
}
function parseStart(s) {
    let i = 0;
    const isDigit = (k) => k < s.length && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57;
    // One field: the digits strptime's own pattern allows, tried as it tries them.
    const num = (maxLen, ok) => {
        const start = i;
        let end = start;
        while (end < s.length && end - start < maxLen && isDigit(end))
            end++;
        for (let e = end; e >= start + 1; e--) {
            const t = s.slice(start, e);
            if (ok(t)) {
                i = e;
                return Number(t);
            }
        }
        return null;
    };
    const lit = (c) => {
        if (i < s.length && s[i].toLowerCase() === c.toLowerCase() && s.charCodeAt(i) < 0x80) {
            i++;
            return true;
        }
        return false;
    };
    const two = (t, lo, hi, oneOk) => {
        if (!/^\d+$/.test(t))
            return false;
        const v = Number(t);
        return (t.length === 2 || (oneOk && t.length === 1)) && v >= lo && v <= hi;
    };
    const y = num(4, (t) => t.length === 4);
    if (y === null || !lit("-"))
        return null;
    const m = num(2, (t) => two(t, 1, 12, t !== "0"));
    if (m === null || !lit("-"))
        return null;
    // %d also allows a space before a single digit.
    let d;
    if (i < s.length && s[i] === " ") {
        i++;
        d = num(1, (t) => two(t, 1, 9, true));
    }
    else {
        d = num(2, (t) => two(t, 1, 31, true));
    }
    if (d === null || !lit("T"))
        return null;
    const hh = num(2, (t) => two(t, 0, 23, true));
    if (hh === null || !lit(":"))
        return null;
    const mm = num(2, (t) => two(t, 0, 59, true));
    if (mm === null || !lit(":"))
        return null;
    const ss = num(2, (t) => two(t, 0, 61, true));
    if (ss === null || !lit("Z"))
        return null;
    if (i !== s.length || y < 1 || ss > 59)
        return null;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    if (d > days)
        return null;
    return [y, m, d, hh, mm, ss];
}
function error(what) {
    return new CaptureError(what);
}
function concat(parts) {
    let n = 0;
    for (const p of parts)
        n += p.length;
    const out = new Uint8Array(n);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
/** One EDF+ or BDF+ file, and what it holds. */
export function write(input, w) {
    const { digMin: dmin, digMax: dmax, sampleBytes } = w;
    const signals = input.signals;
    if (signals.length === 0)
        throw error("no signals");
    const n = signals[0][1].length;
    for (const [lbl, x] of signals) {
        if (x.length !== n)
            throw error(`signal ${lbl} has ${x.length} samples, expected ${n}`);
    }
    if (n === 0)
        throw error("no samples");
    const idx = input.index;
    if (idx.length !== n)
        throw error(`index has ${idx.length} entries for ${n} samples`);
    for (let k = 0; k + 1 < n; k++) {
        if (idx[k + 1] - idx[k] < 1n) {
            throw error(`refusing to write ${w.family}: the sample index steps back after sample ${k}, a break whose length is ` +
                "not known, so the samples after it have no place on this file's timeline");
        }
    }
    // Where each sample belongs, counted in samples from the first.
    const pos = new Float64Array(n);
    for (let k = 0; k < n; k++)
        pos[k] = Number(idx[k] - idx[0]);
    const span = pos[n - 1] + 1;
    const fs = input.fs;
    if (!Number.isFinite(fs))
        throw error("the sample rate is not a number");
    const nsr = Math.max(1, roundHalfEven(fs));
    const dur = nsr / fs;
    const nRec = Math.ceil(span / nsr);
    const used = nRec * nsr;
    const tail = used - span;
    const holes = [];
    for (let k = 0; k + 1 < n; k++) {
        const step = idx[k + 1] - idx[k];
        if (step > 1n)
            holes.push([pos[k] + 1, Number(step - 1n)]);
    }
    // Runs of flagged samples on the file's timeline.
    const runs = [];
    const stretchCounts = [];
    for (const [text, flags] of input.stretches) {
        if (flags.length !== n)
            throw error(`stretch '${text}' has ${flags.length} flags for ${n} samples`);
        const on = new Uint8Array(used + 1);
        for (let k = 0; k < n; k++)
            if (flags[k])
                on[pos[k]] = 1;
        let count = 0;
        let start = -1;
        for (let p = 0; p < on.length; p++) {
            if (start < 0 && on[p])
                start = p;
            else if (start >= 0 && !on[p]) {
                runs.push([start, p - start, text]);
                count++;
                start = -1;
            }
        }
        stretchCounts.push([text, count]);
    }
    // Annotations bucketed into the record whose span holds them: events,
    // then holes and the tail, then stretches.
    const ann = Array.from({ length: nRec }, () => []);
    let nEvents = 0;
    for (const e of input.events) {
        const q = e.t / dur;
        if (!Number.isFinite(q))
            throw error("an event's time is not a number");
        const r = Math.min(Math.max(Math.trunc(q), 0), nRec - 1);
        ann[r].push([e.t, null, e.label]);
        nEvents++;
    }
    const filledSpans = [...holes];
    if (tail > 0)
        filledSpans.push([span, tail]);
    for (const [first, length] of filledSpans)
        ann[Math.floor(first / nsr)].push([first / fs, length / fs, SKIP_LABEL]);
    for (const [first, length, text] of runs)
        ann[Math.floor(first / nsr)].push([first / fs, length / fs, text]);
    const annotBytes = [];
    for (let r = 0; r < nRec; r++) {
        const parts = [tal((r * nsr) / fs, null, "")];
        for (const [t, d, label] of ann[r])
            parts.push(tal(t, d, label));
        annotBytes.push(concat(parts));
    }
    let widest = 0;
    for (const a of annotBytes)
        widest = Math.max(widest, a.length);
    const annNsr = Math.max(1, Math.ceil(widest / sampleBytes) + 1);
    const ns = signals.length + 1;
    const hdrBytes = 256 * (ns + 1);
    const reserved = `${w.family.slice(0, 3)}+C`;
    // Each range fitted to the recorded samples, its bounds as the header will hold them.
    const ranges = [];
    for (const [, x] of signals) {
        const [lo, hi] = scale(x);
        const loW = bound(lo, true);
        const hiW = bound(hi, false);
        if (loW === null || hiW === null)
            throw error("a signal's range is too wide for the header");
        ranges.push(hiW > loW ? [loW, hiW] : [lo, hi]);
    }
    const [y, mo, d, hh, mi, ss] = input.start;
    const two = (v) => String(v).padStart(2, "0");
    const parts = [];
    parts.push(w.version);
    parts.push(field(input.patient, 80));
    parts.push(field(input.recording, 80));
    parts.push(field(`${two(d)}.${two(mo)}.${two(((y % 100) + 100) % 100)}`, 8));
    parts.push(field(`${two(hh)}.${two(mi)}.${two(ss)}`, 8));
    parts.push(field(String(hdrBytes), 8));
    parts.push(field(reserved, 44));
    parts.push(field(String(nRec), 8));
    parts.push(field(num(dur), 8));
    parts.push(field(String(ns), 4));
    const each = (f) => {
        for (let k = 0; k < signals.length; k++)
            parts.push(f(k));
        parts.push(f(null));
    };
    each((s) => field(s === null ? w.annot : signals[s][0], 16));
    each((s) => field(s !== null ? input.transducer : "", 80));
    each((s) => field(s !== null ? "uV" : "", 8));
    each((s) => field(s === null ? "-1" : num(ranges[s][0]), 8));
    each((s) => field(s === null ? "1" : num(ranges[s][1]), 8));
    each(() => field(String(dmin), 8));
    each(() => field(String(dmax), 8));
    each((s) => field(s !== null ? input.prefilter : "", 80));
    each((s) => field(String(s === null ? annNsr : nsr), 8));
    each(() => field("", 32));
    // Every recorded sample where it belongs, every other place the last recorded value before it.
    const last = new Int32Array(used);
    {
        let k = 0;
        for (let p = 0; p < used; p++) {
            while (k + 1 < n && pos[k + 1] <= p)
                k++;
            last[p] = k;
        }
    }
    const real = [];
    let quantum = 0;
    let maxErr = 0;
    signals.forEach(([, x], si) => {
        const [pmin, pmax] = ranges[si];
        const dg = new Int32Array(n);
        for (let k = 0; k < n; k++)
            dg[k] = digitize(x[k], pmin, pmax, dmin, dmax);
        const q = (pmax - pmin) / (dmax - dmin);
        quantum = q > quantum ? q : quantum;
        // What a reader gets back, by the standard's formula, against what was
        // handed in. numpy's max propagates a NaN, and Python's max keeps the
        // first of a NaN and a number.
        let worst = -Infinity;
        let nan = false;
        for (let k = 0; k < n; k++) {
            const back = ((dg[k] - dmin) * (pmax - pmin)) / (dmax - dmin) + pmin;
            const e = Math.abs(back - x[k]);
            if (Number.isNaN(e))
                nan = true;
            else if (e > worst)
                worst = e;
        }
        const worstAll = nan ? NaN : worst;
        if (worstAll > maxErr)
            maxErr = worstAll;
        real.push(dg);
    });
    const recordLen = signals.length * nsr * sampleBytes + annNsr * sampleBytes;
    const body = new Uint8Array(nRec * recordLen);
    let at = 0;
    for (let r = 0; r < nRec; r++) {
        const a = r * nsr;
        for (const dg of real) {
            for (let p = a; p < a + nsr; p++) {
                const v = dg[last[p]];
                body[at++] = v & 0xff;
                body[at++] = (v >> 8) & 0xff;
                if (sampleBytes === 3)
                    body[at++] = (v >> 16) & 0xff;
            }
        }
        const blob = annotBytes[r];
        body.set(blob, at);
        at += annNsr * sampleBytes;
    }
    parts.push(body);
    const bytes = concat(parts);
    let filled = 0;
    for (const [, l] of holes)
        filled += l;
    return [
        bytes,
        {
            nRecords: nRec,
            samplesPerRecord: nsr,
            recordDurationS: dur,
            continuity: reserved,
            fs,
            samplesWritten: n,
            samplesFilled: filled,
            gaps: holes.length,
            tailFilled: tail,
            nAnnotations: nEvents,
            stretchCounts,
            quantumUv: quantum,
            maxErrorUv: maxErr,
        },
    ];
}
//# sourceMappingURL=edf.js.map