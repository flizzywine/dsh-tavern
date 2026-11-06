/** Whether a path is newline-delimited JSON (one record per line). */
export declare function isJsonlPath(path: string): boolean;
/** One parsed line. */
export type JsonlRecord = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: string;
};
/** A record that is an object or array can render as a `JsonTree`. */
export declare function isTreeRecord(value: unknown): value is object | unknown[];
/**
 * Parse one JSONL line.
 *
 * A blank line is NOT a record — JSONL writers commonly end the file with one
 * newline, and the host's pages are line-aligned, so a trailing blank must not
 * render as a broken record. It is reported as `{ok: false}` with an empty
 * error so the caller can skip it instead.
 *
 * @param line - one line of the file, without its newline.
 * @returns the parsed value, or the failure reason.
 */
export declare function parseRecord(line: string): JsonlRecord;
/**
 * One-line summary of a record for its collapsed row.
 *
 * Objects and arrays become `{a: 1, b: "x", rest: …}` rather than raw JSON:
 * a collapsed row has to be scannable, and a raw `JSON.stringify` of a session
 * event is a wall of punctuation. Nesting beyond the first level is elided —
 * the expanded `JsonTree` is where detail lives.
 *
 * @param value - the parsed record.
 * @returns a single-line summary, never longer than {@link SUMMARY_MAX}.
 */
export declare function summarizeRecord(value: unknown): string;
