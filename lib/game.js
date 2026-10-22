// The flight itself, with nothing drawn: a ship on a heading in three
// dimensions, a course of rings laid ahead of it in chunks, a field of
// rock and wreckage around it, and the rules. Speed comes in stages
// earned by rings and lost by hits. A pebble scrapes, anything larger
// costs a life, a near miss pays, and flying clean builds a multiplier.
//
// Units are the ship's: its wings span 4.6. Directions are held: up,
// down, left, right, or nothing.

import { add, sub, scale, dot, cross, length, unit } from "./space.js";
import { model, scaleFor, CLASSES } from "./catalog.js";
import { turnAbout } from "./solid.js";

/** A small fast random source from a seed, so a course can be replayed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const COIN_RADIUS = 0.8;
export const GATE_RADIUS = 4.5;
export const BOOST_RADIUS = 1.2;
/** The ship's drawn outline: half its span, half its height, half its length. */
export const SHIP_HALF = { w: 2.3, h: 0.8, l: 2.7 };
/** Within this of the ship's path a coin is drawn in. */
export const MAGNET = 5;
export const POINTS = { coin: 10, gate: 50, gold: 500, near: 5 };
/** A chevron: seconds of burst, how much faster, and the most that can be banked. */
export const BOOST = 4, BOOST_PACE = 1.6, BOOST_MAX = 7;
/** The speed stages: rings to reach each, units per second there, and how thick the field is. */
export const STAGES = [
  { rings: 0, speed: 30, density: 4 },
  { rings: 10, speed: 34, density: 5 },
  { rings: 20, speed: 38, density: 6 },
  { rings: 30, speed: 42, density: 7 },
  { rings: 40, speed: 47, density: 8 },
  { rings: 55, speed: 53, density: 9 },
  { rings: 70, speed: 60, density: 10 },
];
/** Seconds flown clean for double, then triple, coin and ring points. */
export const STREAK = [30, 60];
/** Passing within this of a large thing, without touching, pays. */
export const NEAR_MISS = 4.6;
/** Rings laid ahead of the next one. */
export const LEAD = 3;
/** Off the course: this far from it for this long, or this far at all, and the course re-forms ahead. */
export const OFF_COURSE = { near: 60, seconds: 6, distance: 250 };
/** The field: cell size, how far it is laid, the clear corridor along the course, and the thinned verge beside it. */
export const CELL = 50, FIELD_RANGE = 150, CORRIDOR = 14, VERGE = 45;
/** The far field, of large things only: bigger cells, laid much farther out. */
export const FAR_CELL = 200, FAR_RANGE = 420;
/** How far things are drawn, in units: small things, and large ones. */
export const DRAW_RANGE = 200, DRAW_FAR = 450;
/** The first ring stands this far ahead at the start, and after the course re-forms. */
const FIRST = 60;
/** A held direction turns gently at first and reaches the full rate after this many seconds, so a short hold is a fine correction and a long one a real turn. */
export const RAMP = 1.0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Turn a frame by `a` about its up, to the right, and by `b` about its right, nose up. */
function turnFrame({ R, U, F }, a, b) {
  let r = R, u = U, f = F;
  if (a) { const c = Math.cos(a), s = Math.sin(a); [f, r] = [add(scale(f, c), scale(r, s)), add(scale(r, c), scale(f, -s))]; }
  if (b) { const c = Math.cos(b), s = Math.sin(b); [f, u] = [add(scale(f, c), scale(u, s)), add(scale(u, c), scale(f, -s))]; }
  return { R: r, U: u, F: f };
}

/** A random attitude. */
function randomFrame(r) {
  let f = { R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, 1] };
  f = turnAbout(f, [0, 1, 0], r() * Math.PI * 2);
  f = turnAbout(f, f.R, r() * Math.PI * 2);
  return turnAbout(f, f.F, r() * Math.PI * 2);
}

/** Where a tumbling thing's frame is at time `t`. */
export function frameOf(o, t) {
  if (!o.tumble) return o.frame;
  return turnAbout(o.frame, o.tumble.axis, o.phase + o.tumble.rate * t);
}

/** Weights by class in the near field, by stage. Clouds of pebbles count for five. */
function fieldWeights(stage) {
  return [
    ["pebble", 0.16], ["boulder", 0.46], ["big", stage >= 1 ? 0.14 : 0.04],
    ["panel", 0.08], ["strut", 0.07], ["canister", 0.07],
    ["satellite", stage >= 2 ? 0.05 : 0],
  ];
}

/** Weights by class in the far field: the large things, by stage. */
function farWeights(stage) {
  return [
    ["giant", stage >= 2 ? 0.5 : 0.15], ["big", 0.3], ["satellite", stage >= 2 ? 0.1 : 0], ["containers", stage >= 3 ? 0.1 : 0], ["spars", stage >= 3 ? 0.1 : 0],
    ["hull", stage >= 4 ? 0.08 : 0], ["station", stage >= 6 ? 0.03 : 0],
  ];
}

/**
 * The chunks a course is made of. Each returns its length in seconds,
 * the bend the course takes over it, and what it lays: at a fraction of
 * its length, across and up from the line. Every chunk ends in a ring.
 * `demand` is how much it asks of the pilot, 0 to 3, and `tier` when it
 * first appears.
 */
const CHUNKS = {
  straight: { demand: 0, tier: 1, lay(c, r) { c.bend((r() - 0.5) * 0.06, (r() - 0.5) * 0.03); c.trail(0.35, 0.9); c.ring(1); } },
  bend: { demand: 0, tier: 1, lay(c, r) { if (r() < 0.6) c.bend((r() < 0.5 ? 1 : -1) * (0.22 + r() * 0.12), 0); else c.bend(0, (r() < 0.5 ? 1 : -1) * (0.16 + r() * 0.08)); c.trail(0.3, 0.9); c.ring(1); } },
  boulder: { demand: 1, tier: 1, lay(c, r) {
    // A big rock on the line, coins round one side. The far side pays more.
    const side = r() < 0.5 ? 1 : -1;
    c.solid(0.55, "big", 6, 0, 0);
    c.trail(0.4, 0.7, side * 5.5, 0); c.trail(0.45, 0.6, -side * 5.5, 0);
    c.trail(0.78, 0.92); c.ring(1);
  } },
  pair: { demand: 1, tier: 1, secs: 6.5, lay(c, r) {
    // Two rings, one off each side of the line: a turn between them.
    const side = r() < 0.5 ? 1 : -1;
    c.trail(0.2, 0.42, side * 7, 0); c.ring(0.46, side * 7, 0);
    c.trail(0.6, 0.94, -side * 7, 0); c.ring(1, -side * 7, 0);
  } },
  slalom: { demand: 2, tier: 2, secs: 5, lay(c, r) {
    const side = r() < 0.5 ? 1 : -1;
    for (let i = 0; i < 3; i++) { const s = (i % 2 ? -1 : 1) * side; c.solid(0.25 + i * 0.25, "big", 6, s * 6.5, 0); }
    c.trail(0.15, 0.9); c.ring(1);
  } },
  wall: { demand: 2, tier: 2, secs: 4.5, lay(c, r) {
    // Two giants with a gap between them on the line, coins through the gap.
    const dy = (r() - 0.5) * 6;
    c.solid(0.6, "giant", 22, -17, dy); c.solid(0.6, "giant", 22, 17, dy);
    c.trail(0.45, 0.75); c.ring(1);
  } },
  fork: { demand: 2, tier: 2, secs: 5, lay(c, r) {
    // A giant on the line. Round it the short way for a few coins, the long way for more.
    const side = r() < 0.5 ? 1 : -1;
    c.solid(0.55, "giant", 18, 0, 0);
    c.trail(0.4, 0.7, -side * 12, 0);
    c.trail(0.3, 0.8, side * 18, 2);
    c.trail(0.82, 0.92); c.ring(1);
  } },
  cloud: { demand: 1, tier: 2, secs: 4, lay(c, r) {
    c.cloud(0.5, 9, 14);
    c.trail(0.3, 0.9); c.ring(1);
  } },
  spars: { demand: 2, tier: 2, secs: 4.5, lay(c, r) {
    // A spar array below the line: the way through is between two spars, above the hub.
    c.solid(0.55, "spars", 15, 0, -8, { frame: "facing" });
    c.trail(0.35, 0.75); c.ring(1);
  } },
  tunnel: { demand: 3, tier: 3, secs: 5, lay(c, r) {
    // A hull section along the line: fly down it, coins inside, a chevron at the exit.
    c.solid(0.5, "hull", 17, 0, 0, { frame: "along" });
    c.trail(0.3, 0.7); c.boost(0.78); c.ring(1);
  } },
  rolling: { demand: 3, tier: 3, secs: 5, lay(c, r) {
    // A giant drifting across the line, timed to be on it when the ship arrives.
    const side = r() < 0.5 ? 1 : -1;
    c.solid(0.6, "giant", 20, -side * 24, 0, { drift: [side * 6, 0, 0] });
    c.trail(0.4, 0.8, side * 12, 0); c.ring(1);
  } },
  gauntlet: { demand: 3, tier: 3, secs: 6, lay(c, r) {
    const side = r() < 0.5 ? 1 : -1;
    for (const [f, gap] of [[0.4, side * 8], [0.8, -side * 8]]) {
      c.solid(f, "giant", 20, gap - 16, 0); c.solid(f, "giant", 20, gap + 16, 0);
      c.trail(f - 0.1, f + 0.1, gap, 0);
    }
    c.ring(1);
  } },
  shower: { demand: 3, tier: 3, secs: 5, lay(c, r) {
    for (let i = 0; i < 6; i++) { const side = i % 2 ? 1 : -1; c.solid(0.3 + i * 0.1, "boulder", 2.5, side * 14, (r() - 0.5) * 6, { drift: [-side * 5, 0, 0] }); }
    c.trail(0.2, 0.9); c.ring(1);
  } },
  station: { demand: 3, tier: 3, secs: 6, lay(c, r) {
    // A ring station across the line. Its open hub is a ring of its own.
    c.solid(0.55, "station", 60, 0, 0, { frame: "facing" });
    c.ring(0.55, 0, 0, 4.6);
    c.trail(0.3, 0.5); c.trail(0.6, 0.9); c.ring(1);
  } },
  breather: { demand: 0, tier: 1, secs: 6, lay(c, r) {
    c.bend((r() - 0.5) * 0.1, 0);
    c.trail(0.1, 0.9); c.boost(0.5);
    c.solid(0.7, "gold", 2.6, (r() < 0.5 ? 1 : -1) * 24, (r() - 0.5) * 10);
    c.ring(1);
  } },
};

export class Game {
  /**
   * `speed` is the first stage's units per second. `turnRate` is radians
   * per second of heading while a direction is held, the same for a turn
   * as for a climb. There is no up in space: hold a climb and the ship
   * goes over the top.
   */
  constructor({ speed = 30, turnRate = 0.55, seed = 1, lives = 3, goldChance = 0.02, field = true } = {}) {
    this.speed = speed;
    this.turnRate = turnRate;
    this.goldChance = goldChance;
    this.random = mulberry32(seed);
    this.lives = lives;
    this.fieldOn = field;
    /** Where the ship is, and its frame: right, up, forward. */
    this.ship = { pos: [0, 0, 0], R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, 1] };
    /** How far the stick is over, across and up, from -1 to 1, easing in and out. */
    this.turn = { x: 0, y: 0 };
    /** How long the current direction has been held. */
    this.held = 0;
    /** How far the heading turned this step, across and up, in radians. */
    this.spin = { x: 0, y: 0 };
    this.objects = [];
    this.score = 0;
    this.combo = 0;
    this.boost = 0;
    this.count = { coins: 0, gates: 0, gold: 0, missed: 0, hits: 0, scrapes: 0, near: 0 };
    this.time = 0;
    this.over = false;
    this.holding = null;
    this.events = [];
    this.shield = 0;
    /** The speed stage, the rings that count toward the next, and the highest reached. */
    this.stage = 0;
    this.stageRings = 0;
    this.topStage = 0;
    /** Seconds flown without a hit or a scrape. */
    this.clean = 0;
    /** Seconds spent off the course, and how often it has re-formed. */
    this.offSince = 0;
    this.reforms = 0;
    /** The head that lays the course, the route it has flown, and the rings in order. */
    this.head = { pos: [0, 0, FIRST], R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, 1], flown: 0 };
    this.route = [[0, 0, 0]];
    this.routeAt = 0;
    this.rings = [];
    this.ringsLaid = 0;
    this.ringsPassed = 0;
    this.setStep = 0;
    /** The field's cells that are laid right now, by key. */
    this.cells = new Map();
    this.cellAt = null;
    this.lay();
    this.tendField();
  }

  /** Units per second at this stage, before any burst. */
  get stageSpeed() { return (STAGES[this.stage].speed / STAGES[0].speed) * this.speed; }
  /** How fast the world comes at the ship, against the first stage. */
  get pace() { return (STAGES[this.stage].speed / STAGES[0].speed) * (this.boost > 0 ? BOOST_PACE : 1); }
  /** What coins and rings are worth now: more the longer the flight has been clean. */
  get multiplier() { return this.clean >= STREAK[1] ? 3 : this.clean >= STREAK[0] ? 2 : 1; }
  /** The ship's frame: right, up, forward. */
  get frame() { const { R, U, F } = this.ship; return { R, U, F }; }
  /** The next ring to fly through, and the one after it. */
  nextRing() { return this.rings.find((o) => !o.done) ?? null; }
  ringAfter() { let seen = false; for (const o of this.rings) { if (o.done) continue; if (seen) return o; seen = true; } return null; }

  /**
   * Advance `dt` seconds with `dir` held, one of up, down, left, right, or
   * null for nothing held. Holding turns the heading that way for as long
   * as it is held. Letting go leaves the ship flying the way it points.
   */
  step(dt, dir) {
    this.events = [];
    if (this.over) return;
    this.held = dir !== null && dir === this.holding ? this.held + dt : 0;
    this.holding = dir;
    const ramp = Math.min(1, (this.held + dt) / RAMP);
    const tx = (dir === "left" ? -1 : dir === "right" ? 1 : 0) * ramp;
    const ty = (dir === "up" ? 1 : dir === "down" ? -1 : 0) * ramp;
    const k = 1 - Math.exp(-dt / 0.14);
    this.turn.x += (tx - this.turn.x) * k;
    this.turn.y += (ty - this.turn.y) * k;
    const a = this.turn.x * this.turnRate * dt, b = this.turn.y * this.turnRate * dt;
    this.spin = { x: a, y: b };
    const f = turnFrame(this.ship, a, b);
    this.ship.R = f.R; this.ship.U = f.U; this.ship.F = f.F;
    this.ship.pos = add(this.ship.pos, scale(f.F, this.stageSpeed * (this.boost > 0 ? BOOST_PACE : 1) * dt));
    this.time += dt;
    this.clean += dt;
    this.shield = Math.max(0, this.shield - dt);
    this.boost = Math.max(0, this.boost - dt);
    for (const o of this.objects) if (o.vel) o.pos = add(o.pos, scale(o.vel, dt));
    this.lay();
    this.tendField();
    this.watchCourse(dt);
    const { R, U, F } = this.ship;
    for (const o of this.objects) {
      const rel = sub(o.pos, this.ship.pos);
      const was = o.depth;
      o.depth = dot(rel, F);
      if (o.done) continue;
      if (o.solid) {
        if (length(rel) < o.r + 10 && this.collides(o, R, U, F)) { o.done = true; o.hit = true; this.resolve(o); continue; }
        if (o.r >= 2 && was > 0 && o.depth <= 0) {
          const lateral = Math.hypot(dot(rel, R), dot(rel, U)) - o.r;
          if (lateral > -o.r && lateral < NEAR_MISS) { this.score += POINTS.near; this.count.near += 1; this.events.push("near"); }
        }
        continue;
      }
      if (o.kind === "coin" && o.depth > 0 && o.depth < 24) {
        // The magnet: a coin passing near the ship is drawn onto its path.
        const dx = dot(rel, R), dy = dot(rel, U);
        if (Math.hypot(dx, dy) <= MAGNET) {
          const onPath = add(this.ship.pos, scale(F, o.depth));
          o.pos = add(o.pos, scale(sub(onPath, o.pos), 1 - Math.exp(-dt / 0.1)));
        }
      }
      // A pickup is met where the ship crosses its own plane.
      const ahead = dot(sub(o.pos, this.ship.pos), o.facing);
      if (ahead <= 0 && o.wasAhead) {
        o.done = true;
        o.hit = this.touching(o, sub(o.pos, this.ship.pos), R, U);
        this.resolve(o);
      }
      o.wasAhead = ahead > 0;
    }
    this.objects = this.objects.filter((o) => !o.gone && (o.cell !== undefined ? this.cells.has(o.cell) : !o.done || o.depth > -12));
  }

  /** Keep rings laid ahead: a chunk at a time, chosen by stage and by where the set stands. */
  lay() {
    while (this.ringsLaid - this.ringsPassed < LEAD) this.layChunk();
  }

  layChunk() {
    const r = this.random;
    const tier = this.stage <= 1 ? 1 : this.stage <= 3 ? 2 : 3;
    const at = this.setStep % 5;
    this.setStep += 1;
    let name = "breather";
    if (at < 4) {
      const want = Math.min(at, tier === 1 ? 1 : tier === 2 ? 2 : 3);
      const pool = Object.entries(CHUNKS).filter(([n, c]) => n !== "breather" && c.tier <= tier && c.demand <= want && c.demand >= want - 1);
      name = pool[Math.floor(r() * pool.length)][0];
    }
    const chunk = CHUNKS[name];
    const v = this.stageSpeed;
    const L = (chunk.secs ?? 3.5) * v;
    const items = [];
    const bend = { yaw: 0, pitch: 0 };
    const c = {
      bend: (yaw, pitch) => { bend.yaw = yaw; bend.pitch = pitch; },
      ring: (f, dx = 0, dy = 0, rad = GATE_RADIUS) => items.push({ d: f * L, kind: "gate", dx, dy, r: rad }),
      boost: (f, dx = 0, dy = 0) => items.push({ d: f * L, kind: "boost", dx, dy }),
      trail: (f0, f1, dx = 0, dy = 0) => { const step = 0.3 * v; for (let d = f0 * L; d <= f1 * L + 1e-6; d += step) items.push({ d, kind: "coin", dx, dy }); },
      solid: (f, cls, across, dx, dy, extra = {}) => items.push({ d: f * L, kind: "solid", cls, across, dx, dy, ...extra }),
      cloud: (f, radius, n) => { for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius; items.push({ d: f * L + (r() - 0.5) * radius, kind: "solid", cls: "pebble", across: 0.3 + r() * 0.4, dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.5 }); } },
    };
    chunk.lay(c, r);
    items.sort((p, q) => p.d - q.d);
    this.flyHead(L, bend, items, name);
  }

  /** The head flies the chunk, bending as it goes and laying what the chunk says where it stands. */
  flyHead(L, bend, items, name) {
    const h = this.head;
    let flown = 0, i = 0;
    while (flown < L - 1e-9) {
      const d = Math.min(2, L - flown);
      const f = turnFrame(h, (bend.yaw * d) / L, (bend.pitch * d) / L);
      h.R = f.R; h.U = f.U; h.F = f.F;
      h.pos = add(h.pos, scale(h.F, d));
      flown += d; h.flown += d;
      if (h.flown - this.routeAt >= 10) { this.route.push([...h.pos]); this.routeAt = h.flown; if (this.route.length > 90) this.route.shift(); }
      while (i < items.length && items[i].d <= flown + 1e-9) { this.place(items[i], h, name); i += 1; }
    }
    while (i < items.length) { this.place(items[i], h, name); i += 1; }
  }

  place(item, h, chunk) {
    const pos = add(add(h.pos, scale(h.R, item.dx)), scale(h.U, item.dy));
    if (item.kind === "solid") {
      const frame = item.frame === "facing" ? { R: h.R, U: h.F, F: scale(h.U, -1) } : item.frame === "along" ? { R: h.R, U: h.F, F: scale(h.U, -1) } : null;
      const o = this.spawn(item.cls, item.across, pos, { frame, still: !!item.frame, vel: item.drift ? add(add(scale(h.R, item.drift[0]), scale(h.U, item.drift[1])), scale(h.F, item.drift[2])) : null });
      o.chunk = chunk;
      return o;
    }
    const o = { kind: item.kind, pos, r: item.r ?? (item.kind === "coin" ? COIN_RADIUS : BOOST_RADIUS), facing: h.F, R: h.R, U: h.U, depth: dot(sub(pos, this.ship.pos), this.ship.F), done: false, hit: false, wasAhead: true, chunk };
    this.objects.push(o);
    if (o.kind === "gate") { this.rings.push(o); this.ringsLaid += 1; }
    return o;
  }

  /** A solid thing of a class, this many units across, at `pos`. */
  spawn(cls, across, pos, { frame = null, still = false, vel = null, cell, variant } = {}) {
    const r = this.random;
    const v = variant ?? Math.floor(r() * 5);
    const m = model(cls, v);
    const k = scaleFor(m, across);
    const o = {
      kind: CLASSES[cls].kind, cls, variant: v, pos, r: m.radius * k, k, solid: true, scrape: !!CLASSES[cls].scrape,
      frame: frame ?? randomFrame(r),
      tumble: still ? null : { axis: unit([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]), rate: (0.15 + r() * 0.5) / Math.sqrt(Math.max(1, across)) },
      phase: r() * Math.PI * 2,
      vel, depth: dot(sub(pos, this.ship.pos), this.ship.F), done: false, hit: false, cell,
    };
    this.objects.push(o);
    return o;
  }

  /** How far the ship is from the course, and when it has been away long enough, the course re-forms ahead. */
  watchCourse(dt) {
    const near = this.nearRoute(this.ship.pos);
    this.offSince = near > OFF_COURSE.near ? this.offSince + dt : 0;
    if (near > OFF_COURSE.distance || this.offSince > OFF_COURSE.seconds) this.reform();
  }

  /** The course re-forms on the ship's heading: the old one is gone, the combo with it, and a new first ring stands ahead. */
  reform() {
    this.reforms += 1;
    this.combo = 0;
    this.offSince = 0;
    for (const o of this.objects) if (o.cell === undefined) o.gone = true;
    this.objects = this.objects.filter((o) => !o.gone);
    this.rings = [];
    this.ringsLaid = 0;
    this.ringsPassed = 0;
    this.setStep = 0;
    const { pos, R, U, F } = this.ship;
    this.head = { pos: add(pos, scale(F, FIRST)), R, U, F, flown: 0 };
    this.route = [[...pos]];
    this.routeAt = 0;
    this.events.push("reform");
    this.lay();
    for (const o of this.objects) if (o.cell !== undefined && this.nearRoute(o.pos) < CORRIDOR + o.r) o.gone = true;
    this.objects = this.objects.filter((o) => !o.gone);
  }

  /** How far a point is from the course: the nearest of its samples, and the head. */
  nearRoute(pos) {
    let best = length(sub(pos, this.head.pos));
    for (const q of this.route) { const d = length(sub(pos, q)); if (d < best) best = d; }
    return best;
  }

  /** Lay the field's cells as the ship comes within range of them, and let go of the ones it has left. Two lattices: near and small, far and large. */
  tendField() {
    if (!this.fieldOn) return;
    const p = this.ship.pos;
    const key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)},${Math.floor(p[2] / CELL)}`;
    if (key === this.cellAt) return;
    this.cellAt = key;
    const wanted = new Set();
    for (const [size, range, prefix] of [[CELL, FIELD_RANGE, ""], [FAR_CELL, FAR_RANGE, "F"]]) {
      const n = Math.ceil(range / size);
      const cx = Math.floor(p[0] / size), cy = Math.floor(p[1] / size), cz = Math.floor(p[2] / size);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
        const c = [(cx + i + 0.5) * size, (cy + j + 0.5) * size, (cz + k + 0.5) * size];
        if (length(sub(c, p)) > range + size * 0.87) continue;
        const ck = `${prefix}${cx + i},${cy + j},${cz + k}`;
        wanted.add(ck);
        if (!this.cells.has(ck)) this.layCell(ck, cx + i, cy + j, cz + k, prefix === "F");
      }
    }
    for (const ck of this.cells.keys()) if (!wanted.has(ck)) this.cells.delete(ck);
  }

  /** One cell of the field, from its own seed: thicker with the stage, thicker off the course, nothing in the corridor. */
  layCell(key, i, j, k, far) {
    const r = mulberry32((((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) + (far ? 7 : 0)) >>> 0);
    const size = far ? FAR_CELL : CELL;
    const center = [(i + 0.5) * size, (j + 0.5) * size, (k + 0.5) * size];
    const off = this.nearRoute(center) > VERGE + size;
    const weights = far ? farWeights(this.stage) : fieldWeights(this.stage);
    const total = weights.reduce((s, w) => s + w[1], 0);
    let budget = (far ? 1.2 + this.stage * 0.35 : STAGES[this.stage].density) * (off ? 1.6 : 1) * (0.75 + r() * 0.5);
    const laid = [];
    this.cells.set(key, laid);
    const drifting = this.stage >= 5;
    while (budget > 0) {
      budget -= 1;
      const pos = [(i + r()) * size, (j + r()) * size, (k + r()) * size];
      const near = this.nearRoute(pos);
      let cls = "boulder";
      if (far && off && r() < this.goldChance * 8) cls = "gold";
      else { let roll = r() * total; for (const [name, w] of weights) { roll -= w; if (roll <= 0) { cls = name; break; } } }
      const [lo, hi] = CLASSES[cls].across;
      const u = r();
      const across = cls === "gold" ? lo + (hi - lo) * u : far ? hi - (hi - lo) * u * u : lo * Math.pow(hi / lo, u * u);
      if (near < CORRIDOR + across / 2) continue;
      if (near < VERGE && r() < 0.5) continue;
      if (cls === "pebble") {
        budget -= 4;
        const n = 7 + Math.floor(r() * 6), radius = 4 + r() * 4;
        for (let m = 0; m < n; m++) {
          const d = unit([r() * 2 - 1, (r() * 2 - 1) * 0.4, r() * 2 - 1]);
          laid.push(this.spawn("pebble", 0.3 + r() * 0.4, add(pos, scale(d, r() * radius)), { cell: key, variant: Math.floor(r() * 5) }));
        }
        continue;
      }
      const vel = drifting && (cls === "giant" || cls === "boulder" || cls === "big") && r() < 0.5 ? scale(unit([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]), 2 + r() * 2) : null;
      laid.push(this.spawn(cls, across, pos, { cell: key, variant: Math.floor(r() * 5), vel }));
    }
  }

  /** Whether the ship, as drawn, overlaps a pickup, as drawn, as it passes the pickup's plane. */
  touching(o, rel, R, U) {
    const dx = dot(rel, R), dy = dot(rel, U);
    if (o.kind === "gate") return dx * dx + dy * dy <= o.r * o.r;
    const ex = SHIP_HALF.w + o.r, ey = SHIP_HALF.h + o.r;
    return (dx * dx) / (ex * ex) + (dy * dy) / (ey * ey) <= 1;
  }

  /** Whether the ship's outline meets a solid thing's: its spheres, its tubes, its rings, where they are right now. */
  collides(o, R, U, F) {
    const m = model(o.cls, o.variant);
    const fr = frameOf(o, this.time);
    const at = (p) => add(o.pos, add(add(scale(fr.R, p[0] * o.k), scale(fr.U, p[1] * o.k)), scale(fr.F, p[2] * o.k)));
    for (const c of m.colliders) {
      const d = sub(at(c.at), this.ship.pos);
      const dx = dot(d, R), dy = dot(d, U), dz = dot(d, F), rr = c.r * o.k;
      const ex = SHIP_HALF.w + rr, ey = SHIP_HALF.h + rr, ez = SHIP_HALF.l + rr;
      if ((dx * dx) / (ex * ex) + (dy * dy) / (ey * ey) + (dz * dz) / (ez * ez) <= 1) return true;
    }
    if (m.tubes.length || m.tori.length) {
      const p = sub(this.ship.pos, o.pos);
      const px = dot(p, fr.R) / o.k, py = dot(p, fr.U) / o.k, pz = dot(p, fr.F) / o.k;
      const reach = 1.2 / o.k;
      const radial = Math.hypot(px, pz);
      for (const t of m.tubes) if (Math.abs(py) <= t.half + reach * 0.5 && radial >= t.ri - reach && radial <= t.ro + reach) return true;
      for (const t of m.tori) if (Math.hypot(radial - t.R, py) <= t.r + reach) return true;
    }
    return false;
  }

  resolve(o) {
    const mult = this.multiplier;
    if (o.kind === "coin") {
      if (o.hit) { this.score += POINTS.coin * mult; this.count.coins += 1; this.events.push("coin"); }
    } else if (o.kind === "gate") {
      this.ringsPassed += 1;
      if (o.hit) {
        this.combo += 1;
        this.score += POINTS.gate * this.combo * mult;
        this.count.gates += 1;
        this.stageRings += 1;
        this.events.push("gate");
        while (this.stage < STAGES.length - 1 && this.stageRings >= STAGES[this.stage + 1].rings) {
          this.stage += 1;
          this.topStage = Math.max(this.topStage, this.stage);
          this.events.push("stage");
        }
      } else {
        this.combo = 0;
        this.count.missed += 1;
        this.events.push("missed");
      }
    } else if (o.kind === "boost") {
      if (o.hit) { this.boost = Math.min(BOOST_MAX, this.boost + BOOST); this.events.push("boost"); }
    } else if (o.kind === "gold") {
      this.score += POINTS.gold; this.count.gold += 1; this.events.push("gold");
    } else if (o.solid) {
      if (this.shield > 0) { o.done = false; o.hit = false; return; }
      this.combo = 0;
      this.clean = 0;
      this.stageDown();
      if (o.scrape) {
        this.count.scrapes += 1;
        this.shield = 0.6;
        this.events.push("scrape");
      } else {
        this.lives -= 1;
        this.count.hits += 1;
        this.shield = 2;
        this.events.push("hit");
        if (this.lives <= 0) { this.over = true; this.events.push("over"); }
      }
    }
  }

  /** A hit drops a stage, and the rings toward it must be flown again. */
  stageDown() {
    this.stage = Math.max(0, this.stage - 1);
    this.stageRings = STAGES[this.stage].rings;
  }
}
