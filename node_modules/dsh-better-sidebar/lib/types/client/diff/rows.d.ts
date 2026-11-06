/**
 * The one diff engine every file-change surface shares (the changes tab's
 * git and session lenses, the diff tab): a unified DiffRow model fed by two
 * producers — a line LCS over known contents (session file ops) and git's
 * own unified-diff text (worktree/commit diffs, via `parseUnifiedDiff` +
 * `unifiedSegments`) — collapsed into hunk/fold segments for the shared
 * renderer. Pure functions only — no React, no DOM.
 */
/** One rendered diff row. */
export interface DiffRow {
    /** Change class: 'context' shared, 'del' removed, 'add' added, 'mod'
     *  rewritten (paired del+add), 'meta' an attached marker row. */
    readonly kind: 'context' | 'del' | 'add' | 'mod' | 'meta';
    /** Old-side 1-based line number; absent on pure additions. */
    readonly oldLine?: number;
    /** New-side 1-based line number; absent on pure deletions. */
    readonly newLine?: number;
    /** The line's text without its terminator. */
    readonly text: string;
}
/**
 * Cell ceiling for the dense LCS table: `oldLines.length * newLines.length`
 * above this never builds the table (see {@link diffLines}). The table is one
 * JS number per cell and measures at ~8 bytes/cell, so the cost is entirely
 * about the input's line counts: a 5000×5000 pair allocates 193MB, a
 * 10000×10000 pair 765MB. 4M cells ≈ 32MB keeps a worst case well inside a
 * browser tab's budget while still pairing a 2000×2000 rewrite exactly.
 */
export declare const MAX_LCS_CELLS = 4000000;
/**
 * Pair each del-run with the add-run that follows it: the overlapping
 * `min(len)` rows on both sides become 'mod' so rewrites tint distinctly and
 * receive intra-line highlighting. Pure — returns a new array when anything
 * changed. Shared by the LCS walk and the unified-diff converter so git
 * hunks rewrite-pair exactly like session ops do.
 */
export declare function pairMods(rows: readonly DiffRow[]): DiffRow[];
/**
 * Line diff by LCS walk with rewrite pairing: the raw walk emits context/del/
 * add rows; `pairMods` marks rewritten pairs as 'mod'.
 *
 * Inputs whose line-count product exceeds {@link MAX_LCS_CELLS} skip the dense
 * table entirely (it would allocate hundreds of MB on the main thread) and
 * degrade to every old line as 'del' (old order, `oldLine` 1..n) followed by
 * every new line as 'add' (new order, `newLine` 1..m). The degenerate output
 * carries no 'context' and no 'mod' rows: pairing is skipped too, since with no
 * alignment found every del/add pair would be marked rewritten.
 * @param oldText - the previous content; empty string diffs against nothing.
 * @param newText - the next content.
 * @returns ordered diff rows, old-side deletions before new-side additions.
 */
export declare function diffLines(oldText: string, newText: string): DiffRow[];
/** One rendered hunk: change rows plus the surrounding context window. */
export interface HunkSegment {
    readonly kind: 'hunk';
    readonly rows: readonly DiffRow[];
}
/** One collapsed run of unchanged rows (the "… n 行" fold). */
export interface FoldSegment {
    readonly kind: 'fold';
    /** The rows this fold hides, when the producer knows them (session diffs
     *  re-derive them from full contents; git gaps never emitted the text, so
     *  those folds carry only their line ranges and cannot expand). */
    readonly rows?: readonly DiffRow[];
    /** How many rows the fold hides. */
    readonly count: number;
    readonly oldStart: number;
    readonly oldEnd: number;
    readonly newStart: number;
    readonly newEnd: number;
}
export type DiffSegment = HunkSegment | FoldSegment;
/** Context window (rows around a change) kept visible in a hunk. */
export declare const HUNK_CONTEXT = 3;
/** Folded context runs shorter than this are shown directly, not collapsed. */
export declare const MIN_FOLD = 3;
/**
 * Group a line diff into hunks and folded context runs. Consecutive changes
 * whose gap fits within the context window merge into one hunk; unchanged
 * regions between hunks (and any surrounding the whole diff) become fold
 * segments that default collapsed. This yields the file-hunk presentation
 * familiar from terminal diffs (Claude Code / git hunk headers).
 * @param rows - the flat diff rows.
 * @param context - how many unchanged rows around a change stay visible.
 * @returns ordered segments (hunks and folds).
 */
export declare function buildDiffSegments(rows: readonly DiffRow[], context?: number): DiffSegment[];
/** One intra-line segment: a run of chars with a changed flag. */
export interface InlineSegment {
    readonly text: string;
    readonly changed: boolean;
}
/** Each side's intra-line segments. */
export interface InlineDiff {
    readonly old: readonly InlineSegment[];
    readonly next: readonly InlineSegment[];
}
/**
 * Intra-line diff by common prefix/suffix: the shared leading and trailing
 * characters stay unchanged, and only the differing middle is marked changed
 * on both sides. This never highlights identical characters and keeps a small
 * edit inside a long line immediately visible. Pure, no React/DOM.
 * @param oldText - the old line.
 * @param newText - the new line.
 * @returns per-side segments marking changed runs.
 */
export declare function diffInline(oldText: string, newText: string): InlineDiff;
/**
 * Merge adjacent inline segments sharing the same changed flag, so rendering
 * wraps each run — not each character — in one span.
 * @param segments - the raw per-character-heavy inline segments.
 * @returns coalesced segments; identical text joined into runs.
 */
export declare function coalesceInline(segments: readonly InlineSegment[]): InlineSegment[];
/** Human byte count for the panel meta row. */
export declare function formatBytes(bytes: number): string;
/** One parsed diff line of a unified diff (git's own hunk structure). */
export interface DiffLine {
    kind: 'ctx' | 'del' | 'add' | 'meta';
    /** The line content without its diff marker ('' for the no-newline marker). */
    text: string;
    /** Old-side line number (null for pure additions / metadata). */
    oldNum: number | null;
    /** New-side line number (null for pure deletions / metadata). */
    newNum: number | null;
}
/** One parsed hunk. */
export interface DiffHunk {
    /** The old-side start line (`-a[,b]`). */
    oldStart: number;
    /** The new-side start line (`+c[,d]`). */
    newStart: number;
    /** The section text after the trailing `@@` (may be empty). */
    header: string;
    lines: DiffLine[];
}
/** One parsed file section of a unified diff. */
export interface DiffFile {
    /** The old-side path ('/dev/null' for a new file); '' when git named none. */
    oldPath: string;
    /** The new-side path ('/dev/null' for a deleted file); '' when git named none. */
    newPath: string;
    /** The file changed with binary content: no hunks to draw. */
    binary: boolean;
    hunks: DiffHunk[];
}
/** The parsed unified diff. */
export interface ParsedDiff {
    files: DiffFile[];
}
/**
 * Undo git's C-quoting of a path (`"a/\346\226\207.md"` → `a/中文.md`).
 * git quotes a path holding a byte outside ASCII, a control character, a
 * quote or a backslash; `-c core.quotePath=false` (see `runGit`) already
 * removes the non-ASCII half for our own commands, so this is the remaining
 * defensive half — and what keeps replayed/pasted diff text readable.
 * Unquoted input comes back unchanged.
 * @param raw - the path as it appears in the diff text.
 * @returns the literal path.
 */
export declare function decodeGitPath(raw: string): string;
/**
 * Parse `git diff --no-color` output into file sections and hunks. Rows
 * outside a file section (leading noise) and metadata rows between the
 * `diff --git`/`---`/`+++` headers and the first hunk (index lines, mode
 * changes, rename/similarity lines) are skipped.
 *
 * Paths come from whichever header names them: `---`/`+++` win when present,
 * otherwise the section's own `rename from|to`, `Binary files … differ` or
 * `diff --git` line supplies them. git emits no `---`/`+++` at all for a
 * binary file, a pure rename and a mode-only change, so without those
 * fallbacks the section renders as an anonymous header (the badge with no
 * file name the reader cannot place).
 *
 * Both of those header branches are gated on `!inHunk`, because a hunk line can
 * wear the same prefix: a deleted line is `-` plus its text, so deleting `-- x`
 * emits `--- x` — a hunk line that starts exactly like the separator, and one
 * that used to be read as a NEW file's header (truncating the hunk here, then
 * stamping the deleted text onto the path). The hunk is the tiebreaker: git
 * never writes `---`/`+++` inside one.
 */
export declare function parseUnifiedDiff(text: string): ParsedDiff;
/**
 * Convert one parsed unified-diff file into renderer segments: each hunk's
 * lines become a paired-mod hunk segment, and the unemitted context gaps
 * between hunks (git already trimmed them) become non-expandable folds that
 * still carry their old/new line ranges. The rewrite pairing applies within
 * each hunk, exactly like session-op diffs.
 */
export declare function unifiedSegments(file: DiffFile): DiffSegment[];
/** Build the untracked-file shape: one file, one hunk of pure additions. */
export declare function untrackedFile(path: string, content: string): DiffFile;
/**
 * Materialize a git gap fold's hidden rows from the two sides' full file
 * contents, by the fold's known line ranges: the old side drives context
 * rows (each mapped onto the new side through the fold's offset — a gap is
 * an unchanged run, so the sides align), and new-side lines the old range
 * never reaches become pure additions. Line numbers clip to the actual
 * content (a no-newline file's ranges can overrun by one); `\r` endings
 * survive verbatim, like git's own context lines.
 */
export declare function foldRowsFromContents(fold: FoldSegment, oldContent: string, newContent: string): DiffRow[];
/** Strip the `a/` / `b/` prefix git puts on diff paths (not on /dev/null). */
export declare function displayPath(path: string): string;
/**
 * The diff's insert/delete counts (the "+n −m" header chips), in git's
 * accounting: one rewritten line is one insertion plus one deletion. It
 * renders as a pair of `mod` rows (one per side), so count SIDES rather than
 * rows — counting each `mod` row as both an add and a delete reported a
 * single-line rewrite as +2 −2, which matched neither `git diff --numstat`
 * nor the `-old` / `+new` pair drawn on screen.
 */
export declare function diffStats(segments: readonly DiffSegment[]): {
    added: number;
    deleted: number;
};
