// The stimulus flickers at the rate it claims, and the patches fit the safety rule.
import test from "node:test";
import assert from "node:assert/strict";
import { brightness, patchesFitTheRule, largestSafePatch, snapRefresh } from "../lib/flicker.js";

test("brightness crosses the middle twice per cycle at the stated rate", () => {
  const hz = 12;
  // Start a little after zero, so the crossing that sits exactly on the
  // boundary of the second is not counted twice or not at all.
  let crossings = 0;
  const start = 0.013;
  let prev = brightness(hz, start) - 0.5;
  for (let i = 1; i <= 6000; i++) {
    const v = brightness(hz, start + i / 6000) - 0.5;
    if ((v >= 0) !== (prev >= 0)) crossings++;
    prev = v;
  }
  assert.equal(crossings, 2 * hz);
});

test("four patches of the default size fit the flashing area rule, and the largest safe size is stated", () => {
  assert.ok(patchesFitTheRule(110));
  assert.ok(!patchesFitTheRule(200));
  assert.equal(largestSafePatch(4), 147);
});

test("a measured refresh rate snaps to a common one", () => {
  assert.equal(snapRefresh(59.7), 60);
  assert.equal(snapRefresh(143.2), 144);
  assert.equal(snapRefresh(50.4), 50.4);
});
