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
 * The accessibility rule for flashing content: the flashing area in any one
 * second stays under about a quarter of a ten degree field of view, which at
 * an ordinary viewing distance is 341 by 256 pixels. Four patches of
 * `size` pixels square must fit inside it together.
 */
export const SAFE_AREA_PX2 = 341 * 256;

export function patchesFitTheRule(size, count = 4) {
  return size * size * count <= SAFE_AREA_PX2;
}

/** The largest square patch `count` patches may be and still fit the rule. */
export function largestSafePatch(count = 4) {
  return Math.floor(Math.sqrt(SAFE_AREA_PX2 / count));
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
