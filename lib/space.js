// Three dimensions, the little of it a flight needs: vectors, a frame
// from a heading, and a camera that turns points in the world into points
// on the screen.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * A frame from a heading: `yaw` turns about the world's up, positive to
 * the right, `pitch` tips the nose, positive up, and `roll` banks about
 * the forward axis, positive left wing down. Returns right, up, forward.
 */
export function frame(yaw, pitch, roll = 0) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const F = [sy * cp, sp, cy * cp];
  let R = [cy, 0, -sy];
  let U = cross(F, R);
  if (roll !== 0) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const R2 = add(scale(R, c), scale(U, s));
    const U2 = add(scale(R, -s), scale(U, c));
    R = R2; U = U2;
  }
  return { R, U, F };
}

/** A camera at `at`, with a frame, a focal length in pixels and the screen's center. */
export class Camera {
  constructor({ at, R, U, F, focal, cx, cy }) {
    this.at = at; this.R = R; this.U = U; this.F = F; this.focal = focal; this.cx = cx; this.cy = cy;
  }

  /** A world point in the camera's own axes: right, up, and depth ahead. */
  local(p) {
    const d = sub(p, this.at);
    return [dot(d, this.R), dot(d, this.U), dot(d, this.F)];
  }

  /** A world point on the screen, with its depth and the pixels per world unit there. Null when behind the camera. */
  project(p, near = 0.5) {
    const [x, y, z] = this.local(p);
    if (z < near) return null;
    const s = this.focal / z;
    return { x: this.cx + x * s, y: this.cy - y * s, z, s };
  }

  /** A direction, at infinity, on the screen. Null when it is behind. */
  far(dir, near = 0.03) {
    const z = dot(dir, this.F);
    if (z < near) return null;
    const s = this.focal / z;
    return { x: this.cx + dot(dir, this.R) * s, y: this.cy - dot(dir, this.U) * s };
  }
}
