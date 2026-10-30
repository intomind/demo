/**
 * The part of HDF5 a MATLAB v7.3 file needs, written by hand.
 *
 * A MATLAB v7.3 file is an HDF5 file with a 512-byte user block whose first
 * 128 bytes are MATLAB's own header. An export holds one group, the root,
 * with at most eight variables, each a contiguous one- or two-dimensional
 * array with a `MATLAB_class` attribute and, for logical and char variables,
 * a `MATLAB_int_decode` one. This writes exactly that, in the structures the
 * HDF5 library writes for the same file by default: the version 0
 * superblock, a symbol table group with one B-tree node, one local heap and
 * one symbol node, and version 1 object headers. No HDF5 library is needed
 * to write it, and any HDF5 reader, MATLAB's included, reads it.
 */
/** The undefined address. */
const UNDEF = 0xffffffffffffffffn;
/** The user block HDF5 data starts after, and where every address counts from. */
const BASE = 512;
/** A group's leaf and internal node sizes, HDF5's defaults. */
const LEAF_K = 4;
const NODE_K = 16;
/** The size HDF5 gives a dataset's object header, filled out with a null message. */
const OHDR_SIZE = 256;
function size(e) {
    switch (e) {
        case "u8":
            return 1;
        case "u16":
        case "i16":
            return 2;
        case "u32":
        case "i32":
        case "f32":
            return 4;
        default:
            return 8;
    }
}
/** Bytes appended little endian. */
class Out {
    b = [];
    u8(...v) {
        for (const x of v)
            this.b.push(x & 0xff);
    }
    u16(v) {
        this.u8(v, v >>> 8);
    }
    u32(v) {
        this.u8(v, v >>> 8, v >>> 16, v >>> 24);
    }
    u64(v) {
        let x = BigInt.asUintN(64, BigInt(v));
        for (let k = 0; k < 8; k++) {
            this.b.push(Number(x & 0xffn));
            x >>= 8n;
        }
    }
    bytes(v) {
        for (let k = 0; k < v.length; k++)
            this.b.push(v[k]);
    }
    pad8() {
        while (this.b.length & 7)
            this.b.push(0);
    }
}
/** The datatype message's body. */
function datatype(e) {
    const d = new Out();
    const sz = size(e);
    if (e === "f32" || e === "f64") {
        // Version 1, floating point, little endian, implied leading one, the sign in the top bit.
        const [sign, expLoc, expSize, mantSize, bias] = e === "f64" ? [63, 52, 11, 52, 1023] : [31, 23, 8, 23, 127];
        d.u8(0x11, 0x20, sign, 0x00);
        d.u32(sz);
        d.u16(0);
        d.u16(sz * 8);
        d.u8(expLoc, expSize, 0, mantSize);
        d.u32(bias);
    }
    else {
        const signed = e === "i16" || e === "i32" || e === "i64";
        d.u8(0x10, signed ? 0x08 : 0x00, 0x00, 0x00);
        d.u32(sz);
        d.u16(0);
        d.u16(sz * 8);
    }
    return d.b;
}
function align8(n) {
    return Math.ceil(n / 8) * 8;
}
/** One message of a version 1 object header: its type, its flags, and its body padded to eight bytes. */
function message(kind, flags, body) {
    const m = new Out();
    m.u16(kind);
    m.u16(align8(body.length));
    m.u8(flags, 0, 0, 0);
    m.bytes(body);
    m.pad8();
    return m.b;
}
/** A simple dataspace with its maximum dimensions equal to its dimensions, as HDF5 writes one for a fixed-size array. No dimensions is a scalar. */
function dataspace(dims) {
    const d = new Out();
    d.u8(1, dims.length, dims.length === 0 ? 0 : 1, 0, 0, 0, 0, 0);
    for (const x of dims)
        d.u64(x);
    if (dims.length > 0)
        for (const x of dims)
            d.u64(x);
    return d.b;
}
/** A version 1 attribute message. */
function attribute(name, type, value) {
    const space = dataspace([]);
    const a = new Out();
    a.u8(1, 0);
    a.u16(name.length + 1);
    a.u16(type.length);
    a.u16(space.length);
    const n = new Out();
    for (let k = 0; k < name.length; k++)
        n.u8(name.charCodeAt(k));
    n.u8(0);
    n.pad8();
    a.bytes(n.b);
    const t = new Out();
    t.bytes(type);
    t.pad8();
    a.bytes(t.b);
    a.bytes(space);
    a.bytes(value);
    return a.b;
}
/** `MATLAB_class`, a fixed-length ASCII string, as h5py stores a numpy bytes scalar. */
function classAttribute(cls) {
    const t = new Out();
    t.u8(0x13, 0x01, 0x00, 0x00);
    t.u32(cls.length);
    const v = [];
    for (let k = 0; k < cls.length; k++)
        v.push(cls.charCodeAt(k));
    return attribute("MATLAB_class", t.b, v);
}
/** `MATLAB_int_decode`, a 64-bit integer. */
function decodeAttribute(v) {
    const x = new Out();
    x.u64(v);
    return attribute("MATLAB_int_decode", datatype("i64"), x.b);
}
/** A version 1 object header holding `messages`, filled out to the size the HDF5 library gives a dataset's header with a null message. */
function objectHeader(messages) {
    const used = messages.reduce((s, m) => s + m.length, 0);
    const all = [...messages];
    let sz;
    if (used + 8 <= OHDR_SIZE) {
        all.push(message(0x0000, 0, new Array(OHDR_SIZE - used - 8).fill(0)));
        sz = OHDR_SIZE;
    }
    else {
        sz = used;
    }
    const h = new Out();
    h.u8(1, 0);
    h.u16(all.length);
    h.u32(1);
    h.u32(sz);
    h.u8(0, 0, 0, 0);
    for (const m of all)
        h.bytes(m);
    return h.b;
}
/** A dataset's messages, in the order the HDF5 library writes them. */
function messagesFor(v, dataAt, dataLen) {
    const layout = new Out();
    layout.u8(3, 1);
    layout.u64(dataAt);
    layout.u64(dataLen);
    const m = [
        message(0x0001, 0, dataspace(v.dims)),
        message(0x0003, 1, datatype(v.elem)),
        message(0x0005, 1, [2, 2, 2, 1, 0, 0, 0, 0]),
        message(0x0008, 0, layout.b),
        message(0x000c, 0, classAttribute(v.matlabClass)),
    ];
    if (v.intDecode !== null)
        m.push(message(0x000c, 0, decodeAttribute(v.intDecode)));
    return m;
}
function byName(a, b) {
    // Byte order of the UTF-8 names, which for these ASCII names is code unit order.
    return a < b ? -1 : a > b ? 1 : 0;
}
/** The file: the user block with `header` at its start, then the HDF5 data. */
export function write(header, vars) {
    if (vars.length > 2 * LEAF_K)
        throw new Error("one symbol node holds eight variables");
    // Where everything goes, as addresses from the base.
    const superblockLen = 96;
    const rootAt = superblockLen;
    const rootLen = 16 + 24;
    const btreeAt = rootAt + rootLen;
    const btreeLen = 24 + (2 * NODE_K + 1) * 8 + 2 * NODE_K * 8;
    const heapAt = btreeAt + btreeLen;
    // The heap: the empty name at offset zero, then each name padded to eight.
    const heap = new Out();
    heap.u8(0, 0, 0, 0, 0, 0, 0, 0);
    const nameAt = [];
    for (const v of vars) {
        nameAt.push(heap.b.length);
        for (let k = 0; k < v.name.length; k++)
            heap.u8(v.name.charCodeAt(k));
        heap.u8(0);
        heap.pad8();
    }
    const heapDataAt = heapAt + 32;
    const snodAt = heapDataAt + heap.b.length;
    const snodLen = 8 + 2 * LEAF_K * 40;
    let next = snodAt + snodLen;
    // Each variable's object header, and its data right after it.
    const objects = [];
    for (const v of vars) {
        const at = next;
        const dataLen = v.data.length;
        // The header's size is known before its data's address.
        const hdrLen = objectHeader(messagesFor(v, 0n, dataLen)).length;
        const dataAt = dataLen === 0 ? UNDEF : BigInt(align8(at + hdrLen));
        const hdr = objectHeader(messagesFor(v, dataAt, dataLen));
        next = dataLen === 0 ? at + hdrLen : Number(dataAt) + dataLen;
        next = align8(next);
        objects.push([at, hdr, v.data]);
    }
    const eof = BASE + next;
    const out = new Uint8Array(eof);
    out.set(header.subarray(0, 128));
    const o = new Out();
    // Superblock, version 0.
    o.u8(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a);
    o.u8(0, 0, 0, 0, 0, 8, 8, 0);
    o.u16(LEAF_K);
    o.u16(NODE_K);
    o.u32(0);
    o.u64(BASE);
    o.u64(UNDEF);
    o.u64(eof);
    o.u64(UNDEF);
    // The root group's symbol table entry: cached B-tree and heap.
    o.u64(0);
    o.u64(rootAt);
    o.u32(1);
    o.u32(0);
    o.u64(btreeAt);
    o.u64(heapAt);
    // The root group's object header: one symbol table message.
    const st = new Out();
    st.u64(btreeAt);
    st.u64(heapAt);
    const m = message(0x0011, 0, st.b);
    o.u8(1, 0);
    o.u16(1);
    o.u32(1);
    o.u32(m.length);
    o.u8(0, 0, 0, 0);
    o.bytes(m);
    // The B-tree: one leaf entry pointing at the one symbol node, keyed by
    // the empty name and the largest name.
    let largest = 0;
    if (vars.length > 0) {
        let best = 0;
        for (let k = 1; k < vars.length; k++)
            if (byName(vars[k].name, vars[best].name) >= 0)
                best = k;
        largest = nameAt[best];
    }
    const bt = new Out();
    bt.u8(0x54, 0x52, 0x45, 0x45);
    bt.u8(0, 0);
    bt.u16(vars.length === 0 ? 0 : 1);
    bt.u64(UNDEF);
    bt.u64(UNDEF);
    bt.u64(0);
    bt.u64(snodAt);
    bt.u64(largest);
    while (bt.b.length < btreeLen)
        bt.b.push(0);
    o.bytes(bt.b);
    // The local heap, with no free space.
    o.u8(0x48, 0x45, 0x41, 0x50);
    o.u8(0, 0, 0, 0);
    o.u64(heap.b.length);
    o.u64(1);
    o.u64(heapDataAt);
    o.bytes(heap.b);
    // The symbol node: an entry per variable, in name order.
    const order = vars.map((_, k) => k).sort((a, b) => byName(vars[a].name, vars[b].name));
    const sn = new Out();
    sn.u8(0x53, 0x4e, 0x4f, 0x44);
    sn.u8(1, 0);
    sn.u16(vars.length);
    for (const k of order) {
        sn.u64(nameAt[k]);
        sn.u64(objects[k][0]);
        sn.u32(0);
        sn.u32(0);
        for (let z = 0; z < 16; z++)
            sn.u8(0);
    }
    while (sn.b.length < snodLen)
        sn.b.push(0);
    o.bytes(sn.b);
    out.set(o.b, BASE);
    // The variables.
    for (const [at, hdr, data] of objects) {
        out.set(hdr, BASE + at);
        if (data.length > 0)
            out.set(data, BASE + align8(at + hdr.length));
    }
    return out;
}
//# sourceMappingURL=hdf5.js.map