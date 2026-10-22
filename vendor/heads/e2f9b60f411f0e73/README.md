# Heads for encoder `e2f9b60f411f0e73`

The encoder carried by IntoMind One firmware 1.4.0 and later. It has 170,772
parameters, 76 wide and 3 layers deep, and is distilled from a larger
encoder pretrained on public EEG. It reads four-second windows at 500
samples per second and does not need to know where the electrodes are.

| File | Gives |
|---|---|
| `age.imh` | age, in years |
| `sex.imh` | a score, higher for female |
| `reconstruction.imr` | the signal, back from the device's tokens |

## How they were measured

On studies the heads never saw: each study was left out in turn, with the
electrode positions hidden, on nine referential montages of 2, 4 and 8
electrodes, and computed with the device's integer arithmetic. Each head is
compared with band power from the same channels, fitted the same way, and
the age head also with the mean age of the training studies.

Each study gives one value per method, its mean over the montages it could
be scored on, and a value below is the mean over studies. A difference has a
bootstrap 95% interval over studies, and p is from a Wilcoxon signed-rank
test over studies, Holm-corrected over eight tests. A person's windows are
averaged within each dataset, up to 40 of them.

The encoder's own training used no labels, but most of these studies gave
it unlabeled windows: 81 of the 109 scored for age, and 90 of the 121 scored
for sex.

## `age.imh`

From firmware 1.4.2 this head is built into the IntoMind One's weights:
slot 0, selected from power on, changed only with the weights.

Fitted on 183,642 windows from 3,742 people in 93 studies.

| Scored on | Mean error, head | Mean error, band power | Mean error, mean age | Head better than band power by [95% interval] | p |
|---|---|---|---|---|---|
| one four-second window | 9.93 years | 10.26 years | 9.75 years | 0.33 [−0.28, 0.95] | 0.96 |
| the mean of a person's windows | 9.16 years | 10.02 years | 9.77 years | 0.86 [0.24, 1.48] | 0.019 |

Against the mean age, the head is 0.18 years worse on one window (95%
interval 0.45 better to 0.83 worse) and 0.61 years better averaged (0.03
worse to 1.25 better).

## `sex.imh`

From firmware 1.4.2 every IntoMind One ships with this head in slot 1.

Fitted on 194,940 windows from 3,986 people in 95 studies. The output is a
least-squares score, with female as 1 and male as 0. It is not a
probability.

| Scored on | AUC, head | AUC, band power | Head better by [95% interval] | p |
|---|---|---|---|---|
| one four-second window | 0.588 | 0.582 | 0.006 [−0.010, 0.022] | 0.96 |
| the mean of a person's windows | 0.623 | 0.614 | 0.009 [−0.013, 0.032] | 0.96 |

## What the age and sex heads are for

They show what the embedding carries. Neither does better than band power
on one window, and the age head does no better than the mean age of the
training studies. Neither is a useful predictor of a person's age or sex,
and neither is offered as one.

## `reconstruction.imr`

Turns each token, the encoder's description of a fifth of a second, back
into the 100 samples it came from, in units of the window's own median and
robust spread. It is linear.

On 18,700 four-electrode windows from 37 studies used neither to train the
encoder nor to fit this file, R² is 0.660. On the 13 of them that were also
kept out of choosing its settings, it is 0.668. By band:

| 1 to 4 Hz | 4 to 8 Hz | 8 to 13 Hz | 13 to 30 Hz | 30 to 45 Hz |
|---|---|---|---|---|
| 0.871 | 0.665 | 0.728 | 0.421 | 0.122 |

Slow rhythms come back. Above 13 Hz most of the signal does not, and above
30 Hz almost none of it does. A window with gross artifacts, beyond 20
robust standard deviations, cannot be recovered in amplitude. Those were
3.9% of the held-out windows, and they are not in these numbers. They hold
92% of the held-out signal's power, so over all windows R² is 0.058, and
the median window's R² is 0.684.

The same file is part of firmware 1.4.0 and later.
