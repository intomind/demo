/**
 * Where the electrodes are, as data: the part of the Python library's
 * `montage` module a manifest is built with.
 *
 * A montage is a list of channels, each a difference between two named
 * sites, with the bias and the shared reference beside them. It is read from
 * what an application declares, which arrives as JSON, so every rule here is
 * Python's rule on a Python dict, refusal words included.
 */
import * as J from "./pyjson.js";
/** A channel that is the difference of two electrodes. */
export const BIPOLAR = "bipolar";
/** A channel against the montage's shared reference. */
export const REFERENTIAL = "referential";
/** The 10-20 and 10-10 names a site's `ten_twenty` may take. */
const TEN_TWENTY = new Set([
    "Nz", "Fp1", "Fpz", "Fp2", "AF7", "AF3", "AFz", "AF4", "AF8", "F9", "F7", "F5", "F3", "F1", "Fz", "F2", "F4", "F6",
    "F8", "F10", "FT9", "FT7", "FC5", "FC3", "FC1", "FCz", "FC2", "FC4", "FC6", "FT8", "FT10", "T9", "T7", "C5", "C3",
    "C1", "Cz", "C2", "C4", "C6", "T8", "T10", "TP9", "TP7", "CP5", "CP3", "CP1", "CPz", "CP2", "CP4", "CP6", "TP8",
    "TP10", "P9", "P7", "P5", "P3", "P1", "Pz", "P2", "P4", "P6", "P8", "P10", "PO7", "PO3", "POz", "PO4", "PO8", "O1",
    "Oz", "O2", "Iz", "A1", "A2", "M1", "M2",
]);
/** Whether a value is one of the 10-20 and 10-10 names. */
export function tenTwenty(v) {
    return v.kind === "str" && TEN_TWENTY.has(v.value);
}
/**
 * Why a montage or a placement could not be recorded. A `montage` or a
 * `placement` failure is the library's `MontageError` or `PlacementError`,
 * which a manifest records in words. An `other` one is what Python raises
 * past both, a missing key or a value of the wrong kind, and stops a
 * recording from being saved there too.
 */
export class Fail extends Error {
    /** Which of the three it is. */
    kind;
    /** One failure, of a kind, in words. */
    constructor(kind, message) {
        super(message);
        this.name = "Fail";
        this.kind = kind;
    }
}
/** Python's `KeyError` on a missing key. */
export function keyError(key) {
    return new Fail("other", `KeyError: ${J.reprStr(key)}`);
}
/** `d[key]`. */
export function item(d, key) {
    if (d.kind !== "object")
        throw new Fail("other", `TypeError: ${J.pyRepr(d)} is not a dict`);
    const v = J.get(d, key);
    if (v === undefined)
        throw keyError(key);
    return v;
}
/** `d.get(key)`, which needs a dict. */
export function get(d, key) {
    if (d.kind !== "object")
        throw new Fail("other", `AttributeError: ${J.pyRepr(d)} has no get`);
    return J.field(d, key);
}
/** `x or []`, for a value that is then iterated as a list. */
export function list(v) {
    if (v.kind === "array")
        return v.items;
    if (!J.truthy(v))
        return [];
    throw new Fail("other", `TypeError: ${J.pyRepr(v)} is not a list`);
}
/** Whether `sorted(idx) == list(range(1, len(idx) + 1))`. */
export function oneToN(idx) {
    if (idx.every(J.isNumber)) {
        const x = idx.map((v) => J.asF64(v) ?? NaN).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        return x.every((v, i) => v === i + 1);
    }
    if (idx.length <= 1 || idx.every((v) => v.kind === "str"))
        return false;
    throw new Fail("other", "TypeError: '<' not supported between the channel indices");
}
/** `int(value)`, for a channel index. */
function intOf(v) {
    const i = J.asI64(v);
    if (i === null)
        throw new Fail("other", `ValueError: invalid literal for int(): ${J.pyRepr(v)}`);
    return i;
}
/** One electrode position, refused when it has no name or claims a 10-20 name it is not. */
export function site(name, tenTwentyName, description) {
    if (!J.truthy(name))
        throw new Fail("montage", "a site needs a name");
    if (tenTwentyName.kind !== "null" && !tenTwenty(tenTwentyName)) {
        throw new Fail("montage", `${J.pyRepr(tenTwentyName)} is not a 10-20/10-10 position`);
    }
    return J.object([
        ["name", name],
        ["ten_twenty", tenTwentyName],
        ["description", description],
    ]);
}
function isDerivation(v) {
    return v.kind === "str" && (v.value === BIPOLAR || v.value === REFERENTIAL);
}
/** One recorded channel: a difference between two sites. */
export function channel(index, derivation, positive, negative, label) {
    if (!isDerivation(derivation)) {
        throw new Fail("montage", `derivation must be one of ('bipolar', 'referential'), got ${J.pyRepr(derivation)}`);
    }
    const i = intOf(index);
    if (i < 1n)
        throw new Fail("montage", "channel index is 1-based");
    const named = J.truthy(label)
        ? label
        : J.str(`${J.pyStr(item(positive, "name"))}-${J.pyStr(item(negative, "name"))}`);
    return J.object([
        ["index", J.int(i)],
        ["derivation", derivation],
        ["positive", positive],
        ["negative", negative],
        ["label", named],
    ]);
}
/** A montage, assembled and checked. */
export function build(channels, electrode, bias, reference, prose, source) {
    const m = J.object([
        ["electrode", electrode],
        ["channels", J.array(channels)],
        ["bias", bias],
        ["reference", reference],
        ["prose", prose],
        ["source", source],
    ]);
    validate(m);
    return m;
}
/** Refuse a montage that cannot describe a real recording. */
export function validate(m) {
    const chans = list(get(m, "channels"));
    if (chans.length === 0)
        throw new Fail("montage", "a montage with no channels describes nothing");
    const idx = chans.map((c) => item(c, "index"));
    if (!oneToN(idx)) {
        throw new Fail("montage", `channel indices must be 1..n with no gaps, got ${J.pyRepr(J.array(idx))}`);
    }
    const reference = get(m, "reference");
    for (const c of chans) {
        const at = J.pyStr(item(c, "index"));
        const derivation = item(c, "derivation");
        if (!isDerivation(derivation))
            throw new Fail("montage", `ch${at}: bad derivation ${J.pyRepr(derivation)}`);
        for (const pole of ["positive", "negative"]) {
            const s = get(c, pole);
            if (!J.truthy(s) || !J.truthy(get(s, "name")))
                throw new Fail("montage", `ch${at}: ${pole} site is missing`);
            const tt = get(s, "ten_twenty");
            if (tt.kind !== "null" && !tenTwenty(tt)) {
                throw new Fail("montage", `ch${at}: ${J.pyRepr(tt)} is not a 10-20/10-10 position`);
            }
        }
        if (derivation.kind === "str" && derivation.value === REFERENTIAL) {
            if (!J.truthy(reference)) {
                throw new Fail("montage", `ch${at} is referential but the montage names no reference`);
            }
            const theirs = item(item(c, "negative"), "name");
            const ours = item(reference, "name");
            if (!J.pyEq(theirs, ours)) {
                throw new Fail("montage", `ch${at} is referential against ${J.pyRepr(theirs)}, but the montage's reference is ${J.pyRepr(ours)}`);
            }
        }
    }
}
/** How many channels a montage has, 0 when it names none. */
export function channelCount(m) {
    const c = J.get(m, "channels");
    return c !== undefined && c.kind === "array" ? c.items.length : 0;
}
/** The montage a site declares, checked, or null when it declares none. */
export function fromSite(siteCfg) {
    const m = J.truthy(siteCfg) ? get(siteCfg, "montage") : J.NULL;
    if (!J.truthy(m))
        return null;
    validate(m);
    return m;
}
//# sourceMappingURL=montage.js.map