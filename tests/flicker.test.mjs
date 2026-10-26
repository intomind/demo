// The patches fit the safety rule.
import test from "node:test";
import assert from "node:assert/strict";
import { patchesInOneField, safeRadius, SAFE_AREA_PX2, snapRefresh } from "../lib/flicker.js";

test("the flashing rule: a quarter of a ten degree field, counted over the patches that could share one", () => {
  assert.equal(SAFE_AREA_PX2, (341 * 256) / 4);
  // The four lights on a laptop screen never share a field, so each may use the whole limit and keeps its full size.
  const laptop = [[720, 112], [720, 788], [112, 450], [1328, 450]];
  assert.equal(patchesInOneField(laptop, 76), 1);
  assert.equal(safeRadius(laptop, 76), 76);
  assert.ok(Math.PI * 76 * 76 <= SAFE_AREA_PX2);
  // On a phone the left and right lights sit within one field, so they shrink until two fit the limit together.
  const phone = [[195, 112], [195, 732], [112, 422], [278, 422]];
  assert.ok(patchesInOneField(phone, 76) >= 2);
  const r = safeRadius(phone, 76);
  assert.ok(r < 76);
  assert.ok(Math.PI * r * r * patchesInOneField(phone, r) <= SAFE_AREA_PX2);
});

test("a measured refresh rate snaps to a common one", () => {
  assert.equal(snapRefresh(59.7), 60);
  assert.equal(snapRefresh(143.2), 144);
  assert.equal(snapRefresh(50.4), 50.4);
});
