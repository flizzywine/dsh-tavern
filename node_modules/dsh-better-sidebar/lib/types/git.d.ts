/** A parsed porcelain status entry (v1 XY convention). */
export interface GitStatusEntry {
    path: string;
    /** Two-letter index/worktree status (X Y), e.g. 'M ', ' M', 'A ', '??'. */
    xy: string;
    /** How many lines the INDEX side gained and lost (`git diff --cached`, index
     *  against HEAD). Absent when git has no numstat row for the path on that
     *  side — an untracked file has none — so "no counts" is never rendered as a
     *  fabricated `0`. */
    staged?: GitLineCounts;
    /** How many lines the WORKTREE side gained and lost (`git diff`, worktree
     *  against the index). Absent for the same reason as {@link staged}.
     *
     *  The two sides are kept APART, never added up: a path can hold a change on
     *  each side ('MM'), and the change panel renders such a path once per band
     *  with that band's own reading. Summing the two readings would double-count
     *  every line both diffs see — e.g. stage a line and keep editing the same
     *  region, and `1 + 1` lines would be reported as a 2-line change on BOTH
     *  the staged row and the unstaged one. */
    unstaged?: GitLineCounts;
}
/** One path's line-count summary from `git diff --numstat`. A binary change is
 *  its own variant because git reports `-`/`-` for it: there ARE no counts, and
 *  saying `+0 −0` would invent a number. */
export type GitLineCounts = {
    additions: number;
    deletions: number;
} | {
    binary: true;
};
/** The source-control panel snapshot. */
export interface GitStatusResult {
    isRepo: boolean;
    /** Absent when HEAD is detached; unborn branches keep their real name. */
    branch?: string;
    /** Native tracking ref (e.g. origin/main); never inferred from a remote. */
    upstream?: string;
    /** Present only when Git can compare HEAD with the tracking ref. */
    ahead?: number;
    behind?: number;
    detached?: boolean;
    operation?: 'merge' | 'rebase';
    entries: GitStatusEntry[];
    /** True when the working tree had more rows than `GIT_STATUS_LIMIT`; the
     *  panel shows a truncation notice instead of freezing on a huge untracked
     *  set (issue #369). */
    truncated?: boolean;
    /** Selected repository root, or the discovered roots when the cwd is a container. */
    root?: string;
    repositories?: string[];
}
/** One linked checkout returned by `git worktree list --porcelain`. */
export interface GitWorktree {
    /** Absolute checkout root. */
    path: string;
    /** Branch name without `refs/heads/`, or `HEAD` when detached. */
    branch: string;
    /** Whether this checkout contains the session cwd. */
    current: boolean;
    /** Number of staged + unstaged status rows (a file changed on both sides counts once). */
    changes: number;
}
/** One `git log` row. */
export interface GitLogEntry {
    /** Short hash (7+ chars, display). */
    hash: string;
    /** Full 40-char hash (advanced operations: revert / cherry-pick). */
    hashFull: string;
    /** Full parent hashes in Git's order; root commits have none. */
    parents: string[];
    subject: string;
    author: string;
    /** ISO 8601 author date (`%ai`), e.g. `2024-01-01 10:00:00 +0800`. */
    date: string;
    /** Ref decorations (`%D` with --decorate=short), e.g. `HEAD -> main, origin/main`; '' when none. */
    refs: string;
}
/** One git failure (stderr text as the message). */
export declare class GitCommandError extends Error {
    readonly code: string;
    readonly command: string;
    constructor(message: string, code: string | undefined, command: string);
}
/** Parse porcelain v1 -z output into entries (rename/copy pairs collapse to one row). */
export declare function parsePorcelainZ(output: string): GitStatusEntry[];
/**
 * Parse a `status --porcelain=v2 --branch -z` read. The metadata lines carry
 * the branch identity, its tracking ref and the ahead/behind counts; the file
 * records reuse the v1 XY convention (v2's `.` clean side folded to a space).
 */
export declare function parseStatusPorcelainV2Z(output: string): GitStatusResult;
/**
 * Parse one `git diff --numstat` answer into a path → line-counts map. Both
 * framings are accepted: the production `-z` one (records NUL-framed, so paths
 * with newlines or quotes stay lossless) and the plain line-framed one.
 *
 * Three record shapes exist:
 *  - `2\t0\tpath` — an ordinary change,
 *  - `-\t-\tpath` — a binary change: no counts exist, so it maps to the binary
 *    variant rather than to `0 0`,
 *  - renames — the path field is the pair `old => new` (or the brace form
 *    `src/{a => b}/x.ts`) in line framing, and two NUL-framed fields (origin
 *    first) in `-z` framing.
 *
 * A rename is attributed to the NEW path: that is the file as it exists now,
 * and the exact path `git status --porcelain` reports for the same change, so
 * the counts land on the row the panel renders.
 */
export declare function parseNumstat(output: string): Map<string, GitLineCounts>;
/** One raw porcelain worktree record. Prunable checkouts are retained by
 * Git's administrative metadata after their directory disappears and must not
 * become selectable command targets. Locked checkouts remain usable. */
export interface GitWorktreeRecord {
    path: string;
    branch: string;
    locked: boolean;
    prunable: boolean;
}
/** Parse `git worktree list --porcelain` records. Production requests use
 * `-z` so even newlines and non-ASCII bytes in checkout paths stay lossless;
 * newline framing remains accepted for small fixtures and older Git output. */
export declare function parseWorktreeList(output: string): GitWorktreeRecord[];
/** Parse `git log --pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D%x1f%P` rows. */
export declare function parseLogLines(output: string): GitLogEntry[];
/** The repository path a dubious-ownership refusal names, or undefined when
 *  the message carries no path (an older or reworded git) — the caller then
 *  falls back to the cwd it already ran in. */
export declare function refusedRepository(message: string): string | undefined;
/** Per-command knobs of {@link runGit}. */
export interface RunGitOptions {
    /** Stdout ceiling in bytes; exceeding it kills the child and rejects. */
    maxBytes?: number;
    /**
     * Number of NUL-framed fields after which the child is killed and the output
     * produced SO FAR resolves — the caller's row cap made real during
     * production instead of after parsing. One field is one row, but a
     * rename/copy record costs TWO (its new name and its origin), so a caller
     * that must never cut a row off early passes twice its row cap; a torn tail
     * is fine, {@link parsePorcelainZ} already tolerates one.
     */
    maxNulFields?: number;
}
/**
 * Run one git command; resolves with stdout, rejects with GitCommandError.
 *
 * A dubious-ownership refusal is retried ONCE with the refused repository
 * (plus the cwd, which is the answer when the message named no path) trusted
 * for that invocation only. Anything else — including a second refusal — is
 * reported as-is, so a repository git cannot be talked into reading still
 * surfaces its real error instead of a misleading "not a git repository".
 */
export declare function runGit(cwd: string, args: string[], timeoutMs?: number, options?: RunGitOptions): Promise<string>;
/** One parsed `git blame --porcelain` row (the editor's hover blame). */
export interface GitBlameLine {
    /** 1-based line number in the file as it exists in the worktree. */
    line: number;
    /** The blamed commit (40 hex chars; all zeros for a line that is not
     *  committed yet — a worktree edit git cannot attribute to a commit). */
    hash: string;
    author: string;
    /** Author time as ISO 8601 carrying the AUTHOR's UTC offset, so the value
     *  is stable regardless of the host machine's timezone. */
    date: string;
    /** The commit's subject line (git's own placeholder for uncommitted rows). */
    summary: string;
}
/**
 * Parse `git blame --porcelain -L <a>,<b>` output into one row per blamed
 * line. Porcelain repeats only the `<hash> <orig> <final>` header for the
 * SECOND and later lines of the same commit (the author / committer / summary
 * block is emitted once per commit per run), so metadata is carried forward
 * per hash; every record ends with its `\t`-prefixed content line, which is
 * where the walk resumes. Unknown lines are skipped, never fatal.
 */
export declare function parseBlamePorcelain(output: string): GitBlameLine[];
/**
 * Blame one line range of a file (`git blame --porcelain -L <a>,<b>`).
 * Every failure mode — not a repository, an untracked file (`git blame`
 * exits non-zero: no such path in HEAD), a bad revision, a stalled mount
 * hitting the command timeout — resolves to an EMPTY result: the editor's
 * hover tooltip shows nothing and a missing answer can never break the
 * editing surface.
 */
export declare function blame(cwd: string, path: string, startLine: number, endLine: number, selected?: string): Promise<GitBlameLine[]>;
/** Whether the directory is inside a git work tree (exit-0 `git rev-parse`).
 *  Probe timeout is short: a cwd on a stalled mount must not hold the panel
 *  hostage for the full command budget (issue #369). */
export declare function isGitRepo(cwd: string): Promise<boolean>;
/** Discover the current repository plus child repositories nested up to
 *  DISCOVERY_MAX_DEPTH - 1 levels below cwd. Results are cached per cwd and
 *  concurrent callers share one in-flight scan, so opening the panel (three
 *  parallel git.* requests) costs a single discovery pass. */
export declare function repoRoots(cwd: string): Promise<string[]>;
/** Resolve the selected repository, defaulting to the first discovered root. */
export declare function repoRoot(cwd: string, selected?: string): Promise<string>;
/** Symbolic HEAD's real branch, including an unborn branch; rejects when detached. */
export declare function currentBranch(cwd: string): Promise<string>;
/**
 * Working-tree status (untracked included). The read is
 * `status --porcelain=v2 --branch -z --untracked-files=all`: one command
 * answers the rows AND the branch identity (name, tracking ref, ahead/behind,
 * detached HEAD), while preserving repository discovery and explicit
 * repository selection for workspace roots. `--untracked-files=all` lists the
 * contents of new directories as individual entries.
 *
 * The per-path line counts (#131) ride this SAME read: one batch of three git
 * processes answers status and both numstat sides together, never one process
 * per file, and callers keep their existing refresh cadence. A numstat failure
 * costs only the counts (the rows fall back to their count-less rendering) —
 * the status answer itself must never fail because of it.
 *
 * The porcelain read now comes FIRST, because its paths become the pathspec of
 * both numstat diffs: the counts only ever ride rows the status read itself
 * reports, and limiting the diffs to those paths is what keeps an unignored
 * nested `node_modules` (59 631 entries / 9.24 MB of numstat) out of the two
 * whole-repo walks. `--literal-pathspecs` is required: porcelain paths are
 * literal file names, and without it a name like `:colon.txt` is parsed as
 * pathspec magic and silently loses its counts.
 *
 * Each side's reading lands on its own field of the entry
 * ({@link GitStatusEntry} documents why the two are never summed).
 */
export declare function status(cwd: string, selected?: string): Promise<GitStatusResult>;
/** All linked checkouts of the repository containing `cwd`, enriched with a
 * live change count. The current checkout is first so a single-worktree repo
 * preserves the old UI ordering. */
export declare function worktrees(cwd: string): Promise<GitWorktree[]>;
/** Resolve an optional client-selected linked checkout. A caller may never use
 * this seam to point Git operations at an unrelated repository: the target
 * must occur in the authoritative session repository's worktree list. */
export declare function resolveWorktree(cwd: string, requested?: string): Promise<string>;
/** Diff text of the worktree (unstaged) or the index (staged). */
export declare function diff(cwd: string, path: string | undefined, staged: boolean, selected?: string): Promise<string>;
/**
 * Diff text of the worktree against HEAD — staged and unstaged changes in
 * ONE patch, which is what "uncommitted changes" means for the editor's
 * change gutter (the two-sided `diff()` above would each miss half of a file
 * that is partly staged). A repository whose HEAD is not born yet cannot
 * answer `diff HEAD`, so that one failure falls back to `diff --cached`
 * (index against the empty tree — the unborn-HEAD shape of the same
 * question). Untracked files never appear in either: the caller marks them
 * from the status store instead.
 */
export declare function diffHead(cwd: string, path: string | undefined, selected?: string): Promise<string>;
/** Stage paths (all when path is undefined). */
export declare function stage(cwd: string, path: string | undefined, selected?: string): Promise<void>;
/** Unstage paths (all when path is undefined). */
export declare function unstage(cwd: string, path: string | undefined, selected?: string): Promise<void>;
/** Commit the staged changes with a message (global identity untouched). */
export declare function commit(cwd: string, message: string, selected?: string): Promise<void>;
/** Branch names (current first). */
export declare function branches(cwd: string, selected?: string): Promise<{
    current: string;
    names: string[];
}>;
/** Switch to an existing branch.
 *  `--end-of-options` precedes the operand: without it a caller-supplied
 *  branch beginning with `-` is parsed as an OPTION, so `-f` force-discarded
 *  the worktree changes and `--work-tree=…` redirected the checkout. Same
 *  guard as show / commitDiff / revert / cherryPick (4100e16). */
export declare function checkout(cwd: string, branch: string, selected?: string): Promise<void>;
/** All refs plus HEAD in child-before-parent order for graph lanes, pageable
 * via skip/count. `--all` also permits an empty history on an unborn HEAD. */
export declare function log(cwd: string, count?: number, skip?: number, selected?: string): Promise<GitLogEntry[]>;
/**
 * Content of a file at a revision (`git show <rev>:<path>`), or null when the
 * revision has no such path (a new/untracked file has no HEAD side).
 *
 * `--end-of-options` precedes the operand: without it a caller-supplied `rev`
 * beginning with `-` is parsed as an OPTION rather than a revision, so
 * `rev: "--output=NUL"` silently wrote to a file and returned empty instead of
 * failing (the Changes tab's diff/blame panes then rendered blank). The
 * sentinel ends option parsing, so the operand can never be a flag while every
 * legitimate revision form still works (`HEAD`, `:0`, `<hash>^`, `HEAD~2`,
 * `origin/main`, any branch name).
 */
export declare function show(cwd: string, rev: string, path: string, selected?: string): Promise<string | null>;
/** Full patch text of one commit (`git show` with the commit header suppressed).
 *  Merge commits show their diff against the first parent (`-m --first-parent`
 *  is a no-op for regular commits), so a history click always has content.
 *  `--end-of-options` keeps a caller-supplied hash from parsing as an option. */
export declare function commitDiff(cwd: string, hash: string, selected?: string): Promise<string>;
/** Discard the worktree changes of one path (`git checkout -- <path>`; the index is untouched). */
export declare function discard(cwd: string, path: string, selected?: string): Promise<void>;
/** Revert one commit onto the current branch with an auto-generated message.
 *  `--end-of-options` keeps a caller-supplied hash from parsing as an option. */
export declare function revert(cwd: string, hash: string, selected?: string): Promise<void>;
/** Cherry-pick one commit onto the current branch.
 *  `--end-of-options` keeps a caller-supplied hash from parsing as an option. */
export declare function cherryPick(cwd: string, hash: string, selected?: string): Promise<void>;
/** Push the current branch to its upstream (`git push`). A branch without a
 *  tracking remote fails loudly with git's own message — the panel shows it and
 *  the user fixes the tracking in a terminal. No operands, so there is nothing
 *  for a caller-supplied value to smuggle in as an option. */
export declare function push(cwd: string, selected?: string): Promise<void>;
/** Pull upstream changes into the current branch (`git pull --ff-only`).
 *  Fast-forward-only keeps a headless panel out of merge/conflict editors: a
 *  diverged branch fails with git's own message instead of opening an
 *  interactive merge, so the user resolves it in a terminal. */
export declare function pull(cwd: string, selected?: string): Promise<void>;
