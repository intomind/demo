/**
 * numpy's `.npy` arrays, read and written as numpy writes them.
 *
 * Only the element types a recording or an export holds are here:
 * booleans, integers, floats, and the fixed-width unicode text an export
 * keeps its manifest in. A two-dimensional array may be stored in either
 * order, and the recorder stores its counts sample by sample, which numpy
 * calls Fortran order for a channels by samples array. 64-bit integers are
 * held as bigints, so none is rounded on the way through.
 */
/** Why an array could not be read. */
export class NpyError extends Error {
    /** What is wrong with the array file, in words. */
    constructor(message) {
        super(message);
        this.name = "NpyError";
    }
}
/** How many elements `d` holds. */
export function len(d) {
    return d.values.length;
}
/** numpy's name for the element type, as `dtype.str` spells it. */
export function descr(d) {
    switch (d.kind) {
        case "b1":
            return "|b1";
        case "u1":
            return "|u1";
        case "i1":
            return "|i1";
        case "U":
            return `<U${d.width}`;
        default:
            return "<" + d.kind;
    }
}
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
/** A float as a 64-bit integer, truncated toward zero, saturating, and zero for a NaN, as Rust's `as i64` converts it. */
export function floatToI64(x) {
    if (Number.isNaN(x))
        return 0n;
    if (x >= 9223372036854775807)
        return I64_MAX;
    if (x <= -9223372036854775808)
        return I64_MIN;
    return BigInt(Math.trunc(x));
}
/** Element `i` as a float, as numpy's `astype(float64)` converts it. */
export function f64At(d, i) {
    switch (d.kind) {
        case "u8":
        case "i8":
            return Number(d.values[i]);
        case "U":
            return NaN;
        default:
            return d.values[i];
    }
}
/** Element `i` as a 64-bit integer. A float is truncated toward zero. */
export function i64At(d, i) {
    switch (d.kind) {
        case "i8":
            return d.values[i];
        case "u8":
            return BigInt.asIntN(64, d.values[i]);
        case "f4":
        case "f8":
            return floatToI64(d.values[i]);
        case "U":
            return 0n;
        default:
            return BigInt(d.values[i]);
    }
}
/** Element `i` as a number that holds it exactly, for an integer type whose values all fit. */
export function intAt(d, i) {
    switch (d.kind) {
        case "u8":
        case "i8":
        case "f4":
        case "f8":
        case "U":
            return Number(i64At(d, i));
        default:
            return d.values[i];
    }
}
/** Element `i` as numpy's `astype(bool)` converts it: nonzero is true. */
export function boolAt(d, i) {
    switch (d.kind) {
        case "U":
            return d.values[i] !== "";
        case "u8":
        case "i8":
            return d.values[i] !== 0n;
        default:
            return d.values[i] !== 0;
    }
}
/** The elements at `keep`, in that order, as numpy's fancy indexing takes them. */
export function take(d, keep) {
    const n = keep.length;
    switch (d.kind) {
        case "U": {
            const values = new Array(n);
            for (let k = 0; k < n; k++)
                values[k] = d.values[keep[k]];
            return { kind: "U", width: d.width, values };
        }
        default: {
            const src = d.values;
            const Ctor = d.values.constructor;
            const out = new Ctor(n);
            for (let k = 0; k < n; k++)
                out[k] = src[keep[k]];
            return { kind: d.kind, values: out };
        }
    }
}
/** The elements from `start` on. */
export function skip(d, start) {
    const from = Math.min(start, len(d));
    const keep = new Int32Array(len(d) - from);
    for (let k = 0; k < keep.length; k++)
        keep[k] = from + k;
    return take(d, keep);
}
/** The bytes numpy stores for these elements, little endian. */
export function bytesOf(d) {
    if (d.kind === "U") {
        const out = new Uint8Array(4 * d.width * d.values.length);
        const view = new DataView(out.buffer);
        d.values.forEach((s, k) => {
            let at = 4 * d.width * k;
            for (const c of s) {
                view.setUint32(at, c.codePointAt(0), true);
                at += 4;
            }
        });
        return out;
    }
    const v = d.values;
    // Typed arrays are in the platform's byte order, which is little endian
    // everywhere this runs; written element by element where it is not.
    if (LITTLE)
        return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    const out = new Uint8Array(v.byteLength);
    const view = new DataView(out.buffer);
    const size = v.BYTES_PER_ELEMENT;
    for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (typeof x === "bigint")
            view.setBigUint64(i * 8, BigInt.asUintN(64, x), true);
        else if (d.kind === "f4")
            view.setFloat32(i * 4, x, true);
        else if (d.kind === "f8")
            view.setFloat64(i * 8, x, true);
        else if (size === 1)
            view.setUint8(i, x & 0xff);
        else if (size === 2)
            view.setUint16(i * 2, x & 0xffff, true);
        else
            view.setUint32(i * 4, x >>> 0, true);
    }
    return out;
}
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** A one-dimensional array. */
export function vector(data) {
    return { shape: [len(data)], fortran: false, data };
}
/** A zero-dimensional text array, as `np.array(text)` makes one. numpy gives an empty text a width of one. */
export function text(s) {
    let width = 0;
    for (const _ of s)
        width++;
    return { shape: [], fortran: false, data: { kind: "U", width: Math.max(1, width), values: [s] } };
}
/** The storage positions of row `r` of a two-dimensional array, in order, whichever order it is stored in. A one-dimensional array has one row. */
export function rowIndices(a, r) {
    if (a.shape.length === 2) {
        const [rows, cols] = a.shape;
        const out = new Int32Array(cols);
        for (let c = 0; c < cols; c++)
            out[c] = a.fortran ? c * rows + r : r * cols + c;
        return out;
    }
    const out = new Int32Array(len(a.data));
    for (let k = 0; k < out.length; k++)
        out[k] = k;
    return out;
}
/** The header numpy writes for an array: the dictionary with its keys in order, the spare room numpy leaves for the growing axis, and padding so that the data starts on a 64-byte boundary. */
function header(a) {
    const shape = a.shape.length === 0 ? "()" : a.shape.length === 1 ? `(${a.shape[0]},)` : `(${a.shape.join(", ")})`;
    let h = `{'descr': '${descr(a.data)}', 'fortran_order': ${a.fortran ? "True" : "False"}, 'shape': ${shape}, }`;
    if (a.shape.length > 0) {
        const growth = a.fortran ? a.shape[a.shape.length - 1] : a.shape[0];
        h += " ".repeat(Math.max(0, 21 - String(growth).length));
    }
    // Version 1.0 holds a header length in two bytes, and numpy moves to 2.0,
    // four bytes, only when it does not fit.
    const hlen = h.length + 1;
    const pad1 = 64 - ((10 + hlen) % 64);
    const v1 = hlen + pad1 <= 65535;
    const prefix = v1 ? 10 : 12;
    const pad = v1 ? pad1 : 64 - ((12 + hlen) % 64);
    const total = hlen + pad;
    const out = new Uint8Array(prefix + total);
    out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, v1 ? 1 : 2, 0]);
    const view = new DataView(out.buffer);
    if (v1)
        view.setUint16(8, total, true);
    else
        view.setUint32(8, total, true);
    for (let k = 0; k < h.length; k++)
        out[prefix + k] = h.charCodeAt(k);
    out.fill(0x20, prefix + h.length, prefix + total - 1);
    out[prefix + total - 1] = 0x0a;
    return out;
}
/** The `.npy` file numpy's `save` writes for `a`. */
export function write(a) {
    const h = header(a);
    const body = bytesOf(a.data);
    const out = new Uint8Array(h.length + body.length);
    out.set(h);
    out.set(body, h.length);
    return out;
}
/** One value of the header dictionary, as text. */
function headerField(h, key) {
    const at = h.indexOf(`'${key}'`);
    if (at < 0)
        return null;
    let rest = h.slice(at + key.length + 2).replace(/^\s+/, "");
    if (!rest.startsWith(":"))
        return null;
    rest = rest.slice(1).replace(/^\s+/, "");
    let end;
    if (rest.startsWith("(")) {
        const close = rest.indexOf(")");
        if (close < 0)
            return null;
        end = close + 1;
    }
    else if (rest.startsWith("'")) {
        const close = rest.indexOf("'", 1);
        if (close < 0)
            return null;
        end = close + 1;
    }
    else {
        const comma = rest.search(/[,}]/);
        if (comma < 0)
            return null;
        end = comma;
    }
    return rest.slice(0, end).trim();
}
/** An `.npy` file's array. */
export function read(b) {
    const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
    if (b.length < 10 || !magic.every((m, k) => b[k] === m))
        throw new NpyError("not a numpy array file");
    let hlen;
    let start;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b[6] === 1) {
        hlen = view.getUint16(8, true);
        start = 10;
    }
    else if (b[6] === 2 || b[6] === 3) {
        if (b.length < 12)
            throw new NpyError("the array file ends early");
        hlen = view.getUint32(8, true);
        start = 12;
    }
    else {
        throw new NpyError(`numpy array format version ${b[6]} is not one numpy writes`);
    }
    if (start + hlen > b.length)
        throw new NpyError("the array file ends early");
    let h;
    try {
        h = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b.subarray(start, start + hlen));
    }
    catch {
        throw new NpyError("the array header is not text");
    }
    const descrField = headerField(h, "descr");
    if (descrField === null)
        throw new NpyError("the array header has no descr");
    const dt = descrField.replace(/^'+|'+$/g, "");
    const fortranField = headerField(h, "fortran_order");
    if (fortranField !== "True" && fortranField !== "False")
        throw new NpyError("the array header has no fortran_order");
    const fortran = fortranField === "True";
    const shapeField = headerField(h, "shape");
    if (shapeField === null)
        throw new NpyError("the array header has no shape");
    const shape = [];
    for (const part of shapeField.replace(/^[()]+|[()]+$/g, "").split(",")) {
        const t = part.trim();
        if (t === "")
            continue;
        const digits = t.replace(/L+$/, "");
        if (!/^\+?\d+$/.test(digits))
            throw new NpyError("the array shape is not a list of sizes");
        shape.push(Number(digits));
    }
    const count = shape.reduce((p, d) => p * d, 1);
    const body = b.subarray(start + hlen);
    const order = dt.slice(0, 1);
    const kind = dt.slice(1);
    let big;
    if (order === "<" || order === "|" || order === "=")
        big = false;
    else if (order === ">")
        big = true;
    else
        throw new NpyError(`element type ${dt} is not one a recording holds`);
    const early = () => {
        throw new NpyError("the array file ends early");
    };
    const raw = (size) => {
        if (body.length < count * size)
            early();
        return new DataView(body.buffer, body.byteOffset, count * size);
    };
    let data;
    switch (kind) {
        case "b1": {
            if (body.length < count)
                early();
            const values = new Uint8Array(count);
            for (let k = 0; k < count; k++)
                values[k] = body[k] !== 0 ? 1 : 0;
            data = { kind: "b1", values };
            break;
        }
        case "u1":
            if (body.length < count)
                early();
            data = { kind: "u1", values: body.slice(0, count) };
            break;
        case "i1":
            if (body.length < count)
                early();
            data = { kind: "i1", values: new Int8Array(body.slice(0, count).buffer) };
            break;
        case "u2": {
            const v = raw(2);
            const values = new Uint16Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getUint16(2 * k, !big);
            data = { kind: "u2", values };
            break;
        }
        case "i2": {
            const v = raw(2);
            const values = new Int16Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getInt16(2 * k, !big);
            data = { kind: "i2", values };
            break;
        }
        case "u4": {
            const v = raw(4);
            const values = new Uint32Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getUint32(4 * k, !big);
            data = { kind: "u4", values };
            break;
        }
        case "i4": {
            const v = raw(4);
            const values = new Int32Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getInt32(4 * k, !big);
            data = { kind: "i4", values };
            break;
        }
        case "u8": {
            const v = raw(8);
            const values = new BigUint64Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getBigUint64(8 * k, !big);
            data = { kind: "u8", values };
            break;
        }
        case "i8": {
            const v = raw(8);
            const values = new BigInt64Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getBigInt64(8 * k, !big);
            data = { kind: "i8", values };
            break;
        }
        case "f4": {
            const v = raw(4);
            const values = new Float32Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getFloat32(4 * k, !big);
            data = { kind: "f4", values };
            break;
        }
        case "f8": {
            const v = raw(8);
            const values = new Float64Array(count);
            for (let k = 0; k < count; k++)
                values[k] = v.getFloat64(8 * k, !big);
            data = { kind: "f8", values };
            break;
        }
        default: {
            if (!kind.startsWith("U") || !/^\d+$/.test(kind.slice(1))) {
                throw new NpyError(`element type ${dt} is not one a recording holds`);
            }
            const width = Number(kind.slice(1));
            if (body.length < count * width * 4)
                early();
            const v = new DataView(body.buffer, body.byteOffset, count * width * 4);
            const values = [];
            const item = Math.max(1, width * 4);
            for (let k = 0; k < count && (k + 1) * item <= count * width * 4; k++) {
                let s = "";
                for (let u = 0; u < width; u++) {
                    const cp = v.getUint32(k * width * 4 + 4 * u, !big);
                    if (cp === 0)
                        break;
                    if (cp > 0x10ffff || (cp >= 0xd800 && cp < 0xe000))
                        throw new NpyError("text that is not unicode");
                    s += String.fromCodePoint(cp);
                }
                values.push(s);
            }
            data = { kind: "U", width, values };
        }
    }
    return { shape, fortran, data };
}
//# sourceMappingURL=npy.js.map