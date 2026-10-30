/**
 * The zip container of an `.npz`, read and written.
 *
 * An `.npz` is a zip archive with one `.npy` file per array, which is what
 * numpy's `savez_compressed` writes. Only what that needs is here: stored
 * and deflated members, the ZIP64 records a large archive carries, and a
 * CRC-32 checked on every member read. Deflate is written here in both
 * directions, so the package carries no dependency and runs the same in a
 * browser and in Node.
 */
import { crc32 } from "../digest.js";
/** Why an archive could not be read. */
export class ZipError extends Error {
    /** What is wrong with the archive, in words. */
    constructor(message) {
        super(message);
        this.name = "ZipError";
    }
}
/** A deflate stream that cannot be decompressed. */
class Damaged extends Error {
}
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
    8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
/** `bits` reversed in its low `n` bits. */
function reverse(bits, n) {
    let r = 0;
    for (let k = 0; k < n; k++)
        r |= ((bits >>> k) & 1) << (n - 1 - k);
    return r;
}
/**
 * The canonical code for `lengths`, as a table. Null where the lengths do
 * not make a code: over-subscribed, or incomplete with more than one symbol
 * used, which is what the decompressor the Rust crate uses refuses.
 */
function table(lengths) {
    const count = new Uint16Array(16);
    let max = 0;
    let used = 0;
    for (let i = 0; i < lengths.length; i++) {
        const l = lengths[i];
        if (l === 0)
            continue;
        count[l]++;
        used++;
        if (l > max)
            max = l;
    }
    let total = 0;
    for (let l = 1; l <= 15; l++)
        total += count[l] << (16 - l);
    if (total > 0x10000 || (total !== 0x10000 && used > 1))
        return null;
    if (max === 0)
        return { bits: 1, entries: new Uint16Array(2) };
    // Canonical codes, smallest first, from the counts below each length.
    const next = new Uint16Array(16);
    let code = 0;
    for (let l = 1; l <= 15; l++) {
        next[l] = code;
        code = (code + count[l]) << 1;
    }
    const size = 1 << max;
    const entries = new Uint16Array(size);
    for (let sym = 0; sym < lengths.length; sym++) {
        const l = lengths[sym];
        if (l === 0)
            continue;
        const c = next[l]++;
        const entry = (sym << 4) | l;
        for (let j = reverse(c, l); j < size; j += 1 << l)
            entries[j] = entry;
    }
    return { bits: max, entries };
}
let FIXED = null;
function fixedTables() {
    if (FIXED === null) {
        const lit = new Uint8Array(288);
        lit.fill(8, 0, 144);
        lit.fill(9, 144, 256);
        lit.fill(7, 256, 280);
        lit.fill(8, 280, 288);
        const dist = new Uint8Array(32).fill(5);
        FIXED = [table(lit), table(dist)];
    }
    return FIXED;
}
/**
 * A raw deflate stream decompressed, refused where it would exceed `limit`
 * bytes or is damaged. Bytes after the final block are ignored.
 */
export function inflate(input, limit) {
    let out = new Uint8Array(Math.min(limit, Math.max(1024, input.length * 4)));
    let n = 0;
    let pos = 0;
    let buf = 0;
    let cnt = 0;
    const room = (extra) => {
        if (n + extra > limit)
            throw new Damaged();
        if (n + extra > out.length) {
            const grown = new Uint8Array(Math.min(limit, Math.max(out.length * 2, n + extra)));
            grown.set(out.subarray(0, n));
            out = grown;
        }
    };
    const bits = (k) => {
        while (cnt < k) {
            if (pos >= input.length)
                throw new Damaged();
            buf |= input[pos++] << cnt;
            cnt += 8;
        }
        const v = buf & ((1 << k) - 1);
        buf >>>= k;
        cnt -= k;
        return v;
    };
    const decode = (t) => {
        while (cnt < t.bits && pos < input.length) {
            buf |= input[pos++] << cnt;
            cnt += 8;
        }
        const e = t.entries[buf & ((1 << t.bits) - 1)];
        const l = e & 15;
        if (l === 0 || l > cnt)
            throw new Damaged();
        buf >>>= l;
        cnt -= l;
        return e >>> 4;
    };
    for (;;) {
        const final = bits(1);
        const type = bits(2);
        if (type === 0) {
            // To the byte boundary, then back to the bytes the bit buffer holds.
            buf >>>= cnt & 7;
            cnt -= cnt & 7;
            pos -= cnt >>> 3;
            buf = 0;
            cnt = 0;
            if (pos + 4 > input.length)
                throw new Damaged();
            const len = input[pos] | (input[pos + 1] << 8);
            const nlen = input[pos + 2] | (input[pos + 3] << 8);
            pos += 4;
            if ((len ^ 0xffff) !== nlen || pos + len > input.length)
                throw new Damaged();
            room(len);
            out.set(input.subarray(pos, pos + len), n);
            n += len;
            pos += len;
        }
        else if (type === 1 || type === 2) {
            let lit;
            let dist;
            if (type === 1) {
                [lit, dist] = fixedTables();
            }
            else {
                const hlit = bits(5) + 257;
                const hdist = bits(5) + 1;
                const hclen = bits(4) + 4;
                if (hlit > 286 || hdist > 30)
                    throw new Damaged();
                const cl = new Uint8Array(19);
                for (let i = 0; i < hclen; i++)
                    cl[CL_ORDER[i]] = bits(3);
                const clt = table(cl);
                if (clt === null)
                    throw new Damaged();
                const lengths = new Uint8Array(hlit + hdist);
                for (let i = 0; i < hlit + hdist;) {
                    const sym = decode(clt);
                    if (sym < 16) {
                        lengths[i++] = sym;
                        continue;
                    }
                    let repeat;
                    let value = 0;
                    if (sym === 16) {
                        if (i === 0)
                            throw new Damaged();
                        value = lengths[i - 1];
                        repeat = 3 + bits(2);
                    }
                    else if (sym === 17) {
                        repeat = 3 + bits(3);
                    }
                    else {
                        repeat = 11 + bits(7);
                    }
                    if (i + repeat > hlit + hdist)
                        throw new Damaged();
                    lengths.fill(value, i, i + repeat);
                    i += repeat;
                }
                const lt = table(lengths.subarray(0, hlit));
                const dt = table(lengths.subarray(hlit));
                if (lt === null || dt === null)
                    throw new Damaged();
                lit = lt;
                dist = dt;
            }
            for (;;) {
                const sym = decode(lit);
                if (sym < 256) {
                    if (n >= out.length)
                        room(1);
                    out[n++] = sym;
                }
                else if (sym === 256) {
                    break;
                }
                else {
                    const li = sym - 257;
                    if (li >= 29)
                        throw new Damaged();
                    const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
                    const di = decode(dist);
                    if (di >= 30)
                        throw new Damaged();
                    const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
                    if (d > n)
                        throw new Damaged();
                    room(len);
                    let from = n - d;
                    for (let k = 0; k < len; k++)
                        out[n++] = out[from++];
                }
            }
        }
        else {
            throw new Damaged();
        }
        if (final)
            break;
    }
    return out.slice(0, n);
}
/** Bits written least significant first, into bytes. */
class BitWriter {
    out = new Uint8Array(1 << 16);
    n = 0;
    buf = 0;
    cnt = 0;
    room(extra) {
        if (this.n + extra <= this.out.length)
            return;
        const grown = new Uint8Array(Math.max(this.out.length * 2, this.n + extra));
        grown.set(this.out.subarray(0, this.n));
        this.out = grown;
    }
    put(value, k) {
        this.buf |= value << this.cnt;
        this.cnt += k;
        if (this.cnt >= 16) {
            this.room(2);
            this.out[this.n++] = this.buf & 0xff;
            this.out[this.n++] = (this.buf >>> 8) & 0xff;
            this.buf >>>= 16;
            this.cnt -= 16;
        }
    }
    align() {
        this.room(4);
        while (this.cnt > 0) {
            this.out[this.n++] = this.buf & 0xff;
            this.buf >>>= 8;
            this.cnt = Math.max(0, this.cnt - 8);
        }
        this.buf = 0;
    }
    bytes(b) {
        this.room(b.length);
        this.out.set(b, this.n);
        this.n += b.length;
    }
    finish() {
        this.align();
        return this.out.slice(0, this.n);
    }
}
/**
 * Code lengths for `freq`, none longer than `limit`: Huffman's, then the
 * longest codes folded back under the limit, which keeps the code complete.
 * Every tree here has at least two symbols, which a complete code needs.
 */
function lengthsFor(freq, limit) {
    const lens = new Uint8Array(freq.length);
    const syms = [];
    for (let i = 0; i < freq.length; i++)
        if (freq[i] > 0)
            syms.push(i);
    syms.sort((a, b) => freq[a] - freq[b] || a - b);
    const m = syms.length;
    // Two queues: the leaves in order, and the merged nodes, which come out
    // of the merging in order too. Nodes 0..m-1 are leaves.
    const weight = new Float64Array(2 * m);
    const parent = new Int32Array(2 * m).fill(-1);
    for (let i = 0; i < m; i++)
        weight[i] = freq[syms[i]];
    let leaf = 0;
    let inner = m;
    let made = m;
    const take = () => {
        if (leaf < m && (inner >= made || weight[leaf] <= weight[inner]))
            return leaf++;
        return inner++;
    };
    while (made < 2 * m - 1) {
        const a = take();
        const b = take();
        weight[made] = weight[a] + weight[b];
        parent[a] = made;
        parent[b] = made;
        made++;
    }
    const depth = new Int32Array(2 * m);
    const count = new Int32Array(Math.max(64, m + 2));
    let maxDepth = 0;
    for (let i = 2 * m - 3; i >= 0; i--)
        depth[i] = depth[parent[i]] + 1;
    for (let i = 0; i < m; i++) {
        count[depth[i]]++;
        if (depth[i] > maxDepth)
            maxDepth = depth[i];
    }
    for (let i = maxDepth; i > limit; i--) {
        while (count[i] > 0) {
            let j = i - 2;
            while (j > 1 && count[j] === 0)
                j--;
            count[i] -= 2;
            count[i - 1] += 1;
            count[j + 1] += 2;
            count[j] -= 1;
        }
    }
    // The shortest lengths to the most frequent symbols.
    let at = m - 1;
    for (let l = 1; l <= limit; l++) {
        for (let k = 0; k < count[l]; k++)
            lens[syms[at--]] = l;
    }
    return lens;
}
/** The canonical codes for `lens`, each already reversed for writing. */
function codesFor(lens) {
    const count = new Uint16Array(16);
    for (const l of lens)
        if (l)
            count[l]++;
    const next = new Uint16Array(16);
    let code = 0;
    for (let l = 1; l <= 15; l++) {
        next[l] = code;
        code = (code + count[l]) << 1;
    }
    const codes = new Uint16Array(lens.length);
    for (let s = 0; s < lens.length; s++) {
        const l = lens[s];
        if (l)
            codes[s] = reverse(next[l]++, l);
    }
    return codes;
}
const LEN_CODE = new Uint16Array(259);
const DIST_CODE = new Uint8Array(32769);
for (let c = 0; c < 29; c++) {
    for (let l = LEN_BASE[c]; l < LEN_BASE[c] + (1 << LEN_EXTRA[c]) && l <= 258; l++)
        LEN_CODE[l] = c;
}
LEN_CODE[258] = 28;
for (let c = 0; c < 30; c++) {
    for (let d = DIST_BASE[c]; d < DIST_BASE[c] + (1 << DIST_EXTRA[c]) && d <= 32768; d++)
        DIST_CODE[d] = c;
}
const WINDOW = 32768;
const HASH_BITS = 15;
const MAX_CHAIN = 48;
const NICE = 128;
const BLOCK_SYMBOLS = 1 << 15;
/** `data` as one raw deflate stream: matches found back through the window, then a dynamic Huffman block per run of symbols, or a stored block where that is smaller. */
export function deflate(data) {
    const w = new BitWriter();
    if (data.length === 0) {
        // One final fixed block holding only its end.
        w.put(3, 3);
        w.put(0, 7);
        return w.finish();
    }
    const head = new Int32Array(1 << HASH_BITS).fill(-1);
    const prev = new Int32Array(WINDOW);
    const lit = new Uint16Array(BLOCK_SYMBOLS);
    const dist = new Uint16Array(BLOCK_SYMBOLS);
    const lenOf = new Uint16Array(BLOCK_SYMBOLS);
    const hash = (i) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & ((1 << HASH_BITS) - 1);
    const insert = (i) => {
        if (i + 2 >= data.length)
            return;
        const h = hash(i);
        prev[i & (WINDOW - 1)] = head[h];
        head[h] = i;
    };
    let i = 0;
    let blockStart = 0;
    let syms = 0;
    while (i < data.length) {
        let best = 0;
        let bestDist = 0;
        if (i + 2 < data.length) {
            const h = hash(i);
            let cand = head[h];
            const maxLen = Math.min(258, data.length - i);
            for (let chain = 0; cand >= 0 && i - cand <= WINDOW && chain < MAX_CHAIN; chain++) {
                if (data[cand + best] === data[i + best]) {
                    let l = 0;
                    while (l < maxLen && data[cand + l] === data[i + l])
                        l++;
                    if (l > best) {
                        best = l;
                        bestDist = i - cand;
                        if (l >= NICE || l === maxLen)
                            break;
                    }
                }
                const p = prev[cand & (WINDOW - 1)];
                if (p >= cand)
                    break;
                cand = p;
            }
        }
        if (best >= 3) {
            lit[syms] = 257 + LEN_CODE[best];
            dist[syms] = bestDist;
            lenOf[syms] = best;
            syms++;
            for (let k = 0; k < best; k++)
                insert(i + k);
            i += best;
        }
        else {
            lit[syms] = data[i];
            dist[syms] = 0;
            syms++;
            insert(i);
            i++;
        }
        if (syms === BLOCK_SYMBOLS || i >= data.length) {
            block(w, data, blockStart, i, lit, dist, lenOf, syms, i >= data.length);
            blockStart = i;
            syms = 0;
        }
    }
    return w.finish();
}
/** One block: dynamic Huffman, or stored where that is smaller. */
function block(w, data, from, to, lit, dist, lenOf, syms, final) {
    const lf = new Uint32Array(286);
    const df = new Uint32Array(30);
    for (let s = 0; s < syms; s++) {
        lf[lit[s]]++;
        if (dist[s])
            df[DIST_CODE[dist[s]]]++;
    }
    lf[256] = 1;
    // A complete code needs two symbols in every tree.
    const atLeastTwo = (f) => {
        let used = 0;
        for (const x of f)
            if (x)
                used++;
        for (let s = 0; used < 2 && s < f.length; s++) {
            if (!f[s]) {
                f[s] = 1;
                used++;
            }
        }
    };
    atLeastTwo(lf);
    atLeastTwo(df);
    const ll = lengthsFor(lf, 15);
    const dl = lengthsFor(df, 15);
    let hlit = 286;
    while (hlit > 257 && ll[hlit - 1] === 0)
        hlit--;
    let hdist = 30;
    while (hdist > 1 && dl[hdist - 1] === 0)
        hdist--;
    // The code lengths, run-length coded.
    const all = [...ll.subarray(0, hlit), ...dl.subarray(0, hdist)];
    const rle = [];
    for (let k = 0; k < all.length;) {
        const v = all[k];
        let run = 1;
        while (k + run < all.length && all[k + run] === v)
            run++;
        let left = run;
        if (v === 0) {
            while (left >= 11) {
                const r = Math.min(138, left);
                rle.push([18, r - 11, 7]);
                left -= r;
            }
            if (left >= 3) {
                rle.push([17, left - 3, 3]);
                left = 0;
            }
        }
        else {
            rle.push([v, 0, 0]);
            left--;
            while (left >= 3) {
                const r = Math.min(6, left);
                rle.push([16, r - 3, 2]);
                left -= r;
            }
        }
        for (; left > 0; left--)
            rle.push([v, 0, 0]);
        k += run;
    }
    const cf = new Uint32Array(19);
    for (const [s] of rle)
        cf[s]++;
    atLeastTwo(cf);
    const cl = lengthsFor(cf, 7);
    let hclen = 19;
    while (hclen > 4 && cl[CL_ORDER[hclen - 1]] === 0)
        hclen--;
    let bitsDynamic = 3 + 5 + 5 + 4 + 3 * hclen;
    for (const [s, , xb] of rle)
        bitsDynamic += cl[s] + xb;
    for (let s = 0; s < syms; s++) {
        const c = lit[s];
        bitsDynamic += ll[c];
        if (c > 256) {
            bitsDynamic += LEN_EXTRA[c - 257] + dl[DIST_CODE[dist[s]]] + DIST_EXTRA[DIST_CODE[dist[s]]];
        }
    }
    bitsDynamic += ll[256];
    const storedBytes = to - from;
    const bitsStored = (Math.ceil(storedBytes / 65535) || 1) * 40 + storedBytes * 8 + 8;
    if (bitsStored < bitsDynamic) {
        for (let at = from; at < to || at === from;) {
            const len = Math.min(65535, to - at);
            const last = final && at + len >= to;
            w.put(last ? 1 : 0, 1);
            w.put(0, 2);
            w.align();
            w.bytes(new Uint8Array([len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff]));
            w.bytes(data.subarray(at, at + len));
            at += len;
            if (len === 0)
                break;
        }
        return;
    }
    const lc = codesFor(ll);
    const dc = codesFor(dl);
    const cc = codesFor(cl);
    w.put(final ? 1 : 0, 1);
    w.put(2, 2);
    w.put(hlit - 257, 5);
    w.put(hdist - 1, 5);
    w.put(hclen - 4, 4);
    for (let k = 0; k < hclen; k++)
        w.put(cl[CL_ORDER[k]], 3);
    for (const [s, x, xb] of rle) {
        w.put(cc[s], cl[s]);
        if (xb)
            w.put(x, xb);
    }
    for (let s = 0; s < syms; s++) {
        const c = lit[s];
        w.put(lc[c], ll[c]);
        if (c > 256) {
            const li = c - 257;
            if (LEN_EXTRA[li])
                w.put(lenOf[s] - LEN_BASE[li], LEN_EXTRA[li]);
            const d = dist[s];
            const di = DIST_CODE[d];
            w.put(dc[di], dl[di]);
            if (DIST_EXTRA[di])
                w.put(d - DIST_BASE[di], DIST_EXTRA[di]);
        }
    }
    w.put(lc[256], ll[256]);
}
function u16(b, at) {
    if (at + 2 > b.length)
        throw new ZipError("the archive ends early");
    return b[at] | (b[at + 1] << 8);
}
function u32(b, at) {
    if (at + 4 > b.length)
        throw new ZipError("the archive ends early");
    return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}
function u64(b, at) {
    if (at + 8 > b.length)
        throw new ZipError("the archive ends early");
    return u32(b, at) + u32(b, at + 4) * 2 ** 32;
}
/** Every member of an archive, by name, in the order the central directory lists them, each decompressed and checked against its CRC. */
export function read(archive) {
    // The end of central directory record, searched for from the end, past any comment.
    let eocd = -1;
    const top = Math.max(0, archive.length - 21);
    for (let k = 0, i = top - 1; i >= 0 && k < 65557; i--, k++) {
        if (archive[i] === 0x50 && archive[i + 1] === 0x4b && archive[i + 2] === 0x05 && archive[i + 3] === 0x06) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0)
        throw new ZipError("not a zip archive: no end of central directory");
    let entries = u16(archive, eocd + 10);
    let cdSize = u32(archive, eocd + 12);
    let cdOffset = u32(archive, eocd + 16);
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
        // ZIP64: the locator sits just before the record above.
        const loc = eocd - 20;
        if (loc < 0 || u32(archive, loc) !== 0x07064b50)
            throw new ZipError("a ZIP64 archive without its locator");
        const rec = u64(archive, loc + 8);
        if (u32(archive, rec) !== 0x06064b50)
            throw new ZipError("a ZIP64 archive without its end record");
        entries = u64(archive, rec + 32);
        cdSize = u64(archive, rec + 40);
        cdOffset = u64(archive, rec + 48);
    }
    const out = [];
    let p = cdOffset;
    const end = cdOffset + cdSize;
    for (let e = 0; e < entries; e++) {
        if (p >= end || u32(archive, p) !== 0x02014b50)
            throw new ZipError("a central directory entry is missing");
        const flags = u16(archive, p + 8);
        const method = u16(archive, p + 10);
        const crc = u32(archive, p + 16);
        let csize = u32(archive, p + 20);
        let usize = u32(archive, p + 24);
        const nameLen = u16(archive, p + 28);
        const extraLen = u16(archive, p + 30);
        const commentLen = u16(archive, p + 32);
        let local = u32(archive, p + 42);
        if (p + 46 + nameLen > archive.length)
            throw new ZipError("the archive ends early");
        const nameBytes = archive.subarray(p + 46, p + 46 + nameLen);
        let name;
        if (flags & 0x800) {
            try {
                name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes);
            }
            catch {
                throw new ZipError("a member name that is not UTF-8");
            }
        }
        else {
            // cp437 in principle. numpy's names are ASCII.
            name = String.fromCharCode(...nameBytes);
        }
        // The ZIP64 extra field holds, in order, whichever of the sizes and the
        // offset did not fit 32 bits.
        let x = p + 46 + nameLen;
        const xEnd = x + extraLen;
        while (x + 4 <= xEnd) {
            const id = u16(archive, x);
            const len = u16(archive, x + 2);
            if (id === 0x0001) {
                let q = x + 4;
                if (usize === 0xffffffff) {
                    usize = u64(archive, q);
                    q += 8;
                }
                if (csize === 0xffffffff) {
                    csize = u64(archive, q);
                    q += 8;
                }
                if (local === 0xffffffff)
                    local = u64(archive, q);
            }
            x += 4 + len;
        }
        p = xEnd + commentLen;
        if (u32(archive, local) !== 0x04034b50)
            throw new ZipError(`${name}: the member's header is missing`);
        const dataAt = local + 30 + u16(archive, local + 26) + u16(archive, local + 28);
        if (dataAt + csize > archive.length)
            throw new ZipError(`${name}: the archive ends early`);
        const raw = archive.subarray(dataAt, dataAt + csize);
        let data;
        if (method === 0) {
            data = raw.slice();
        }
        else if (method === 8) {
            try {
                data = inflate(raw, usize);
            }
            catch (err) {
                if (err instanceof Damaged)
                    throw new ZipError(`${name}: the compressed data is damaged`);
                throw err;
            }
        }
        else {
            throw new ZipError(`${name}: compression method ${method} is not one numpy writes`);
        }
        if (data.length !== usize)
            throw new ZipError(`${name}: ${data.length} bytes where the archive says ${usize}`);
        if (crc32(data) !== crc)
            throw new ZipError(`${name}: the CRC does not match`);
        out.push([name, data]);
    }
    return out;
}
/** The date and time fields of a zip header for a moment in UTC. */
function dosTime(unix) {
    const d = new Date(unix * 1000);
    const y = d.getUTCFullYear();
    if (y < 1980)
        return [0, (1 << 5) | 1];
    const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >>> 1);
    const date = ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    return [time, date];
}
/** Bytes appended little endian. */
class Bytes {
    buf = new Uint8Array(1 << 16);
    n = 0;
    room(k) {
        if (this.n + k <= this.buf.length)
            return;
        const grown = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
        grown.set(this.buf.subarray(0, this.n));
        this.buf = grown;
    }
    u16(v) {
        this.room(2);
        this.buf[this.n++] = v & 0xff;
        this.buf[this.n++] = (v >>> 8) & 0xff;
    }
    u32(v) {
        this.room(4);
        for (let k = 0; k < 4; k++)
            this.buf[this.n++] = (v >>> (8 * k)) & 0xff;
    }
    u64(v) {
        this.u32(v % 2 ** 32);
        this.u32(Math.floor(v / 2 ** 32));
    }
    bytes(b) {
        this.room(b.length);
        this.buf.set(b, this.n);
        this.n += b.length;
    }
    done() {
        return this.buf.slice(0, this.n);
    }
}
/** An archive of `members`, each deflated, stamped with `unixTime`. */
export function write(members, unixTime) {
    const [time, date] = dosTime(unixTime);
    const out = new Bytes();
    const central = new Bytes();
    let count = 0;
    for (const [name, data] of members) {
        const packed = deflate(data);
        const crc = crc32(data);
        const offset = out.n;
        const zip64 = data.length >= 0xffffffff || packed.length >= 0xffffffff || offset >= 0xffffffff;
        const version = zip64 ? 45 : 20;
        const nameB = new TextEncoder().encode(name);
        // Local header. Sizes that do not fit go in its ZIP64 field.
        out.u32(0x04034b50);
        out.u16(version);
        out.u16(0); // flags
        out.u16(8); // deflate
        out.u16(time);
        out.u16(date);
        out.u32(crc);
        if (zip64) {
            out.u32(0xffffffff);
            out.u32(0xffffffff);
        }
        else {
            out.u32(packed.length);
            out.u32(data.length);
        }
        out.u16(nameB.length);
        out.u16(zip64 ? 20 : 0);
        out.bytes(nameB);
        if (zip64) {
            out.u16(0x0001);
            out.u16(16);
            out.u64(data.length);
            out.u64(packed.length);
        }
        out.bytes(packed);
        // Central directory entry.
        central.u32(0x02014b50);
        central.u16(version | (3 << 8)); // made on unix
        central.u16(version);
        central.u16(0);
        central.u16(8);
        central.u16(time);
        central.u16(date);
        central.u32(crc);
        if (zip64) {
            central.u32(0xffffffff);
            central.u32(0xffffffff);
        }
        else {
            central.u32(packed.length);
            central.u32(data.length);
        }
        central.u16(nameB.length);
        central.u16(zip64 ? 4 + 24 : 0);
        central.u16(0); // comment
        central.u16(0); // disk
        central.u16(0); // internal attributes
        central.u32((0o600 << 16) >>> 0); // external attributes, as numpy's members get
        central.u32(zip64 ? 0xffffffff : offset);
        central.bytes(nameB);
        if (zip64) {
            // Order in the ZIP64 field: uncompressed size, compressed size, offset.
            central.u16(0x0001);
            central.u16(24);
            central.u64(data.length);
            central.u64(packed.length);
            central.u64(offset);
        }
        count++;
    }
    const cdOffset = out.n;
    const cd = central.done();
    out.bytes(cd);
    const big = count >= 0xffff || cdOffset >= 0xffffffff || cd.length >= 0xffffffff;
    if (big) {
        const rec = out.n;
        out.u32(0x06064b50);
        out.u64(44);
        out.u16(45);
        out.u16(45);
        out.u32(0);
        out.u32(0);
        out.u64(count);
        out.u64(count);
        out.u64(cd.length);
        out.u64(cdOffset);
        out.u32(0x07064b50);
        out.u32(0);
        out.u64(rec);
        out.u32(1);
    }
    out.u32(0x06054b50);
    out.u16(0);
    out.u16(0);
    out.u16(big ? 0xffff : count);
    out.u16(big ? 0xffff : count);
    out.u32(big ? 0xffffffff : cd.length);
    out.u32(big ? 0xffffffff : cdOffset);
    out.u16(0);
    return out.done();
}
//# sourceMappingURL=zip.js.map