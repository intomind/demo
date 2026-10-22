//! Biological Sex Detector as a program: the open source AI head for
//! biological sex in slot 1, running on your IntoMind One.
//!
//!     cargo run --release --bin biological_sex -- ["Ada's IntoMind One"]

use intomind_demos::{name_arg, published::sex, shipped_head};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Err(e) = shipped_head::run(sex::SLOT, name_arg(&args, &[]).as_deref(), 120.0).await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
