// Age Detector: the open source AI head for age, in slot 0 on the IntoMind One.

import { openHead } from "../lib/openhead.js";
import { drawAge } from "../lib/readout.js";
import { AGE } from "../lib/numbers.js";
import { agePreview } from "../lib/previews.js";

openHead({
  title: "Age Detector",
  about: `
  <p><b>EEG</b>, electroencephalography, is a recording of the brain's electrical activity from four electrodes resting on the scalp. The IntoMind One has a small <b>AI model</b> built into the chip inside it: a mathematical function with thousands of adjustable numbers, tuned on a large collection of EEG recordings until it learned which patterns in the signal go together.</p>
  <p>That model, the <b>encoder</b>, reads four seconds of EEG and summarizes it as 76 numbers, called an <b>embedding</b>. A second, much smaller model called a <b>head</b> turns those 76 numbers into one guess: an age. It was fitted on recordings from thousands of people whose ages were known, then tested on people it had never seen, where it was off by about nine years on average.</p>
  <p>The brain's rhythms change over a lifetime in ways that are measurable but noisy, so the number here is an honest estimate from the signal, not a measurement of you. It runs on your IntoMind One's own chip, not on this computer.</p>`,
  slot: AGE.slot,
  intro: `<p>Put on your IntoMind One, connect it, and sit still for a minute.</p>
    <p>Your IntoMind One carries an open source AI model that reads four seconds of EEG at a time and estimates an age from it. It runs on its own chip, not on this computer. Every few seconds a new estimate arrives. The number on screen is the average so far, with the model's published error either side of it.</p>
    <p>It shows what the signal carries. It is not a measurement of you.</p>`,
  draw: (g, w, h, r) => drawAge(g, w, h, { ...r, error: AGE.averaged.head }),
  card: "Age Detector",
  file: "age-detector.png",
  preview: agePreview(AGE.averaged.head),
});
