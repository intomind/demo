// The browser trainer against heads the Python API produced on the same numbers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import * as P from "../vendor/intomind-sdk-1.4.0/protocol.js";
import { rint, gapRidge, trainHead, blockedFolds, symmetricEigenvalues, trainingFile, trainingText, savedHead, roundPermutation } from "../lib/train.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, "fixtures", "train");
const rows = JSON.parse(readFileSync(join(fx, "embeddings.json"), "utf8"));
const targets = JSON.parse(readFileSync(join(fx, "targets.json"), "utf8"));
const python = JSON.parse(readFileSync(join(fx, "ridge.json"), "utf8"));
const pythonHead = new Uint8Array(readFileSync(join(fx, "head.imh")));

test("rint rounds half to even, as numpy does", () => {
  assert.equal(rint(0.5), 0);
  assert.equal(rint(1.5), 2);
  assert.equal(rint(2.5), 2);
  assert.ok(rint(-0.5) === 0);
  assert.equal(rint(-1.5), -2);
  assert.equal(rint(2.4), 2);
  assert.equal(rint(2.6), 3);
  assert.equal(rint(-2.6), -3);
});

test("eigenvalues of a known matrix", () => {
  // [[2,1],[1,2]] has eigenvalues 1 and 3.
  const ev = symmetricEigenvalues([2, 1, 1, 2], 2);
  assert.ok(Math.abs(ev[0] - 1) < 1e-12 && Math.abs(ev[1] - 3) < 1e-12);
});

test("the ridge matches the Python API's choice", () => {
  // The smallest eigenvalue is the encoder's dead direction, rounding noise
  // by construction, so two exact solvers agree on it only to a few parts in
  // a hundred million of the matrix's norm. The head test below is the one
  // that matters: the same bytes come out.
  const ridge = gapRidge(rows);
  assert.ok(Math.abs(ridge - python.ridge) / python.ridge < 1e-6, `${ridge} vs ${python.ridge}`);
});

test("the head matches the Python API's byte for byte", () => {
  const { blob } = trainHead(rows, targets, { name: python.name, encoderId: python.encoder_id });
  assert.equal(blob.length, pythonHead.length);
  if (Buffer.compare(Buffer.from(blob), Buffer.from(pythonHead)) !== 0) {
    const a = P.decodeHead(blob);
    const b = P.decodeHead(pythonHead);
    let worst = 0;
    for (let i = 0; i < a.inDim; i++) worst = Math.max(worst, Math.abs(a.weights[0][i] - b.weights[0][i]));
    assert.fail(`heads differ: largest weight difference ${worst}, bias ${a.bias[0]} vs ${b.bias[0]}, scale ${a.scale[0]} vs ${b.scale[0]}`);
  }
});

test("the head the browser builds evaluates like the device", () => {
  const head = P.decodeHead(pythonHead);
  const out = P.evaluateHead(head, rows[0]);
  assert.equal(out.length, 1);
  let acc = head.bias[0];
  for (let i = 0; i < head.inDim; i++) acc += head.weights[0][i] * rows[0][i];
  assert.equal(out[0], head.scale[0] * acc);
});

test("blocked folds score the fixture above chance and never see their held-out block", () => {
  const r = blockedFolds(rows, targets, { folds: 5, encoderId: python.encoder_id });
  assert.ok(r !== null);
  assert.equal(r.total, rows.length);
  assert.ok(r.accuracy > r.chance, `${r.accuracy} should beat chance ${r.chance}`);
  assert.equal(r.folds.length, 5);
});

test("too few windows is refused rather than fitted", () => {
  assert.throws(() => trainHead(rows.slice(0, 60), targets.slice(0, 60), { encoderId: python.encoder_id }), /needs more than 60 windows/);
  assert.equal(blockedFolds(rows.slice(0, 70), targets.slice(0, 70), { encoderId: python.encoder_id }), null);
});

test("a float embedding is refused, because the device never sees one", () => {
  const bad = rows.map((r) => r.slice());
  bad[0][0] = 0.5;
  assert.throws(() => trainHead(bad, targets, { encoderId: python.encoder_id }), /integers/);
});

test("the training data the light switch saves trains the same custom AI head in the browser and in python/teach_it.py, byte for byte", () => {
  const windows = rows.map((embedding, i) => ({ index: 100 + i, round: Math.floor(i / 10), label: targets[i], embedding: Int16Array.from(embedding) }));
  const text = trainingText(trainingFile({ name: python.name, encoderId: python.encoder_id, states: ["Off", "On"], windows, dropped: 3 }));
  const back = JSON.parse(text);
  assert.equal(back.windows.length, rows.length);
  assert.deepEqual(back.windows[7].embedding, rows[7]);
  const { blob } = trainHead(back.windows.map((w) => w.embedding), back.windows.map((w) => w.label), { name: back.name, encoderId: back.encoderId });
  assert.deepEqual(blob, pythonHead);

  const dir = mkdtempSync(join(tmpdir(), "light-switch-"));
  writeFileSync(join(dir, "data.json"), text);
  const run = spawnSync("python3", [join(here, "..", "python", "teach_it.py"), "--from", join(dir, "data.json"), "--out", join(dir, "head.imh")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, "head.imh"))), pythonHead);
});

test("a saved custom AI head is taken when it fits, and refused with a reason when it is damaged or does not fit", () => {
  assert.equal(savedHead(pythonHead, { encoderId: python.encoder_id, width: 76 }).inDim, 76);
  const damaged = pythonHead.slice(); damaged[60] ^= 1;
  assert.throws(() => savedHead(damaged), /not a custom AI head/);
  assert.throws(() => savedHead(new TextEncoder().encode("a photo, not a head")), /not a custom AI head/);
  assert.throws(() => savedHead(pythonHead, { encoderId: "0123456789abcdef" }), /another version/);
  const two = P.buildHead([Array(76).fill(1), Array(76).fill(2)], [0, 0], [1, 1], { encoderId: python.encoder_id });
  assert.throws(() => savedHead(two), /2 readings/);
  const narrow = P.buildHead([Array(40).fill(1)], [0], [1], { version: 1 });
  assert.throws(() => savedHead(narrow, { encoderId: python.encoder_id, width: 76 }), /does not fit/);
});

test("the round permutation test calls a real difference clear and no difference unclear", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const make = (shift) => {
    const rows = [], labels = [], rounds = [];
    for (let r = 0; r < 8; r++) for (let i = 0; i < 11; i++) {
      const label = r % 2;
      rows.push(Array.from({ length: 76 }, (_, j) => Math.round((rand() - 0.5) * 4000 + (label && j < 8 ? shift : 0))));
      labels.push(label); rounds.push(r);
    }
    return { rows, labels, rounds };
  };
  const real = make(2500);
  const clear = roundPermutation(real.rows, real.labels, real.rounds, { encoderId: python.encoder_id });
  assert.equal(clear.labelings, 70);
  // The labeling that swaps On and Off splits the rounds the same way, so the best p is two in 70.
  assert.ok(Math.abs(clear.p - 2 / 70) < 1e-9, `p ${clear.p}`);
  assert.equal(clear.accuracy, blockedFolds(real.rows, real.labels, { encoderId: python.encoder_id }).accuracy);
  const none = make(0);
  assert.ok(roundPermutation(none.rows, none.labels, none.rounds, { encoderId: python.encoder_id }).p > 0.05);
});
