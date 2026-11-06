/**
 * Optional native search engines (fd / ripgrep) behind the editor's file-name
 * search (fs.search). The probe runs lazily once per process: each candidate
 * binary is verified with `--version` under a 500ms budget so a dead path is
 * never used. Engine stdout streams are always capped (fd's --max-results
 * included; rg is capped by killing the child).
 *
 * Engine output is normalized to the walk contract (see fs-search.ts):
 * root-relative, '/'-separated paths, case-insensitive NAME matching, sorted
 * by the caller, plus the directory/file split the client needs. fd reports
 * directories natively (`--type d`); rg --files reports files only, so
 * `deriveRgMatches` turns a matching path segment into the directory hit the
 * walk would have reported — the one real gap left is an EMPTY directory
 * whose name matches (no file path carries it, so rg cannot see it; fd and
 * the walk both report it).
 *
 * A runtime failure disables that engine for the rest of the process (a
 * broken binary must not slow every later search); the caller falls back to
 * the plain walk. A timeout is NOT a failure: it means this tree was too
 * large, so it must not strip every other root of the engine. Hooks are
 * swappable for tests (setEngineHooks).
 */
import { type ChildProcess } from 'node:child_process';
export type Engine = 'fd' | 'rg';
/** A probed, verified engine binary. */
export interface EngineProbe {
    engine: Engine;
    binary: string;
}
/** The engine output contract: root-relative, '/'-separated, UNSORTED. */
export interface EngineResult {
    /** Every matching entry (files and directories). */
    paths: string[];
    /** The subset of `paths` that are directories. */
    dirs: string[];
    /** true when the match cap cut the stream short. */
    truncated: boolean;
}
/**
 * Where DeepSeek Harness keeps its own `@vscode/ripgrep` platform package
 * (`@vscode/ripgrep-<platform>-<arch>/bin/rg` — the binary the harness's
 * agent-side search tools run on, so the sidebar search should prefer it
 * over a random PATH rg). The roots below are PACKAGE-MANAGER ROOTS (the
 * directory holding `@vscode/`), not `<root>/@deepseek-ai/dsh/node_modules`
 * style dependency dirs: npm and pnpm hoist the platform package next to
 * `@deepseek-ai`, not under it (verified against a real install: the
 * profile tree carries `<profile>/node_modules/@vscode/ripgrep-<…>` and no
 * `@deepseek-ai/dsh/node_modules` at all). Both shapes are still probed —
 * a tree that did not hoist keeps the package under the CLI. Deriving "the
 * node_modules that provided @deepseek-ai/dsh" from the running paths also
 * covers pnpm's `.pnpm/node_modules` hoist layer for free (verified on
 * fnm/pnpm: execPath `.../node/versions/v22/bin/node` walks
 * `bin/node_modules` → `versions/node_modules` → … → `.pnpm/node_modules`),
 * and `modulePath` (the CLI entry, `…/@deepseek-ai/dsh/lib/bin.js`) covers
 * a desktop shell whose bundled tree sits next to a node it did not ship —
 * a Homebrew node + this checkout's dependency tree is exactly that layout
 * (verified: the candidate resolves to the bundled rg on macOS).
 * Wrong guesses are cheap: every candidate goes through verify() and
 * unusable ones are dropped.
 *
 * Pure in `platform`: every path below is built with that platform's
 * `node:path` dialect (see `P` in the body), so the returned shape depends
 * only on the arguments — never on the OS running the probe.
 */
export declare function bundledRgCandidates(platform: NodeJS.Platform, arch: string, execPath: string, env: NodeJS.ProcessEnv, home: string, modulePath?: string | undefined): string[];
/** Escape glob metacharacters so a query matches literally inside -g.
 *  Braces are metacharacters too ({a,b} alternation): an unbalanced '{'
 *  makes rg fail to parse the glob (exit 2 → the engine looks broken), and
 *  a balanced one silently matches a DIFFERENT literal ('a{b}' searches
 *  'ab'). Verified against rg 15: '\{' is a valid brace escape. */
export declare function escapeGlob(query: string): string;
/** Directory names that are never useful filename-search results (VCS
 *  internals, dependency forests, package-manager stores, build caches,
 *  worktree forests, language environments).
 *  The plain walk in fs-search.ts builds its case-insensitive skip set
 *  from this list, and BOTH engine argvs exclude every name — with
 *  --no-ignore active an rg/fd run would otherwise re-enter node_modules
 *  and regress the budget-saving behavior of the walk. Excludes are
 *  matched case-insensitively (fd honors --ignore-case; rg uses --iglob),
 *  mirroring the walk's toLowerCase comparison. */
export declare const SKIP_DIR_NAMES: readonly string[];
/** A timeout means the tree is too big, not that the binary is broken —
 *  it must not disable the engine for every other search root. */
export declare class EngineTimeoutError extends Error {
}
/** Normalize one engine's stdout lines to the walk contract: root-relative,
 *  '/'-separated, no leading './'. fd/rg emit relative paths with the
 *  PLATFORM separator; the walk contract is '/'-separated on every platform.
 *  `separator` defaults to the platform separator — pass '\\' to model
 *  Windows engine output (rg on Windows emits '\' paths and '.\' prefixes;
 *  Windows file names can never contain '\' or '/', so the substitution is
 *  lossless there). A trailing '\r' is also stripped: Windows engines emit
 *  CRLF line endings, and while readline usually swallows the CR, a leftover
 *  one must never leak into a path (safe on every platform — a POSIX file
 *  whose name ends in CR is pathological). */
export declare function normalizeEnginePaths(lines: readonly string[], separator?: string): string[];
/** The fd argv: the query as a literal substring, every SKIP_DIR_NAMES
 *  excluded (a bare name excludes the entry at any depth; a worktree-style
 *  `.git` FILE is covered too — verified against real fd), '/' separators
 *  pinned, and --max-results one ABOVE the stream sentinel (cap + 1) so a
 *  full result set overflows into the same truncation detected for rg
 *  (see runChild). Directory matches are read from a second invocation
 *  (`type: 'd'`, see runChild) because fd cannot label its matches. */
export declare function fdArgv(cap: number, query: string, type?: 'd'): string[];
/** The rg argv: --files listing filtered by a case-insensitive literal-name
 *  glob, '/' separators pinned (rg emits '\' in cmd/PowerShell on Windows,
 *  '/' in Git Bash — rg#501; the flag exists since rg 0.8, a build without
 *  it fails at spawn and is disabled at runtime). Every SKIP_DIR_NAME gets
 *  a glob pair: a '<name>-anywhere' glob prunes the directory tree, and the second
 *  entry-only glob excludes an entry NAMED the skip word itself — a git
 *  worktree has a `.git` FILE (not a directory) at its root, and the
 *  directory-exclusion glob requires a path segment AFTER the word so it
 *  does not cover the pointer file (verified against real rg). fd's
 *  --exclude and the plain walk both skip it without the extra glob. */
export declare function rgArgv(query: string): string[];
/** rg reports FILES only (`rg --files` never emits a directory line), while
 *  the walk contract matches entry names — files AND directories. Every rg
 *  line is a file path whose glob already guarantees the query appears
 *  somewhere in it, so: a basename hit stays a file match, and a matching
 *  DIRECTORY segment is derived as a directory match (a directory named X
 *  holding at least one file surfaces exactly as fd/walk report it).
 *  EMPTY directories stay invisible to rg — no file path carries them —
 *  the one gap left versus fd and the walk. Both lists are sorted and
 *  capped at the same sentinel (maxMatches + 1, the caller slices back and
 *  re-derives the directory subset from what it keeps, so `dirs` stays a
 *  subset of `matches`); `truncated` is raised when the derived set exceeded
 *  the budget — the budget, not the engine, cut the result short (runChild
 *  ORs it with the stream's own sentinel). */
export declare function deriveRgMatches(paths: readonly string[], query: string, maxMatches: number): {
    paths: string[];
    dirs: string[];
    truncated: boolean;
};
/** One child invocation per engine, emitting normalized relative paths.
 *  fd needs two runs to fill the walk contract: the plain literal match (both
 *  files and directories — the walk's own shape) and a `--type d` run for the
 *  directory subset. rg's query globs admit basename hits AND files under
 *  matching directories; deriveRgMatches converts the latter into the
 *  directory matches the walk contract reports and drops nothing else.
 *
 *  Truncation symmetry: `streamLines` marks truncated when the stream
 *  exceeds `cap = maxMatches + 1` lines (the +1 is a sentinel proving
 *  "there is more"). rg has no --max-results so it naturally overflows
 *  into the sentinel; fd MUST NOT cap at `cap` (it would stop exactly at
 *  the sentinel and never be seen as truncated) — pin its --max-results
 *  one higher (maxMatches + 2) so a full result set trips the same
 *  sentinel and both engines report truncated identically, with the
 *  caller slicing back to maxMatches. */
declare function runChild(probe: EngineProbe, root: string, query: string, maxMatches: number): Promise<EngineResult>;
declare let prober: () => Promise<readonly EngineProbe[]>;
declare let runner: typeof runChild;
/**
 * The spawn signature runChild uses, narrowed from `typeof spawn` so a test
 * spawner returning a scripted `ChildProcess` satisfies the hook without
 * matching spawn's full overload surface.
 */
export type EngineSpawner = (binary: string, argv: readonly string[], options: {
    cwd: string;
    stdio: ['ignore', 'pipe', 'ignore'];
}) => ChildProcess;
/** Child spawn behind runChild — injectable so tests can drive the real
 *  orchestration with scripted children (event order, stream timing). */
declare let spawner: EngineSpawner;
/** The verified engines for this process (cached across searches). */
export declare function probeEngines(): Promise<readonly EngineProbe[]>;
/** Run one engine and get capped, normalized matches; a runtime failure
 *  disables that engine for the rest of the process (a broken binary must
 *  not slow every later search) — but a TIMEOUT does not: a timeout means
 *  THIS tree was too big, while the broken-set is per-engine, so disabling
 *  here would strip every other (small) root of the engine over one huge
 *  directory. */
export declare function runEngine(probe: EngineProbe, root: string, query: string, maxMatches: number): Promise<EngineResult>;
/** The engines a caller may actually try (verified, not broken). */
export declare function usableEngines(): Promise<readonly EngineProbe[]>;
/** Test seam: replace the probe / child-runner / spawn implementations. */
export declare function setEngineHooks(next: {
    prober?: typeof prober;
    runner?: typeof runner;
    spawner?: typeof spawner;
}): void;
/** Reset probe cache, broken-set and hooks (test isolation). */
export declare function resetEngines(): void;
export {};
