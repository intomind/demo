// Heads: a published head file read as the device reads it, a running
// average of a head's outputs, and the probit a readout drawn from an AUC
// needs.

import { protocol as P } from "../vendor/intomind-sdk-1.4.3/index.js";

/** Fetch a head file and read it the way the device does, hash and all. */
export async function loadHead(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`could not load ${url}: ${r.status}`);
  return P.decodeHead(new Uint8Array(await r.arrayBuffer()));
}

/** Outputs seen so far, with flagged windows counted but kept out of the mean. */
export class Running {
  constructor() {
    this.n = 0;
    this.sum = 0;
    this.flagged = 0;
    this.latest = null;
    this.latestFlagged = false;
  }

  add(value, flagged) {
    this.latest = value;
    this.latestFlagged = flagged;
    if (flagged) {
      this.flagged += 1;
      return;
    }
    this.n += 1;
    this.sum += value;
  }

  get mean() {
    return this.n === 0 ? null : this.sum / this.n;
  }
}

/** The inverse of the standard normal distribution function, Acklam's approximation. */
export function probit(p) {
  if (p <= 0 || p >= 1) throw new Error("probit takes a probability strictly between 0 and 1");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  let q;
  let r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - plow) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
