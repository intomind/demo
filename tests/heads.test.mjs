// The vendored heads are the published ones, and they read as the device reads them.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import * as P from "../vendor/intomind-sdk-1.4.3/protocol.js";
import { ENCODER, AGE, SEX } from "../lib/numbers.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "vendor", "heads", ENCODER.id);
const sums = readFileSync(join(here, "..", "vendor", "heads", "SHA256SUMS"), "utf8");

for (const which of [AGE, SEX]) {
  test(`${which.file} is the published file and decodes for encoder ${ENCODER.id}`, () => {
    const bytes = readFileSync(join(dir, which.file));
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert.ok(sums.includes(`${digest}  ${ENCODER.id}/${which.file}`), `${which.file} is not in SHA256SUMS`);
    const head = P.decodeHead(new Uint8Array(bytes));
    assert.equal(head.encoderId, ENCODER.id);
    assert.equal(head.inDim, ENCODER.width);
    assert.equal(head.outDim, 1);
    const zero = new Array(head.inDim).fill(0);
    assert.equal(P.evaluateHead(head, zero)[0], head.scale[0] * head.bias[0]);
  });
}
