// Solid things in space, built from rules and lit by one sun: rock of
// every size, wreckage, and the lights the course is made of. A mesh is
// vertices and faces. A face is its vertex indices, a material and a
// tint. The painter projects a mesh through a camera, drops what faces
// away, sorts far to near, and shades each face flat: sun, a cool fill
// from the far side, a highlight where the metal catches the sun, and a
// thin rim where the body meets the dark.

import { add, sub, scale, dot, cross, unit, length } from "./space.js";

/** The world's light, the same one the ship is drawn by: from the upper left, a little behind the camera. */
export const SUN = unit([-0.45, 0.85, -0.3]);
/** The fill: faint, cool, from below and behind, so the dark side still has a shape. */
const FILL = unit([0.5, -0.35, 0.6]);
const SUN_COLOR = [1.0, 0.96, 0.88];
const FILL_COLOR = [70, 100, 150];
const RIM_COLOR = [130, 180, 240];

export const MAT = {
  rock: { albedo: [116, 108, 98], spec: 0.1, shine: 10 },
  slate: { albedo: [92, 98, 110], spec: 0.16, shine: 14 },
  iron: { albedo: [124, 112, 96], spec: 0.28, shine: 18 },
  gold: { albedo: [232, 176, 52], spec: 1.1, shine: 26, metal: true, glow: [255, 190, 60] },
  metal: { albedo: [156, 164, 176], spec: 0.6, shine: 34 },
  dark: { albedo: [58, 62, 70], spec: 0.4, shine: 24 },
  paint: { albedo: [184, 180, 170], spec: 0.3, shine: 20 },
  glass: { albedo: [28, 40, 58], spec: 1.4, shine: 50 },
  solar: { albedo: [30, 56, 118], spec: 1.3, shine: 60 },
  coin: { emissive: [255, 181, 71], glow: [255, 181, 71] },
  ring: { emissive: [78, 224, 255], glow: [78, 224, 255] },
  chevron: { emissive: [255, 70, 225], glow: [255, 70, 225] },
  window: { emissive: [230, 236, 244], dim: 1 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** A small deterministic random source, from a seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotate a frame about `axis` by `angle`, Rodrigues' way. */
export function turnAbout({ R, U, F }, axis, angle) {
  const k = unit(axis), c = Math.cos(angle), s = Math.sin(angle);
  const rot = (v) => add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
  return { R: rot(R), U: rot(U), F: rot(F) };
}

export const IDENTITY = { R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, 1] };

/** A frame turned by three angles, for setting a thing down at an attitude. */
export function attitude(yaw, pitch, roll) {
  let f = turnAbout(IDENTITY, [0, 1, 0], yaw);
  f = turnAbout(f, f.R, pitch);
  return turnAbout(f, f.F, roll);
}

// ---- Value noise, for the skin of a rock.

function noise3(seed) {
  const h = (i, j, k) => {
    let n = (i * 374761393 + j * 668265263 + k * 1440662683 + seed * 982451653) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  };
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const u = sm(x - i), v = sm(y - j), w = sm(z - k);
    const lerp = (a, b, t) => a + (b - a) * t;
    const c00 = lerp(h(i, j, k), h(i + 1, j, k), u), c10 = lerp(h(i, j + 1, k), h(i + 1, j + 1, k), u);
    const c01 = lerp(h(i, j, k + 1), h(i + 1, j, k + 1), u), c11 = lerp(h(i, j + 1, k + 1), h(i + 1, j + 1, k + 1), u);
    return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w);
  };
}

function fbm(n, p, freq, octaves = 3) {
  let s = 0, amp = 1, f = freq, norm = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * n(p[0] * f + 7.3, p[1] * f + 3.1, p[2] * f + 5.7);
    norm += amp; amp *= 0.5; f *= 2.1;
  }
  return s / norm;
}

// ---- Primitives. Every face winds so its normal points out.

export function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (cache.has(key)) return cache.get(key);
      V.push(unit(add(V[a], V[b])));
      cache.set(key, V.length - 1);
      return V.length - 1;
    };
    const next = [];
    for (const [a, b, c] of F) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    F = next;
  }
  return { V, F };
}

/** Make every face of a star-shaped mesh wind outward from its center. */
function outward(mesh, center = [0, 0, 0]) {
  for (const f of mesh.F) {
    const [a, b, c] = f.idx.map((i) => mesh.V[i]);
    const n = cross(sub(b, a), sub(c, a));
    const mid = f.idx.reduce((s, i) => add(s, mesh.V[i]), [0, 0, 0]).map((v) => v / f.idx.length);
    if (dot(n, sub(mid, center)) < 0) f.idx.reverse();
  }
  return mesh;
}

const quad = (mat, tint, a, b, c, d) => ({ idx: [a, b, c, d], mat, tint });
const tri = (mat, tint, a, b, c) => ({ idx: [a, b, c], mat, tint });

/** A box of width, height and depth, centered. */
export function box(w, h, d, mat, tint = 1) {
  const x = w / 2, y = h / 2, z = d / 2;
  const V = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const F = [quad(mat, tint, 0, 1, 2, 3), quad(mat, tint, 4, 5, 6, 7), quad(mat, tint, 0, 1, 5, 4), quad(mat, tint, 2, 3, 7, 6), quad(mat, tint, 1, 2, 6, 5), quad(mat, tint, 0, 3, 7, 4)];
  return outward({ V, F });
}

/** A thin plate in the x-y plane, split into cells that alternate in tint, both faces. Solar cells, hull plating, ribbing. */
export function plate(w, h, cols, rows, mat, { tints = [1, 0.86], thick = 0.04 } = {}) {
  const V = [], F = [];
  const v = (p) => { V.push(p); return V.length - 1; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = -w / 2 + (c / cols) * w, x1 = -w / 2 + ((c + 1) / cols) * w;
    const y0 = -h / 2 + (r / rows) * h, y1 = -h / 2 + ((r + 1) / rows) * h;
    const tint = tints[(r + c) % tints.length];
    const a = v([x0, y0, thick / 2]), b = v([x1, y0, thick / 2]), cc = v([x1, y1, thick / 2]), d = v([x0, y1, thick / 2]);
    F.push(quad(mat, tint, a, b, cc, d));
    const a2 = v([x0, y0, -thick / 2]), b2 = v([x1, y0, -thick / 2]), c2 = v([x1, y1, -thick / 2]), d2 = v([x0, y1, -thick / 2]);
    F.push(quad(mat, tint, d2, c2, b2, a2));
  }
  // The edges.
  const e = MAT.dark;
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  for (let i = 0; i < 4; i++) {
    const p = corners[i], q = corners[(i + 1) % 4];
    const a = v([p[0], p[1], thick / 2]), b = v([q[0], q[1], thick / 2]), c = v([q[0], q[1], -thick / 2]), d = v([p[0], p[1], -thick / 2]);
    F.push(quad(e, 1, a, b, c, d));
  }
  return outward({ V, F });
}

/** A prism of `n` sides and radius `r`, `h` tall along y, its top scaled by `taper`. */
export function prism(n, r, h, mat, { taper = 1, cap = true, tint = 1, tintSides = null } = {}) {
  const V = [], F = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    V.push([Math.cos(a) * r, -h / 2, Math.sin(a) * r]);
    V.push([Math.cos(a) * r * taper, h / 2, Math.sin(a) * r * taper]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    F.push(quad(mat, tintSides ? tintSides(i) : tint, i * 2, j * 2, j * 2 + 1, i * 2 + 1));
  }
  if (cap) {
    F.push({ idx: Array.from({ length: n }, (_, i) => i * 2), mat, tint });
    F.push({ idx: Array.from({ length: n }, (_, i) => i * 2 + 1), mat, tint });
  }
  return outward({ V, F });
}

/** A hollow tube along y: an outer skin, an inner skin, and the two rims. Its ends may be torn: `tear(i)` says how much to cut from each end at the i-th seam. */
export function tube(n, ro, ri, h, mat, { tint = 1, tear = null, inner = MAT.dark } = {}) {
  const V = [], F = [];
  const v = (p) => { V.push(p); return V.length - 1; };
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const cut = tear ? tear(i) : [0, 0];
    rings.push({ ob: v([c * ro, -h / 2 + cut[0], s * ro]), ot: v([c * ro, h / 2 - cut[1], s * ro]), ib: v([c * ri, -h / 2 + cut[0], s * ri]), it: v([c * ri, h / 2 - cut[1], s * ri]) });
  }
  for (let i = 0; i < n; i++) {
    const p = rings[i], q = rings[(i + 1) % n];
    F.push(quad(mat, tint, p.ob, q.ob, q.ot, p.ot));
    F.push(quad(inner, 0.7, p.it, q.it, q.ib, p.ib));
    F.push(quad(mat, 0.9, p.ob, p.ib, q.ib, q.ob));
    F.push(quad(mat, 0.9, p.ot, q.ot, q.it, p.it));
  }
  return { V, F };
}

/** A torus about y: `R` to the center of the tube, `r` the tube's own radius. */
export function torus(nMajor, nMinor, R, r, mat, { tint = 1 } = {}) {
  const V = [], F = [];
  for (let i = 0; i < nMajor; i++) {
    const a = (i / nMajor) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < nMinor; j++) {
      const b = (j / nMinor) * Math.PI * 2, cb = Math.cos(b), sb = Math.sin(b);
      V.push([(R + r * cb) * ca, r * sb, (R + r * cb) * sa]);
    }
  }
  const at = (i, j) => ((i + nMajor) % nMajor) * nMinor + ((j + nMinor) % nMinor);
  for (let i = 0; i < nMajor; i++) for (let j = 0; j < nMinor; j++) {
    const f = quad(mat, tint, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    // Outward is away from the tube's own center line.
    const a = ((i + 0.5) / nMajor) * Math.PI * 2;
    const ringCenter = [Math.cos(a) * R, 0, Math.sin(a) * R];
    const [p0, p1, p2] = f.idx.map((k) => V[k]);
    const n = cross(sub(p1, p0), sub(p2, p0));
    const mid = f.idx.reduce((s, k) => add(s, V[k]), [0, 0, 0]).map((x) => x / 4);
    if (dot(n, sub(mid, ringCenter)) < 0) f.idx.reverse();
    F.push(f);
  }
  return { V, F };
}

/** A shallow dish facing +y, both sides. */
export function dish(n, r, depth, mat) {
  const V = [[0, -depth, 0]], F = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; V.push([Math.cos(a) * r, 0, Math.sin(a) * r]); }
  const m = V.length;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; V.push([Math.cos(a) * r * 0.55, -depth * 0.6, Math.sin(a) * r * 0.55]); }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    F.push(tri(mat, 1, 0, 1 + j, 1 + i));          // inside, seen from above
    F.push(quad(MAT.dark, 0.8, 1 + i, 1 + j, m + j, m + i)); // the back
    F.push(tri(MAT.dark, 0.8, 0, m + i, m + j));
  }
  // Inside faces must face +y.
  for (const f of F.slice(0, n)) {
    const [a, b, c] = f.idx.map((k) => V[k]);
    if (cross(sub(b, a), sub(c, a))[1] < 0) f.idx.reverse();
  }
  return { V, F };
}

/** Set a mesh down in another's space: at `at`, in frame {R, U, F}, scaled by `k`. */
export function place(mesh, { at = [0, 0, 0], R = [1, 0, 0], U = [0, 1, 0], F = [0, 0, 1], k = 1 } = {}) {
  return {
    V: mesh.V.map((p) => add(add(add(at, scale(R, p[0] * k)), scale(U, p[1] * k)), scale(F, p[2] * k))),
    F: mesh.F.map((f) => ({ ...f, idx: [...f.idx] })),
  };
}

/** Several meshes as one, so they sort against each other when drawn. */
export function merge(...meshes) {
  const V = [], F = [];
  for (const m of meshes) {
    const base = V.length;
    V.push(...m.V);
    for (const f of m.F) F.push({ ...f, idx: f.idx.map((i) => i + base) });
  }
  return { V, F };
}

/** The farthest any vertex is from the origin. */
export function radiusOf(mesh) {
  let r = 0;
  for (const p of mesh.V) r = Math.max(r, length(p));
  return r;
}

// ---- Rock.

/**
 * A rock from a seed. `level` is how fine the mesh is, `rough` how far
 * the skin wanders, `craters` how many bowls are struck into it, and
 * `squash` how far from round it is. Its radius is about one.
 */
export function asteroid(seed, { level = 2, rough = 0.18, freq = null, craters = 4, craterSize = 1, craterDepth = 1, squash = null, mat = null } = {}) {
  const r = rng(seed);
  const { V, F } = icosphere(level);
  const n = noise3(Math.floor(r() * 1e6));
  const skin = noise3(Math.floor(r() * 1e6));
  const fq = freq ?? 1.3 + r() * 0.9;
  const sq = squash ?? [1, 0.78 + r() * 0.2, 0.62 + r() * 0.3];
  const material = mat ?? [MAT.rock, MAT.slate, MAT.iron][Math.floor(r() * 3)];
  const bowls = [];
  for (let i = 0; i < craters; i++) {
    // Many small, few large, the way craters come.
    const size = r() * r();
    bowls.push({ c: unit([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]), rho: (0.14 + size * 0.5) * craterSize, depth: (0.04 + size * 0.14) * craterDepth });
  }
  const ao = new Float64Array(V.length);
  const verts = V.map((p, i) => {
    let rad = 1 + rough * (fbm(n, p, fq, 4) * 2 - 1);
    for (const b of bowls) {
      const a = Math.acos(clamp(dot(p, b.c), -1, 1));
      if (a < b.rho) {
        const f = 0.5 + 0.5 * Math.cos((Math.PI * a) / b.rho);
        rad -= b.depth * f;
        ao[i] += f;
      }
      const rim = (a - b.rho) / (b.rho * 0.22);
      rad += b.depth * 0.32 * Math.exp(-rim * rim);
    }
    return [p[0] * rad * sq[0], p[1] * rad * sq[1], p[2] * rad * sq[2]];
  });
  const faces = F.map((idx) => {
    const shadow = Math.min(1, idx.reduce((s, i) => s + ao[i], 0) / 3);
    const mid = scale(add(add(V[idx[0]], V[idx[1]]), V[idx[2]]), 1 / 3);
    // Mineral: slow bands of lighter and darker stone across the body, and a little grain on every face.
    const band = 0.8 + 0.4 * fbm(skin, mid, 2.6, 2);
    return { idx, mat: material, tint: band * (0.95 + r() * 0.1) * (1 - 0.5 * shadow) };
  });
  const mesh = outward({ V: verts, F: faces });
  mesh.N = vertexNormals(mesh);
  return mesh;
}

/** A normal at every vertex: the mean of the faces that meet there, by area. */
export function vertexNormals({ V, F }) {
  const N = V.map(() => [0, 0, 0]);
  for (const f of F) {
    const [a, b, c] = f.idx.map((i) => V[i]);
    const n = cross(sub(b, a), sub(c, a));
    for (const i of f.idx) N[i] = add(N[i], n);
  }
  return N.map(unit);
}

export const pebble = (seed) => asteroid(seed, { level: 2, rough: 0.3, freq: 1.0, craters: 0 });
export const boulder = (seed) => asteroid(seed, { level: 2, rough: 0.28, freq: 1.8, craters: 3, craterSize: 1.3, craterDepth: 1.6 });
export const bigRock = (seed) => asteroid(seed, { level: 3, rough: 0.16, craters: 9, craterSize: 1.1, craterDepth: 1.8 });
export const giant = (seed) => asteroid(seed, { level: 4, rough: 0.1, freq: 1.1, craters: 18, craterSize: 1.0, craterDepth: 1.8, squash: [1, 0.9, 0.8] });
export const goldRock = (seed) => asteroid(seed, { level: 3, rough: 0.13, craters: 5, craterSize: 1.2, craterDepth: 1.5, mat: MAT.gold });

/** A big rock with its halo of small ones, the family that travels together. Radius about two. */
export function cluster(seed) {
  const r = rng(seed);
  const parts = [bigRock(seed)];
  const n = 9 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const dir = unit([r() * 2 - 1, (r() * 2 - 1) * 0.6, r() * 2 - 1]);
    const dist = 1.35 + r() * 0.7;
    const k = 0.1 + r() * 0.22;
    parts.push(place(r() < 0.5 ? boulder(seed * 7 + i) : pebble(seed * 11 + i), { at: scale(dir, dist), ...attitude(r() * 6, r() * 6, r() * 6), k }));
  }
  return merge(...parts);
}

/** A drifting cloud of pebbles, thin as a sheet. Radius about one. */
export function pebbleCloud(seed) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < 42; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    const at = [Math.cos(a) * d, (r() - 0.5) * 0.35, Math.sin(a) * d];
    parts.push(place(pebble(seed * 13 + i), { at, ...attitude(r() * 6, r() * 6, r() * 6), k: 0.035 + r() * 0.06 }));
  }
  return merge(...parts);
}

// ---- Wreckage.

/** A panel torn from a hull: plating creased down the middle, ribs behind it, a rail along the top, and one corner gone. Radius about one. */
export function panel(seed) {
  const r = rng(seed);
  const bend = 0.2 + r() * 0.2;
  const half = (s) => {
    const f = turnAbout(IDENTITY, [0, 1, 0], s * bend);
    const skin = place(plate(1.0, 1.5, 2, 3, MAT.paint, { tints: [1, 0.9], thick: 0.05 }), { at: scale(f.R, s * 0.5), ...f });
    const rail = place(box(0.08, 1.5, 0.12, MAT.dark), { at: add(scale(f.R, s * 1.0), scale(f.F, -0.06)), ...f });
    const ribs = [-0.45, 0.1, 0.55].map((y) => place(box(0.96, 0.06, 0.1, MAT.dark), { at: add(add(scale(f.R, s * 0.5), scale(f.U, y)), scale(f.F, -0.07)), ...f }));
    return merge(skin, rail, ...ribs);
  };
  const top = place(box(2.0, 0.08, 0.12, MAT.dark), { at: [0, 0.75, -0.06] });
  return merge(half(1), half(-1), top);
}

/** A length of beam, an I in section, with a plate at each end. Radius about 1.7. */
export function strut(seed) {
  const r = rng(seed);
  const L = 3.0 + r() * 0.8;
  return merge(
    box(L, 0.42, 0.07, MAT.metal, 0.92),
    place(box(L, 0.07, 0.46, MAT.metal), { at: [0, 0.21, 0] }),
    place(box(L, 0.07, 0.46, MAT.metal), { at: [0, -0.21, 0] }),
    place(box(0.1, 0.72, 0.72, MAT.dark), { at: [L / 2, 0, 0] }),
    place(box(0.1, 0.72, 0.72, MAT.dark), { at: [-L / 2, 0, 0] }),
  );
}

/** A canister: a drum with two bands and domed ends. Radius about one. */
export function canister(seed) {
  const r = rng(seed);
  const h = 1.5 + r() * 0.4;
  return merge(
    prism(14, 0.5, h, MAT.paint, { tintSides: (i) => (i % 7 === 3 ? 0.78 : 1) }),
    place(prism(14, 0.56, 0.14, MAT.dark), { at: [0, h * 0.3, 0] }),
    place(prism(14, 0.56, 0.14, MAT.dark), { at: [0, -h * 0.3, 0] }),
    place(prism(14, 0.5, 0.22, MAT.metal, { taper: 0.55 }), { at: [0, h / 2 + 0.11, 0] }),
    place(prism(14, 0.5, 0.22, MAT.metal, { taper: 0.55 }), { at: [0, -h / 2 - 0.11, 0], U: [0, -1, 0], F: [0, 0, -1] }),
  );
}

/** A dead satellite: a body, a dish on a boom, two solar wings, antennae. Radius about three. */
export function satellite(seed) {
  const r = rng(seed);
  const wing = (s) => place(plate(2.6, 1.0, 8, 3, MAT.solar, { tints: [1, 0.8], thick: 0.04 }), { at: [s * 1.95, 0, 0], ...turnAbout(IDENTITY, [1, 0, 0], Math.PI / 2 + (r() - 0.5) * 0.1) });
  const yoke = (s) => place(prism(6, 0.05, 0.9, MAT.metal), { at: [s * 0.95, 0, 0], R: [0, 1, 0], U: [1, 0, 0] });
  return merge(
    box(1.0, 1.0, 1.4, MAT.metal, 0.95),
    place(plate(0.9, 1.3, 3, 4, MAT.dark, { tints: [0.9, 1], thick: 0.02 }), { at: [0, 0.51, 0], ...turnAbout(IDENTITY, [1, 0, 0], Math.PI / 2) }),
    wing(1), wing(-1), yoke(1), yoke(-1),
    place(prism(6, 0.05, 0.9, MAT.metal), { at: [0, 0, 1.1], R: [1, 0, 0], U: [0, 0, 1], F: [0, -1, 0] }),
    place(dish(18, 0.95, 0.3, MAT.paint), { at: [0, 0, 1.6], R: [1, 0, 0], U: [0, 0, 1], F: [0, -1, 0] }),
    place(prism(4, 0.025, 1.4, MAT.metal), { at: [0.3, 0, -1.1], R: [1, 0, 0], U: [0, 0, -1], F: [0, 1, 0] }),
    place(prism(4, 0.025, 1.0, MAT.metal), { at: [-0.3, 0.2, -0.9], R: [1, 0, 0], U: [0, 0.3, -1], F: [0, 1, 0.3] }),
  );
}

/** Cargo containers, still lashed in a stack. Radius about three. */
export function containers(seed) {
  const r = rng(seed);
  const parts = [];
  const mats = [MAT.metal, MAT.dark, MAT.paint, MAT.iron];
  const one = (at, yaw) => {
    const m = mats[Math.floor(r() * mats.length)];
    const ribbed = plate(2.4, 1.0, 9, 1, m, { tints: [1, 0.9], thick: 1.0 });
    parts.push(place(ribbed, { at, ...turnAbout(IDENTITY, [0, 1, 0], yaw) }));
  };
  for (let row = 0; row < 2; row++) for (let i = 0; i < 3; i++) {
    one([(i - 1) * 1.08 + (r() - 0.5) * 0.08, (row - 0.5) * 1.06, (r() - 0.5) * 0.12], (r() - 0.5) * 0.08);
  }
  one([(r() - 0.5) * 0.5, 1.6, (r() - 0.5) * 0.4], 0.35 + r() * 0.3);
  return merge(...parts);
}

/** Long spars from a hub, the frame of something that is gone. Radius about four. */
export function sparArray(seed) {
  const r = rng(seed);
  const parts = [prism(6, 0.4, 0.9, MAT.dark)];
  const colliders = [{ at: [0, 0, 0], r: 0.55 }];
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.4, tilt = (r() - 0.5) * 0.5;
    const dir = unit([Math.cos(a) * Math.cos(tilt), Math.sin(tilt), Math.sin(a) * Math.cos(tilt)]);
    const L = 3.2 + r() * 1.2;
    const up = unit(cross(dir, [0, 1, 0.01]));
    parts.push(place(prism(5, 0.07, L, MAT.metal), { at: scale(dir, L / 2), R: up, U: dir, F: cross(up, dir) }));
    parts.push(place(box(0.28, 0.28, 0.28, MAT.dark), { at: scale(dir, L) }));
    for (let d = 0.6; d <= L; d += 0.6) colliders.push({ at: scale(dir, d), r: 0.14 });
    colliders.push({ at: scale(dir, L), r: 0.22 });
  }
  const m = merge(...parts);
  m.colliders = colliders;
  return m;
}

/** A section of hull, ripped at both ends, ribbed, its windows mostly dark. Radius about four. */
export function hullSection(seed) {
  const r = rng(seed);
  const L = 7 + r() * 2, n = 20;
  const tears = Array.from({ length: n }, () => [r() * r() * 1.4, r() * r() * 1.4]);
  const parts = [tube(n, 2.2, 1.98, L, MAT.metal, { tint: 0.95, tear: (i) => tears[i] })];
  for (const y of [-0.3, 0, 0.3]) parts.push(place(tube(n, 2.34, 2.2, 0.24, MAT.dark), { at: [0, y * L, 0] }));
  for (const y of [-0.15, 0.15]) parts.push(place(tube(n, 2.28, 2.2, 0.12, MAT.dark), { at: [0, y * L, 0] }));
  // Windows: rows along the hull at a few angles, a few still lit.
  for (const a of [0.3, 1.1, 2.4, 3.9, 5.2]) {
    for (let i = 0; i < 9; i++) {
      const y = -L * 0.38 + (i / 8) * L * 0.76;
      if (Math.abs(y % (0.3 * L)) < 0.2) continue;
      const lit = r() < 0.18;
      const c = Math.cos(a), s = Math.sin(a);
      const w = place(plate(0.42, 0.3, 1, 1, lit ? MAT.window : MAT.glass, { tints: [lit ? 1 : 0.6], thick: 0.02 }), { at: [c * 2.22, y, s * 2.22], R: [-s, 0, c], U: [0, 1, 0], F: [c, 0, s] });
      parts.push(w);
    }
  }
  return merge(...parts);
}

/** A ring station, derelict: the wheel, the hub, six spokes, a few lights left on. Radius about seven. */
export function ringStation(seed) {
  const r = rng(seed);
  const parts = [torus(36, 10, 6, 0.85, MAT.metal, { tint: 0.95 }), tube(14, 1.35, 1.1, 1.9, MAT.dark, { tint: 1 }), place(tube(14, 1.55, 1.35, 0.3, MAT.metal), { at: [0, 0.8, 0] }), place(tube(14, 1.55, 1.35, 0.3, MAT.metal), { at: [0, -0.8, 0] })];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const dir = [Math.cos(a), 0, Math.sin(a)];
    parts.push(place(prism(6, 0.18, 4.8, MAT.paint, { tint: 0.9 }), { at: scale(dir, 3.6), R: [0, 1, 0], U: dir, F: cross([0, 1, 0], dir) }));
  }
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + 0.08;
    const lit = r() < 0.25;
    const c = Math.cos(a), s = Math.sin(a);
    parts.push(place(plate(0.46, 0.34, 1, 1, lit ? MAT.window : MAT.glass, { tints: [lit ? 1 : 0.6], thick: 0.02 }), { at: [c * 6.87, 0.1, s * 6.87], R: [-s, 0, c], U: [0, 1, 0], F: [c, 0, s] }));
  }
  return merge(...parts);
}

// ---- Light: the course.

/** A coin: a thick faceted disc, lit from within. Radius 0.8. */
export function coin() {
  const rim = prism(16, 0.8, 0.14, MAT.coin, { tint: 0.86, cap: false });
  const bevelTop = place(prism(16, 0.8, 0.08, MAT.coin, { taper: 0.82, tint: 1, cap: false }), { at: [0, 0.11, 0] });
  const bevelBottom = place(prism(16, 0.8, 0.08, MAT.coin, { taper: 0.82, tint: 1, cap: false }), { at: [0, -0.11, 0], U: [0, -1, 0], F: [0, 0, -1] });
  const faceTop = place(prism(16, 0.66, 0.02, MAT.coin, { tint: 0.72 }), { at: [0, 0.14, 0] });
  const faceBottom = place(prism(16, 0.66, 0.02, MAT.coin, { tint: 0.72 }), { at: [0, -0.14, 0] });
  const bossTop = place(prism(16, 0.3, 0.05, MAT.coin, { tint: 1.1, taper: 0.8 }), { at: [0, 0.17, 0] });
  const bossBottom = place(prism(16, 0.3, 0.05, MAT.coin, { tint: 1.1, taper: 0.8 }), { at: [0, -0.17, 0], U: [0, -1, 0], F: [0, 0, -1] });
  return merge(rim, bevelTop, bevelBottom, faceTop, faceBottom, bossTop, bossBottom);
}
/** A ring to fly through. Radius 4.5. */
export const ring = (R = 4.5) => torus(40, 8, R, 0.2, MAT.ring);
/**
 * A chevron, the speed burst: two slabs meeting at a tip, pointing up and
 * swept forward, and a second one stacked under it, the way the course
 * lays them. Seen from behind it is the double mark; seen from the side
 * it leans into the flight. Radius about 1.3.
 */
export function chevron() {
  const arm = (s, dy) => {
    const E = [s * 0.95, -0.45 + dy, -0.42], T = [0, 0.4 + dy, 0.42];
    const d = unit(sub(T, E)), L = length(sub(T, E));
    const R = unit(cross([0, 0, 1], d)), U = cross(d, R);
    return place(box(0.4, 0.18, L, MAT.chevron), { at: scale(add(E, T), 0.5), R, U, F: d });
  };
  return merge(arm(1, 0.38), arm(-1, 0.38), arm(1, -0.5), arm(-1, -0.5));
}

// ---- The painter.

/**
 * Draw `mesh` set down at `at` in frame {R, U, F}, scaled by `k`, as
 * `camera` sees it. Emissive materials glow: a halo under the body.
 * `smooth` shades across faces, `seams` strokes them closed.
 */
export function drawSolid(g, mesh, { at, R, U, F, camera, k = 1, dark = true, halo = 1, alpha = 1, near = 0.5, smooth = true, seams = true }) {
  const world = (p) => add(add(add(at, scale(R, p[0] * k)), scale(U, p[1] * k)), scale(F, p[2] * k));
  const turn = (n) => add(add(scale(R, n[0]), scale(U, n[1])), scale(F, n[2]));
  const W = mesh.V.map(world);
  const P = W.map((p) => camera.project(p, near));
  const NW = mesh.N && smooth ? mesh.N.map(turn) : null;
  const drawn = [];
  let glowAt = null, glowMat = null;
  for (const f of mesh.F) {
    const pts = [];
    for (const i of f.idx) { if (P[i] === null) { pts.length = 0; break; } pts.push(P[i]); }
    if (pts.length === 0) continue;
    const a = W[f.idx[0]], b = W[f.idx[1]], c = W[f.idx[2]];
    const n = unit(cross(sub(b, a), sub(c, a)));
    let mid = [0, 0, 0];
    for (const i of f.idx) mid = add(mid, W[i]);
    mid = scale(mid, 1 / f.idx.length);
    const view = unit(sub(camera.at, mid));
    const facing = dot(n, view);
    if (facing <= 0) continue;
    const depth = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const tint = f.tint ?? 1;
    if (NW && pts.length === 3 && !f.mat.emissive) {
      // Smooth: the light at each corner, and a gradient across the face between the dimmest and the brightest.
      const lit = f.idx.map((i) => lightAt(NW[i], view, f.mat, tint, dark));
      drawn.push({ pts, depth, lit, mat: f.mat, tint, view });
    } else {
      drawn.push({ pts, depth, color: shadeFace(n, view, f.mat, tint, dark) });
    }
    if (f.mat.glow && glowAt === null) { glowAt = camera.project(at, near); glowMat = f.mat; }
  }
  if (drawn.length === 0) return;
  drawn.sort((p, q) => q.depth - p.depth);
  g.save();
  g.globalAlpha = alpha;
  if (glowAt && halo > 0) {
    const rr = radiusOf(mesh) * k * glowAt.s * (1.6 + 0.8 * halo);
    const [r0, g0, b0] = glowMat.glow;
    g.globalCompositeOperation = dark ? "lighter" : "source-over";
    const grad = g.createRadialGradient(glowAt.x, glowAt.y, 0, glowAt.x, glowAt.y, rr);
    grad.addColorStop(0, `rgba(${r0},${g0},${b0},${dark ? 0.26 * halo : 0.14 * halo})`);
    grad.addColorStop(0.45, `rgba(${r0},${g0},${b0},${dark ? 0.07 * halo : 0.04 * halo})`);
    grad.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
    g.fillStyle = grad;
    g.fillRect(glowAt.x - rr, glowAt.y - rr, rr * 2, rr * 2);
    g.globalCompositeOperation = "source-over";
  }
  g.lineJoin = "round";
  g.lineWidth = 0.7;
  for (const f of drawn) {
    g.beginPath();
    f.pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    const fill = f.color ?? smoothFill(g, f);
    g.fillStyle = fill;
    g.fill();
    // The stroke in the face's own color hides the hairline between faces. Faces a few pixels across show none.
    if (seams) { g.strokeStyle = fill; g.stroke(); }
  }
  g.restore();
}

/** The light falling on a surface that faces `n`: the sun's share, the fill's share, and the glint. */
function lightAt(n, view, mat, tint, dark) {
  const lam = Math.max(0, dot(n, SUN));
  const fill = Math.max(0, dot(n, FILL));
  const h = unit(add(SUN, view));
  const spec = Math.pow(Math.max(0, dot(n, h)), mat.shine) * mat.spec;
  const rim = Math.pow(1 - Math.max(0, dot(n, view)), 4) * (dark ? 0.14 : 0.06);
  return { lam, fill, spec, rim };
}

function colorOf(mat, { lam, fill, spec, rim }, tint, dark) {
  const amb = dark ? 0.14 : 0.34;
  const specCol = mat.metal ? mat.albedo : [255, 250, 240];
  const out = [0, 1, 2].map((i) => mat.albedo[i] * (amb * tint + 0.9 * lam * tint * SUN_COLOR[i]) + FILL_COLOR[i] * 0.2 * fill * tint + specCol[i] * spec * SUN_COLOR[i] + RIM_COLOR[i] * rim);
  return `rgb(${Math.round(clamp(out[0], 0, 255))},${Math.round(clamp(out[1], 0, 255))},${Math.round(clamp(out[2], 0, 255))})`;
}

/**
 * A triangle's fill from the light at its three corners: brightness is a
 * plane over the triangle, so one linear gradient along the plane's slope
 * matches it exactly.
 */
function smoothFill(g, f) {
  const { pts, lit, mat, tint } = f;
  const dark = true;
  const v = lit.map((l) => l.lam + 0.35 * l.fill + l.spec * 2);
  const [p0, p1, p2] = pts;
  // Solve brightness = a x + b y + c through the three corners.
  const d = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  const colors = lit.map((l) => colorOf(mat, l, tint, dark));
  let lo = 0, hi = 0;
  for (let i = 1; i < 3; i++) { if (v[i] < v[lo]) lo = i; if (v[i] > v[hi]) hi = i; }
  f.midColor = colors[lo];
  if (Math.abs(d) < 1e-6 || v[hi] - v[lo] < 1e-4) return colors[hi];
  const a = ((v[1] - v[0]) * (p2.y - p0.y) - (v[2] - v[0]) * (p1.y - p0.y)) / d;
  const b = ((v[2] - v[0]) * (p1.x - p0.x) - (v[1] - v[0]) * (p2.x - p0.x)) / d;
  const len2 = a * a + b * b;
  if (len2 < 1e-12) return colors[hi];
  // Along the slope, the darkest corner sits at t = 0 and the brightest at t = 1.
  const px = pts[lo].x, py = pts[lo].y;
  const t = (v[hi] - v[lo]) / len2;
  const grad = g.createLinearGradient(px, py, px + a * t, py + b * t);
  grad.addColorStop(0, colors[lo]);
  grad.addColorStop(1, colors[hi]);
  return grad;
}

function shadeFace(n, view, mat, tint, dark) {
  if (mat.emissive) {
    const h = unit(add(SUN, view));
    const glint = Math.pow(Math.max(0, dot(n, h)), 30) * 0.9;
    const k = (0.6 + 0.4 * Math.max(0, dot(n, SUN))) * tint * (mat.dim ?? 1);
    const [r, g, b] = mat.emissive;
    return `rgb(${Math.round(Math.min(255, r * k + 255 * glint))},${Math.round(Math.min(255, g * k + 255 * glint))},${Math.round(Math.min(255, b * k + 255 * glint))})`;
  }
  return colorOf(mat, lightAt(n, view, mat, tint, dark), tint, dark);
}
