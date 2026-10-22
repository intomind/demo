//! Training a custom AI head exactly as the Python API and the browser do
//! it: a ridge fit chosen from the embeddings alone, quantized the way the
//! device holds it, and written in the published head format. The tests
//! hold this file to the head the Python API produced on the same numbers,
//! byte for byte.

use intomind::protocol::head::{self, HeadHeader};
use sha2::{Digest, Sha256};

/// Round half to even, as numpy's rint and Python's round do.
pub fn rint(x: f64) -> f64 {
    let f = x.floor();
    let d = x - f;
    if d < 0.5 {
        f
    } else if d > 0.5 {
        f + 1.0
    } else if f % 2.0 == 0.0 {
        f
    } else {
        f + 1.0
    }
}

/// The eigenvalues of a symmetric matrix, ascending, by cyclic Jacobi
/// rotations. `a` is n by n, row-major.
pub fn symmetric_eigenvalues(a: &[f64], n: usize) -> Vec<f64> {
    let mut m = a.to_vec();
    for _ in 0..100 {
        let mut off = 0.0;
        let mut diag = 0.0;
        for i in 0..n {
            diag += m[i * n + i] * m[i * n + i];
            for j in i + 1..n {
                off += m[i * n + j] * m[i * n + j];
            }
        }
        if off <= 1e-26 * f64::max(diag, 1e-300) {
            break;
        }
        for p in 0..n {
            for q in p + 1..n {
                let apq = m[p * n + q];
                if apq == 0.0 {
                    continue;
                }
                let app = m[p * n + p];
                let aqq = m[q * n + q];
                let theta = (aqq - app) / (2.0 * apq);
                let sign = if theta == 0.0 { 1.0 } else { theta.signum() };
                let t = sign / (theta.abs() + (theta * theta + 1.0).sqrt());
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for k in 0..n {
                    let akp = m[k * n + p];
                    let akq = m[k * n + q];
                    m[k * n + p] = c * akp - s * akq;
                    m[k * n + q] = s * akp + c * akq;
                }
                for k in 0..n {
                    let apk = m[p * n + k];
                    let aqk = m[q * n + k];
                    m[p * n + k] = c * apk - s * aqk;
                    m[q * n + k] = s * apk + c * aqk;
                }
            }
        }
    }
    let mut ev: Vec<f64> = (0..n).map(|i| m[i * n + i]).collect();
    ev.sort_by(|x, y| x.partial_cmp(y).unwrap());
    ev
}

/// The ridge the Python API uses unless told otherwise: the geometric mean
/// of the two smallest eigenvalues of the centered embeddings' Gram matrix,
/// the smallest floored at one. No label enters the choice.
pub fn gap_ridge(rows: &[Vec<i32>]) -> f64 {
    let n = rows.len();
    let d = rows[0].len();
    let mut mean = vec![0.0; d];
    for r in rows {
        for j in 0..d {
            mean[j] += r[j] as f64;
        }
    }
    for v in mean.iter_mut() {
        *v /= n as f64;
    }
    let mut gram = vec![0.0; d * d];
    let mut xc = vec![0.0; d];
    for r in rows {
        for j in 0..d {
            xc[j] = r[j] as f64 - mean[j];
        }
        for i in 0..d {
            let xi = xc[i];
            if xi == 0.0 {
                continue;
            }
            for j in i..d {
                gram[i * d + j] += xi * xc[j];
            }
        }
    }
    for i in 0..d {
        for j in 0..i {
            gram[i * d + j] = gram[j * d + i];
        }
    }
    let ev = symmetric_eigenvalues(&gram, d);
    (f64::max(ev[0], 1.0) * ev[1]).sqrt()
}

/// Solve A X = B for X, A n by n and B n by k, by elimination with partial pivoting.
pub fn solve(a: &[f64], b: &[f64], n: usize, k: usize) -> Result<Vec<f64>, String> {
    let mut a = a.to_vec();
    let mut b = b.to_vec();
    for col in 0..n {
        let mut pivot = col;
        let mut best = a[col * n + col].abs();
        for r in col + 1..n {
            let v = a[r * n + col].abs();
            if v > best {
                best = v;
                pivot = r;
            }
        }
        if best == 0.0 {
            return Err("the system is singular, so these embeddings do not determine a head".into());
        }
        if pivot != col {
            for j in 0..n {
                a.swap(col * n + j, pivot * n + j);
            }
            for j in 0..k {
                b.swap(col * k + j, pivot * k + j);
            }
        }
        let p = a[col * n + col];
        for r in col + 1..n {
            let f = a[r * n + col] / p;
            if f == 0.0 {
                continue;
            }
            for j in col..n {
                a[r * n + j] -= f * a[col * n + j];
            }
            for j in 0..k {
                b[r * k + j] -= f * b[col * k + j];
            }
        }
    }
    let mut x = vec![0.0; n * k];
    for r in (0..n).rev() {
        for j in 0..k {
            let mut s = b[r * k + j];
            for c in r + 1..n {
                s -= a[r * n + c] * x[c * k + j];
            }
            x[r * k + j] = s / a[r * n + r];
        }
    }
    Ok(x)
}

/// Least squares with a ridge on the weights and none on the intercept, one
/// target per row. Returns the float weights and the intercept.
pub fn fit_linear(rows: &[Vec<i32>], targets: &[f64], ridge: f64) -> Result<(Vec<f64>, f64), String> {
    let n = rows.len();
    if n == 0 {
        return Err("no windows".into());
    }
    let d = rows[0].len();
    if n <= d {
        return Err(format!("fitting {d} weights needs more than {n} windows, or the head will describe the noise in this recording rather than the signal"));
    }
    let m = d + 1;
    let mut a = vec![0.0; m * m];
    let mut b = vec![0.0; m];
    let mut x = vec![0.0; m];
    for r in 0..n {
        for j in 0..d {
            x[j] = rows[r][j] as f64;
        }
        x[d] = 1.0;
        for i in 0..m {
            let xi = x[i];
            if xi == 0.0 {
                continue;
            }
            for j in i..m {
                a[i * m + j] += xi * x[j];
            }
            b[i] += xi * targets[r];
        }
    }
    for i in 0..m {
        for j in 0..i {
            a[i * m + j] = a[j * m + i];
        }
    }
    for i in 0..d {
        a[i * m + i] += ridge;
    }
    let w = solve(&a, &b, m, 1)?;
    Ok((w[..d].to_vec(), w[d]))
}

/// The weights scaled to the largest and rounded to signed bytes, with the
/// bias in the same units, and the scale that turns them back.
pub fn quantize(weights: &[f64], intercept: f64) -> (Vec<i8>, i32, f64) {
    let mut peak: f64 = 0.0;
    for v in weights {
        peak = peak.max(v.abs());
    }
    let s = if peak > 0.0 { peak / 127.0 } else { 1.0 };
    let row = weights.iter().map(|v| rint(v / s).clamp(-127.0, 127.0) as i8).collect();
    (row, rint(intercept / s) as i32, s)
}

/// Eight bytes from sixteen hex digits.
pub fn encoder_bytes(id: &str) -> Result<[u8; 8], String> {
    let mut out = [0u8; 8];
    if id.len() != 16 {
        return Err(format!("an encoder id is sixteen hex digits, and {id:?} is not"));
    }
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&id[i * 2..i * 2 + 2], 16).map_err(|_| format!("{id:?} is not hex"))?;
    }
    Ok(out)
}

/// A head blob the device can run, from the device's embeddings and one
/// 0 or 1 target per window.
pub fn train_head(rows: &[Vec<i32>], targets: &[f64], name: &str, encoder_id: &str) -> Result<Vec<u8>, String> {
    let ridge = gap_ridge(rows);
    let (weights, intercept) = fit_linear(rows, targets, ridge)?;
    let (row, bias, scale) = quantize(&weights, intercept);
    let mut padded = [0u8; head::NAME_LEN];
    let mut end = name.len().min(head::NAME_LEN);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    padded[..end].copy_from_slice(&name.as_bytes()[..end]);
    let header = HeadHeader {
        version: head::FORMAT_VERSION_2,
        kind: head::KIND_LINEAR,
        in_dim: rows[0].len() as u16,
        out_dim: 1,
        name: padded,
        encoder_id: encoder_bytes(encoder_id)?,
    };
    let len = head::blob_len(header.version, header.in_dim, header.out_dim);
    let mut blob = vec![0u8; len];
    head::encode_unhashed(&header, &row, &[bias], &[scale as f32], &mut blob).map_err(|e| format!("{e:?}"))?;
    let digest = Sha256::digest(&blob[..len - head::HASH_LEN]);
    blob[len - head::HASH_LEN..].copy_from_slice(&digest);
    Ok(blob)
}

/// What a head says of one window, computed the way the device computes it.
pub fn evaluate(blob: &[u8], embedding: &[i32]) -> Result<f32, String> {
    let layout = head::layout_any(blob, u8::MAX).map_err(|e| format!("{e:?}"))?;
    let window: Vec<i16> = embedding.iter().map(|&v| v as i16).collect();
    let mut out = vec![0f32; layout.header.out_dim as usize];
    layout.evaluate(&window, &mut out).map_err(|e| format!("{e:?}"))?;
    Ok(out[0])
}

/// A held-out score.
#[derive(Debug, Clone, PartialEq)]
pub struct Score {
    /// Windows the held-out heads got right.
    pub correct: usize,
    /// Windows held out, in all.
    pub total: usize,
    /// What guessing the commoner state gets.
    pub chance: f64,
}

/// Held-out accuracy by contiguous blocks, in the order the windows were
/// collected, so adjacent windows do not flatter the score. None when
/// there are too few windows to hold any out.
pub fn blocked_folds(rows: &[Vec<i32>], labels: &[f64], encoder_id: &str) -> Result<Option<Score>, String> {
    let n = rows.len();
    let d = rows[0].len();
    let mut k = 5;
    while n - n.div_ceil(k) <= d && k < 20 {
        k += 1;
    }
    if n - n.div_ceil(k) <= d {
        return Ok(None);
    }
    let size = n.div_ceil(k);
    let (mut correct, mut total) = (0, 0);
    for f in 0..k {
        let (lo, hi) = (f * size, ((f + 1) * size).min(n));
        if lo >= hi {
            continue;
        }
        let train_rows: Vec<Vec<i32>> = rows[..lo].iter().chain(&rows[hi..]).cloned().collect();
        let train_y: Vec<f64> = labels[..lo].iter().chain(&labels[hi..]).copied().collect();
        if !train_y.contains(&0.0) || !train_y.contains(&1.0) {
            continue;
        }
        let blob = train_head(&train_rows, &train_y, "fold", encoder_id)?;
        for i in lo..hi {
            let out = evaluate(&blob, &rows[i])?;
            if (if out > 0.5 { 1.0 } else { 0.0 }) == labels[i] {
                correct += 1;
            }
        }
        total += hi - lo;
    }
    if total == 0 {
        return Ok(None);
    }
    let ones = labels.iter().filter(|&&l| l == 1.0).count();
    Ok(Some(Score { correct, total, chance: ones.max(n - ones) as f64 / n as f64 }))
}

/// The training data the Mind-Controlled Light Switch demo saves: every
/// window it kept, in order, with its label, and what the head was trained
/// beside.
pub struct TrainingData {
    /// One embedding per window.
    pub rows: Vec<Vec<i32>>,
    /// 0 for the first state, 1 for the second.
    pub labels: Vec<f64>,
    /// The two states' names.
    pub states: (String, String),
    /// The encoder the embeddings came from.
    pub encoder_id: String,
    /// The name the demo gave the head.
    pub name: Option<String>,
}

/// Read the training data the demo saves.
pub fn training_data(text: &str) -> Result<TrainingData, String> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("not training data from the demo: {e}"))?;
    let windows = v["windows"].as_array().ok_or("the file has no windows")?;
    let mut rows = Vec::with_capacity(windows.len());
    let mut labels = Vec::with_capacity(windows.len());
    for w in windows {
        let e = w["embedding"].as_array().ok_or("a window has no embedding")?;
        rows.push(e.iter().map(|x| x.as_i64().map(|x| x as i32).ok_or("an embedding holds something other than integers")).collect::<Result<_, _>>()?);
        labels.push(w["label"].as_f64().ok_or("a window has no label")?);
    }
    let states = v["states"].as_array().filter(|s| s.len() == 2).ok_or("the file does not name its two states")?;
    let state = |i: usize| states[i].as_str().unwrap_or("").to_string();
    Ok(TrainingData {
        rows,
        labels,
        states: (state(0), state(1)),
        encoder_id: v["encoderId"].as_str().ok_or("the file does not name its encoder")?.to_string(),
        name: v["name"].as_str().map(str::to_string),
    })
}
