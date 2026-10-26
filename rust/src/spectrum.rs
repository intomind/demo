//! How much of a signal's power sits in a band, by Welch's method as
//! `scipy.signal.welch` does it with its defaults: Hann windows, half
//! overlapping, each segment's mean removed, a one-sided density.

use std::f64::consts::PI;

/// Frequencies and power density of `x`, sampled at `fs`, in segments of `nperseg`.
pub fn welch(x: &[f64], fs: f64, nperseg: usize) -> (Vec<f64>, Vec<f64>) {
    let n = nperseg.min(x.len());
    let step = n - n / 2;
    let window: Vec<f64> = (0..n).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()).collect();
    let scale = 1.0 / (fs * window.iter().map(|w| w * w).sum::<f64>());
    let bins = n / 2 + 1;
    let (cos, sin): (Vec<f64>, Vec<f64>) = (0..n).map(|i| ((2.0 * PI * i as f64 / n as f64).cos(), (2.0 * PI * i as f64 / n as f64).sin())).unzip();
    let mut psd = vec![0.0; bins];
    let mut segments = 0;
    let mut start = 0;
    while start + n <= x.len() {
        let seg = &x[start..start + n];
        let mean = seg.iter().sum::<f64>() / n as f64;
        let y: Vec<f64> = seg.iter().zip(&window).map(|(v, w)| (v - mean) * w).collect();
        for (k, p) in psd.iter_mut().enumerate() {
            let (mut re, mut im) = (0.0, 0.0);
            for (i, v) in y.iter().enumerate() {
                let at = (k * i) % n;
                re += v * cos[at];
                im -= v * sin[at];
            }
            let mut power = (re * re + im * im) * scale;
            if k != 0 && !(n.is_multiple_of(2) && k == n / 2) {
                power *= 2.0;
            }
            *p += power;
        }
        segments += 1;
        start += step;
    }
    if segments > 0 {
        for p in psd.iter_mut() {
            *p /= segments as f64;
        }
    }
    ((0..bins).map(|k| k as f64 * fs / n as f64).collect(), psd)
}

/// The power between `lo` and `hi` hertz, by the trapezoid rule over the bins in it.
pub fn band(freqs: &[f64], psd: &[f64], lo: f64, hi: f64) -> f64 {
    let picked: Vec<(f64, f64)> = freqs.iter().zip(psd).filter(|(f, _)| **f >= lo && **f < hi).map(|(f, p)| (*f, *p)).collect();
    picked.windows(2).map(|w| (w[1].0 - w[0].0) * (w[0].1 + w[1].1) / 2.0).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ten_hertz_sine_puts_its_power_in_the_alpha_band() {
        let fs = 250.0;
        let x: Vec<f64> = (0..1000).map(|i| (2.0 * PI * 10.0 * i as f64 / fs).sin()).collect();
        let (f, p) = welch(&x, fs, 500);
        let relative = band(&f, &p, 8.0, 13.0) / band(&f, &p, 4.0, 30.0);
        assert!(relative > 0.95, "{relative}");
    }
}
