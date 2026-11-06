/**
 * A per-line JSON language for JSONL / NDJSON editing.
 *
 * Reusing `@codemirror/lang-json` here is not free: its grammar accepts ONE
 * top-level value, so every record after the first lands in an error node —
 * measured on a 400-record file, 402 error nodes. They are zero-width for
 * well-formed lines so the tinting looks right, but the parse is structurally
 * wrong: every diagnostic, fold and structure query built on it inherits the
 * damage, and a genuinely broken line is indistinguishable from the boundary
 * noise. (Verified directly against `@lezer/json` before writing this.)
 *
 * A JSONL line IS an independent JSON document, so the honest parse is one
 * JSON tokenizer per line. This is that tokenizer, written as a CodeMirror
 * `StreamLanguage`: it walks a line once, tags what it recognises, and marks
 * what it does not — which is exactly the signal a broken record deserves.
 *
 * Only the concerns an editor needs are covered: strings (with escapes and an
 * unterminated tail), numbers, `true`/`false`/`null`, structural punctuation,
 * and property names (a string followed by `:`). No validation of duplicate
 * keys, no nesting depth, no number grammar beyond JSON's shape — a tokenizer
 * is not a parser and pretending otherwise would only produce false errors.
 */
import { StreamLanguage } from '@codemirror/language';
/**
 * The JSONL language: one JSON document per line, no cross-line state.
 *
 * A `StreamLanguage` carries a state object between lines; this grammar keeps
 * none, because JSONL records are independent by definition — carrying
 * anything would make line 2's tinting depend on line 1's.
 */
export declare const jsonlLanguage: StreamLanguage<{}>;
