/**
 * The changes list's hierarchy.
 *
 * A `git status` answer is a flat list of repo-relative paths, and the Git
 * lens used to render exactly that: one row per file, with the file name and
 * its directory squeezed onto the same line. Nested work (a refactor touching
 * `src/client/changes/*`) then read as a wall of near-identical rows. This
 * module folds the list into the directory tree the lens renders — VS Code's
 * SCM tree, including its single-child directory compression — so the shape
 * of the change is legible at a glance.
 *
 * Pure — no React, no DOM. `buildChangeTree` runs once per group per fold;
 * the renderer only walks the result.
 */
import type { GitLineCounts, GitStatusEntry } from '../api.ts';
import { type GitFileStatus } from '../ui/index.ts';
/** Which band's reading a tree carries: the index side or the worktree side.
 *  Named after `GitStatusEntry`'s own fields so `entry[side]` is the reading. */
export type ChangeSide = 'staged' | 'unstaged';
/** One changed file (a leaf), carrying its porcelain status. */
export interface ChangeFile {
    kind: 'file';
    /** The file's own name (the last path segment). */
    name: string;
    /** The repo-relative path exactly as git reported it (the row's identity). */
    path: string;
    status: GitFileStatus;
    /** THIS GROUP's line counts for the path (#131) — the index side inside the
     *  staged group, the worktree side inside the unstaged one, so a path changed
     *  on both sides lands in both groups with a reading of its own each. Absent
     *  when git has no numstat row for the path on this side — untracked files
     *  never have one. */
    counts?: GitLineCounts;
}
/** One directory row: its children plus the number of changed files beneath. */
export interface ChangeDir {
    kind: 'dir';
    /** The display label: one segment, or the compressed chain ('src/client'). */
    name: string;
    /** The deepest directory this row stands for. */
    path: string;
    children: ChangeNode[];
    /** Changed files anywhere under this row (the row's count pill). */
    changes: number;
}
export type ChangeNode = ChangeDir | ChangeFile;
/**
 * Fold one group's changed files (unstaged or staged) into a directory tree.
 * Rows without a porcelain status (clean, ignored) are skipped, a repeated
 * path counts once, and an empty input yields an empty list.
 * @param entries - the group's `git status` entries.
 * @param side - which band's reading to put on the leaves. The entries carry
 *   both sides (a path can be in both groups), so the tree must be told which
 *   one its rows stand for. `undefined` leaves the leaves count-less, which is
 *   what the MERGE band wants: a conflict is not a line-count story, and
 *   neither side's number may be presented as "the" number for it.
 * @returns the tree's roots, ready to render in order.
 */
export declare function buildChangeTree(entries: readonly GitStatusEntry[], side?: ChangeSide): ChangeNode[];
/** One group's summed line counts, plus how many rows contributed them. */
export interface ChangeLineTotals {
    additions: number;
    deletions: number;
    /** Rows that actually PRINT numbers. 0 means the group has nothing to sum
     *  (only untracked files, binary blobs — or only 0/0 entries such as a pure
     *  rename), so the header must show no total at all. */
    files: number;
}
/**
 * Sum one group tree's line counts (#131): the group header's total is exactly
 * the sum of the numbers its own file rows print. Binary rows, rows without
 * counts (untracked files) and rows whose two numbers are both zero (a pure
 * rename, a mode-only change — their rows print nothing) contribute nothing,
 * never a fabricated 0 — and folding a directory is a view state, so every
 * member counts either way.
 */
export declare function sumLineCounts(nodes: readonly ChangeNode[]): ChangeLineTotals;
