/**
 * Numbers written exactly as the Python library writes them.
 *
 * Every export is held to the bytes the Python library produces, and those
 * bytes come from Python's own formatting: `repr` for a float in JSON,
 * `f"{x:.6f}"` in text and annotations, `f"{x:.8g}"` in an EDF header, and
 * `decimal.Decimal` when a header bound is moved outward. Each is reproduced
 * here from its definition, and the fixtures in `contract/recordings` hold
 * them to what Python printed.
 *
 * JavaScript's own formatting finds the same digits as Python's except at an
 * exact tie, where `toFixed`, `toPrecision` and `toExponential` round away
 * from zero and Python rounds half to even. Ties are settled here on the
 * exact binary value.
 */
const F64 = new DataView(new ArrayBuffer(8));
/** The exact decimal value of a finite, nonzero `x`'s magnitude. */
function exact(x) {
    F64.setFloat64(0, Math.abs(x));
    const hi = F64.getUint32(0);
    const lo = F64.getUint32(4);
    const biased = (hi >>> 20) & 0x7ff;
    let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let e2;
    if (biased === 0) {
        e2 = -1074;
    }
    else {
        m |= 1n << 52n;
        e2 = biased - 1075;
    }
    // m * 2^e2, and for a negative e2, m * 5^-e2 * 10^e2.
    if (e2 >= 0)
        return { digits: (m << BigInt(e2)).toString(), exp: 0 };
    return { digits: (m * 5n ** BigInt(-e2)).toString(), exp: e2 };
}
/**
 * `ex` rounded half to even to `n` significant digits: exactly `n` digits,
 * and the exponent of the first of them.
 */
function roundSignificant(ex, n) {
    const d = ex.digits;
    let exp = d.length - 1 + ex.exp;
    if (d.length <= n)
        return { digits: d + "0".repeat(n - d.length), exp };
    let kept = d.slice(0, n);
    const first = d.charCodeAt(n) - 48;
    let up = first > 5;
    if (first === 5) {
        let rest = false;
        for (let i = n + 1; i < d.length; i++) {
            if (d.charCodeAt(i) !== 48) {
                rest = true;
                break;
            }
        }
        up = rest || (kept.charCodeAt(n - 1) - 48) % 2 === 1;
    }
    if (up) {
        const carried = increment(kept);
        if (carried.length > n) {
            kept = carried.slice(0, n);
            exp += 1;
        }
        else {
            kept = carried;
        }
    }
    return { digits: kept, exp };
}
/** A string of decimal digits plus one. */
function increment(digits) {
    const b = digits.split("");
    let i = b.length - 1;
    while (i >= 0) {
        if (b[i] === "9") {
            b[i] = "0";
            i--;
        }
        else {
            b[i] = String.fromCharCode(b[i].charCodeAt(0) + 1);
            return b.join("");
        }
    }
    return "1" + b.join("");
}
/**
 * The shortest decimal digits that read back as `x`, and the exponent of the
 * first of them: `x = d.ddd × 10^exp`. `x` is finite and not zero.
 *
 * Python's `repr` takes the fewest digits that round trip, and of those the
 * closest to `x`, and where two are equally close, the even one. The count
 * comes from `toExponential`, which finds the fewest, and the digits from
 * rounding `x` to that many places half to even, which is the closest,
 * whenever that reads back as `x`.
 */
function shortest(x) {
    const a = Math.abs(x);
    const s = a.toExponential();
    const at = s.indexOf("e");
    const digits = s.slice(0, at).replace(".", "");
    const exp = Number(s.slice(at + 1));
    const even = roundSignificant(exact(a), digits.length);
    const back = Number(`${even.digits[0]}.${even.digits.slice(1)}e${even.exp}`);
    if (back === a)
        return even;
    return { digits, exp };
}
/** `d.ddd` and the exponent, as Python writes an exponent: a sign and at least two digits. */
function scientific(neg, digits, exp) {
    let out = neg ? "-" : "";
    out += digits[0];
    if (digits.length > 1)
        out += "." + digits.slice(1);
    out += exp < 0 ? "e-" : "e+";
    out += String(Math.abs(exp)).padStart(2, "0");
    return out;
}
/** Python's `repr` of a float, which is also what `json.dumps` writes for a finite one. */
export function repr(x) {
    if (Number.isNaN(x))
        return "nan";
    if (x === Infinity)
        return "inf";
    if (x === -Infinity)
        return "-inf";
    if (x === 0)
        return Object.is(x, -0) ? "-0.0" : "0.0";
    const { digits, exp } = shortest(x);
    const neg = x < 0;
    // Where the decimal point falls, counted from the left of the digits.
    const point = exp + 1;
    if (point <= -4 || point > 16)
        return scientific(neg, digits, exp);
    let out = neg ? "-" : "";
    const n = digits.length;
    if (point <= 0) {
        out += "0." + "0".repeat(-point) + digits;
    }
    else if (point < n) {
        out += digits.slice(0, point) + "." + digits.slice(point);
    }
    else {
        out += digits + "0".repeat(point - n) + ".0";
    }
    return out;
}
/**
 * `f"{x:.{places}f}"`: the exact binary value rounded half to even, and the
 * sign of a negative zero kept, as Python's formatting does.
 */
export function fixed(x, places) {
    if (Number.isNaN(x))
        return "nan";
    if (x === Infinity)
        return "inf";
    if (x === -Infinity)
        return "-inf";
    const neg = x < 0 || Object.is(x, -0);
    const a = Math.abs(x);
    let body;
    if (a < 1e21 && places <= 100) {
        body = a.toFixed(places);
        // `toFixed` takes the larger of two equally close results. The tie is
        // exact when the value, scaled to one place past the last, is an odd
        // integer, and then the even neighbour below is the one Python takes.
        const scaled = a * 2 ** (places + 1);
        if (Number.isInteger(scaled) && scaled < 2 ** 53 && scaled % 2 === 1) {
            const last = body.charCodeAt(body.length - 1) - 48;
            if (last % 2 === 1)
                body = body.slice(0, -1) + String(last - 1);
        }
    }
    else {
        body = fixedExact(a, places);
    }
    return neg ? "-" + body : body;
}
/** `fixed` for a magnitude `toFixed` cannot write, from the exact value. */
function fixedExact(a, places) {
    let digits;
    if (a === 0) {
        digits = "0";
    }
    else {
        // The value scaled by 10^places, rounded half to even to an integer.
        const ex = exact(a);
        const s = ex.exp + places;
        if (s >= 0) {
            digits = ex.digits + "0".repeat(s);
        }
        else {
            const drop = -s;
            const d = ex.digits;
            const q = drop >= d.length ? "" : d.slice(0, d.length - drop);
            const r = drop >= d.length ? "0".repeat(drop - d.length) + d : d.slice(d.length - drop);
            const first = r.charCodeAt(0) - 48;
            const rest = /[1-9]/.test(r.slice(1));
            const lastOdd = q !== "" && (q.charCodeAt(q.length - 1) - 48) % 2 === 1;
            const up = first > 5 || (first === 5 && (rest || lastOdd));
            digits = q === "" ? (up ? "1" : "0") : up ? increment(q) : q;
        }
    }
    if (places === 0)
        return digits;
    const padded = digits.padStart(places + 1, "0");
    return padded.slice(0, padded.length - places) + "." + padded.slice(padded.length - places);
}
/**
 * `f"{x:.{precision}g}"`: `precision` significant digits, trailing zeros and
 * a bare decimal point removed, and an exponent when the rounded value's
 * exponent is below -4 or at least `precision`.
 */
export function general(x, precision) {
    if (Number.isNaN(x))
        return "nan";
    if (x === Infinity)
        return "inf";
    if (x === -Infinity)
        return "-inf";
    const p = Math.max(1, precision);
    const neg = x < 0 || Object.is(x, -0);
    // Rounded to p significant digits, half to even on the exact value.
    const { digits, exp } = x === 0 ? { digits: "0".repeat(p), exp: 0 } : roundSignificant(exact(x), p);
    if (exp < -4 || exp >= p) {
        const kept = digits.replace(/0+$/, "");
        return scientific(neg, kept === "" ? "0" : kept, exp);
    }
    // Fixed, with p - 1 - exp places, then trimmed.
    const places = Math.max(0, p - 1 - exp);
    let out = fixed(Math.abs(x), places);
    if (out.includes("."))
        out = out.replace(/0+$/, "").replace(/\.$/, "");
    return neg ? "-" + out : out;
}
/**
 * `f"{Decimal(repr(x)).quantize(Decimal(1).scaleb(-places), rounding=…):f}"`
 * for a finite `x`, or null where Python's default context (28 digits)
 * refuses the quantize and raises.
 */
export function quantize(x, places, toward) {
    const r = repr(x);
    const neg = r.startsWith("-");
    const body = neg ? r.slice(1) : r;
    // The decimal's coefficient and exponent, from the repr's own digits.
    let mant = body;
    let e10 = 0;
    const at = body.indexOf("e");
    if (at >= 0) {
        mant = body.slice(0, at);
        const e = Number(body.slice(at + 1));
        if (!Number.isInteger(e))
            return null;
        e10 = e;
    }
    const dot = mant.indexOf(".");
    const intPart = dot >= 0 ? mant.slice(0, dot) : mant;
    const fracPart = dot >= 0 ? mant.slice(dot + 1) : "";
    let coeff = intPart + fracPart;
    const exp = e10 - fracPart.length;
    const target = -places;
    if (exp >= target) {
        coeff += "0".repeat(exp - target);
    }
    else {
        const drop = target - exp;
        let keep;
        let rest;
        if (drop >= coeff.length) {
            keep = "";
            rest = coeff;
        }
        else {
            keep = coeff.slice(0, coeff.length - drop);
            rest = coeff.slice(coeff.length - drop);
        }
        const inexact = /[1-9]/.test(rest);
        coeff = keep === "" ? "0" : keep;
        // Away from zero when the rounding direction points away from it.
        const away = inexact && ((toward === "ceiling" && !neg) || (toward === "floor" && neg));
        if (away)
            coeff = increment(coeff);
    }
    // The coefficient without leading zeros, as Decimal holds it.
    let digits = coeff.replace(/^0+/, "");
    if (digits === "")
        digits = "0";
    if (digits.length > 28)
        return null;
    // Written in fixed notation with exactly `places` places, the sign of a
    // zero kept, as Decimal formats it.
    const padded = digits.length <= places ? "0".repeat(places + 1 - digits.length) + digits : digits;
    const split = padded.length - places;
    let out = neg ? "-" : "";
    out += padded.slice(0, split);
    if (places > 0)
        out += "." + padded.slice(split);
    return out;
}
/** The sum numpy computes for a contiguous float64 array: pairwise within blocks of 8192, the blocks added left to right. */
export function numpySum(a) {
    const pairwise = (lo, n) => {
        if (n < 8) {
            let r = 0;
            for (let i = 0; i < n; i++)
                r += a[lo + i];
            return r;
        }
        if (n <= 128) {
            const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
            let i = 8;
            for (; i < n - (n % 8); i += 8) {
                for (let j = 0; j < 8; j++)
                    r[j] = r[j] + a[lo + i + j];
            }
            let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
            for (; i < n; i++)
                res += a[lo + i];
            return res;
        }
        let n2 = Math.floor(n / 2);
        n2 -= n2 % 8;
        return pairwise(lo, n2) + pairwise(lo + n2, n - n2);
    };
    if (a.length === 0)
        return 0;
    let s = pairwise(0, Math.min(8192, a.length));
    for (let at = 8192; at < a.length; at += 8192)
        s += pairwise(at, Math.min(8192, a.length - at));
    return s;
}
/** `numpy.mean` of a contiguous float64 array. */
export function numpyMean(a) {
    return numpySum(a) / a.length;
}
/** Digits with a comma between every three, counted from the right. */
function commas(digits) {
    let out = "";
    for (let i = 0; i < digits.length; i++) {
        if (i > 0 && (digits.length - i) % 3 === 0)
            out += ",";
        out += digits[i];
    }
    return out;
}
/** An integer with thousands separators, as `f"{n:,}"` writes it. */
export function grouped(n) {
    const b = BigInt(n);
    const out = commas((b < 0n ? -b : b).toString());
    return b < 0n ? "-" + out : out;
}
/** `f"{x:,.{places}f}"`. */
export function groupedFixed(x, places) {
    const s = fixed(x, places);
    if (!Number.isFinite(x))
        return s;
    const neg = s.startsWith("-");
    const body = neg ? s.slice(1) : s;
    const dot = body.indexOf(".");
    let out = commas(dot >= 0 ? body.slice(0, dot) : body);
    if (dot >= 0)
        out += body.slice(dot);
    return neg ? "-" + out : out;
}
//# sourceMappingURL=pyfmt.js.map