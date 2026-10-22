// BCI Flight Simulator. Four lights flicker, each at its own exact rate.
// The visual cortex follows the one the eyes rest on, the page reads which
// from the raw signal, and the ship turns toward that light for as long as
// the eyes stay there, like a stick held over. Let go and it flies on the
// way it points. The course is a chain of rings laid ahead through a
// field of rock and wreckage. Rings in a row build a combo, a chevron is
// a burst of speed, speed comes in stages earned by rings, a pebble
// scrapes, anything larger costs a life, and a near miss pays.
//
// The camera rides behind and a little above the ship, looking the way
// the ship points, and its own heading catches up a beat late. While a
// turn is held the ship sits off to the side, nose into the turn, body
// touching the light, and the world sweeps past behind it.

import { shell, ready, fit, mono, sans, isDark, pickDevice } from "../lib/shell.js";
import { Detector, scores } from "../lib/ssvep.js";
import { DEFAULT_RATES, DIRECTIONS, brightness, largestSafePatch } from "../lib/flicker.js";
import { Game, STAGES, DRAW_RANGE, DRAW_FAR, frameOf } from "../lib/game.js";
import { Camera, add, sub, scale, dot, cross, unit, length } from "../lib/space.js";
import { drawShip, mesh } from "../lib/ship.js";
import { drawSolid, turnAbout, coin as coinMesh, chevron as chevronMesh } from "../lib/solid.js";
import { model } from "../lib/catalog.js";
import { pilot } from "../lib/pilot.js";
import { sound, setSound, soundOn } from "../lib/sound.js";

const RATES = DEFAULT_RATES;
const KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
/** Seconds of signal one decision reads. */
const WINDOW = 2;
/** Seconds of baseline before the lights come on. */
const BASELINE = 10;
/** The camera: how far behind the ship and how far above it, in the ship's units. */
const CAM = { back: 17, up: 3.6 };
/** The near and far star fields: how many, and how far they reach. */
const NEAR_STARS = 900, NEAR_REACH = 120, FAR_STARS = 420;
const BEST_KEY = "intomind-demo-flight-best";
const SHIP = mesh();
const COIN = coinMesh();
const CHEVRON = chevronMesh();
/** Counts of one frame's work, for looking at with `?dev`: window.__flight. */
const stats = { step: 0, draw: 0, items: 0, meshes: 0, faces: 0, dots: 0, frames: 0 };
if (new URLSearchParams(location.search).has("dev")) window.__flight = stats;
const CYAN = [78, 224, 255], AMBER = [255, 181, 71], FUCHSIA = [255, 63, 214], RED = [255, 74, 28];
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

/** A frame turned from another: `yaw` about its up, then `pitch` about its right, then `roll` about its forward, left wing down. */
function turned({ R, U, F }, yaw, pitch, roll = 0) {
  let r = R, u = U, f = F;
  if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); [f, r] = [add(scale(f, c), scale(r, s)), add(scale(r, c), scale(f, -s))]; }
  if (pitch) { const c = Math.cos(pitch), s = Math.sin(pitch); [f, u] = [add(scale(f, c), scale(u, s)), add(scale(u, c), scale(f, -s))]; }
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); [r, u] = [add(scale(r, c), scale(u, s)), add(scale(u, c), scale(r, -s))]; }
  return { R: r, U: u, F: f };
}

/**
 * Everything seen of a flight that is not the game itself: the camera's
 * lag, the ship's bank, the stars, the sparks, the debris and the
 * flashes. One for the stage, and one for the preview on the card.
 */
class View {
  constructor({ lights = 0, quiet = false } = {}) {
    this.lights = lights;
    this.quiet = quiet;
    this.lag = { x: 0, y: 0 };
    this.bank = 0;
    this.nose = 0;
    this.shake = 0;
    this.zoom = 1;
    /** How many mesh faces may be drawn in one frame: it falls when frames run long and climbs back when they are quick. */
    this.faces = 5000;
    /** Where the camera was and where the ship fell on the screen, for the layer drawn over the world. */
    this.camera = null;
    this.shipAt = null;
    this.hitUntil = 0;
    this.scrapeUntil = 0;
    this.pops = [];
    this.sparks = [];
    this.flares = [];
    this.debris = [];
    this.near = Array.from({ length: NEAR_STARS }, () => [(Math.random() * 2 - 1) * NEAR_REACH, (Math.random() * 2 - 1) * NEAR_REACH, (Math.random() * 2 - 1) * NEAR_REACH]);
    this.far = Array.from({ length: FAR_STARS }, () => { const d = unit([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]); return { d, b: 0.3 + Math.random() * 0.7 }; });
  }

  reset() {
    this.lag = { x: 0, y: 0 };
    this.zoom = 1;
    this.pops = []; this.sparks = []; this.flares = []; this.debris = [];
  }

  /** The measure of the screen: the lens, and how far the camera's heading must lag the ship's for the ship's body to sit touching a light. */
  measure(w, h, game) {
    const R = this.lights;
    const cx = w * 0.5, cy = h * 0.5;
    const focal = 0.75 * Math.max(w, h);
    // The ship's body, on screen, is about half a unit wide and a third tall at the camera's distance.
    const s0 = focal / CAM.back;
    const bw = 0.55 * s0, bh = 0.36 * s0;
    const travelX = Math.max(40, cx - 2 * R - 36 - bw), travelY = Math.max(40, cy - 2 * R - 36 - bh);
    // A heading lag of this many radians puts the ship there, and a first-order lag settles at rate times its time constant.
    const lagX = Math.atan(travelX / focal), lagY = Math.atan(travelY / focal);
    return { R, cx, cy, focal, tauX: lagX / game.turnRate, tauY: lagY / game.turnRate };
  }

  /** What just happened in the game, shown and heard. Returns how long the world should stand still for it. */
  react(game, t, onEvent) {
    let stop = 0;
    for (const ev of game.events) {
      const m = game.multiplier;
      if (ev === "coin") { this.pops.push({ text: `+${10 * m}`, until: t + 0.7 }); this.sparkle(14, t, AMBER); if (!this.quiet) sound.coin(); }
      else if (ev === "gate") { this.pops.push({ text: game.combo > 1 ? `+${50 * game.combo * m} ×${game.combo}` : `+${50 * m}`, until: t + 0.9 }); this.flares.push({ until: t + 0.5 }); if (!this.quiet) sound.gate(game.combo); }
      else if (ev === "boost") { this.pops.push({ text: "SPEED", until: t + 0.9, color: FUCHSIA }); if (!this.quiet) sound.boost(); }
      else if (ev === "gold") { this.pops.push({ text: "+500 GOLD", until: t + 1.2 }); this.sparkle(40, t, AMBER); if (!this.quiet) sound.gold(); }
      else if (ev === "near") { this.pops.push({ text: "+5 CLOSE", until: t + 0.8, color: CYAN }); this.shake = Math.max(this.shake, 0.25); if (!this.quiet) sound.near(); }
      else if (ev === "scrape") { this.scrapeUntil = t + 0.3; this.shake = Math.max(this.shake, 0.45); this.sparkle(10, t, [200, 200, 200]); stop = Math.max(stop, 0.02); if (!this.quiet) sound.scrape(); }
      else if (ev === "hit") { this.hitUntil = t + 0.5; this.shake = 1; this.shatter(t); stop = Math.max(stop, 0.1); if (!this.quiet) sound.hit(); }
      else if (ev === "stage") { this.pops.push({ text: `SPEED ${game.stage + 1}`, until: t + 1.2, color: CYAN }); if (!this.quiet) sound.stage(); }
      else if (ev === "over") { if (!this.quiet) sound.over(); }
      onEvent?.(ev);
    }
    return stop;
  }

  sparkle(n, t, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
      this.sparks.push({ dx: Math.cos(a) * s, dy: Math.sin(a) * s, born: t, life: 0.5 + Math.random() * 0.3, color });
    }
  }

  /** Shards off the ship on a hit: they fly out, turn, and fade. */
  shatter(t) {
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 220;
      this.debris.push({ dx: Math.cos(a) * s, dy: Math.sin(a) * s, born: t, life: 0.8 + Math.random() * 0.5, size: 2 + Math.random() * 4, spin: (Math.random() - 0.5) * 12 });
    }
  }

  /** The camera's heading falls behind by what the ship turned and catches up a beat late. The ship banks and lifts its nose from the stick. The view widens in a burst. */
  follow(game, dt, m) {
    this.lag.x = (this.lag.x + game.spin.x) * Math.exp(-dt / m.tauX);
    this.lag.y = (this.lag.y + game.spin.y) * Math.exp(-dt / m.tauY);
    const kb = 1 - Math.exp(-dt / 0.12);
    this.bank += (-game.turn.x * 0.95 - this.bank) * kb;
    this.nose += (game.turn.y * 0.3 - this.nose) * kb;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.zoom += ((game.boost > 0 ? 0.86 : 1) - this.zoom) * (1 - Math.exp(-dt / 0.35));
  }

  /** The world as the camera sees it: stars, the field and the course, the ship, and what just happened. Drawn at one pixel per pixel. */
  draw(g, w, h, m, game, t, dt, { flying }) {
    const dark = isDark();
    if (dt > 1 / 45) this.faces = Math.max(1500, this.faces - 300); else if (dt < 1 / 57) this.faces = Math.min(14000, this.faces + 60);
    const { cx, cy } = m;
    const focal = m.focal * this.zoom;
    g.fillStyle = dark ? "#03050a" : "#ECECE7";
    g.fillRect(0, 0, w, h);
    const pace = flying ? game.pace : 0.4;
    const boosting = flying && game.boost > 0;
    const ship = game.frame;
    const camAt = add(add(game.ship.pos, scale(ship.F, -CAM.back)), scale(ship.U, CAM.up));
    const view = turned(ship, -this.lag.x, -this.lag.y - Math.atan2(CAM.up, CAM.back));
    const sx = (Math.random() - 0.5) * 14 * this.shake, sy = (Math.random() - 0.5) * 14 * this.shake;
    const camera = new Camera({ at: camAt, ...view, focal, cx: cx + sx, cy: cy + sy });
    // The far stars, at infinity: they only turn.
    g.globalCompositeOperation = dark ? "lighter" : "source-over";
    const farBins = [[], [], []];
    for (const s of this.far) {
      const p = camera.far(s.d);
      if (p === null) continue;
      farBins[Math.min(2, Math.floor(s.b * 3))].push(p);
    }
    farBins.forEach((bin, i) => {
      g.fillStyle = dark ? `rgba(243,241,234,${0.2 + 0.15 * i})` : `rgba(17,17,17,${0.12 + 0.1 * i})`;
      g.beginPath();
      for (const p of bin) g.rect(p.x, p.y, 1.5, 1.5);
      g.fill();
    });
    // The near stars, around the ship: they stream past, and streak with the ship's speed.
    const step = scale(ship.F, -game.speed * pace * (0.03 + (boosting ? 0.05 : 0)));
    const nearBins = [[], [], [], []];
    for (const s of this.near) {
      for (let i = 0; i < 3; i++) {
        const d = s[i] - game.ship.pos[i];
        if (d > NEAR_REACH) s[i] -= 2 * NEAR_REACH; else if (d < -NEAR_REACH) s[i] += 2 * NEAR_REACH;
      }
      const a = camera.project(s, 2), b = camera.project(add(s, step), 2);
      if (a === null || b === null) continue;
      nearBins[Math.min(3, Math.floor(Math.min(1, 30 / a.z) * 4))].push(a, b);
    }
    nearBins.forEach((bin, i) => {
      const near = (i + 0.5) / 4;
      g.strokeStyle = dark ? `rgba(243,241,234,${0.12 + near * 0.6})` : `rgba(17,17,17,${0.06 + near * 0.4})`;
      g.lineWidth = Math.min(2, 0.4 + near * 1.6);
      g.beginPath();
      for (let j = 0; j < bin.length; j += 2) { g.moveTo(bin[j].x, bin[j].y); g.lineTo(bin[j + 1].x, bin[j + 1].y); }
      g.stroke();
    });
    if (boosting) {
      const hp = camera.far(ship.F) ?? { x: cx, y: cy };
      g.strokeStyle = dark ? "rgba(255,120,230,0.2)" : "rgba(170,20,140,0.16)";
      g.lineWidth = 1;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + t * 0.4;
        const r0 = Math.min(w, h) * (0.25 + 0.1 * Math.sin(i * 7.1 + t * 9)), r1 = Math.max(w, h);
        g.beginPath(); g.moveTo(hp.x + Math.cos(a) * r0, hp.y + Math.sin(a) * r0); g.lineTo(hp.x + Math.cos(a) * r1, hp.y + Math.sin(a) * r1); g.stroke();
      }
    }
    g.globalCompositeOperation = "source-over";
    // Everything in the world, far to near, the ship at its own depth among it. Small things come up out of the dark; large ones are seen from farther.
    const next = game.nextRing(), after = game.ringAfter();
    const shipAt = camera.project(game.ship.pos, 0.1);
    const items = [];
    for (const o of game.objects) {
      if (o.done && (o.hit || o.solid)) continue;
      const p = camera.project(o.pos, 0.6);
      if (p === null) continue;
      const reach = o.r >= 5 ? DRAW_FAR : DRAW_RANGE;
      if (p.z > reach + 40 && o !== next) continue;
      if (p.x < -o.r * p.s - 20 || p.x > w + o.r * p.s + 20 || p.y < -o.r * p.s - 20 || p.y > h + o.r * p.s + 20) continue;
      items.push({ o, p, fade: o === next ? 1 : Math.min(1, (reach + 40 - p.z) / 40) });
    }
    // Within the frame's face budget: first everything big enough gets a coarse mesh, cheapest first, then the largest are refined.
    const solids = items.filter((it) => it.o.solid && it.o.r * it.p.s >= 6).sort((a, b) => b.o.r * b.p.s - a.o.r * a.p.s);
    const lodOf = new Map();
    let left = this.faces;
    for (const it of solids) {
      const m = model(it.o.cls, it.o.variant);
      if (m.far.F.length > 400 || m.far.F.length > left) continue;
      left -= m.far.F.length;
      lodOf.set(it.o, m.far);
    }
    for (const it of solids) {
      const px = it.o.r * it.p.s;
      const m = model(it.o.cls, it.o.variant);
      const wish = px > 320 ? m.hi : px > 130 ? (it.o.cls === "giant" ? m.lo : m.hi) : px > 45 ? m.lo : m.far;
      const have = lodOf.get(it.o) ?? null;
      for (const step of [wish, m.lo]) {
        const cost = step.F.length - (have ? have.F.length : 0);
        if (step.F.length > (have ? have.F.length : 0) && cost <= left) { left -= cost; lodOf.set(it.o, step); break; }
      }
    }
    items.sort((a, b) => b.p.z - a.p.z);
    stats.items += items.length; stats.meshes += lodOf.size;
    let shipDrawn = false;
    const drawShipNow = () => {
      const blink = game.shield > 1 && Math.floor(t * 12) % 2 === 0;
      g.globalAlpha = blink ? 0.35 : 1;
      const pose = turned(ship, 0, this.nose, this.bank);
      drawShip(g, { model: SHIP, at: game.ship.pos, ...pose, camera, engine: flying ? (boosting ? 1.8 : 0.8 + 0.2 * pace) : 0.5, glow: dark ? "lighter" : "source-over" });
      g.globalAlpha = 1;
      shipDrawn = true;
    };
    for (const { o, p, fade } of items) {
      if (!shipDrawn && shipAt && p.z <= shipAt.z) drawShipNow();
      const alpha = o.done ? Math.max(0, 1 + o.depth / 4) * fade : fade;
      if (alpha <= 0) continue;
      g.globalAlpha = o === after ? alpha * 0.5 : alpha;
      const px = o.r * p.s;
      if (o.kind === "coin") {
        if (px < 6) coinDot(g, p.x, p.y, Math.max(1.5, px), dark, t);
        else {
          const fr = turnAbout({ R: o.R, U: o.facing, F: cross(o.R, o.facing) }, o.facing, t * 2.4 + o.pos[0] * 0.3);
          drawSolid(g, COIN, { at: o.pos, ...fr, camera, k: 1, dark, halo: 0.9, near: 0.5 });
        }
      } else if (o.kind === "gate") gate(g, camera, o, dark, o === next ? "next" : o === after ? "after" : "");
      else if (o.kind === "boost") {
        if (px < 4) { g.fillStyle = rgba(FUCHSIA, 0.9); g.beginPath(); g.arc(p.x, p.y, Math.max(1.5, px), 0, Math.PI * 2); g.fill(); }
        else drawSolid(g, CHEVRON, { at: o.pos, R: o.R, U: o.U, F: o.facing, camera, k: 1, dark, halo: 0.5, near: 0.5 });
      } else solid(g, o, p, px, camera, game.time, dark, lodOf.get(o));
      g.globalAlpha = 1;
    }
    if (!shipDrawn) drawShipNow();
    this.camera = camera;
    this.shipAt = shipAt;
    this.next = flying ? next : null;
    if (shipAt) {
      // Sparks from a coin, shards from a hit, a flare from a ring, points rising, all at the ship.
      this.sparks = this.sparks.filter((s) => t - s.born < s.life);
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
      for (const s of this.sparks) {
        const age = (t - s.born) / s.life;
        g.fillStyle = rgba(s.color, (1 - age) * 0.9);
        g.beginPath(); g.arc(shipAt.x + s.dx * age, shipAt.y + s.dy * age - age * age * 60, 2.2 * (1 - age) + 0.6, 0, Math.PI * 2); g.fill();
      }
      g.globalCompositeOperation = "source-over";
      this.debris = this.debris.filter((d) => t - d.born < d.life);
      for (const d of this.debris) {
        const age = (t - d.born) / d.life;
        g.save();
        g.translate(shipAt.x + d.dx * age, shipAt.y + d.dy * age + age * age * 40);
        g.rotate(d.spin * age);
        g.fillStyle = dark ? `rgba(150,157,170,${1 - age})` : `rgba(80,84,92,${1 - age})`;
        g.fillRect(-d.size / 2, -d.size / 4, d.size, d.size / 2);
        g.restore();
      }
      this.flares = this.flares.filter((f) => f.until > t);
      g.globalCompositeOperation = dark ? "lighter" : "source-over";
      for (const f of this.flares) {
        const a = (f.until - t) / 0.5;
        const rr = 4.5 * shipAt.s * (1 + (1 - a) * 1.6);
        g.strokeStyle = rgba(CYAN, a * 0.7); g.lineWidth = 3 * a + 1;
        g.beginPath(); g.arc(shipAt.x, shipAt.y, rr, 0, Math.PI * 2); g.stroke();
      }
      g.globalCompositeOperation = "source-over";
    }
    if (this.hitUntil > t) {
      const a = (this.hitUntil - t) / 0.5;
      const v = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.7);
      v.addColorStop(0, rgba(RED, 0)); v.addColorStop(1, rgba(RED, 0.55 * a));
      g.fillStyle = v; g.fillRect(0, 0, w, h);
    } else if (this.scrapeUntil > t) {
      const a = (this.scrapeUntil - t) / 0.3;
      const v = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.35, cx, cy, Math.max(w, h) * 0.7);
      v.addColorStop(0, "rgba(243,241,234,0)"); v.addColorStop(1, `rgba(243,241,234,${0.22 * a})`);
      g.fillStyle = v; g.fillRect(0, 0, w, h);
    }
  }
}

/** A solid thing at its distance: a point, a shaded dot, or the mesh the budget allowed it, smoother the closer it comes. */
function solid(g, o, p, px, camera, time, dark, meshOf) {
  if (px < 1.2) return;
  if (px < 6 || !meshOf) { stats.dots += 1; dotOf(g, p.x, p.y, Math.max(1, px), o, dark); return; }
  stats.faces += meshOf.F.length;
  const facePx = (px * 2) / Math.sqrt(meshOf.F.length);
  drawSolid(g, meshOf, { at: o.pos, ...frameOf(o, time), camera, k: o.k, dark, halo: o.kind === "gold" ? 0.8 : 0, near: 0.6, smooth: px > 34, seams: facePx > 2.5 });
}

/** What is drawn over the world at the screen's own density: the next ring's mark and the points rising at the ship. */
function overlay(g, w, h, view, game, t, dark) {
  if (view.camera === null) return;
  if (view.next) marker(g, w, h, view.camera, view.next, game, t, dark);
  const shipAt = view.shipAt;
  if (!shipAt) return;
  view.pops = view.pops.filter((p) => p.until > t);
  let row = 0;
  for (const pop of view.pops) {
    const a = Math.min(1, (pop.until - t) / 0.4);
    g.fillStyle = rgba(pop.color ?? AMBER, a);
    mono(g, 14); g.textAlign = "center";
    g.fillText(pop.text, shipAt.x, shipAt.y - Math.min(w, h) * 0.12 - (0.9 - (pop.until - t)) * 40 - row * 18);
    g.textAlign = "start";
    row += 1;
  }
}

/** A far thing as a dot: a flat disc with a lit edge, cheap enough for thousands; a shaded ball once it is big enough to show one. */
function dotOf(g, x, y, r, o, dark) {
  const c = o.kind === "gold" ? [255, 200, 80] : o.kind === "junk" ? [150, 158, 170] : [122, 114, 104];
  if (r > 8) {
    const ball = g.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
    ball.addColorStop(0, `rgb(${c[0]},${c[1]},${c[2]})`);
    ball.addColorStop(0.55, `rgb(${Math.round(c[0] * 0.5)},${Math.round(c[1] * 0.5)},${Math.round(c[2] * 0.52)})`);
    ball.addColorStop(1, `rgb(${Math.round(c[0] * 0.14)},${Math.round(c[1] * 0.14)},${Math.round(c[2] * 0.18)})`);
    g.fillStyle = ball;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  } else {
    g.fillStyle = `rgb(${Math.round(c[0] * 0.42)},${Math.round(c[1] * 0.42)},${Math.round(c[2] * 0.46)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (r > 2.2) {
      g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.5)`;
      g.beginPath(); g.arc(x - r * 0.28, y - r * 0.3, r * 0.42, 0, Math.PI * 2); g.fill();
    }
  }
  if (o.kind === "gold" && dark) {
    g.globalCompositeOperation = "lighter";
    const halo = g.createRadialGradient(x, y, 0, x, y, r * 4);
    halo.addColorStop(0, "rgba(255,190,60,0.35)"); halo.addColorStop(1, "rgba(255,190,60,0)");
    g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 4, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
  }
}

/** A coin too far to be a shape: a point of warm light. */
function coinDot(g, x, y, r, dark, t) {
  g.save();
  g.globalCompositeOperation = dark ? "lighter" : "source-over";
  const halo = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
  halo.addColorStop(0, "rgba(255,181,71,0.7)"); halo.addColorStop(0.4, "rgba(255,181,71,0.18)"); halo.addColorStop(1, "rgba(255,181,71,0)");
  g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 2.4, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#ffd58a";
  g.beginPath(); g.arc(x, y, r * (0.8 + 0.2 * Math.abs(Math.cos(t * 3 + x * 0.01))), 0, Math.PI * 2); g.fill();
  g.restore();
}

/** A ring is a circle in space, facing the way the course ran when it was laid. The next one is lit and never fades. */
function gate(g, camera, o, dark, role) {
  const n = o.facing ?? [0, 0, 1];
  const a = unit(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const b = cross(n, a);
  const pts = [];
  for (let i = 0; i < 36; i++) {
    const th = (i / 36) * Math.PI * 2;
    const p = camera.project(add(add(o.pos, scale(a, Math.cos(th) * o.r)), scale(b, Math.sin(th) * o.r)), 0.5);
    if (p === null) return;
    pts.push(p);
  }
  const s = camera.project(o.pos, 0.5)?.s ?? 1;
  const r = Math.max(2, o.r * s);
  g.save();
  g.lineJoin = "round";
  const ring = () => { g.beginPath(); pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y))); g.closePath(); };
  const missed = o.done && !o.hit;
  g.strokeStyle = missed ? rgba(RED, 0.7) : dark ? rgba(CYAN, role === "next" ? 1 : 0.85) : "rgba(17,17,17,.8)";
  g.lineWidth = Math.max(1.5, r * 0.045);
  ring(); g.stroke();
  if (dark && !missed) {
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = rgba(CYAN, role === "next" ? 0.35 : 0.22); g.lineWidth = r * 0.14;
    ring(); g.stroke();
    g.fillStyle = rgba(CYAN, role === "next" ? 0.07 : 0.04);
    ring(); g.fill();
  }
  g.restore();
}

/** The next ring's mark: a soft pulse on it when it is in view, and when it is not, an arrow at the edge of the view with the distance. */
function marker(g, w, h, camera, ring, game, t, dark) {
  const p = camera.project(ring.pos, 0.6);
  const inset = 44;
  const dist = Math.round(length(sub(ring.pos, game.ship.pos)));
  const ink = dark ? CYAN : [0, 120, 150];
  g.save();
  if (p !== null && p.x > inset && p.x < w - inset && p.y > inset && p.y < h - inset) {
    const r = Math.max(14, ring.r * p.s * 1.25) * (1 + 0.06 * Math.sin(t * 4));
    g.globalCompositeOperation = dark ? "lighter" : "source-over";
    const halo = g.createRadialGradient(p.x, p.y, r * 0.75, p.x, p.y, r * 1.5);
    halo.addColorStop(0, rgba(ink, 0)); halo.addColorStop(0.5, rgba(ink, 0.12)); halo.addColorStop(1, rgba(ink, 0));
    g.fillStyle = halo; g.beginPath(); g.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2); g.fill();
    g.restore();
    return;
  }
  // Off the screen, or behind: the direction to it, clamped to the edge.
  const l = camera.local(ring.pos);
  let dx = l[0], dy = -l[1];
  if (l[2] < 0) { dx = -dx; dy = -dy; }
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const cx = w / 2, cy = h / 2;
  const kx = dx !== 0 ? (cx - inset) / Math.abs(dx) : Infinity, ky = dy !== 0 ? (cy - inset) / Math.abs(dy) : Infinity;
  const k = Math.min(kx, ky);
  const x = cx + dx * k, y = cy + dy * k;
  const ang = Math.atan2(dy, dx);
  g.translate(x, y); g.rotate(ang);
  g.fillStyle = rgba(ink, 0.95);
  g.beginPath(); g.moveTo(10, 0); g.lineTo(-4, -7); g.lineTo(-4, 7); g.closePath(); g.fill();
  g.rotate(-ang);
  mono(g, 10.5); g.textBaseline = "middle";
  g.fillStyle = dark ? "rgba(243,241,234,0.75)" : "rgba(17,17,17,0.75)";
  const tx = -dx * 22, ty = -dy * 22;
  g.textAlign = Math.abs(dx) > 0.5 ? (dx > 0 ? "end" : "start") : "center";
  g.fillText(String(dist), tx, ty + (Math.abs(dx) > 0.5 ? 0 : 0));
  g.restore();
}

/** The flight flying itself, for the card. */
function flightPreview(canvas) {
  const view = new View({ lights: 0, quiet: true });
  let game = new Game({ seed: 7 });
  let last = null, raf = 0;
  const t0 = performance.now();
  const tick = (now) => {
    const t = (now - t0) / 1000;
    const dt = last === null ? 0 : Math.min(0.1, t - last);
    last = t;
    const { g, w, h } = fit(canvas, 1);
    const m = view.measure(w, h, game);
    game.step(dt, pilot(game));
    view.react(game, t, (ev) => { if (ev === "over") { game = new Game({ seed: Math.floor(t * 100) }); view.reset(); } });
    view.follow(game, dt, m);
    view.draw(g, w, h, m, game, t, dt, { flying: true });
    overlay(g, w, h, view, game, t, isDark());
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

const canvas = document.getElementById("stage");
const ui = shell({ title: "BCI Flight Simulator", line: "", about: `
  <p>A <b>BCI</b>, a brain-computer interface, is any system that takes a signal from the brain and turns it into a command. This one reads <b>EEG</b>, the brain's electrical activity, from electrodes resting on the back of the head.</p>
  <p>When you look at a light that flickers at a steady rate, the <b>visual cortex</b>, the part of the brain at the back that processes what you see, starts producing electrical waves at exactly that rate. This is called a <b>steady-state visually evoked potential</b>, SSVEP, and it is one of the most reliable signals in brain-computer interfaces. The four lights flicker at 8, 10, 12 and 15 times a second.</p>
  <p>This page measures how much of each rate is present in your signal. Whichever rate stands out is the light you are looking at, and the ship turns that way for as long as you look. Your IntoMind One does not track your eyes. It reads what the back of your brain is doing, and that happens to say where you are looking.</p>` });
const device = await pickDevice();

const st = {
  started: false,
  phase: "idle",
  held: null,
  keyDir: null,
  baseline: [],
  baselineUntil: 0,
  lastFrame: null,
  decide: null,
  stop: 0,
  sayUntil: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
};
const view = new View({ lights: Math.min(76, Math.floor(largestSafePatch(4) / Math.sqrt(Math.PI))) });
/** The world is drawn here at one pixel per screen pixel, then copied under the lenses and the text, which are drawn at the screen's full density. */
const world = document.createElement("canvas");
let worldG = null;
function worldContext(w, h) {
  if (world.width !== w || world.height !== h) { world.width = w; world.height = h; worldG = world.getContext("2d"); }
  return worldG;
}
const detector = new Detector({ rates: RATES, threshold: 2.5, hold: 2, release: 2 });
let game = new Game();

const againBtn = ui.opt("Play again", playAgain);
againBtn.classList.add("hide");
const soundBtn = ui.opt("Sound on", () => { setSound(!soundOn()); soundBtn.textContent = soundOn() ? "Sound on" : "Sound off"; }, { on: false });
ui.sep();
ui.link("Source", "main.js");

ui.connect(device, { onConnect: begin, onDisconnect: () => { st.phase = "idle"; st.held = null; stopDeciding(); if (st.started) ui.say("Your IntoMind One disconnected. The arrow keys still fly it."); } });
device.on((e) => { if (e.type === "auto") { ui.closeCard(); begin(); } });

ui.openingCard(device, {
  title: "BCI Flight Simulator",
  warning: "<b>This demo flickers.</b> Flicker between about 3 and 60 times a second can trigger a seizure in people with photosensitive epilepsy. Don't play it if you have epilepsy, or if flickering light has ever made you feel unwell.",
  html: `<p>Four lights flicker, each at its own rate. When you look at one, the back of your brain, the part that sees, flickers at the same rate, and your IntoMind One picks it up. The ship turns toward the light you are looking at for as long as you look at it, and flies on the way it points when you look away. A short look is a small correction. A long one is a real turn.</p>
    <p>Follow the coins to the next ring. Every ring in a row counts for more, and every ten rings the ship flies faster. A chevron is a burst of speed. Pebbles scrape, and anything bigger costs a life. You have three. Leave the course and it re-forms ahead of you. The arrow keys fly it too, with or without your IntoMind One.</p>`,
  also: { label: "Fly with the keyboard", onClick: () => start() },
  onConnect: begin,
  preview: flightPreview,
});

/** The game, from the first second. */
function start() {
  if (!st.started) { st.started = true; newGame(); }
  if (st.phase === "idle") ui.say("Arrow keys steer. Follow the coins to the ring.");
}

function newGame() {
  game = new Game({ seed: Date.now() % 100000, goldChance: device.q?.has("gold") ? Number(device.q.get("gold")) : undefined, lives: device.q?.has("lives") ? Number(device.q.get("lives")) : undefined });
  // With the simulated IntoMind One, `stage=3` starts at a speed stage, to see the later course.
  if (device.q?.has("stage")) { game.stage = Math.max(0, Math.min(STAGES.length - 1, Number(device.q.get("stage")))); game.stageRings = STAGES[game.stage].rings; }
  view.reset();
  st.held = null;
  st.stop = 0;
  detector.reset();
  againBtn.classList.remove("hide");
}

/** The IntoMind One joins: a baseline with the lights dark, then the eyes steer. */
async function begin() {
  start();
  try {
    await device.start();
  } catch (e) {
    ui.warn(e.message);
    return;
  }
  calibrate();
}

function calibrate() {
  st.phase = "baseline";
  st.baseline = [];
  st.baselineUntil = performance.now() / 1000 + (device.q?.has("fast") ? 2 : BASELINE);
  detector.clearBaseline();
  ui.say("Look at the center of the screen for ten seconds while your IntoMind One listens to your signal with no flicker.");
  startDeciding();
}

function flyingLine() { return st.phase === "flying" ? "Look at a light and the ship turns toward it. The arrow keys work too." : "Arrow keys steer. Follow the coins to the ring."; }

function fly() {
  st.phase = "flying";
  detector.reset();
  st.held = null;
  ui.say(flyingLine());
}

function startDeciding() { stopDeciding(); st.decide = setInterval(decide, 250); }
function stopDeciding() { if (st.decide !== null) clearInterval(st.decide); st.decide = null; }

function decide() {
  const win = device.recent(WINDOW);
  if (win === null) { if (st.phase === "flying") st.held = null; return; }
  if (st.phase === "baseline") {
    st.baseline.push(scores(win, device.fs, RATES));
    if (performance.now() / 1000 >= st.baselineUntil) {
      detector.setBaseline(st.baseline);
      fly();
    }
    return;
  }
  if (st.phase === "flying") st.held = detector.update(win, device.fs);
}

function playAgain() {
  newGame();
  ui.say(flyingLine());
}

/** A line for a moment, then the usual one. */
function sayFor(text, seconds, t) {
  ui.say(text);
  st.sayUntil = t + seconds;
}

window.addEventListener("keydown", (e) => {
  const dir = KEYS[e.key];
  if (dir) { e.preventDefault(); st.keyDir = dir; }
  if (e.key === "Escape") st.keyDir = null;
});
window.addEventListener("keyup", (e) => { if (KEYS[e.key] === st.keyDir) st.keyDir = null; });

function frame(ts) {
  const t = ts / 1000;
  const dt = st.lastFrame === null ? 0 : Math.min(0.1, t - st.lastFrame);
  st.lastFrame = t;
  const { g, w, h } = fit(canvas);
  const m = view.measure(w, h, game);
  // With the simulated IntoMind One, `auto` lets the pilot fly it.
  const dir = st.keyDir ?? (device.q?.has("auto") ? pilot(game) : st.phase === "flying" ? st.held : null);
  const flying = st.started && !game.over;
  if (flying) {
    // A hit stops the world for a breath.
    if (st.stop > 0) st.stop -= dt;
    else {
      const t0 = performance.now();
      game.step(dt, dir);
      stats.step += performance.now() - t0;
      st.stop = view.react(game, t, (ev) => {
        if (ev === "over") {
          ui.say("Out of lives.");
          if (game.score > st.best) { st.best = game.score; localStorage.setItem(BEST_KEY, String(st.best)); }
        } else if (ev === "reform") sayFor("You left the course. A new one re-forms ahead: follow the coins to the ring.", 5, t);
        else if (ev === "scrape") sayFor("A scrape. Your run of rings and a step of speed are gone.", 3, t);
        else if (ev === "hit") sayFor(game.lives > 0 ? `A hit. ${game.lives} ${game.lives === 1 ? "life" : "lives"} left.` : "Out of lives.", 3, t);
      });
    }
    if (soundOn()) sound.engine(game.pace);
    if (st.sayUntil && t > st.sayUntil) { st.sayUntil = 0; ui.say(flyingLine()); }
  } else sound.engine(0);
  view.follow(game, dt, m);
  const t1 = performance.now();
  const gw = worldContext(w, h);
  // Under the card, before the flight starts, the world only needs refreshing now and then.
  if (st.started || stats.frames % 4 === 0 || gw !== worldG) view.draw(gw, w, h, m, game, t, dt, { flying });
  g.drawImage(world, 0, 0, w, h);
  overlay(g, w, h, view, game, t, isDark());
  chrome(g, w, h, m, t);
  stats.draw += performance.now() - t1;
  stats.frames += 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** The lights, the score, the combo and the streak, the lives, the speed stage, the baseline count, and the score large when it is over. */
function chrome(g, w, h, m, t) {
  const dark = isDark();
  const { R, cx, cy } = m;
  const held = st.keyDir ?? st.held;
  const spots = { up: [cx, R + 36], down: [cx, h - R - 36], left: [R + 36, cy], right: [w - R - 36, cy] };
  for (const d of DIRECTIONS) {
    const [x, y] = spots[d];
    lens(g, x, y, R, st.phase === "flying" ? brightness(RATES[d], t) : st.phase === "baseline" ? 0.03 : 0.08, held === d, dark);
  }
  if (st.started) {
    const ink = dark ? "rgba(243,241,234,.85)" : "#111";
    const dim = dark ? "rgba(243,241,234,.45)" : "#77776F";
    g.fillStyle = ink; mono(g, 13); g.textAlign = "end"; g.textBaseline = "alphabetic";
    g.fillText(game.score.toLocaleString("en-US"), w - 36, 96);
    let y = 116;
    if (game.multiplier > 1) { g.fillStyle = rgba(CYAN, 0.95); g.fillText(`×${game.multiplier} CLEAN`, w - 36, y); y += 20; }
    if (game.combo > 1) { g.fillStyle = rgba(AMBER, 0.95); g.fillText(`×${game.combo}`, w - 36, y); y += 20; }
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.arc(w - 40 - i * 16, y, 4, 0, Math.PI * 2);
      if (i < game.lives) { g.fillStyle = ink; g.fill(); } else { g.strokeStyle = dark ? "rgba(243,241,234,.3)" : "rgba(17,17,17,.3)"; g.lineWidth = 1; g.stroke(); }
    }
    y += 22;
    g.fillStyle = dim; mono(g, 11);
    g.fillText(`SPEED ${game.stage + 1}`, w - 36, y);
    g.textAlign = "start";
    if (game.over) {
      g.fillStyle = dark ? "#f3f1ea" : "#111"; g.textAlign = "center";
      sans(g, Math.min(w, h) * 0.22, 650);
      g.fillText(game.score.toLocaleString("en-US"), cx, cy + Math.min(w, h) * 0.07);
      g.fillStyle = dim; mono(g, 13);
      const parts = [`${game.count.coins} COINS`, `${game.count.gates} RINGS`];
      if (game.count.gold) parts.push(`${game.count.gold} GOLD`);
      if (game.count.near) parts.push(`${game.count.near} CLOSE`);
      parts.push(`SPEED ${game.topStage + 1}`, `${game.time.toFixed(0)} SECONDS`, `BEST ${st.best.toLocaleString("en-US")}`);
      g.fillText(parts.join(" · "), cx, cy + Math.min(w, h) * 0.14);
      g.textAlign = "start";
    }
  }
  if (st.phase === "baseline") {
    const left = Math.max(0, st.baselineUntil - performance.now() / 1000);
    g.fillStyle = dark ? "rgba(243,241,234,.62)" : "#77776F";
    mono(g, 12); g.textAlign = "center";
    g.fillText(`${Math.ceil(left)}`, cx, cy + h * 0.2);
    g.textAlign = "start";
    g.fillStyle = dark ? "#f3f1ea" : "#111";
    g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
  }
}

function lens(g, x, y, R, bright, held, dark) {
  g.save();
  if (dark) {
    g.globalCompositeOperation = "lighter";
    const halo = g.createRadialGradient(x, y, R * 0.6, x, y, R * 2.4);
    halo.addColorStop(0, "rgba(78,224,255,0.12)"); halo.addColorStop(1, "rgba(78,224,255,0)");
    g.fillStyle = halo; g.fillRect(x - R * 2.6, y - R * 2.6, R * 5.2, R * 5.2);
    g.globalCompositeOperation = "source-over";
  }
  const lensG = g.createRadialGradient(x - R * 0.3, y - R * 0.35, 0, x, y, R);
  lensG.addColorStop(0, `rgb(${Math.round(120 + 135 * bright)},${Math.round(200 + 55 * bright)},255)`);
  lensG.addColorStop(0.6, `rgb(${Math.round(20 + 60 * bright)},${Math.round(120 + 100 * bright)},${Math.round(160 + 95 * bright)})`);
  lensG.addColorStop(1, "#06202a");
  g.fillStyle = lensG; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = held ? (dark ? "rgba(243,241,234,0.95)" : "#111") : "rgba(78,224,255,0.45)";
  g.lineWidth = held ? 3 : 1;
  g.beginPath(); g.arc(x, y, R + 5, 0, Math.PI * 2); g.stroke();
  g.restore();
}

ready();
