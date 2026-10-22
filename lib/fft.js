// A power spectrum for the page, with no dependency: a radix-2 transform,
// Welch's average over Hann windows, and band power by integration.

/** In-place complex transform. `re` and `im` are equal power-of-two lengths. */
export function fft(re, im) {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error("the transform takes equal power-of-two lengths");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** A Hann window of `n` points. */
export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** The power-of-two segment length that spans about two seconds at `fs`. */
export function nfftFor(fs) {
  let n = 1;
  while (n < 2 * fs) n <<= 1;
  return n;
}

/**
 * Welch's estimate of the power spectral density of `x`, in the square of
 * its units per hertz: segments of `nfft` with half overlap, each with its
 * mean removed and a Hann window, averaged. Null when `x` is shorter than
 * one segment. A sample that is NaN (a marked gap) spoils its segment,
 * which is skipped.
 */
export function welch(x, fs, nfft = nfftFor(fs)) {
  if (x.length < nfft) return null;
  const w = hann(nfft);
  let wsum2 = 0;
  for (let i = 0; i < nfft; i++) wsum2 += w[i] * w[i];
  const bins = nfft / 2 + 1;
  const acc = new Float64Array(bins);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let segments = 0;
  for (let start = 0; start + nfft <= x.length; start += nfft / 2) {
    let mean = 0;
    let bad = false;
    for (let i = 0; i < nfft; i++) {
      const v = x[start + i];
      if (Number.isNaN(v)) { bad = true; break; }
      mean += v;
    }
    if (bad) continue;
    mean /= nfft;
    for (let i = 0; i < nfft; i++) {
      re[i] = (x[start + i] - mean) * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    segments++;
  }
  if (segments === 0) return null;
  const freqs = new Float64Array(bins);
  const psd = new Float64Array(bins);
  const scale = 1 / (fs * wsum2 * segments);
  for (let k = 0; k < bins; k++) {
    freqs[k] = (k * fs) / nfft;
    // One-sided: the interior bins carry both halves of the spectrum.
    psd[k] = acc[k] * scale * (k === 0 || k === bins - 1 ? 1 : 2);
  }
  return { freqs, psd };
}

/** Power between `lo` and `hi` hertz, the density integrated over the bins inside. */
export function bandPower(freqs, psd, lo, hi) {
  const df = freqs.length > 1 ? freqs[1] - freqs[0] : 1;
  let sum = 0;
  for (let k = 0; k < freqs.length; k++) if (freqs[k] >= lo && freqs[k] < hi) sum += psd[k] * df;
  return sum;
}
