/**
 * Device time on the host's clocks, as the Python library maps it, and the
 * clock record a recording carries.
 *
 * Every time exchange is read on two host clocks. The device's time is
 * fitted against the monotonic one, which cannot step, and the wall clock
 * read beside it is the anchor that carries the fit back into the time a
 * recording is written in. While a stream runs the fit that dates its
 * samples is held still, so a recording is on one ruler from its first
 * sample to its last. Exchanges keep arriving and what they say is reported
 * beside it. A step of the wall clock is found between anchors and written
 * down, never smoothed into the samples.
 *
 * The arithmetic is the library's, operation for operation, so a fit made
 * here is the same bits as the one the library makes from the same
 * exchanges.
 */
import { fixed, groupedFixed } from "./pyfmt.js";
import * as J from "./pyjson.js";
/** Beyond this, a slope is not two crystals disagreeing. */
const MAX_SKEW_PPM = 1000.0;
/** And a slope has to be measured this well to beat assuming none. */
const MAX_SKEW_STDERR_PPM = 100.0;
/** How far realtime and monotonic may drift apart between two anchors without the wall clock having stepped: a floor for the two reads, and the rate at which NTP slews. */
const STEP_FLOOR_S = 0.05;
const SLEW_PPM = 500e-6;
/** Both host clocks, now: `performance.now()` for the monotonic one, `Date.now()` for the wall clock, in seconds, monotonic first. */
export function hostClocks() {
    const p = globalThis.performance;
    const monotonic = p !== undefined ? p.now() / 1000 : Date.now() / 1000;
    return { monotonic, realtime: Date.now() / 1000 };
}
/** The map from device time to host time: the exchanges, the fit, and whether the fit is being held still under a running stream. */
export class Clock {
    #tickHz;
    #syncs = [];
    #skew = 1.0;
    #offset = 0.0;
    #pinned = null;
    #frameOffset = 0.0;
    #frameMono = null;
    #learned = null;
    #frozen = false;
    /** A clock for a device whose time runs at `tickHz`, with no exchange taken: the device's own seconds until one is. */
    constructor(tickHz) {
        this.#tickHz = tickHz;
    }
    /** One exchange: both host clocks before the request and after the answer, and the device's time in its ticks. The fit is redone over every exchange so far. */
    observe(deviceTicks, before, after) {
        this.#syncs.push({
            host: (before.realtime + after.realtime) / 2,
            device: Number(deviceTicks) / this.#tickHz,
            rtt: after.realtime - before.realtime,
            mono: (before.monotonic + after.monotonic) / 2,
        });
        this.#fit();
    }
    /** Hold the map still: a stream has started, and its samples are dated by the fit in force now. */
    freeze() {
        this.#frozen = true;
    }
    /** Let the map move again: the stream has ended. */
    thaw() {
        this.#frozen = false;
    }
    /** Whether the map is being held still. */
    get frozen() {
        return this.#frozen;
    }
    /** The exchanges so far. */
    get syncs() {
        return this.#syncs;
    }
    /** Device ticks on the monotonic clock. */
    monoTime(deviceTicks) {
        return (Number(deviceTicks) / this.#tickHz) * this.#skew + this.#offset;
    }
    /** Device ticks on the wall clock of the first exchange: one continuous ruler, whatever the wall clock did afterwards. */
    hostTime(deviceTicks) {
        return this.monoTime(deviceTicks) + this.#frameOffset;
    }
    /** (wall clock, monotonic) for every exchange. */
    anchors() {
        return this.#syncs.map((s) => [s.host, s.mono]);
    }
    #fit() {
        const syncs = this.#syncs;
        const n = syncs.length;
        if (n === 0)
            return;
        let first = syncs[0];
        for (const s of syncs.slice(1))
            if (s.mono < first.mono)
                first = s;
        let skew;
        let offset;
        let pinned;
        if (n === 1) {
            skew = 1.0;
            offset = syncs[0].mono - syncs[0].device;
            pinned = "one exchange: a point has no slope";
        }
        else {
            const ds = syncs.map((s) => s.device);
            const hs = syncs.map((s) => s.mono);
            const dbar = fsum(ds) / n;
            const hbar = fsum(hs) / n;
            const sdd = fsum(ds.map((d) => (d - dbar) * (d - dbar)));
            const sdh = fsum(ds.map((d, i) => (d - dbar) * (hs[i] - hbar)));
            skew = sdd > 0 ? sdh / sdd : 1.0;
            offset = hbar - skew * dbar;
            pinned = this.#reject(skew, offset, sdd, n);
            if (pinned !== null) {
                skew = 1.0;
                offset = hbar - dbar;
            }
        }
        // What the exchanges say, always. What the samples are dated with, only
        // while no stream is running.
        this.#learned = { skew, offset, pinned };
        if (this.#frozen)
            return;
        this.#frameMono = first.mono;
        this.#frameOffset = first.host - first.mono;
        this.#skew = skew;
        this.#offset = offset;
        this.#pinned = pinned;
    }
    /** Why a slope cannot be believed: past what two crystals can differ by, or not measured well enough to beat assuming none. */
    #reject(skew, offset, sdd, n) {
        if (sdd <= 0)
            return "every exchange landed on the same device time";
        const errPpm = Math.abs(skew - 1.0) * 1e6;
        if (errPpm > MAX_SKEW_PPM) {
            return `fitted ${groupedFixed(errPpm, 0)} ppm from unity, past the ${groupedFixed(MAX_SKEW_PPM, 0)} ppm two oscillators can differ by`;
        }
        if (n <= 2)
            return "two exchanges: a slope with no residual to check it";
        const resid = this.#syncs.map((s) => s.mono - (skew * s.device + offset));
        const sse = fsum(resid.map((r) => r * r));
        const sePpm = Math.sqrt(sse / (n - 2) / sdd) * 1e6;
        if (sePpm > MAX_SKEW_STDERR_PPM) {
            let hi = -Infinity;
            let lo = Infinity;
            for (const s of this.#syncs) {
                hi = Math.max(hi, s.device);
                lo = Math.min(lo, s.device);
            }
            return (`slope ${groupedFixed(errPpm, 0)} +- ${groupedFixed(sePpm, 0)} ppm over a ${fixed(hi - lo, 2)} s baseline: ` +
                "not measured well enough to beat assuming 1.0");
        }
        return null;
    }
    /** The clock record a recording carries: how far `host_time` can be trusted, the anchors that align events afterwards, any step of the wall clock, and what the exchanges said while the map was held. */
    quality() {
        const syncs = this.#syncs;
        const n = syncs.length;
        const anchors = this.anchors();
        const steps = findSteps(anchors);
        const optStr = (s) => (s === null ? J.NULL : J.str(s));
        const out = J.object([
            ["n_syncs", J.int(n)],
            ["skew", J.float(this.#skew)],
            ["offset", J.float(this.#offset)],
            ["skew_pinned", J.bool(this.#pinned !== null)],
            ["skew_pinned_why", optStr(this.#pinned)],
            ["residual_ms", J.NULL],
            ["max_half_rtt_ms", J.NULL],
            ["span_s", J.NULL],
            ["fitted_against", J.str("monotonic")],
            ["anchors", J.array(anchors.map(([t, m]) => J.array([J.float(t), J.float(m)])))],
            ["frame_mono", this.#frameMono === null ? J.NULL : J.float(this.#frameMono)],
            ["wall_clock_steps", steps],
            ["wall_clock_stepped", J.bool(steps.kind === "array" && steps.items.length > 0)],
        ]);
        let span = null;
        if (n > 0) {
            let rtt = -Infinity;
            for (const s of syncs)
                rtt = Math.max(rtt, s.rtt);
            J.set(out, "max_half_rtt_ms", J.float((rtt / 2) * 1e3));
        }
        if (n >= 2) {
            span = syncs[n - 1].device - syncs[0].device;
            J.set(out, "span_s", J.float(span));
            const errs = syncs.map((s) => s.mono - (this.#skew * s.device + this.#offset));
            J.set(out, "residual_ms", J.float(Math.sqrt(fsum(errs.map((e) => e * e)) / n) * 1e3));
        }
        const learned = this.#learned;
        J.set(out, "skew_measured", learned === null ? J.NULL : J.float(learned.skew));
        J.set(out, "skew_measured_pinned_why", learned === null ? J.NULL : optStr(learned.pinned));
        J.set(out, "map_frozen_at_stream_start", J.bool(this.#frozen));
        if (learned !== null && span !== null && learned.skew !== 0 && span !== 0) {
            J.set(out, "uncorrected_drift_s", J.float((learned.skew - this.#skew) * span));
        }
        return out;
    }
}
/** Steps of the wall clock between consecutive anchors, in monotonic order: where each is bracketed and how far it jumped. */
export function findSteps(anchors) {
    const a = [...anchors].sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
    const out = [];
    for (let i = 0; i + 1 < a.length; i++) {
        const [t0, m0] = a[i];
        const [t1, m1] = a[i + 1];
        const drift = t1 - t0 - (m1 - m0);
        const tol = STEP_FLOOR_S + SLEW_PPM * Math.abs(m1 - m0);
        if (Math.abs(drift) > tol) {
            out.push(J.object([
                ["after_mono", J.float(m0)],
                ["before_mono", J.float(m1)],
                ["jump_s", J.float(drift)],
                ["tolerance_s", J.float(tol)],
                ["realtime_before", J.float(t0)],
                ["realtime_after", J.float(t1)],
            ]));
        }
    }
    return J.array(out);
}
/** `math.fsum`: the correctly rounded sum, by Python's own partials, so a sum here is the same bits as the library's. */
export function fsum(xs) {
    const p = [];
    let special = 0.0;
    let inf = 0.0;
    for (const x0 of xs) {
        let x = x0;
        let i = 0;
        for (let j = 0; j < p.length; j++) {
            let y = p[j];
            if (Math.abs(x) < Math.abs(y)) {
                const t = x;
                x = y;
                y = t;
            }
            const hi = x + y;
            const lo = y - (hi - x);
            if (lo !== 0)
                p[i++] = lo;
            x = hi;
        }
        p.length = i;
        if (x !== 0) {
            if (!Number.isFinite(x)) {
                // A sum that overflowed from finite terms is an error in Python.
                if (Number.isFinite(x0))
                    throw new RangeError("intermediate overflow in fsum");
                if (!Number.isNaN(x0))
                    inf += x0;
                special += x0;
                p.length = 0;
            }
            else {
                p.push(x);
            }
        }
    }
    if (special !== 0) {
        if (Number.isNaN(inf))
            throw new RangeError("-inf + inf in fsum");
        return special;
    }
    let hi = 0.0;
    let n = p.length;
    if (n > 0) {
        hi = p[--n];
        let lo = 0.0;
        while (n > 0) {
            const x = hi;
            const y = p[--n];
            hi = x + y;
            const yr = hi - x;
            lo = y - yr;
            if (lo !== 0)
                break;
        }
        if (n > 0 && ((lo < 0 && p[n - 1] < 0) || (lo > 0 && p[n - 1] > 0))) {
            const y = lo * 2;
            const x = hi + y;
            const yr = x - hi;
            if (y === yr)
                hi = x;
        }
    }
    return hi;
}
//# sourceMappingURL=clock.js.map