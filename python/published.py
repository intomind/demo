"""Every published figure these scripts quote, with where it comes from.

The check script compares each one with the vendored copy of the heads
repository's README, as it does for the pages' lib/numbers.js.
"""

SOURCE = "https://github.com/intomind/eeg-foundation-model-heads/blob/main/e2f9b60f411f0e73/README.md"

ENCODER_ID = "e2f9b60f411f0e73"

#: Mean absolute error of the age head, in years, against the two baselines the heads README reports.
AGE = {
    "slot": 0,
    "oneWindow": {"head": 9.93, "bandPower": 10.26, "meanAge": 9.75},
    "averaged": {"head": 9.16, "bandPower": 10.02, "meanAge": 9.77},
}

#: AUC of the sex head's score against band power, as the heads README reports it.
SEX = {
    "slot": 1,
    "oneWindow": {"head": 0.588, "bandPower": 0.582},
    "averaged": {"head": 0.623, "bandPower": 0.614},
}
