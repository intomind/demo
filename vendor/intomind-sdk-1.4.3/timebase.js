/**
 * Device time onto a host clock.
 *
 * A device's clock is monotonic and free running. A host's is a different
 * crystal. The fit between them is a line, and the point of taking several
 * exchanges rather than one is that a single exchange cannot tell a clock
 * difference from a slow answer.
 *
 * The fit is refused rather than believed when it is absurd. Two crystals
 * do not differ by a thousand parts per million, and a measurement that
 * says they do is measuring something else, usually a link that stalled in
 * the middle of an exchange.
 */
/** Beyond this, a skew is not two crystals disagreeing. */
export const MAX_SKEW_PPM = 1000.0;
/** And it has to be measured rather than drawn through noise. */
export const MAX_SKEW_STDERR_PPM = 100.0;
/** One time exchange, read on both clocks. */
export class Exchange {
    /** Host time before the request, in seconds. */
    before;
    /** Host time after the answer. */
    after;
    /** The device's own time, in its ticks, captured when it read the request. */
    deviceTicks;
    /** One exchange: the host clock either side of the request, and the device's own answer in its ticks. */
    constructor(before, after, deviceTicks) {
        this.before = before;
        this.after = after;
        this.deviceTicks = deviceTicks;
    }
    /** The middle of the window the device's answer must lie in. */
    get host() {
        return (this.before + this.after) / 2;
    }
    /**
     * How wide that window is. Half the round trip, which is the uncertainty
     * in this one exchange.
     */
    get uncertainty() {
        return (this.after - this.before) / 2;
    }
}
/** Device time onto host time, and the exchanges it was learned from. */
export class Timebase {
    /** The device's own tick rate, from device info. */
    tickHz;
    #exchanges = [];
    #fit = null;
    /** `tickHz` is the device's own, from device info. */
    constructor(tickHz) {
        this.tickHz = tickHz;
    }
    /** Take one exchange. The fit is redone from everything so far. */
    observe(exchange) {
        this.#exchanges.push(exchange);
        this.#refit();
        return this.#fit;
    }
    /** Every exchange taken so far. */
    get exchanges() {
        return this.#exchanges;
    }
    /** The current fit, or null before the first exchange. */
    get fit() {
        return this.#fit;
    }
    /** Host time for a device time, in seconds. Null until there is a fit. */
    hostTime(deviceTicks) {
        if (this.#fit === null)
            return null;
        const d = Number(deviceTicks) / this.tickHz;
        return d * (1 + this.#fit.skewPpm * 1e-6) + this.#fit.offsetS;
    }
    #refit() {
        const n = this.#exchanges.length;
        if (n === 0) {
            this.#fit = null;
            return;
        }
        const xs = this.#exchanges.map((e) => Number(e.deviceTicks) / this.tickHz);
        const ys = this.#exchanges.map((e) => e.host);
        if (n === 1) {
            // One exchange fixes an offset and says nothing about rate. Claiming
            // a skew from it would be claiming a measurement that was never made.
            this.#fit = {
                offsetS: ys[0] - xs[0],
                skewPpm: 0,
                exchanges: 1,
                residualUs: this.#exchanges[0].uncertainty * 1e6,
                skewUsed: false,
            };
            return;
        }
        const meanX = xs.reduce((a, b) => a + b, 0) / n;
        const meanY = ys.reduce((a, b) => a + b, 0) / n;
        const sxx = xs.reduce((acc, x) => acc + (x - meanX) ** 2, 0);
        const sxy = xs.reduce((acc, x, i) => acc + (x - meanX) * (ys[i] - meanY), 0);
        const slope = sxx > 0 ? sxy / sxx : 1;
        const intercept = meanY - slope * meanX;
        const rss = xs.reduce((acc, x, i) => acc + (ys[i] - (slope * x + intercept)) ** 2, 0);
        const residualUs = Math.sqrt(rss / n) * 1e6;
        const skewPpm = (slope - 1) * 1e6;
        // The standard error of the slope, in the same units.
        const stderrPpm = n > 2 && sxx > 0 ? Math.sqrt(rss / (n - 2) / sxx) * 1e6 : Infinity;
        const believable = Math.abs(skewPpm) <= MAX_SKEW_PPM && stderrPpm <= MAX_SKEW_STDERR_PPM;
        this.#fit = believable
            ? { offsetS: intercept, skewPpm, exchanges: n, residualUs, skewUsed: true }
            : // Keep the offset, which is measured well, and drop the rate, which
                // is not. A wrong rate is worse than no rate: it grows.
                { offsetS: meanY - meanX, skewPpm: 0, exchanges: n, residualUs, skewUsed: false };
    }
}
//# sourceMappingURL=timebase.js.map