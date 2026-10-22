# The demos, as scripts

For people who would rather script it. Everything here runs on the
published `intomind` package and nothing else of ours.

```
pip install 'intomind[analysis]'
cd python
python3 eyes_closed.py
```

Each script takes the device's name as its one argument when more than one
answers, as in `python3 age.py "Ada's IntoMind One"`.

| Script | Demo | What it does |
|---|---|---|
| `eyes_closed.py` | Alpha Flower | Streams, and prints the alpha band's share of the signal once a second. |
| `age.py` | Age Detector | Runs the open source AI head for age in slot 0 on your IntoMind One and prints its running mean beside the published error. |
| `biological_sex.py` | Biological Sex Detector | Runs the open source AI head for biological sex in slot 1 the same way, as a score. |
| `teach_it.py` | Mind-Controlled Light Switch | Two states with spoken cues, a custom AI head trained with the published `train_head`, scored on held-out blocks, uploaded to slot 2 and run. With `--from`, reproduces the same custom AI head, byte for byte, from the training data the Mind-Controlled Light Switch demo saves, with no device. |
| `light_switch_pi.py` | Mind-Controlled Light Switch | On a Raspberry Pi: runs your custom AI head in slot 2 and drives an LED on a GPIO pin from it. |
| `record_and_export.py` | | Records a minute with provenance and checksums, exports it to BDF, and opens it in MNE if MNE is installed. |

`common.py` connects. `published.py` holds the published figures the
scripts quote, and the repository's `check.py` holds it to the heads
repository's README like the pages' `lib/numbers.js`.

The flight simulator has no script, because it needs the screen to flicker.

The scripts print rather than record. Two write to your own disk and
nowhere else: `record_and_export.py` writes the recording, and `teach_it.py`
writes your custom AI head.
