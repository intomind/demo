/**
 * Where the electrodes went, and what is under them: the part of the Python
 * library's `placement` module a manifest is built with.
 *
 * A layout is what a device offers: its slots and how they are wired into
 * channels. A placement is where a person put it, this time. A manifest
 * records both, the placement resolved against the scalp positions and the
 * regions under them, and the montage generated from the two. Both arrive as
 * JSON from an application, so every rule here is Python's rule on a Python
 * dict, refusal words included.
 */
import * as M from "./montage.js";
import { Fail, get, item, keyError, list, oneToN } from "./montage.js";
import { general } from "./pyfmt.js";
import * as J from "./pyjson.js";
const LEFT = "left";
const RIGHT = "right";
const MIDLINE = "midline";
const RECORDING = "recording";
const BIAS = "bias";
const REFERENCE = "reference";
/** What can be under an electrode: key, words, and kind. */
const REGIONS = [
    ["frontal-pole", "frontal pole", "cortical"],
    ["dlpfc", "dorsolateral prefrontal", "cortical"],
    ["vlpfc", "ventrolateral prefrontal", "cortical"],
    ["orbitofrontal", "orbitofrontal", "cortical"],
    ["premotor", "premotor and supplementary motor", "cortical"],
    ["motor", "primary motor", "cortical"],
    ["somatosensory", "primary somatosensory", "cortical"],
    ["superior-parietal", "superior parietal", "cortical"],
    ["tpj", "inferior parietal and temporoparietal junction", "cortical"],
    ["temporal-pole", "temporal pole", "cortical"],
    ["superior-temporal", "superior temporal", "cortical"],
    ["inferior-temporal", "middle and inferior temporal", "cortical"],
    ["lateral-occipital", "lateral occipital", "cortical"],
    ["medial-occipital", "medial occipital", "cortical"],
    ["temporalis", "temporalis (jaw muscle)", "muscle"],
    ["frontalis", "frontalis (brow muscle)", "muscle"],
    ["ocular", "eye movement", "ocular"],
    ["mastoid-bone", "mastoid bone, little cortex beneath", "bone"],
];
const ZONES = [
    ["forehead-outer", "outer forehead, above the brow's outer end", [[LEFT, "AF7"], [RIGHT, "AF8"]], ["frontal-pole", "dlpfc", "ocular", "frontalis"]],
    ["forehead-inner", "inner forehead, above the brow", [[LEFT, "Fp1"], [RIGHT, "Fp2"]], ["frontal-pole", "orbitofrontal", "ocular", "frontalis"]],
    ["forehead-center", "center of the forehead", [[MIDLINE, "Fpz"]], ["frontal-pole", "ocular", "frontalis"]],
    ["hairline", "forehead at the hairline", [[LEFT, "F5"], [RIGHT, "F6"], [MIDLINE, "Fz"]], ["dlpfc", "vlpfc", "frontalis"]],
    ["temple-front", "temple, front", [[LEFT, "F7"], [RIGHT, "F8"]], ["vlpfc", "temporalis", "temporal-pole"]],
    ["temple-back", "temple, back", [[LEFT, "FT7"], [RIGHT, "FT8"]], ["temporalis", "superior-temporal", "vlpfc"]],
    ["in-front-of-ear", "in front of the ear", [[LEFT, "FT9"], [RIGHT, "FT10"]], ["temporalis", "temporal-pole"]],
    ["above-ear", "above the ear", [[LEFT, "T7"], [RIGHT, "T8"]], ["superior-temporal", "temporalis"]],
    ["behind-ear", "behind the ear, on the bone", [[LEFT, "TP9"], [RIGHT, "TP10"]], ["mastoid-bone", "inferior-temporal"]],
    ["behind-above-ear", "behind and above the ear", [[LEFT, "TP7"], [RIGHT, "TP8"]], ["tpj", "superior-temporal"]],
    ["side-of-head", "side of the head, above and forward of the ear", [[LEFT, "C5"], [RIGHT, "C6"]], ["somatosensory", "motor"]],
    ["crown-side", "crown, off to the side", [[LEFT, "C3"], [RIGHT, "C4"]], ["motor", "somatosensory", "premotor"]],
    ["top-of-head", "top of the head", [[MIDLINE, "Cz"]], ["motor", "premotor"]],
    ["back-of-head-side", "back of the head, off to the side", [[LEFT, "P3"], [RIGHT, "P4"]], ["superior-parietal", "tpj"]],
    ["crown-back", "crown, toward the back", [[MIDLINE, "Pz"]], ["superior-parietal"]],
    ["back-of-head-low", "back of the head, low", [[LEFT, "O1"], [RIGHT, "O2"]], ["lateral-occipital", "medial-occipital"]],
    ["back-of-head-center", "back of the head, center", [[MIDLINE, "Oz"]], ["medial-occipital"]],
    ["nape", "the bump at the base of the skull", [[MIDLINE, "Iz"]], ["medial-occipital"]],
];
/** Every scalp position, in the order the Python library builds them. */
function scalpTable() {
    const out = [];
    for (const [zone, human, sides, over] of ZONES) {
        for (const [side, tt] of sides) {
            const key = side === MIDLINE ? zone : `${side}-${zone}`;
            const words = side === MIDLINE ? human : `${side} ${human}`;
            out.push([
                key,
                J.object([
                    ["key", J.str(key)],
                    ["zone", J.str(zone)],
                    ["side", J.str(side)],
                    ["human", J.str(words)],
                    ["ten_ten", J.str(tt)],
                    ["over", J.array(over.map(J.str))],
                ]),
            ]);
        }
    }
    return out;
}
/** One scalp position by key, or the refusal naming how many there are. */
function scalp(key) {
    const table = scalpTable();
    if (key.kind === "array" || key.kind === "object") {
        throw new Fail("other", `TypeError: unhashable type: ${J.pyRepr(key)}`);
    }
    if (key.kind === "str") {
        const found = table.find(([t]) => t === key.value);
        if (found !== undefined)
            return found[1];
    }
    throw new Fail("placement", `${J.pyRepr(key)} is not a scalp position. There are ${table.length}; \`placement.choices()\` lists them.`);
}
function region(key) {
    if (key.kind !== "str")
        return null;
    return REGIONS.find(([r]) => r === key.value) ?? null;
}
/** What is under a scalp position, its side carried down, each entry marked as inferred. */
function regionsUnder(scalpKey) {
    const s = scalp(scalpKey);
    const side = J.pyStr(J.field(s, "side"));
    const out = [];
    for (const key of list(J.field(s, "over"))) {
        const r = region(key);
        if (r === null)
            throw keyError(J.pyStr(key));
        const [k, human, kind] = r;
        const sided = side !== MIDLINE && kind !== "ocular" ? `${side} ${human}` : human;
        out.push(J.object([
            ["region", J.str(k)],
            ["human", J.str(sided)],
            ["kind", J.str(kind)],
            ["side", J.str(side)],
            ["derived", J.bool(true)],
        ]));
    }
    return out;
}
/** A key a Python dict can hold. A list or an object cannot be one. */
function hashable(v) {
    if (v.kind === "array" || v.kind === "object")
        throw new Fail("other", `TypeError: unhashable type: ${J.pyRepr(v)}`);
}
/** `{s["key"]: s for s in slots}`: insertion order, a repeated key keeping its first place and its last slot. */
function slotsByKey(slots) {
    const out = [];
    for (const s of slots) {
        const k = item(s, "key");
        hashable(k);
        const have = out.find(([h]) => J.pyEq(h, k));
        if (have !== undefined)
            have[1] = s;
        else
            out.push([k, s]);
    }
    return out;
}
function has(slots, k) {
    hashable(k);
    return slots.some(([h]) => J.pyEq(h, k));
}
function slotOf(slots, k) {
    return slots.find(([h]) => J.pyEq(h, k))?.[1] ?? null;
}
/** The keys of a JSON object, as values: what `for k in d` iterates. */
function keys(d) {
    if (d.kind === "object")
        return d.entries.map(([k]) => J.str(k));
    if (!J.truthy(d))
        return [];
    throw new Fail("other", `AttributeError: ${J.pyRepr(d)} has no keys`);
}
/** `k in d` for a JSON object, whose keys are strings. */
function inObject(d, k) {
    hashable(k);
    return d.kind === "object" && k.kind === "str" && d.entries.some(([h]) => h === k.value);
}
/** What `for r in value` yields: a list's items, a string's characters, an object's keys. */
function iterate(v) {
    if (v.kind === "array")
        return v.items;
    if (v.kind === "str")
        return Array.from(v.value, (c) => J.str(c));
    if (v.kind === "object")
        return keys(v);
    throw new Fail("other", `TypeError: ${J.pyRepr(v)} is not iterable`);
}
function roleIs(s, role) {
    const r = item(s, "role");
    return r.kind === "str" && r.value === role;
}
/** Refuse a layout that could not be wired. */
function validateLayout(f) {
    const slots = slotsByKey(list(get(f, "slots")));
    if (slots.length === 0)
        throw new Fail("placement", "a layout with no slots describes nothing");
    const chans = list(get(f, "channels"));
    if (chans.length === 0)
        throw new Fail("placement", `${J.pyRepr(get(f, "key"))} declares no channels`);
    const idx = chans.map((c) => item(c, "index"));
    if (!oneToN(idx)) {
        throw new Fail("placement", `channel indices must be 1..n with no gaps, got ${J.pyRepr(J.array(idx))}`);
    }
    const refs = [];
    for (const [, s] of slots)
        if (roleIs(s, REFERENCE))
            refs.push(s);
    for (const c of chans) {
        const at = J.pyStr(item(c, "index"));
        const derivation = item(c, "derivation");
        if (!(derivation.kind === "str" && (derivation.value === M.BIPOLAR || derivation.value === M.REFERENTIAL))) {
            throw new Fail("placement", `ch${at}: bad derivation ${J.pyRepr(derivation)}`);
        }
        for (const pole of ["positive", "negative"]) {
            const named = get(c, pole);
            if (!has(slots, named)) {
                throw new Fail("placement", `ch${at}: ${pole} names slot ${J.pyRepr(named)}, which this layout does not have`);
            }
        }
        if (derivation.value === M.REFERENTIAL) {
            if (refs.length !== 1) {
                throw new Fail("placement", `ch${at} is single-ended, so this layout needs exactly one reference slot; it has ${refs.length}`);
            }
            const negative = item(c, "negative");
            const reference = item(refs[0], "key");
            if (!J.pyEq(negative, reference)) {
                throw new Fail("placement", `ch${at} is single-ended against ${J.pyRepr(negative)}, but the reference slot is ${J.pyRepr(reference)}`);
            }
        }
    }
    for (const p of list(get(f, "presets")))
        validatePreset(f, p, slots);
}
function validatePreset(f, p, slots) {
    // `f['key']` is read only where the words need it, as Python reads it.
    const lay = () => J.pyStr(item(f, "key"));
    if (!J.truthy(get(p, "key")))
        throw new Fail("placement", `${lay()}: a preset needs a key`);
    const sites = get(p, "sites");
    const missing = [];
    for (const [k, s] of slots)
        if (!inObject(sites, k) && !roleIs(s, BIAS))
            missing.push(k);
    if (missing.length > 0) {
        const names = [];
        for (const k of missing) {
            if (k.kind !== "str")
                throw new Fail("other", `TypeError: sequence item: expected str, ${J.pyRepr(k)}`);
            names.push(k.value);
        }
        names.sort(codePointOrder);
        throw new Fail("placement", `${lay()}/${J.pyStr(item(p, "key"))}: no site for slot(s) ${names.join(", ")}`);
    }
    if (sites.kind === "object") {
        for (const [k, v] of sites.entries) {
            if (!has(slots, J.str(k))) {
                throw new Fail("placement", `${lay()}/${J.pyStr(item(p, "key"))}: ${J.reprStr(k)} is not a slot`);
            }
            scalp(v);
        }
    }
    else if (J.truthy(sites)) {
        throw new Fail("other", "AttributeError: a preset's sites is not a dict");
    }
    if (get(p, "rotation_deg").kind !== "null" && !J.truthy(get(f, "rotatable"))) {
        const l = lay();
        throw new Fail("placement", `${l}/${J.pyStr(item(p, "key"))} states a rotation, but ${l} is not rotatable`);
    }
}
/** Two strings in Python's order, which is code point order. */
function codePointOrder(a, b) {
    const x = Array.from(a, (c) => c.codePointAt(0));
    const y = Array.from(b, (c) => c.codePointAt(0));
    for (let i = 0; i < Math.min(x.length, y.length); i++)
        if (x[i] !== y[i])
            return x[i] - y[i];
    return x.length - y.length;
}
/** A layout as an application declares it, checked. Null for nothing. */
export function layoutFrom(d) {
    if (!J.truthy(d))
        return null;
    validateLayout(d);
    return d;
}
/** `p.get(key, default)`. */
function getOr(d, key, fallback) {
    if (d.kind !== "object")
        throw new Fail("other", `AttributeError: ${J.pyRepr(d)} has no get`);
    return J.get(d, key) ?? fallback;
}
/** Refuse a placement that does not put every electrode somewhere. */
function validatePlacement(lay, p) {
    const theirs = get(p, "layout");
    const ours = get(lay, "key");
    if (!J.pyEq(theirs, ours)) {
        throw new Fail("placement", `this placement is for layout ${J.pyRepr(theirs)}, not ${J.pyRepr(ours)}`);
    }
    const name = () => J.pyStr(item(lay, "key"));
    const slots = slotsByKey(list(item(lay, "slots")));
    const sites = get(p, "sites");
    for (const k of keys(sites)) {
        if (!has(slots, k))
            throw new Fail("placement", `${J.pyRepr(k)} is not a slot on ${name()}`);
        scalp(J.field(sites, J.pyStr(k)));
    }
    const yes = J.bool(true);
    for (const [k, s] of slots) {
        if (inObject(sites, k))
            continue;
        if (roleIs(s, BIAS) && !J.truthy(getOr(p, "bias_driven", yes)))
            continue;
        throw new Fail("placement", `${name()}: no site for slot ${J.pyRepr(k)} (${J.pyStr(item(s, "human"))})`);
    }
    const over = get(p, "over");
    for (const k of keys(over)) {
        if (!has(slots, k))
            throw new Fail("placement", `override names ${J.pyRepr(k)}, which is not a slot`);
        for (const r of iterate(J.field(over, J.pyStr(k)))) {
            if (region(r) === null)
                throw new Fail("placement", `${J.pyRepr(r)} is not a region; there are ${REGIONS.length}`);
        }
    }
    const rotation = get(p, "rotation_deg");
    if (rotation.kind !== "null" && !J.truthy(get(lay, "rotatable"))) {
        throw new Fail("placement", `${name()} is not rotatable, so a rotation of ${J.pyStr(rotation)} means nothing`);
    }
}
/** The placement with every slot's site and regions filled in. */
export function resolve(lay, p) {
    validatePlacement(lay, p);
    const slots = slotsByKey(list(item(lay, "slots")));
    const sites = get(p, "sites");
    const over = get(p, "over");
    const out = [];
    for (const [key, s] of slots) {
        const siteKey = sites.kind === "object" && key.kind === "str" ? J.field(sites, key.value) : J.NULL;
        if (siteKey.kind === "null")
            continue;
        const sc = scalp(siteKey);
        let regions;
        if (inObject(over, key)) {
            regions = iterate(J.field(over, J.pyStr(key))).map((r) => {
                const found = region(r);
                if (found === null)
                    throw keyError(J.pyStr(r));
                const [k, human, kind] = found;
                return J.object([
                    ["region", J.str(k)],
                    ["human", J.str(human)],
                    ["kind", J.str(kind)],
                    ["side", J.field(sc, "side")],
                    ["derived", J.bool(false)],
                ]);
            });
        }
        else {
            regions = regionsUnder(siteKey);
        }
        out.push(J.object([
            ["slot", key],
            ["role", item(s, "role")],
            ["name", item(s, "name")],
            ["human", item(s, "human")],
            ["scalp", sc],
            ["over", J.array(regions)],
        ]));
    }
    return J.object([
        ["layout", item(lay, "key")],
        ["preset", get(p, "preset")],
        ["rotation_deg", get(p, "rotation_deg")],
        ["note", getOr(p, "note", J.str(""))],
        ["bias_driven", getOr(p, "bias_driven", J.bool(true))],
        ["slots", J.array(out)],
    ]);
}
/** The resolved slots, by slot key. */
function bySlot(r) {
    const s = J.get(r, "slots");
    return s !== undefined && s.kind === "array" ? s.items.map((x) => [J.field(x, "slot"), x]) : [];
}
function firstWithRole(slots, role) {
    for (const s of slots)
        if (roleIs(s, role))
            return s;
    return null;
}
/** `sorted(channels, key=lambda c: c["index"])`, stable. */
function byIndex(chans) {
    const keyed = chans.map((c) => {
        const i = item(c, "index");
        const k = J.isNumber(i) ? J.asF64(i) : null;
        if (k === null)
            throw new Fail("other", "TypeError: an index is not a number");
        return [k, c];
    });
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return keyed.map(([, c]) => c);
}
/** The placement as a montage, so everything downstream works. */
export function toMontage(lay, p) {
    const r = resolve(lay, p);
    const placed = bySlot(r);
    const site = (key) => {
        const s = slotOf(placed, key);
        if (s === null)
            throw keyError(J.pyStr(key));
        const sc = item(s, "scalp");
        return M.site(item(s, "name"), item(sc, "ten_ten"), item(sc, "human"));
    };
    const slots = list(item(lay, "slots"));
    const refSlot = firstWithRole(slots, REFERENCE);
    const chans = [];
    for (const c of byIndex(list(item(lay, "channels")))) {
        chans.push(M.channel(item(c, "index"), item(c, "derivation"), site(item(c, "positive")), site(item(c, "negative")), get(c, "label")));
    }
    const biasSlot = firstWithRole(slots, BIAS);
    const bias = biasSlot !== null && slotOf(placed, item(biasSlot, "key")) !== null && J.truthy(J.field(r, "bias_driven"))
        ? site(item(biasSlot, "key"))
        : J.NULL;
    const e = get(lay, "electrode");
    const electrode = J.truthy(e) ? e : J.str("unknown");
    const reference = refSlot !== null ? site(item(refSlot, "key")) : J.NULL;
    return M.build(chans, electrode, bias, reference, J.str(describe(lay, p, false)), J.NULL);
}
/** The placement as a sentence, regenerated from the structure. */
export function describe(lay, p, extras) {
    const r = resolve(lay, p);
    const placed = bySlot(r);
    const resolved = list(J.field(r, "slots"));
    const roleOf = (s, role) => {
        const x = J.field(s, "role");
        return x.kind === "str" && x.value === role;
    };
    const rec = resolved.filter((s) => roleOf(s, RECORDING));
    const reference = resolved.find((s) => roleOf(s, REFERENCE));
    const spots = new Set(rec.map((s) => J.pyStr(J.field(J.field(s, "scalp"), "key"))));
    const lastPart = (s) => {
        const h = J.pyStr(J.field(s, "human")).split(", ");
        return h[h.length - 1];
    };
    const parts = [];
    const chans = list(item(lay, "channels"));
    if (rec.length > 1 && spots.size === 1) {
        parts.push(`${chans.length} channels in one cluster at ${J.pyStr(J.field(J.field(rec[0], "scalp"), "human"))}: ` +
            rec.map(lastPart).join(", "));
        if (reference !== undefined)
            parts.push(`referenced to the ${lastPart(reference)}`);
    }
    else {
        for (const c of byIndex(chans)) {
            const human = (pole) => {
                const s = slotOf(placed, item(c, pole));
                if (s === null)
                    throw keyError(J.pyStr(item(c, pole)));
                return J.pyStr(J.field(J.field(s, "scalp"), "human"));
            };
            const a = human("positive");
            const b = human("negative");
            const at = J.pyStr(item(c, "index"));
            const d = item(c, "derivation");
            parts.push(d.kind === "str" && d.value === M.REFERENTIAL ? `ch${at} = ${a}, referenced to ${b}` : `ch${at} = ${a} / ${b}`);
        }
    }
    const slots = list(item(lay, "slots"));
    const b = firstWithRole(slots, BIAS);
    if (b !== null) {
        const s = slotOf(placed, item(b, "key"));
        const where = s !== null && J.truthy(J.field(r, "bias_driven")) ? J.pyStr(J.field(J.field(s, "scalp"), "human")) : "not driven";
        parts.push(`bias = ${where}`);
    }
    let tail = "";
    if (extras) {
        const rotation = J.field(r, "rotation_deg");
        if (J.truthy(rotation))
            tail += ` Rotated ${general(J.asF64(rotation) ?? NaN, 6)}°.`;
        const note = J.field(r, "note");
        if (J.truthy(note))
            tail += ` ${J.pyStr(note)}`;
    }
    if (parts.length === 0)
        throw new Fail("other", "IndexError: list index out of range");
    const said = [parts[0]];
    for (const part of parts.slice(1)) {
        const head = Array.from(part).slice(0, 14).join("");
        if (head.includes(" = ")) {
            said.push(part);
        }
        else {
            const chars = Array.from(part);
            said.push(chars.length === 0 ? "" : chars[0].toUpperCase() + chars.slice(1).join(""));
        }
    }
    return said.join(". ") + "." + tail;
}
//# sourceMappingURL=placement.js.map