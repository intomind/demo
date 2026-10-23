// Flicker a patch at an exact rate on any display: the brightness is a
// sinusoid sampled at each frame's own time, so the rate does not depend on
// the screen's refresh rate dividing evenly. And the rule that keeps the
// flickering area small enough to be safe for most people.

/** The four patches, their place on the screen, and the rate each flickers at, in hertz. */
export const DEFAULT_RATES = { up: 8, right: 10, down: 12, left: 15 };
export const DIRECTIONS = ["up", "right", "down", "left"];

/** Brightness between 0 and 1 for a patch at `hz`, at `t` seconds. */
export function brightness(hz, t) {
  return 0.5 * (1 + Math.sin(2 * Math.PI * hz * t));
}

/**
 * The accessibility rule for flashing content: within any ten degree field
 * of view, what flashes covers no more than a quarter of the field. On an
 * ordinary screen at an ordinary distance a ten degree field is about 341
 * by 256 pixels, so the limit is a quarter of that area. Patches far
 * enough apart never share a field, and each may use the whole limit.
 */
export const FIELD_PX = { w: 341, h: 256 };
export const SAFE_AREA_PX2 = (FIELD_PX.w * FIELD_PX.h) / 4;

/** How many round patches of radius `r` at `centers` could lie in one ten degree field together, counting any patch that touches it. */
export function patchesInOneField(centers, r) {
  let most = 0;
  const n = centers.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const chosen = centers.filter((_, i) => mask & (1 << i));
    const xs = chosen.map((c) => c[0]), ys = chosen.map((c) => c[1]);
    const fits = Math.max(...xs) - Math.min(...xs) <= FIELD_PX.w + 2 * r && Math.max(...ys) - Math.min(...ys) <= FIELD_PX.h + 2 * r;
    if (fits) most = Math.max(most, chosen.length);
  }
  return most;
}

/** The largest radius, at most `most`, for round patches at `centers` that keeps every ten degree field under the limit. */
export function safeRadius(centers, most = 76) {
  for (let r = Math.floor(most); r >= 4; r--) {
    if (Math.PI * r * r * patchesInOneField(centers, r) <= SAFE_AREA_PX2) return r;
  }
  return 4;
}

/** The screen's refresh rate, from the intervals between animation frames. */
export function measureRefresh(frames = 60) {
  return new Promise((resolve) => {
    const times = [];
    const tick = (t) => {
      times.push(t);
      if (times.length < frames + 1) requestAnimationFrame(tick);
      else {
        const gaps = [];
        for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
        gaps.sort((a, b) => a - b);
        const median = gaps[Math.floor(gaps.length / 2)];
        resolve(snapRefresh(1000 / median));
      }
    };
    requestAnimationFrame(tick);
  });
}

/** A measured rate, snapped to a common refresh rate when within three percent of one. */
export function snapRefresh(hz) {
  for (const common of [60, 75, 90, 100, 120, 144, 165, 240]) {
    if (Math.abs(hz - common) / common < 0.03) return common;
  }
  return Math.round(hz * 10) / 10;
}
