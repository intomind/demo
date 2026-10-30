// Training a head in the browser, exactly as the Python API does it: a
// ridge fit chosen from the embeddings alone, quantized the way the device
// holds it, and written with the SDK's buildHead. The Node tests hold this
// file to heads the Python API produced on the same numbers.

import * as P from "../vendor/intomind-sdk-1.4.3/protocol.js";

/** Round half to even, as numpy's rint and Python's round do. */
export function rint(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * The eigenvalues of a symmetric matrix, ascending, by cyclic Jacobi
 * rotations. `a` is n by n, row-major, and is left as it was.
 */
export function symmetricEigenvalues(a, n) {
  const m = Float64Array.from(a);
  const at = (i, j) => m[i * n + j];
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    let diag = 0;
    for (let i = 0; i < n; i++) {
      diag += at(i, i) * at(i, i);
      for (let j = i + 1; j < n; j++) off += at(i, j) * at(i, j);
    }
    if (off <= 1e-26 * Math.max(diag, 1e-300)) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = at(p, q);
        if (apq === 0) continue;
        const app = at(p, p);
        const aqq = at(q, q);
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = at(k, p);
          const akq = at(k, q);
          m[k * n + p] = c * akp - s * akq;
          m[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = at(p, k);
          const aqk = at(q, k);
          m[p * n + k] = c * apk - s * aqk;
          m[q * n + k] = s * apk + c * aqk;
        }
      }
    }
  }
  const ev = [];
  for (let i = 0; i < n; i++) ev.push(at(i, i));
  return ev.sort((x, y) => x - y);
}

/**
 * The ridge the Python API uses unless told otherwise: the geometric mean
 * of the two smallest eigenvalues of the centered embeddings' Gram matrix,
 * the smallest floored at one. No label enters the choice.
 */
export function gapRidge(rows) {
  const n = rows.length;
  const d = rows[0].length;
  const mean = new Float64Array(d);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const gram = new Float64Array(d * d);
  const xc = new Float64Array(d);
  for (const r of rows) {
    for (let j = 0; j < d; j++) xc[j] = r[j] - mean[j];
    for (let i = 0; i < d; i++) {
      const xi = xc[i];
      if (xi === 0) continue;
      for (let j = i; j < d; j++) gram[i * d + j] += xi * xc[j];
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) gram[i * d + j] = gram[j * d + i];
  const ev = symmetricEigenvalues(gram, d);
  return Math.sqrt(Math.max(ev[0], 1) * ev[1]);
}

/** Solve A X = B for X, A n by n and B n by k, by elimination with partial pivoting. */
export function solve(a, b, n, k) {
  const A = Float64Array.from(a);
  const B = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r * n + col]);
      if (v > best) { best = v; pivot = r; }
    }
    if (best === 0) throw new Error("the system is singular, so these embeddings do not determine a head");
    if (pivot !== col) {
      for (let j = 0; j < n; j++) { const t = A[col * n + j]; A[col * n + j] = A[pivot * n + j]; A[pivot * n + j] = t; }
      for (let j = 0; j < k; j++) { const t = B[col * k + j]; B[col * k + j] = B[pivot * k + j]; B[pivot * k + j] = t; }
    }
    const p = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / p;
      if (f === 0) continue;
      for (let j = col; j < n; j++) A[r * n + j] -= f * A[col * n + j];
      for (let j = 0; j < k; j++) B[r * k + j] -= f * B[col * k + j];
    }
  }
  const X = new Float64Array(n * k);
  for (let r = n - 1; r >= 0; r--) {
    for (let j = 0; j < k; j++) {
      let s = B[r * k + j];
      for (let c = r + 1; c < n; c++) s -= A[r * n + c] * X[c * k + j];
      X[r * k + j] = s / A[r * n + r];
    }
  }
  return X;
}

/**
 * Least squares with a ridge on the weights and none on the intercept.
 * `rows` are the quantized embeddings, `targets` one number or one array
 * per row. Returns float weights and intercepts, one per output.
 */
export function fitLinear(rows, targets, ridge) {
  const n = rows.length;
  if (n === 0) throw new Error("no windows");
  const d = rows[0].length;
  if (n <= d) {
    throw new Error(`fitting ${d} weights needs more than ${n} windows, or the head will describe the noise in this recording rather than the signal`);
  }
  const ys = targets.map((t) => (Array.isArray(t) ? t : [t]));
  const k = ys[0].length;
  const m = d + 1;
  const A = new Float64Array(m * m);
  const B = new Float64Array(m * k);
  const x = new Float64Array(m);
  for (let r = 0; r < n; r++) {
    for (let j = 0; j < d; j++) x[j] = rows[r][j];
    x[d] = 1;
    for (let i = 0; i < m; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      for (let j = i; j < m; j++) A[i * m + j] += xi * x[j];
      for (let o = 0; o < k; o++) B[i * k + o] += xi * ys[r][o];
    }
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < i; j++) A[i * m + j] = A[j * m + i];
  for (let i = 0; i < d; i++) A[i * m + i] += ridge;
  const W = solve(A, B, m, k);
  const weights = [];
  const intercepts = [];
  for (let o = 0; o < k; o++) {
    const w = new Float64Array(d);
    for (let j = 0; j < d; j++) w[j] = W[j * k + o];
    weights.push(w);
    intercepts.push(W[d * k + o]);
  }
  return { weights, intercepts };
}

/** Each output row scaled to its largest weight and rounded to signed bytes, with the bias in the same units. */
export function quantizeRows(weights, intercepts) {
  const rows = [];
  const bias = [];
  const scale = [];
  weights.forEach((w, o) => {
    let peak = 0;
    for (const v of w) peak = Math.max(peak, Math.abs(v));
    const s = peak > 0 ? peak / 127 : 1;
    rows.push(Array.from(w, (v) => Math.max(-127, Math.min(127, rint(v / s)))));
    bias.push(rint(intercepts[o] / s));
    scale.push(s);
  });
  return { rows, bias, scale };
}

/** A head blob the device can run, from quantized embeddings and targets. */
export function trainHead(rows, targets, { name = "", encoderId, ridge = null } = {}) {
  for (const r of rows) for (const v of r) if (!Number.isInteger(v)) throw new Error("embeddings are the device's integers, as the embedding windows carry them");
  const chosen = ridge === null ? gapRidge(rows) : ridge;
  const fit = fitLinear(rows, targets, chosen);
  const q = quantizeRows(fit.weights, fit.intercepts);
  const blob = P.buildHead(q.rows, q.bias, q.scale, { name, encoderId, inDim: rows[0].length });
  return { blob, ridge: chosen, ...q };
}

/**
 * Held-out accuracy by contiguous blocks, in the order the windows were
 * collected, so adjacent windows do not flatter the score. Two classes,
 * targets 0 and 1, scored as the device would score them: the quantized
 * head's output above one half means class 1. Null when there are too few
 * windows to hold any out.
 */
export function blockedFolds(rows, labels, { folds = 5, encoderId } = {}) {
  const n = rows.length;
  const d = rows[0].length;
  let k = folds;
  while (n - Math.ceil(n / k) <= d && k < 20) k++;
  if (n - Math.ceil(n / k) <= d) return null;
  const size = Math.ceil(n / k);
  let correct = 0;
  let total = 0;
  const perFold = [];
  for (let f = 0; f < k; f++) {
    const lo = f * size;
    const hi = Math.min(n, lo + size);
    if (lo >= hi) continue;
    const trainRows = [];
    const trainY = [];
    for (let i = 0; i < n; i++) if (i < lo || i >= hi) { trainRows.push(rows[i]); trainY.push(labels[i]); }
    if (!trainY.includes(0) || !trainY.includes(1)) continue;
    const { blob } = trainHead(trainRows, trainY, { name: "fold", encoderId });
    const head = P.decodeHead(blob);
    let c = 0;
    for (let i = lo; i < hi; i++) {
      const out = P.evaluateHead(head, rows[i])[0];
      if ((out > 0.5 ? 1 : 0) === labels[i]) c++;
    }
    correct += c;
    total += hi - lo;
    perFold.push({ correct: c, total: hi - lo });
  }
  if (total === 0) return null;
  const ones = labels.filter((l) => l === 1).length;
  const chance = Math.max(ones, n - ones) / n;
  return { accuracy: correct / total, correct, total, chance, folds: perFold };
}

/**
 * What the light switch saves of a teaching: every window it kept, in the
 * order it was collected, with its label, and what the head was trained
 * beside. `python/teach_it.py --from` reads it and trains the same custom
 * AI head, byte for byte.
 */
export function trainingFile({ name, encoderId, states, windows, dropped = 0, score = null, made = new Date() }) {
  const width = windows[0]?.embedding.length ?? 0;
  return {
    what: `Training data for a custom AI head, from the Mind-Controlled Light Switch: one ${width}-dimensional embedding for every four seconds of EEG, in the order they were collected, labeled 0 for ${states[0]} and 1 for ${states[1]}.`,
    made: made.toISOString(),
    name,
    encoderId,
    states,
    dropped,
    score,
    windows: windows.map((w) => ({ index: w.index, round: w.round, label: w.label, embedding: Array.from(w.embedding) })),
  };
}

/**
 * A saved custom AI head, checked the way the device checks it, and against
 * the device it is going to. What it throws is a sentence a person can act on.
 */
export function savedHead(bytes, { encoderId = null, width = null } = {}) {
  let head;
  try { head = P.decodeHead(bytes); } catch { throw new Error("That file is not a custom AI head, or it is damaged."); }
  if (head.outDim !== 1) throw new Error(`That AI head gives ${head.outDim} readings at a time, and the light switch needs one.`);
  if (encoderId && head.encoderId !== P.NO_ENCODER_ID && head.encoderId !== encoderId) {
    throw new Error("That custom AI head was trained beside another version of the AI model on the IntoMind One's chip, so it cannot read this one. Teach a new one.");
  }
  if (width && head.inDim !== width) throw new Error("That custom AI head does not fit the AI model on this IntoMind One. Teach a new one.");
  return head;
}

/** The training file as text: one window to a line, so it reads in any editor and parses anywhere. */
export function trainingText(file) {
  const head = JSON.stringify({ ...file, windows: [] }, null, 2);
  const lines = file.windows.map((w) => `    ${JSON.stringify(w)}`).join(",\n");
  return `${head.replace('"windows": []', `"windows": [\n${lines}\n  ]`)}\n`;
}

/**
 * Whether a held-out score is clearly better than guessing, tested so that
 * neighboring readings are not counted as separate evidence. The readings in
 * a round share its label, so whole rounds trade labels: every way of
 * labeling as many rounds On as were taught is scored with the same blocked
 * folds, and `p` is the share of labelings that score at least as well as
 * the one taught. With eight rounds that is 70 labelings, and the one that
 * swaps On and Off splits the rounds the same way and scores the same, so
 * `p` is never below two in 70. `rounds` gives each reading's round.
 */
export function roundPermutation(rows, labels, rounds, { folds = 5, encoderId, most = 400 } = {}) {
  const n = rows.length;
  const d = rows[0].length;
  let k = folds;
  while (n - Math.ceil(n / k) <= d && k < 20) k++;
  if (n - Math.ceil(n / k) <= d) return null;
  const size = Math.ceil(n / k);
  const ids = [...new Set(rounds)];
  const on = ids.filter((r) => labels[rounds.indexOf(r)] === 1);
  // Each fold's training readings and ridge, which no label enters.
  const parts = [];
  for (let f = 0; f < k; f++) {
    const lo = f * size, hi = Math.min(n, lo + size);
    if (lo >= hi) continue;
    const train = [];
    for (let i = 0; i < n; i++) if (i < lo || i >= hi) train.push(i);
    parts.push({ lo, hi, train, ridge: gapRidge(train.map((i) => rows[i])) });
  }
  const score = (isOn) => {
    let correct = 0, total = 0;
    for (const { lo, hi, train, ridge } of parts) {
      const y = train.map((i) => (isOn.has(rounds[i]) ? 1 : 0));
      if (!y.includes(0) || !y.includes(1)) continue;
      const head = P.decodeHead(trainHead(train.map((i) => rows[i]), y, { name: "fold", encoderId, ridge }).blob);
      for (let i = lo; i < hi; i++) if ((P.evaluateHead(head, rows[i])[0] > 0.5 ? 1 : 0) === (isOn.has(rounds[i]) ? 1 : 0)) correct++;
      total += hi - lo;
    }
    return total ? correct / total : 0;
  };
  // Every labeling when there are few enough, otherwise a fixed sample of them.
  const labelings = [];
  const pick = (from, need, chosen) => {
    if (labelings.length > most) return;
    if (need === 0) { labelings.push(new Set(chosen)); return; }
    for (let i = from; i <= ids.length - need; i++) pick(i + 1, need - 1, [...chosen, ids[i]]);
  };
  pick(0, on.length, []);
  if (labelings.length > most) {
    labelings.length = 0;
    let seed = 1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let s = 0; s < most; s++) labelings.push(new Set([...ids].sort(() => rand() - 0.5).slice(0, on.length)));
    labelings.push(new Set(on));
  }
  const taught = score(new Set(on));
  const atLeast = labelings.filter((l) => score(l) >= taught - 1e-12).length;
  return { accuracy: taught, p: atLeast / labelings.length, labelings: labelings.length };
}
