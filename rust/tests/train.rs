//! The heads this crate trains are the heads the Python API trains, byte for
//! byte, held to the same fixture the browser's trainer is held to.

use std::path::PathBuf;

use intomind_demos::train::{blocked_folds, gap_ridge, rint, train_head, training_data};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/train").join(name)
}

fn rows() -> (Vec<Vec<i32>>, Vec<f64>, serde_json::Value) {
    let rows: Vec<Vec<i32>> = serde_json::from_str(&std::fs::read_to_string(fixture("embeddings.json")).unwrap()).unwrap();
    let targets: Vec<f64> = serde_json::from_str(&std::fs::read_to_string(fixture("targets.json")).unwrap()).unwrap();
    let meta: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(fixture("ridge.json")).unwrap()).unwrap();
    (rows, targets, meta)
}

#[test]
fn rint_rounds_half_to_even_as_numpy_does() {
    assert_eq!(rint(0.5), 0.0);
    assert_eq!(rint(1.5), 2.0);
    assert_eq!(rint(2.5), 2.0);
    assert_eq!(rint(-1.5), -2.0);
    assert_eq!(rint(2.4), 2.0);
}

#[test]
fn the_ridge_agrees_with_the_python_api() {
    let (rows, _, meta) = rows();
    let ridge = meta["ridge"].as_f64().unwrap();
    assert!(((gap_ridge(&rows) - ridge) / ridge).abs() < 1e-6);
}

#[test]
fn the_head_matches_the_python_api_byte_for_byte() {
    let (rows, targets, meta) = rows();
    let blob = train_head(&rows, &targets, meta["name"].as_str().unwrap(), meta["encoder_id"].as_str().unwrap()).unwrap();
    assert_eq!(blob, std::fs::read(fixture("head.imh")).unwrap());
}

#[test]
fn training_data_from_the_demo_trains_the_same_head() {
    let (rows, targets, meta) = rows();
    let windows: Vec<serde_json::Value> = rows.iter().zip(&targets).enumerate()
        .map(|(i, (r, t))| serde_json::json!({ "index": 100 + i, "round": i / 10, "label": *t as i64, "embedding": r }))
        .collect();
    let file = serde_json::json!({ "name": meta["name"], "encoderId": meta["encoder_id"], "states": ["Off", "On"], "windows": windows });
    let data = training_data(&file.to_string()).unwrap();
    let blob = train_head(&data.rows, &data.labels, data.name.as_deref().unwrap(), &data.encoder_id).unwrap();
    assert_eq!(blob, std::fs::read(fixture("head.imh")).unwrap());
}

#[test]
fn blocked_folds_score_the_fixture_as_the_python_script_does() {
    let (rows, targets, meta) = rows();
    let s = blocked_folds(&rows, &targets, meta["encoder_id"].as_str().unwrap()).unwrap().unwrap();
    // python/teach_it.py's blocked_folds on the same fixture: 100 of 150, against a chance of one half.
    assert_eq!((s.correct, s.total, s.chance), (100, 150, 0.5));
}
