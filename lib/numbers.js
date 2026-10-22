// Every published figure these pages quote, with where it comes from. The
// check script compares each one with the vendored copy of the heads
// repository's README, so a figure cannot drift from its source.

export const SOURCE = "https://github.com/intomind/eeg-foundation-model-heads/blob/main/e2f9b60f411f0e73/README.md";

export const ENCODER = {
  id: "e2f9b60f411f0e73",
  parameters: 170772,
  width: 76,
  layers: 3,
};

/** Mean absolute error of the age head, in years, against the two baselines the heads README reports. */
export const AGE = {
  file: "age.imh",
  slot: 0,
  windows: 183642,
  people: 3742,
  studies: 93,
  oneWindow: { head: 9.93, bandPower: 10.26, meanAge: 9.75 },
  averaged: { head: 9.16, bandPower: 10.02, meanAge: 9.77 },
};

/** AUC of the sex head's score against band power, as the heads README reports it. */
export const SEX = {
  file: "sex.imh",
  slot: 1,
  windows: 194940,
  people: 3986,
  studies: 95,
  oneWindow: { head: 0.588, bandPower: 0.582 },
  averaged: { head: 0.623, bandPower: 0.614 },
};
