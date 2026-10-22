// The starship, as a shaded model, drawn where a camera sees it.

import { add, scale, sub, dot, cross, unit } from "./space.js";

const HULL = [222, 226, 232];
const HULL_D = [168, 174, 184];
const GLASS = [40, 170, 210];
const WING = [150, 157, 170];

/** Build the ship. One hull: a delta, its wings squared off at the tips, a fin standing on each tip. The nose points along -z. */
export function mesh() {
  const V = [];
  const F = [];
  const v = (x, y, z) => { V.push([x, y, z]); return V.length - 1; };
  const face = (color, ...idx) => { F.push({ idx, color }); };
  const nose = v(0, 0.04, -2.7);
  const fr = [v(0.26, 0.3, -1.4), v(0.42, 0.02, -1.4), v(0.26, -0.22, -1.4), v(-0.26, -0.22, -1.4), v(-0.42, 0.02, -1.4), v(-0.26, 0.3, -1.4)];
  const rr = [v(0.34, 0.34, 1.2), v(0.52, 0.0, 1.2), v(0.34, -0.26, 1.2), v(-0.34, -0.26, 1.2), v(-0.52, 0.0, 1.2), v(-0.34, 0.34, 1.2)];
  const tail = v(0, 0.03, 1.36);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const col = i === 0 || i === 5 ? HULL : i === 2 || i === 3 ? HULL_D : [182, 188, 197];
    face(col, nose, fr[j], fr[i]);
    face(col, fr[i], fr[j], rr[j], rr[i]);
    face([60, 65, 75], rr[i], rr[j], tail);
  }
  // The canopy, drawn after the hull since it always sits on top of it.
  const c0 = v(0, 0.64, -0.85), c1 = v(0.2, 0.32, -1.25), c2 = v(-0.2, 0.32, -1.25), c3 = v(0.24, 0.34, -0.25), c4 = v(-0.24, 0.34, -0.25);
  face(GLASS, c1, c2, c0); face(GLASS, c2, c4, c0); face(GLASS, c4, c3, c0); face(GLASS, c3, c1, c0);
  const nav = [];
  for (const s of [1, -1]) {
    // The wing: root along the hull, a straight chord at the tip.
    const rootL = v(s * 0.42, 0, -0.5), rootT = v(s * 0.5, 0, 1.1);
    const tipL = v(s * 2.3, -0.1, 0.3), tipT = v(s * 2.3, -0.1, 0.95);
    face(WING, rootL, tipL, tipT, rootT);
    face([112, 119, 131], rootL, rootT, tipT, tipL);
    // The fin stands on the tip chord, its leading edge swept back.
    const finTop = v(s * 2.3, 0.5, 0.9);
    face([128, 135, 148], tipL, finTop, tipT);
    face([128, 135, 148], tipL, tipT, finTop);
    nav.push([s * 2.3, 0.0, 0.95, s > 0 ? "#3bff7a" : "#ff3b3b"]);
  }
  const t1 = v(0, 0.34, 0.25), t2 = v(0, 0.98, 1.1), t3 = v(0, 0.34, 1.2);
  face([150, 156, 168], t1, t2, t3); face([150, 156, 168], t1, t3, t2);
  const engines = [[0.27, -0.02, 1.3], [-0.27, -0.02, 1.3]];
  return { V, F, engines, nav };
}

/** The world's light: from the upper left, a little behind the camera. */
const LIGHT = unit([-0.45, 0.85, -0.3]);

/**
 * Draw the ship at `at` in the world, with its frame (right, up, forward),
 * as `camera` sees it. `engine` from 0 to 2 is how hard the engines burn.
 */
export function drawShip(g, { model, at, R, U, F, camera, engine = 1, glow = "lighter" }) {
  const { V, F: faces, engines, nav } = model;
  // Mesh x is right, y is up, and the nose is at -z, so forward is -z.
  const world = (p) => add(add(add(at, scale(R, p[0])), scale(U, p[1])), scale(F, -p[2]));
  const pts = V.map((p) => camera.project(world(p), 0.1));
  if (pts.some((p) => p === null)) return;
  const drawn = faces.map((f) => {
    const ws = f.idx.map((i) => world(V[i]));
    const n = unit(cross(sub(ws[1], ws[0]), sub(ws[2], ws[0])));
    const shade = 0.52 + 0.58 * Math.max(0, dot(n, LIGHT));
    const depth = f.idx.reduce((a, i) => a + pts[i].z, 0) / f.idx.length;
    return { pts: f.idx.map((i) => pts[i]), depth, color: f.color.map((c) => Math.min(255, c * shade)), glass: f.color === GLASS };
  });
  drawn.sort((a, b) => (a.glass !== b.glass ? (a.glass ? 1 : -1) : b.depth - a.depth));
  g.save();
  g.lineJoin = "round";
  for (const f of drawn) {
    const [r, gg, b] = f.color;
    g.beginPath();
    f.pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    g.fillStyle = f.glass ? `rgba(${Math.round(r + 40)},${Math.round(gg + 60)},${Math.round(b + 60)},0.92)` : `rgb(${Math.round(r)},${Math.round(gg)},${Math.round(b)})`;
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 0.6;
    g.fill();
    g.stroke();
  }
  // Engines, glowing toward the camera.
  g.globalCompositeOperation = glow;
  for (const e of engines) {
    const p = camera.project(world(e), 0.1);
    if (p === null) continue;
    const r = p.s * (0.22 + 0.1 * engine);
    const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
    halo.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.9 * engine)})`);
    halo.addColorStop(0.18, `rgba(120,236,255,${Math.min(1, 0.75 * engine)})`);
    halo.addColorStop(0.5, `rgba(78,224,255,${Math.min(1, 0.22 * engine)})`);
    halo.addColorStop(1, "rgba(78,224,255,0)");
    g.fillStyle = halo;
    g.fillRect(p.x - r * 3.2, p.y - r * 3.2, r * 6.4, r * 6.4);
  }
  for (const [x, y, z, color] of nav) {
    const p = camera.project(world([x, y, z]), 0.1);
    if (p === null) continue;
    g.fillStyle = color;
    g.beginPath(); g.arc(p.x, p.y, Math.max(1.5, p.s * 0.045), 0, Math.PI * 2); g.fill();
    const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 0.16);
    halo.addColorStop(0, color); halo.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 0.35; g.fillStyle = halo; g.fillRect(p.x - p.s * 0.16, p.y - p.s * 0.16, p.s * 0.32, p.s * 0.32); g.globalAlpha = 1;
  }
  g.restore();
}
