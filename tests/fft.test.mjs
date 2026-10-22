// The spectrum: a known sine lands in its bin, and band power follows it.
import test from "node:test";
import assert from "node:assert/strict";
import { fft, welch, bandPower, nfftFor } from "../lib/fft.js";

test("segment lengths span about two seconds", () => {
  assert.equal(nfftFor(250), 512);
  assert.equal(nfftFor(500), 1024);
  assert.equal(nfftFor(1000), 2048);
});

test("a 10 hertz sine peaks at 10 hertz", () => {
  const fs = 500;
  const x = [];
  for (let i = 0; i < fs * 4; i++) x.push(20 * Math.sin((2 * Math.PI * 10 * i) / fs) + 0.01 * Math.sin(i));
  const s = welch(x, fs);
  assert.ok(s !== null);
  let best = 0;
  for (let k = 1; k < s.freqs.length; k++) if (s.psd[k] > s.psd[best]) best = k;
  assert.ok(Math.abs(s.freqs[best] - 10) < 0.6, `peak at ${s.freqs[best]}`);
  const alpha = bandPower(s.freqs, s.psd, 8, 13);
  const beta = bandPower(s.freqs, s.psd, 13, 30);
  assert.ok(alpha > 50 * beta);
  // Parseval, roughly: the band around the peak holds the sine's power, amplitude squared over two.
  assert.ok(Math.abs(alpha - 200) / 200 < 0.1, `alpha power ${alpha}`);
});

test("a gap spoils only its segment", () => {
  const fs = 250;
  const x = [];
  for (let i = 0; i < fs * 4; i++) x.push(Math.sin((2 * Math.PI * 10 * i) / fs));
  x[10] = NaN;
  const s = welch(x, fs);
  assert.ok(s !== null, "the later segments still count");
});

test("the transform of an impulse is flat", () => {
  const re = new Float64Array(8);
  const im = new Float64Array(8);
  re[0] = 1;
  fft(re, im);
  for (let k = 0; k < 8; k++) assert.ok(Math.abs(re[k] - 1) < 1e-12 && Math.abs(im[k]) < 1e-12);
});
