/**
 * What an IntoMind recording is, read and exported in a browser or in Node.
 *
 * A recording is the set of files every IntoMind program writes under one
 * name: `name.npz` with the samples, `name.meta.json` with the manifest,
 * `name.events.json` with the markers, and `name.sha256`, written last.
 * `Collection` reads them as the Python library reads them, its checks and
 * its two corrections included, and `exportRecording` writes any of them as
 * npz, edf, bdf, csv, tsv or mat, each byte for byte or array for array
 * what the Python library writes, with the same summary.
 * docs.intomind.com/files.html states what both promise.
 *
 * A recording is made here as the Python library's recorder makes one:
 * `Clock` maps the device's time onto the host's two clocks, `Take` holds
 * what a run collected, and `save` makes the recording's files with the
 * manifest the library writes. `Session` collects a take and saves it for
 * you; these are what it uses.
 *
 * Nothing here reads or writes a disk: a collection is handed its files'
 * bytes, an export hands back the file's bytes, and a saved recording is its
 * files' bytes. `capture/node` does each on a folder in Node.
 *
 * ```ts
 * import { Collection, exportRecording } from "@intomind/sdk/capture";
 *
 * const recordings = new Collection(files);       // file name -> bytes
 * const bdf = exportRecording(recordings, "my-recording", "bdf");
 * console.log(bdf.summary.samples, "samples, largest error", bdf.summary.max_error_uv, "µV");
 * ```
 */
export { CaptureError } from "./errors.js";
export { Collection, Recording, checkLabel } from "./recording.js";
export { FORMATS, exportRecording, fileName, formatOf } from "./export.js";
export { dumps, dumpsIndented, dumpsSorted, float, fromPlain, int, isValue, loads, toPlain } from "./pyjson.js";
export { Clock, findSteps, hostClocks } from "./clock.js";
export { MANIFEST_VERSION, Take, checksums, configAfter, describeChain, hostVersions, montageFields, processing, save, } from "./record.js";
export { PACKAGE_VERSION } from "./version.js";
//# sourceMappingURL=index.js.map