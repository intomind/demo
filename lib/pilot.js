// A pilot for the flight when no one is flying it: the preview on the
// card, and the tests that measure how hard the course is. It aims at
// the next ring, takes coins on the way, and steps round what is solid.
// Given a lag, it flies the way a person does through the IntoMind One: it
// holds a direction for as long as the turn needs, lets go, and waits to
// see where that left the ship before deciding again.

import { sub, dot } from "./space.js";
import { RAMP } from "./game.js";

/**
 * How far the heading turns for a hold of T seconds from rest, with the
 * stick's ease, the ramp, and the tail after letting go, found once by
 * flying the stick model itself; and the hold that gives an angle.
 */
const TABLE = (() => {
  const out = [];
  for (let T = 0.05; T <= 3.0001; T += 0.05) {
    let stick = 0, held = 0, angle = 0, t = 0;
    const dt = 1 / 60, k = 1 - Math.exp(-dt / 0.14);
    while (t < T + 1.5) {
      const holding = t < T;
      held = holding ? held + dt : 0;
      const target = holding ? Math.min(1, (held + dt) / RAMP) : 0;
      stick += (target - stick) * k;
      angle += stick * dt;
      t += dt;
      if (!holding && stick < 0.003) break;
    }
    out.push({ T, angle });
  }
  return out;
})();
function holdFor(a, rate) {
  const want = a / rate;
  for (const row of TABLE) if (row.angle >= want) return row.T;
  return 3.0 + (want - TABLE[TABLE.length - 1].angle);
}

/** A pilot: call it each step with the game and it says what to hold. `lag` is how long a decision takes to land. */
export function makePilot(lag = 0) {
  let plan = null;
  return (game) => {
    const t = game.time;
    if (plan !== null && t < plan.busyUntil) return t < plan.until ? plan.dir : null;
    const next = decide(game, lag);
    if (next === null) { plan = { dir: null, until: t, busyUntil: t + 0.25 }; return null; }
    // After a hold, let go long enough for the turn to finish before judging it, and for the decision to land.
    plan = { dir: next.dir, until: t + next.hold, busyUntil: t + next.hold + Math.max(lag, 0.5) };
    return next.dir;
  };
}

/** The pilot without lag, for the preview. */
export function pilot(game) {
  const d = decide(game, 0);
  return d === null ? null : d.dir;
}

/** What to do now: a direction and how long to hold it, or null for nothing. */
function decide(game, lag) {
  const { R, U, F } = game.frame;
  const v = game.stageSpeed;
  const next = game.nextRing();
  // Anything solid on a line that meets the ship within the time a dodge takes, and nearer than the next ring: steer away from it.
  const horizon = v * (2.5 + lag);
  for (const o of game.objects) {
    if (!o.solid || o.kind === "gold" || o.done || o.depth < 2 || o.depth > horizon + o.r) continue;
    if (next && next.depth > 6 && o.depth - o.r > next.depth) continue;
    const rel = sub(o.pos, game.ship.pos);
    const dx = dot(rel, R), dy = dot(rel, U);
    const reach = o.r + 3.5;
    if (Math.abs(dx) < reach && Math.abs(dy) < reach * 0.6 + 1) {
      const across = Math.abs(dx) > Math.abs(dy) * 0.6 || o.r > 6;
      const need = (across ? reach - Math.abs(dx) : reach * 0.6 + 1 - Math.abs(dy)) / Math.max(10, o.depth - lag * v);
      const hold = Math.min(2, holdFor(need * 1.4, game.turnRate));
      if (across) return { dir: dx >= 0 ? "left" : "right", hold };
      return { dir: dy >= 0 ? "down" : "up", hold };
    }
  }
  // Aim through the next ring at the one after it: once the heading will carry the ship through, look past it.
  let target = next;
  let close = false;
  if (next !== null) {
    const rel = sub(next.pos, game.ship.pos);
    const lateral = Math.hypot(dot(rel, R), dot(rel, U));
    const after = game.ringAfter();
    close = next.depth < v * 1.5;
    // Near a ring that the heading already carries the ship through, look past it to the one after.
    if (lateral < next.r * (close ? 0.85 : 0.5)) target = after ?? next;
  }
  if (target === null) {
    let best = Infinity;
    for (const o of game.objects) {
      if (o.done || o.solid || o.depth < 8) continue;
      if (o.depth < best) { best = o.depth; target = o; }
    }
  }
  if (target === null) return null;
  const rel = sub(target.pos, game.ship.pos);
  const x = Math.atan2(dot(rel, R), dot(rel, F)), y = Math.atan2(dot(rel, U), dot(rel, F));
  const a = Math.abs(x) >= Math.abs(y) ? x : y;
  if (Math.abs(a) < 0.03) return null;
  // Close to a ring, only a nudge: a hard turn now would carry past the course.
  const hold = Math.min(close && target === next ? 0.4 : 2.5, holdFor(Math.abs(a), game.turnRate));
  if (Math.abs(x) >= Math.abs(y)) return { dir: x > 0 ? "right" : "left", hold };
  return { dir: y > 0 ? "up" : "down", hold };
}
