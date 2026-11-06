import type { ExcludeMatcher } from './exclude-patterns.ts';
/** One explorer row. */
export interface SidebarFsEntry {
    name: string;
    path: string;
    isDir: boolean;
    hidden: boolean;
    /** Whether the row is a symlink; `isDir` then describes the link's target. */
    isSymlink: boolean;
    /** For symlinks: the target is missing or unreadable (stat failed). */
    broken: boolean;
    /**
     * Directory rows only: the contents are EXACTLY one child — the explorer
     * folds such singleton chains into one breadcrumb row (VSCode's "compact
     * folders"). The terminal link (sole child is a FILE) is marked too, so
     * the row label never shifts when the chain expands. Symlink children
     * never qualify: a self-referential link would otherwise fold forever.
     */
    compact?: boolean;
}
/** One listed level. */
export interface SidebarFsListing {
    path: string;
    entries: SidebarFsEntry[];
    truncated: boolean;
}
/**
 * Directory-first, case-insensitive name ordering (VSCode explorer order).
 *
 * `toLowerCase()` + code-point comparison instead of `localeCompare`: measured
 * at ~0.35ms/10k rows against ~14.6ms for the collator, and the tie-break on
 * the ORIGINAL name keeps the order total and deterministic for names that
 * only differ in case (`A` before `a`).
 */
export declare function compareEntries(a: SidebarFsEntry, b: SidebarFsEntry): number;
/**
 * How long one listed level stays valid. Short on purpose: it absorbs the
 * re-listing a re-render (or a burst of tree opens) causes without hiding
 * changes for perceptibly long, and every writer invalidates it explicitly
 * anyway (see {@link invalidateDirectoryCache}).
 */
export declare const DIRECTORY_CACHE_TTL_MS = 1500;
/**
 * Drop the cached level(s) for one directory (and, when called with no
 * argument, everything). Writers call this after any mutation: `fs.write`,
 * `fs.rename`, `fs.remove`, `fs.mkdir`, the upload route and the fs-watch
 * notifier all funnel here, so a stale level is never served past the write
 * that changed it.
 * @param path - absolute (or session-relative) directory to invalidate; absent
 *  clears the whole cache.
 */
export declare function invalidateDirectoryCache(path?: string): void;
/**
 * List one directory level (cached for {@link DIRECTORY_CACHE_TTL_MS}).
 * @param path - absolute directory path.
 * @param maxEntries - row bound of one level (extra rows flag `truncated`).
 * @param exclude - compiled exclude-pattern probe (the explorerExclude pref):
 *  matched entries are dropped from the listing AND the singleton fold probe,
 *  so they never render nor block a breadcrumb fold.
 * @param gate - optional shared probe budget; a batch listing many levels
 *  passes ONE gate ({@link createProbeGate}) so the per-level probe bounds do
 *  not multiply. Cache hits never touch it.
 * @returns the sorted listing.
 * @throws {SidebarError} fs-error when the level is unreadable or not a directory.
 */
export declare function listDirectory(path: string, maxEntries?: number, exclude?: ExcludeMatcher, gate?: ProbeGate): Promise<SidebarFsListing>;
/**
 * In-flight filesystem probes ONE listing request may run across ALL of its
 * levels. The per-level bounds below are exactly that — per level — while a
 * batch request lists up to `FS_TREES_MAX_PATHS` levels concurrently
 * (`fs.trees`), so without a shared budget a cold mount of a wide tree could
 * hold levels × per-level probes open at once (64 × 32). Equal to the
 * per-level constant on purpose: a single-level listing behaves as before.
 */
export declare const PROBE_BUDGET = 32;
/** A FIFO gate bounding how many probe operations run at the same time. */
export interface ProbeGate {
    /**
     * Run one probe operation under the gate.
     * @param task - the probe; it must not acquire the gate itself.
     * @returns the task's own result.
     */
    run<T>(task: () => Promise<T>): Promise<T>;
}
/**
 * Create the probe gate one listing request shares across its levels.
 * @param limit - maximum probes in flight; below 1 is clamped to 1.
 * @returns the gate.
 */
export declare function createProbeGate(limit?: number): ProbeGate;
/** The root row label of a listing: the last path segment (or the full path at the filesystem root). */
export declare function rootLabel(path: string): string;
/** Parent of a path, or undefined at the filesystem root (the explorer's "up" target). */
export declare function parentOf(path: string): string | undefined;
/**
 * Normalize a caller-supplied path to an absolute, resolved path or throw
 * fs-error. `path.isAbsolute()` is the OS's own notion of absolute: POSIX
 * roots (`/...`), Windows drive letters (`C:\...`) and — on win32 — UNC
 * network shares (`\\server\share\...`); drive-relative forms (`C:foo`)
 * stay rejected.
 */
export declare function requireAbsolute(path: string): string;
/**
 * Whether `target` lies under `base` (or equals it), tolerant of separator
 * style and — on Windows, where the filesystem is case-insensitive — of
 * letter case.
 *
 * LEXICAL ONLY, and no longer a security boundary: the sidebar's containment
 * fence was removed (see path-security.ts), so nothing in this plugin decides
 * access by this function any more. It is kept for the client-side mirror
 * usage and the historical tests, not as a guard.
 * @param platform - filesystem semantics; injectable so both branches are
 *  unit-testable on any host.
 */
export declare function isWithin(base: string, target: string, platform?: NodeJS.Platform): boolean;
/** Message text of an unknown thrown value. */
export declare function messageOf(error: unknown): string;
