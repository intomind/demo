//! Every published figure these programs quote, with where it comes from.
//! The repository's check compares each one with the vendored copy of the
//! heads repository's README, as it does for `lib/numbers.js` and
//! `python/published.py`.

/// The README the figures come from.
pub const SOURCE: &str = "https://github.com/intomind/eeg-foundation-model-heads/blob/main/e2f9b60f411f0e73/README.md";

/// The encoder the open source AI heads were trained beside.
pub const ENCODER_ID: &str = "e2f9b60f411f0e73";

/// Mean absolute error of the age head, in years, against the two baselines the heads README reports.
pub mod age {
    /// The built-in slot.
    pub const SLOT: u8 = 0;
    /// The head, on one window.
    pub const ONE_WINDOW_HEAD: f64 = 9.93;
    /// Band power, on one window.
    pub const ONE_WINDOW_BAND_POWER: f64 = 10.26;
    /// Guessing the studies' mean age, on one window.
    pub const ONE_WINDOW_MEAN_AGE: f64 = 9.75;
    /// The head, a person's windows averaged.
    pub const AVERAGED_HEAD: f64 = 9.16;
    /// Band power, a person's windows averaged.
    pub const AVERAGED_BAND_POWER: f64 = 10.02;
    /// Guessing the studies' mean age, a person's windows averaged.
    pub const AVERAGED_MEAN_AGE: f64 = 9.77;
}

/// AUC of the sex head's score against band power, as the heads README reports it.
pub mod sex {
    /// The first of the slots that are yours, where every IntoMind One carries it.
    pub const SLOT: u8 = 1;
    /// The head, on one window.
    pub const ONE_WINDOW_HEAD: f64 = 0.588;
    /// Band power, on one window.
    pub const ONE_WINDOW_BAND_POWER: f64 = 0.582;
    /// The head, a person's windows averaged.
    pub const AVERAGED_HEAD: f64 = 0.623;
    /// Band power, a person's windows averaged.
    pub const AVERAGED_BAND_POWER: f64 = 0.614;
}
