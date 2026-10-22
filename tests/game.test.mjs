// The ship flies forward along a heading, a held direction turns it, the
// course is a chain of rings laid ahead in chunks through a field, what
// you see touch is what touches, and the rules count what happened.
import test from "node:test";
import assert from "node:assert/strict";
import { Game, COIN_RADIUS, GATE_RADIUS, SHIP_HALF, MAGNET, POINTS, BOOST, STAGES, STREAK, LEAD, CORRIDOR, OFF_COURSE, DRAW_RANGE, RAMP } from "../lib/game.js";
import { makePilot } from "../lib/pilot.js";
import { add, scale, sub, dot, length } from "../lib/space.js";

const yawOf = (g) => Math.atan2(g.ship.F[0], g.ship.F[2]);
/** A game with no course and no field, to test the ship and the rules alone. */
const quiet = (opts = {}) => { const g = new Game({ ...opts, field: false }); g.objects = []; g.rings = []; g.lay = () => {}; g.watchCourse = () => {}; return g; };
/** A pickup `d` units along the heading, off it by `dx` across and `dy` up, facing the ship. */
const ahead = (g, kind, d, dx, dy, r) => { const { R, U, F } = g.frame; const o = { kind, pos: add(add(add(g.ship.pos, scale(F, d)), scale(R, dx)), scale(U, dy)), r, facing: F, R, U, depth: d, done: false, hit: false, wasAhead: true }; g.objects.push(o); if (kind === "gate") g.rings.push(o); return o; };
/** A solid thing of a class, this many units across, `d` ahead and off the heading by `dx`, `dy`. */
const solid = (g, cls, across, d, dx, dy, extra = {}) => { const { R, U, F } = g.frame; return g.spawn(cls, across, add(add(add(g.ship.pos, scale(F, d)), scale(R, dx)), scale(U, dy)), { variant: 0, ...extra }); };
const fly = (g, seconds, dir = null) => { const events = []; for (let i = 0; i < Math.round(seconds * 60); i++) { g.step(1 / 60, dir); events.push(...g.events); } return events; };

test("the ship flies forward at its speed, and a held direction turns it: gently at first, at the full rate after a second", () => {
  const g = quiet({ speed: 10, turnRate: 1 });
  fly(g, 1);
  assert.ok(Math.abs(g.ship.pos[2] - 10) < 0.2 && Math.abs(g.ship.pos[0]) < 1e-9, "a second straight: ten units down the z axis");
  fly(g, 0.3, "left");
  fly(g, 0.5);
  assert.ok(yawOf(g) < 0 && yawOf(g) > -0.09, `a short hold is a nudge: ${yawOf(g)}`);
  const g2 = quiet({ speed: 10, turnRate: 1 });
  fly(g2, 2, "left");
  assert.ok(yawOf(g2) < -1.2 && yawOf(g2) > -1.6, `two seconds held: a half radian over the ramp and a radian at full rate, less the ease: ${yawOf(g2)}`);
  const yaw = yawOf(g2);
  const before = [...g2.ship.pos];
  fly(g2, 1);
  assert.ok(Math.abs(yawOf(g2) - yaw) < 0.16, "letting go leaves the heading where it was, past the ease out");
  const moved = sub(g2.ship.pos, before);
  assert.ok(Math.abs(length(moved) - 10) < 0.5 && dot(moved, g2.frame.F) > 9.5, "and the ship keeps flying forward along it");
});

test("holding up pitches the nose up at the same rate, and kept up it goes over the top", () => {
  const g = quiet({ turnRate: 1 });
  fly(g, 4, "up");
  assert.ok(g.ship.F[2] < -0.8, `four seconds: pointing back the way it came, upside down: ${g.ship.F}`);
  assert.ok(g.ship.U[1] < -0.8);
  const { R, U, F } = g.ship;
  assert.ok(Math.abs(dot(R, F)) < 1e-9 && Math.abs(dot(U, F)) < 1e-9 && Math.abs(length(R) - 1) < 1e-9, "the frame stays square");
});

test("a pickup is met against the ship's drawn outline: a coin at the wing tip counts, one just past it does not, and a ring takes the ship's heart", () => {
  const g = quiet();
  const { R, U } = g.frame;
  const o = (kind, r) => ({ kind, r });
  const rel = (dx, dy) => add(scale(R, dx), scale(U, dy));
  assert.ok(g.touching(o("coin", COIN_RADIUS), rel(SHIP_HALF.w + COIN_RADIUS - 0.05, 0), R, U));
  assert.ok(!g.touching(o("coin", COIN_RADIUS), rel(SHIP_HALF.w + COIN_RADIUS + 0.1, 0), R, U));
  assert.ok(g.touching(o("coin", COIN_RADIUS), rel(0, SHIP_HALF.h + COIN_RADIUS - 0.05), R, U));
  assert.ok(!g.touching(o("coin", COIN_RADIUS), rel(0, SHIP_HALF.h + COIN_RADIUS + 0.1), R, U));
  assert.ok(g.touching(o("gate", GATE_RADIUS), rel(GATE_RADIUS - 0.05, 0), R, U));
  assert.ok(!g.touching(o("gate", GATE_RADIUS), rel(GATE_RADIUS + 0.05, 0), R, U));
});

test("a coin passing within a wingspan is drawn in and counts, and one further out is not", () => {
  const g = quiet();
  ahead(g, "coin", 12, MAGNET - 0.5, 0, COIN_RADIUS);
  ahead(g, "coin", 12, MAGNET + 2, 0, COIN_RADIUS);
  const events = fly(g, 1);
  assert.equal(events.filter((e) => e === "coin").length, 1);
  assert.equal(g.score, POINTS.coin);
});

test("a solid thing is met against its own shape where it is: a boulder at the wing tip hits, one past it passes, and a tunnel is hollow", () => {
  const g = quiet();
  solid(g, "boulder", 2, 20, SHIP_HALF.w + 0.6, 0);
  assert.ok(fly(g, 1.2).includes("hit"), "a boulder a unit past the wing tip's reach, its own radius counted, is a hit");
  assert.equal(g.lives, 2);
  const g2 = quiet();
  solid(g2, "boulder", 2, 20, SHIP_HALF.w + 1.6, 0);
  assert.ok(!fly(g2, 1.2).includes("hit"), "half a unit farther out and it passes");
  const g3 = quiet();
  solid(g3, "hull", 17, 30, 0, 0, { frame: { R: g3.frame.R, U: g3.frame.F, F: scale(g3.frame.U, -1) }, still: true });
  assert.ok(!fly(g3, 2.5).includes("hit"), "down the middle of a hull section is clear");
  const g4 = quiet();
  solid(g4, "hull", 17, 30, 3.6, 0, { frame: { R: g4.frame.R, U: g4.frame.F, F: scale(g4.frame.U, -1) }, still: true });
  assert.ok(fly(g4, 2.5).includes("hit"), "its wall is not");
});

test("a pebble scrapes: the combo, the clean streak and a speed stage go, no life does; a rock costs a life and a breath of shield", () => {
  const g = quiet();
  g.combo = 3; g.stage = 2; g.stageRings = 20; g.clean = 40;
  solid(g, "pebble", 0.5, 15, 0, 0);
  const events = fly(g, 1);
  assert.ok(events.includes("scrape") && !events.includes("hit"));
  assert.equal(g.lives, 3);
  assert.equal(g.combo, 0);
  assert.equal(g.stage, 1);
  assert.equal(g.stageRings, STAGES[1].rings);
  assert.ok(g.clean < 1);
  solid(g, "boulder", 2, 15, 0, 0);
  solid(g, "boulder", 2, 25, 0, 0);
  const more = fly(g, 1.5);
  assert.equal(more.filter((e) => e === "hit").length, 1, "the second rock comes inside the shield's two seconds and does not count");
  assert.equal(g.lives, 2);
});

test("passing close by something large pays a near miss; passing wide pays nothing", () => {
  const g = quiet();
  solid(g, "big", 8, 30, SHIP_HALF.w + 4 + 2, 0);
  const events = fly(g, 1.5);
  assert.ok(events.includes("near") && !events.includes("hit"), `close: ${events}`);
  assert.equal(g.score, POINTS.near);
  const g2 = quiet();
  solid(g2, "big", 8, 30, SHIP_HALF.w + 4 + 8, 0);
  assert.ok(!fly(g2, 1.5).includes("near"));
});

test("rings in a row build the combo, a miss ends it, ten rings reach the next speed stage, and a hit drops one", () => {
  const g = quiet();
  for (let i = 0; i < 10; i++) ahead(g, "gate", 20 + i * 15, 0, 0, GATE_RADIUS);
  const events = fly(g, 6);
  assert.equal(events.filter((e) => e === "gate").length, 10);
  assert.equal(g.combo, 10);
  assert.ok(events.includes("stage") && g.stage === 1, "the second stage, and the pace with it");
  assert.ok(g.pace > 1.1);
  assert.equal(g.score, POINTS.gate * (10 * 11) / 2);
  ahead(g, "gate", 20, GATE_RADIUS + 6, 0, GATE_RADIUS);
  assert.ok(fly(g, 1.5).includes("missed"));
  assert.equal(g.combo, 0);
  solid(g, "boulder", 2, 15, 0, 0);
  fly(g, 1);
  assert.equal(g.stage, 0, "a hit drops a stage");
});

test("thirty seconds clean doubles coins and rings, sixty triples them", () => {
  const g = quiet();
  g.clean = STREAK[0];
  ahead(g, "coin", 10, 0, 0, COIN_RADIUS);
  fly(g, 0.6);
  assert.equal(g.score, POINTS.coin * 2);
  g.clean = STREAK[1];
  ahead(g, "coin", 10, 0, 0, COIN_RADIUS);
  fly(g, 0.6);
  assert.equal(g.score, POINTS.coin * 2 + POINTS.coin * 3);
});

test("a chevron is a burst that wears off", () => {
  const g = quiet();
  ahead(g, "boost", 10, 0, 0, 1.2);
  fly(g, 0.5);
  assert.ok(g.boost > BOOST - 0.6 && g.pace > 1.5);
  fly(g, BOOST + 0.5);
  assert.equal(g.boost, 0);
});

test("the course is laid ahead in chunks: rings stand in order, the next is always in reach of the eye, and the field keeps a corridor clear of it", () => {
  const g = new Game({ seed: 3 });
  assert.ok(g.rings.length >= LEAD);
  const next = g.nextRing();
  assert.ok(next !== null && next.depth > 0 && next.depth < DRAW_RANGE, "the first ring is ahead and in view");
  for (const o of g.objects) if (o.cell !== undefined && !o.done) assert.ok(g.nearRoute(o.pos) >= CORRIDOR + o.r * 0.5 - 1e-6, `${o.cls} sits in the corridor, ${g.nearRoute(o.pos).toFixed(1)} from the course`);
  fly(g, 20);
  assert.ok(g.count.gates + g.count.missed >= 2, "rings came and went");
  assert.ok(g.ringsLaid - g.ringsPassed >= LEAD, "and rings keep being laid ahead as rings are passed");
});

test("leave the course and it re-forms ahead: the old rings are gone and a new first ring stands in view", () => {
  const g = new Game({ seed: 4 });
  const old = g.rings.slice();
  const events = fly(g, 4, "left").concat(fly(g, OFF_COURSE.seconds + 4));
  assert.ok(events.includes("reform"), "the course re-formed");
  assert.ok(old.every((o) => !g.objects.includes(o)), "the old rings are gone");
  const next = g.nextRing();
  assert.ok(next !== null && next.depth > 0 && next.depth < DRAW_RANGE && !old.includes(next), "a new ring ahead");
});

test("hands off, the ship passes fewer than a third of the rings: the course asks for turns", () => {
  const g = new Game({ seed: 1, lives: 1e9 });
  const events = fly(g, 150);
  const passed = events.filter((e) => e === "gate").length, missed = events.filter((e) => e === "missed").length;
  assert.ok(passed + missed >= 10, `enough rings came: ${passed + missed}`);
  assert.ok(passed / (passed + missed) < 0.34, `passed ${passed} of ${passed + missed}`);
});

test("a pilot that sees nothing but the screen passes most rings and climbs a stage; one deciding a second and a half late still lives for minutes", () => {
  const run = (seed, lag, seconds) => {
    const g = new Game({ seed });
    const think = makePilot(lag);
    const q = []; let held = null; let gates = 0, missed = 0;
    for (let i = 0; i < seconds * 60 && !g.over; i++) {
      q.push({ at: g.time + lag, dir: think(g) });
      while (q.length && q[0].at <= g.time) held = q.shift().dir;
      g.step(1 / 60, held);
      for (const e of g.events) { if (e === "gate") gates++; if (e === "missed") missed++; }
    }
    return { g, gates, missed };
  };
  const sharp = run(2, 0, 240);
  assert.ok(sharp.gates / (sharp.gates + sharp.missed) > 0.45, `sharp pilot: ${sharp.gates} of ${sharp.gates + sharp.missed}`);
  assert.ok(sharp.g.topStage >= 1, "and reached the second stage");
  for (const seed of [3, 4, 5]) {
    const late = run(seed, 1.5, 300);
    assert.ok(late.g.time >= 120, `late pilot, seed ${seed}: flew ${late.g.time.toFixed(0)} seconds`);
  }
});
