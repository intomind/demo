/**
 * JSON read and written as the Python library reads and writes it.
 *
 * A manifest is read with `json.loads` and an export carries it again as
 * `json.dumps(manifest, sort_keys=True)`, so an export written here holds
 * the same text only if this module keeps what Python keeps: an integer
 * apart from a float, every float exactly, every integer exactly, the order
 * keys arrived in, and `NaN` and `Infinity`, which Python reads and writes
 * although JSON does not define them. `JSON.parse` keeps none of these, so
 * nothing here uses it.
 */
import { repr } from "./pyfmt.js";
import { UNPRINTABLE } from "./unprintable.js";
// Every value this module makes, so that one can be told from plain data an
// application hands in, whatever shape that data has.
const MADE = new WeakSet();
function made(v) {
    MADE.add(v);
    return v;
}
/** Whether `x` is a value this module made, from `loads` or one of the constructors here. */
export function isValue(x) {
    return typeof x === "object" && x !== null && MADE.has(x);
}
/** The null value. */
export const NULL = made({ kind: "null" });
/** A string value. */
export function str(value) {
    return made({ kind: "str", value });
}
/** An integer value, from a number that is a whole number or from a bigint. */
export function int(value) {
    return made({ kind: "int", value: BigInt(value).toString() });
}
/** An integer value from its decimal digits, which may be any length. */
function intDigits(value) {
    return made({ kind: "int", value });
}
/** A float value. */
export function float(value) {
    return made({ kind: "float", value });
}
/** A boolean value. */
export function bool(value) {
    return made({ kind: "bool", value });
}
/** An array value. */
export function array(items) {
    return made({ kind: "array", items });
}
/** An object value, its keys in the order given. */
export function object(entries) {
    return made({ kind: "object", entries });
}
/**
 * Plain JavaScript data as a value: null and undefined as null, a boolean, a
 * string, a bigint as an integer, a number as an integer when it is a whole
 * number a double holds exactly and as a float otherwise, an array, and a
 * `Map` or a plain object with its keys in their order. A value this module
 * made is itself, so a float with no fraction, which Python writes as `3.0`,
 * is said with `float(3)` or read with `loads`. A plain object puts keys that
 * look like integers first, as JavaScript orders them; a `Map` keeps any
 * order. A key whose value is undefined is left out, as `JSON.stringify`
 * leaves it.
 */
export function fromPlain(x) {
    if (isValue(x))
        return x;
    if (x === null || x === undefined)
        return NULL;
    switch (typeof x) {
        case "boolean":
            return bool(x);
        case "string":
            return str(x);
        case "bigint":
            return int(x);
        case "number":
            return Number.isSafeInteger(x) && !Object.is(x, -0) ? int(x) : float(x);
        case "object": {
            if (Array.isArray(x))
                return array(x.map(fromPlain));
            const entries = [];
            if (x instanceof Map) {
                for (const [k, v] of x) {
                    if (typeof k !== "string")
                        throw new TypeError(`a key must be a string, not a ${typeof k}`);
                    if (v !== undefined)
                        entries.push([k, fromPlain(v)]);
                }
                return object(entries);
            }
            const proto = Object.getPrototypeOf(x);
            if (proto !== Object.prototype && proto !== null) {
                throw new TypeError(`${Object.prototype.toString.call(x)} is not data a JSON value can hold`);
            }
            for (const [k, v] of Object.entries(x))
                if (v !== undefined)
                    entries.push([k, fromPlain(v)]);
            return object(entries);
        }
        default:
            throw new TypeError(`a ${typeof x} is not data a JSON value can hold`);
    }
}
/** `d[key] = value` on a Python dict: a key already there keeps its place and takes the value, a new one goes last. */
export function set(d, key, value) {
    if (d.kind !== "object")
        return;
    for (const e of d.entries) {
        if (e[0] === key) {
            e[1] = value;
            return;
        }
    }
    d.entries.push([key, value]);
}
/** `d.pop(key, None)` on a Python dict. */
export function pop(d, key) {
    if (d.kind !== "object")
        return NULL;
    const at = d.entries.findIndex(([k]) => k === key);
    if (at < 0)
        return NULL;
    return d.entries.splice(at, 1)[0][1];
}
/** `dict(d)` in Python: a new object with the same keys in the same order, its values shared. */
export function copyObject(d) {
    return d.kind === "object" ? object(d.entries.map(([k, v]) => [k, v])) : d;
}
/** A boolean, an integer or a float. */
export function isNumber(v) {
    return v.kind === "bool" || v.kind === "int" || v.kind === "float";
}
/** The value as an exact integer, for a boolean, an integer, or a float with no fraction. */
function exactInt(v) {
    if (v.kind === "bool")
        return v.value ? 1n : 0n;
    if (v.kind === "int")
        return BigInt(v.value);
    if (v.kind === "float" && Number.isInteger(v.value))
        return BigInt(v.value);
    return null;
}
/** Python's `==` between two values JSON can hold: numbers by their exact value, whatever their type, and `True` as 1. */
export function pyEq(a, b) {
    switch (a.kind) {
        case "null":
            return b.kind === "null";
        case "str":
            return b.kind === "str" && a.value === b.value;
        case "array":
            return b.kind === "array" && a.items.length === b.items.length && a.items.every((x, i) => pyEq(x, b.items[i]));
        case "object":
            return (b.kind === "object" &&
                a.entries.length === b.entries.length &&
                a.entries.every(([k, v]) => b.entries.some(([k2, v2]) => k === k2 && pyEq(v, v2))));
        default: {
            if (!isNumber(b))
                return false;
            const x = exactInt(a);
            const y = exactInt(b);
            if (x !== null && y !== null)
                return x === y;
            // At least one is a float with a fraction or not finite, which no
            // integer equals.
            return a.kind === "float" && b.kind === "float" && a.value === b.value;
        }
    }
}
/** The value under `key`, when `v` is an object that has it. */
export function get(v, key) {
    if (v.kind !== "object")
        return undefined;
    for (const [k, x] of v.entries)
        if (k === key)
            return x;
    return undefined;
}
/** `meta.get(key)` in Python: the value, or null where it is absent. */
export function field(v, key) {
    return get(v, key) ?? NULL;
}
/** Python's truth value. */
export function truthy(v) {
    switch (v.kind) {
        case "null":
            return false;
        case "bool":
            return v.value;
        case "int":
            return v.value !== "0";
        case "float":
            return v.value !== 0;
        case "str":
            return v.value !== "";
        case "array":
            return v.items.length > 0;
        case "object":
            return v.entries.length > 0;
    }
}
// The characters Rust's `char::is_whitespace` and `str::trim` take as
// whitespace, which are Unicode's White_Space property. JavaScript's own
// `trim` adds U+FEFF and leaves out U+0085.
const WHITE_SPACE = new Set([
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
    0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
/** Whether one code unit is whitespace. Every whitespace character is a single code unit. */
export function isWhitespace(code) {
    return WHITE_SPACE.has(code);
}
/** `s` without whitespace at either end. */
export function trim(s) {
    let a = 0;
    let b = s.length;
    while (a < b && WHITE_SPACE.has(s.charCodeAt(a)))
        a++;
    while (b > a && WHITE_SPACE.has(s.charCodeAt(b - 1)))
        b--;
    return s.slice(a, b);
}
/** `s` without whitespace at its start. */
export function trimStart(s) {
    let a = 0;
    while (a < s.length && WHITE_SPACE.has(s.charCodeAt(a)))
        a++;
    return s.slice(a);
}
const FLOAT_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** `float(text)` for the spellings Python accepts, or null where Python would raise. */
function pythonFloat(s) {
    const t = s.replaceAll("_", "");
    switch (t.toLowerCase()) {
        case "nan":
        case "+nan":
        case "-nan":
            return NaN;
        case "inf":
        case "+inf":
        case "infinity":
        case "+infinity":
            return Infinity;
        case "-inf":
        case "-infinity":
            return -Infinity;
    }
    return FLOAT_TEXT.test(t) ? Number(t) : null;
}
/** `float(value)` in Python, for a number, a boolean or a numeric string. Null where Python would raise. */
export function asF64(v) {
    switch (v.kind) {
        case "bool":
            return v.value ? 1 : 0;
        case "int":
            return Number(v.value);
        case "float":
            return v.value;
        case "str":
            return pythonFloat(trim(v.value));
        default:
            return null;
    }
}
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
/**
 * `int(value)` in Python for an integer, a whole float, a boolean, or a
 * string of digits. Null where Python would raise or the result does not fit
 * 64 bits.
 */
export function asI64(v) {
    switch (v.kind) {
        case "bool":
            return v.value ? 1n : 0n;
        case "int": {
            const b = BigInt(v.value);
            return b >= I64_MIN && b <= I64_MAX ? b : null;
        }
        case "float": {
            if (!Number.isFinite(v.value))
                return null;
            const t = Math.trunc(v.value);
            return Math.abs(t) < 9.2e18 ? BigInt(t) : null;
        }
        case "str": {
            const t = trim(v.value).replaceAll("_", "");
            if (!/^[+-]?\d+$/.test(t))
                return null;
            const b = BigInt(t);
            return b >= I64_MIN && b <= I64_MAX ? b : null;
        }
        default:
            return null;
    }
}
/** The text of a string value, or null for anything else. */
export function asStr(v) {
    return v.kind === "str" ? v.value : null;
}
/** `str(value)` in Python. */
export function pyStr(v) {
    return v.kind === "str" ? v.value : pyRepr(v);
}
/** `repr(value)` in Python, for the values JSON can hold. */
export function pyRepr(v) {
    switch (v.kind) {
        case "null":
            return "None";
        case "bool":
            return v.value ? "True" : "False";
        case "int":
            return v.value;
        case "float":
            return repr(v.value);
        case "str":
            return reprStr(v.value);
        case "array":
            return `[${v.items.map(pyRepr).join(", ")}]`;
        case "object":
            return `{${v.entries.map(([k, x]) => `${reprStr(k)}: ${pyRepr(x)}`).join(", ")}}`;
    }
}
/**
 * Python's `repr` of a string: single quotes unless the text holds a single
 * quote and no double quote, and every character Python does not print as
 * itself written as its escape, from Python's own table.
 */
export function reprStr(s) {
    const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
    let out = quote;
    for (const c of s) {
        const code = c.codePointAt(0);
        if (c === "\\")
            out += "\\\\";
        else if (c === "\n")
            out += "\\n";
        else if (c === "\r")
            out += "\\r";
        else if (c === "\t")
            out += "\\t";
        else if (c === quote)
            out += "\\" + c;
        else if (unprintable(code)) {
            if (code < 0x100)
                out += "\\x" + code.toString(16).padStart(2, "0");
            else if (code < 0x10000)
                out += "\\u" + code.toString(16).padStart(4, "0");
            else
                out += "\\U" + code.toString(16).padStart(8, "0");
        }
        else
            out += c;
    }
    return out + quote;
}
/** Whether Python's `repr` writes this code point as an escape. */
function unprintable(code) {
    let lo = 0;
    let hi = UNPRINTABLE.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const [a, b] = UNPRINTABLE[mid];
        if (b < code)
            lo = mid + 1;
        else if (a > code)
            hi = mid - 1;
        else
            return true;
    }
    return false;
}
/** Why a document is not JSON as Python reads it. */
export class ParseError extends Error {
    /** The reason, and the character it was found at. */
    constructor(message) {
        super(message);
        this.name = "ParseError";
    }
}
/** `json.loads(text)`. Throws a `ParseError` where Python would raise. */
export function loads(text) {
    const p = new Parser(text);
    p.ws();
    const v = p.value();
    p.ws();
    if (p.i !== text.length)
        throw p.err("extra data");
    return v;
}
class Parser {
    s;
    i = 0;
    constructor(s) {
        this.s = s;
    }
    err(what) {
        // Counted in characters, a pair of surrogates being one.
        let n = 0;
        const end = Math.min(this.i, this.s.length);
        for (let k = 0; k < end; k++) {
            const c = this.s.charCodeAt(k);
            if (c >= 0xd800 && c < 0xdc00 && k + 1 < end) {
                const d = this.s.charCodeAt(k + 1);
                if (d >= 0xdc00 && d < 0xe000)
                    k++;
            }
            n++;
        }
        return new ParseError(`${what} at character ${n}`);
    }
    ws() {
        const s = this.s;
        while (this.i < s.length) {
            const c = s.charCodeAt(this.i);
            if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d)
                this.i++;
            else
                break;
        }
    }
    eat(lit) {
        if (this.s.startsWith(lit, this.i)) {
            this.i += lit.length;
            return true;
        }
        return false;
    }
    value() {
        if (this.i >= this.s.length)
            throw this.err("expecting value");
        const c = this.s[this.i];
        if (c === "{")
            return this.object();
        if (c === "[")
            return this.array();
        if (c === '"')
            return str(this.string());
        if (c === "n" && this.eat("null"))
            return NULL;
        if (c === "t" && this.eat("true"))
            return bool(true);
        if (c === "f" && this.eat("false"))
            return bool(false);
        if (c === "N" && this.eat("NaN"))
            return float(NaN);
        if (c === "I" && this.eat("Infinity"))
            return float(Infinity);
        if (c === "-" && this.s.startsWith("-Infinity", this.i)) {
            this.i += "-Infinity".length;
            return float(-Infinity);
        }
        if (c === "-" || (c >= "0" && c <= "9"))
            return this.number();
        throw this.err("expecting value");
    }
    /** `(-?(?:0|[1-9]\d*))(\.\d+)?([eE][-+]?\d+)?`, as Python's scanner matches a number. */
    number() {
        const s = this.s;
        const start = this.i;
        const isDigit = (k) => k < s.length && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57;
        const digits = () => {
            const from = this.i;
            while (isDigit(this.i))
                this.i++;
            return this.i - from;
        };
        if (s[this.i] === "-")
            this.i++;
        if (s[this.i] === "0") {
            this.i++;
        }
        else if (isDigit(this.i)) {
            digits();
        }
        else {
            this.i = start;
            throw this.err("expecting value");
        }
        const intEnd = this.i;
        let isFloat = false;
        if (s[this.i] === "." && isDigit(this.i + 1)) {
            this.i++;
            digits();
            isFloat = true;
        }
        if (s[this.i] === "e" || s[this.i] === "E") {
            const save = this.i;
            this.i++;
            if (s[this.i] === "+" || s[this.i] === "-")
                this.i++;
            if (digits() === 0)
                this.i = save;
            else
                isFloat = true;
        }
        if (isFloat)
            return float(Number(s.slice(start, this.i)));
        const t = s.slice(start, intEnd);
        const neg = t.startsWith("-");
        const body = neg ? t.slice(1) : t;
        return intDigits(body === "0" || !neg ? body : "-" + body);
    }
    hex4() {
        const h = this.s.slice(this.i, this.i + 4);
        if (h.length < 4 || !/^[0-9a-fA-F]{4}$/.test(h))
            throw this.err("invalid \\uXXXX escape");
        this.i += 4;
        return parseInt(h, 16);
    }
    string() {
        const s = this.s;
        this.i++; // the opening quote
        let out = "";
        for (;;) {
            const start = this.i;
            while (this.i < s.length) {
                const c = s.charCodeAt(this.i);
                if (c === 0x22 || c === 0x5c || c < 0x20)
                    break;
                this.i++;
            }
            out += s.slice(start, this.i);
            if (this.i >= s.length)
                throw this.err("unterminated string");
            const c = s[this.i];
            if (c === '"') {
                this.i++;
                return out;
            }
            if (c !== "\\")
                throw this.err("invalid control character");
            this.i++;
            if (this.i >= s.length)
                throw this.err("unterminated string");
            const e = s[this.i];
            this.i++;
            switch (e) {
                case '"':
                    out += '"';
                    break;
                case "\\":
                    out += "\\";
                    break;
                case "/":
                    out += "/";
                    break;
                case "b":
                    out += "\b";
                    break;
                case "f":
                    out += "\f";
                    break;
                case "n":
                    out += "\n";
                    break;
                case "r":
                    out += "\r";
                    break;
                case "t":
                    out += "\t";
                    break;
                case "u": {
                    const u = this.hex4();
                    let code = u;
                    if (u >= 0xd800 && u < 0xdc00 && s.startsWith("\\u", this.i)) {
                        const save = this.i;
                        this.i += 2;
                        const lo = this.hex4();
                        if (lo >= 0xdc00 && lo < 0xe000)
                            code = 0x10000 + ((u - 0xd800) << 10) + (lo - 0xdc00);
                        else
                            this.i = save;
                    }
                    // Python keeps a lone surrogate. The Rust crate cannot hold one,
                    // so such a manifest is refused there, and here alike.
                    if (code >= 0xd800 && code < 0xe000)
                        throw this.err("a lone surrogate");
                    out += String.fromCodePoint(code);
                    break;
                }
                default:
                    throw this.err("invalid escape");
            }
        }
    }
    array() {
        this.i++;
        const items = [];
        this.ws();
        if (this.s[this.i] === "]") {
            this.i++;
            return array(items);
        }
        for (;;) {
            this.ws();
            items.push(this.value());
            this.ws();
            const c = this.s[this.i];
            if (c === ",")
                this.i++;
            else if (c === "]") {
                this.i++;
                return array(items);
            }
            else
                throw this.err("expecting ',' delimiter");
        }
    }
    object() {
        this.i++;
        const entries = [];
        const at = new Map();
        this.ws();
        if (this.s[this.i] === "}") {
            this.i++;
            return object(entries);
        }
        for (;;) {
            this.ws();
            if (this.s[this.i] !== '"')
                throw this.err("expecting property name enclosed in double quotes");
            const k = this.string();
            this.ws();
            if (this.s[this.i] !== ":")
                throw this.err("expecting ':' delimiter");
            this.i++;
            this.ws();
            const v = this.value();
            const slot = at.get(k);
            if (slot === undefined) {
                at.set(k, entries.length);
                entries.push([k, v]);
            }
            else {
                entries[slot][1] = v;
            }
            this.ws();
            const c = this.s[this.i];
            if (c === ",")
                this.i++;
            else if (c === "}") {
                this.i++;
                return object(entries);
            }
            else
                throw this.err("expecting ',' delimiter");
        }
    }
}
/** A string as `json.dumps` writes it with `ensure_ascii`: everything outside the printable ASCII range escaped, in lowercase hex. */
function writeStr(s) {
    let out = '"';
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0x5c)
            out += "\\\\";
        else if (c === 0x22)
            out += '\\"';
        else if (c === 0x0a)
            out += "\\n";
        else if (c === 0x0d)
            out += "\\r";
        else if (c === 0x09)
            out += "\\t";
        else if (c === 0x08)
            out += "\\b";
        else if (c === 0x0c)
            out += "\\f";
        else if (c >= 0x20 && c <= 0x7e)
            out += s[i];
        else
            out += "\\u" + c.toString(16).padStart(4, "0");
    }
    return out + '"';
}
/** The text `json.dumps` writes for a value as a dict's key, and null for a list or an object, which no dict holds as a key. */
export function jsonKey(v) {
    switch (v.kind) {
        case "str":
        case "int":
            return v.value;
        case "float":
            return writeFloat(v.value);
        case "bool":
            return v.value ? "true" : "false";
        case "null":
            return "null";
        default:
            return null;
    }
}
function writeFloat(f) {
    if (Number.isNaN(f))
        return "NaN";
    if (f === Infinity)
        return "Infinity";
    if (f === -Infinity)
        return "-Infinity";
    return repr(f);
}
/** Two strings in Python's order, which is code point order, not UTF-16's. */
export function compareKeys(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const x = a.codePointAt(i);
        const y = b.codePointAt(i);
        if (x !== y)
            return x < y ? -1 : 1;
        if (x > 0xffff)
            i++;
    }
    return a.length - b.length;
}
/** `json.dumps(value, sort_keys=True)`: one line, `", "` and `": "`. */
export function dumpsSorted(v) {
    return oneLine(v, true);
}
/** `json.dumps(value)`: one line, keys in their order. */
export function dumps(v) {
    return oneLine(v, false);
}
function oneLine(v, sort) {
    const parts = [];
    const go = (v) => {
        switch (v.kind) {
            case "null":
                parts.push("null");
                return;
            case "bool":
                parts.push(v.value ? "true" : "false");
                return;
            case "int":
                parts.push(v.value);
                return;
            case "float":
                parts.push(writeFloat(v.value));
                return;
            case "str":
                parts.push(writeStr(v.value));
                return;
            case "array":
                parts.push("[");
                v.items.forEach((x, i) => {
                    if (i > 0)
                        parts.push(", ");
                    go(x);
                });
                parts.push("]");
                return;
            case "object": {
                const items = sort ? [...v.entries].sort((a, b) => compareKeys(a[0], b[0])) : v.entries;
                parts.push("{");
                items.forEach(([k, x], i) => {
                    if (i > 0)
                        parts.push(", ");
                    parts.push(writeStr(k), ": ");
                    go(x);
                });
                parts.push("}");
                return;
            }
        }
    };
    go(v);
    return parts.join("");
}
/** `json.dumps(value, indent=indent)`: keys in their order, `","` at line ends, and `": "` after a key. */
export function dumpsIndented(v, indent) {
    const parts = [];
    const go = (v, level) => {
        const pad = (n) => {
            parts.push(" ".repeat(indent * n));
        };
        if (v.kind === "array" && v.items.length > 0) {
            parts.push("[");
            v.items.forEach((x, i) => {
                parts.push(i > 0 ? ",\n" : "\n");
                pad(level + 1);
                go(x, level + 1);
            });
            parts.push("\n");
            pad(level);
            parts.push("]");
        }
        else if (v.kind === "object" && v.entries.length > 0) {
            parts.push("{");
            v.entries.forEach(([k, x], i) => {
                parts.push(i > 0 ? ",\n" : "\n");
                pad(level + 1);
                parts.push(writeStr(k), ": ");
                go(x, level + 1);
            });
            parts.push("\n");
            pad(level);
            parts.push("}");
        }
        else {
            parts.push(dumpsSorted(v));
        }
    };
    go(v, 0);
    return parts.join("");
}
/**
 * A value as plain JavaScript: an integer as a number, or as a bigint where
 * a number cannot hold it exactly, and an object as a plain object in its
 * key order.
 */
export function toPlain(v) {
    switch (v.kind) {
        case "null":
            return null;
        case "bool":
        case "float":
        case "str":
            return v.value;
        case "int": {
            const b = BigInt(v.value);
            return b >= -(2n ** 53n) && b <= 2n ** 53n ? Number(b) : b;
        }
        case "array":
            return v.items.map(toPlain);
        case "object": {
            const out = {};
            for (const [k, x] of v.entries) {
                // Defined rather than assigned, so a key named `__proto__` is a key.
                Object.defineProperty(out, k, { value: toPlain(x), enumerable: true, writable: true, configurable: true });
            }
            return out;
        }
    }
}
//# sourceMappingURL=pyjson.js.map