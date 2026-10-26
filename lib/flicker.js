// Flicker a patch sharply at an exact rate, apart from the page's drawing,
// and the rule that keeps the flickering area small enough to be safe for
// most people.

/** The four patches, their place on the screen, and the rate each flickers at, in hertz. */
export const DEFAULT_RATES = { up: 8, right: 10, down: 12, left: 15 };
export const DIRECTIONS = ["up", "right", "down", "left"];

/**
 * The four patches, as elements of their own over the page. Each is a black
 * disc with a white one on it that a CSS animation shows for the first half
 * of every cycle and hides for the second: a sharp flicker at full contrast,
 * not a fade. The browser runs the animation apart from the page's drawing,
 * so a slow frame of the game cannot hold a patch on or off. Where the
 * screen's refresh rate does not divide evenly by the rate, a cycle lasts a
 * frame more or less, and the rate holds on average.
 */
export function lamps(rates, parent = document.body) {
  const all = DIRECTIONS.map((d) => {
    const lamp = document.createElement("div");
    lamp.className = "lamp";
    lamp.style.setProperty("--period", `${(1000 / rates[d]).toFixed(4)}ms`);
    const white = document.createElement("i");
    lamp.append(white);
    parent.append(lamp);
    return { d, lamp, white, at: "" };
  });
  return {
    /** Each patch centered on `spots[d]` with radius `r`, flickering, or else a steady gray at `level`, from 0 for black to 1 for white. */
    place(spots, r, flickering, level) {
      for (const p of all) {
        const [x, y] = spots[p.d];
        const at = `${x},${y},${r}`;
        if (at !== p.at) {
          p.at = at;
          Object.assign(p.lamp.style, { left: `${x - r}px`, top: `${y - r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
        }
        p.lamp.classList.toggle("flicker", flickering);
        if (p.white.style.opacity !== String(level)) p.white.style.opacity = String(level);
      }
    },
  };
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
