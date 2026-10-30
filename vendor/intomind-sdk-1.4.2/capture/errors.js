/**
 * The one error a recording or an export is refused with.
 */
/** Why a recording could not be read or exported. Its message is the Rust crate's, word for word. */
export class CaptureError extends Error {
    /** The reason, in words. */
    constructor(message) {
        super(message);
        this.name = "CaptureError";
    }
}
//# sourceMappingURL=errors.js.map