// Biological Sex Detector: the open source AI head for biological sex, in slot 1 on the IntoMind One.

import { openHead } from "../lib/openhead.js";
import { drawSex } from "../lib/readout.js";
import { SEX, ENCODER } from "../lib/numbers.js";
import { sexPreview } from "../lib/previews.js";

openHead({
  title: "Biological Sex Detector",
  about: `
  <p><b>EEG</b>, electroencephalography, is a recording of the brain's electrical activity from four electrodes resting on the scalp. The IntoMind One has a small <b>AI model</b> built into its chip, the <b>encoder</b>, which reads four seconds of EEG and summarizes it as 76 numbers, an <b>embedding</b>.</p>
  <p>A second, much smaller model called a <b>head</b> turns those numbers into a score. This one was fitted on recordings from thousands of people labeled 0 for male and 1 for female, so it answers on that scale. How well it separates the two is measured by <b>AUC</b>: the chance that a random female recording scores higher than a random male one. Here it is 0.62, where 0.5 would be guessing and 1 would be perfect.</p>
  <p>That is a weak effect, and the two clouds show it: the groups overlap far more than they differ. EEG carries a little information about biological sex, and this page shows exactly how little.</p>`,
  slot: SEX.slot,
  intro: `<p>Put on your IntoMind One, connect it, and sit still for a minute.</p>
    <p>Your IntoMind One carries an open source AI model that reads four seconds of EEG at a time and scores it on a scale where the people it learned from sat at 0 for male and 1 for female. It runs on its own chip. The score on screen is the average so far, drawn against those two groups.</p>
    <p>The two groups overlap a great deal. That is the honest picture: EEG carries a little about biological sex, not a lot.</p>`,
  draw: (g, w, h, r) => drawSex(g, w, h, { ...r, auc: SEX.averaged.head }),
  card: "Biological Sex Detector",
  file: "biological-sex-detector.png",
  preview: sexPreview(SEX.averaged.head),
  published: { url: `../vendor/heads/${ENCODER.id}/${SEX.file}`, name: "the open source AI head for biological sex" },
});
