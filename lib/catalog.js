// Every class of thing the ship can meet, by name: how big it comes, how
// it is built, what it does to the ship, and what it is for hitting. The
// model and the view share this so a hit is against what is drawn. Meshes
// are built once per variant and kept.

import * as S from "./solid.js";
import { length } from "./space.js";

/** Spheres along a line from `a` to `b`, in mesh units. */
const chain = (a, b, r, n) => Array.from({ length: n }, (_, i) => ({ at: a.map((v, k) => v + (b[k] - v) * (n === 1 ? 0.5 : i / (n - 1))), r }));

export const CLASSES = {
  pebble: { kind: "rock", across: [0.3, 0.7], scrape: true, hi: (s) => S.pebble(s), lo: (s) => S.asteroid(s, { level: 1, rough: 0.3, freq: 1.0, craters: 0 }), colliders: [{ at: [0, 0, 0], r: 0.9 }] },
  boulder: { kind: "rock", across: [1, 3], hi: (s) => S.boulder(s), lo: (s) => S.asteroid(s, { level: 1, rough: 0.28, freq: 1.8, craters: 3, craterSize: 1.3, craterDepth: 1.6 }), colliders: [{ at: [0, 0, 0], r: 0.92 }] },
  big: { kind: "rock", across: [5, 10], hi: (s) => S.bigRock(s), lo: (s) => S.asteroid(s, { level: 2, rough: 0.16, craters: 9, craterSize: 1.1, craterDepth: 1.8 }), far: (s) => S.asteroid(s, { level: 1, rough: 0.16, craters: 9, craterSize: 1.1, craterDepth: 1.8 }), colliders: [{ at: [0, 0, 0], r: 0.93 }] },
  giant: { kind: "rock", across: [20, 40], hi: (s) => S.giant(s), lo: (s) => S.asteroid(s, { level: 3, rough: 0.1, freq: 1.1, craters: 18, craterSize: 1.0, craterDepth: 1.8, squash: [1, 0.9, 0.8] }), far: (s) => S.asteroid(s, { level: 2, rough: 0.1, freq: 1.1, craters: 18, craterSize: 1.0, craterDepth: 1.8, squash: [1, 0.9, 0.8] }), colliders: [{ at: [0, 0, 0], r: 0.9 }] },
  gold: { kind: "gold", across: [2, 3], hi: (s) => S.goldRock(s), lo: (s) => S.asteroid(s, { level: 2, rough: 0.13, craters: 5, craterSize: 1.2, craterDepth: 1.5, mat: S.MAT.gold }), far: (s) => S.asteroid(s, { level: 1, rough: 0.13, craters: 5, craterSize: 1.2, craterDepth: 1.5, mat: S.MAT.gold }), colliders: [{ at: [0, 0, 0], r: 0.95 }] },
  panel: { kind: "junk", across: [1, 2], hi: (s) => S.panel(s), colliders: chain([-0.7, 0, 0], [0.7, 0, 0], 0.5, 3) },
  strut: { kind: "junk", across: [2, 4], hi: (s) => S.strut(s), colliders: chain([-1.5, 0, 0], [1.5, 0, 0], 0.32, 5) },
  canister: { kind: "junk", across: [1, 2], hi: (s) => S.canister(s), colliders: chain([0, -0.6, 0], [0, 0.6, 0], 0.55, 3) },
  satellite: { kind: "junk", across: [4, 6], hi: (s) => S.satellite(s), colliders: [{ at: [0, 0, 0], r: 0.75 }, { at: [0, 0, 1.6], r: 0.8 }, ...chain([-3.2, 0, 0], [-0.9, 0, 0], 0.45, 4), ...chain([0.9, 0, 0], [3.2, 0, 0], 0.45, 4)] },
  containers: { kind: "junk", across: [5, 8], hi: (s) => S.containers(s), colliders: [...chain([-1.6, -0.5, 0], [1.6, -0.5, 0], 0.62, 4), ...chain([-1.6, 0.5, 0], [1.6, 0.5, 0], 0.62, 4), { at: [0, 1.6, 0], r: 0.6 }, { at: [0.9, 1.6, 0.3], r: 0.5 }] },
  spars: { kind: "junk", across: [15, 15], hi: (s) => S.sparArray(s), colliders: null },
  hull: { kind: "junk", across: [8, 9], hi: (s) => S.hullSection(s), colliders: [], tubes: [{ ri: 1.98, ro: 2.34, half: 4.5 }] },
  station: { kind: "junk", across: [60, 60], hi: (s) => S.ringStation(s), colliders: [], tori: [{ R: 6, r: 0.9 }], tubes: [{ ri: 1.1, ro: 1.35, half: 0.95 }] },
};

const built = new Map();

/** One variant of a class: its meshes from finest to coarsest, its radius in mesh units, and what it is for hitting. */
export function model(cls, variant = 0) {
  const key = `${cls}:${variant}`;
  if (built.has(key)) return built.get(key);
  const c = CLASSES[cls];
  const seed = (hashOf(cls) + variant * 7919) >>> 0;
  const hi = c.hi(seed);
  const lo = c.lo ? c.lo(seed) : hi;
  const far = c.far ? c.far(seed) : lo;
  const radius = S.radiusOf(hi);
  const colliders = hi.colliders ?? c.colliders ?? [{ at: [0, 0, 0], r: radius * 0.9 }];
  const m = { cls, hi, lo, far, radius, colliders, tubes: c.tubes ?? [], tori: c.tori ?? [] };
  built.set(key, m);
  return m;
}

/** The scale that makes a variant this many units across. */
export function scaleFor(m, across) { return across / 2 / m.radius; }

function hashOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export const VARIANTS = 5;
