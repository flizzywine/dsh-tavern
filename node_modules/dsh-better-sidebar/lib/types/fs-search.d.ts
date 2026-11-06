import type { ExcludeTest } from './exclude-patterns.ts';
/** One search: the paths of the matching entries (root-relative,
 * '/'-separated for tree searches; a direct-path query yields the RESOLVED
 * absolute target) plus the truncation flag. */
export interface FsSearchResult {
    matches: string[];
    /** The subset of `matches` that are DIRECTORIES (same form as their match
     *  row). The client navigates the tree for these instead of opening them:
     *  `fs.read` refuses a directory, so treating a hit as a file surfaces a
     *  bare `"…" is a directory` error. */
    dirs: string[];
    truncated: boolean;
}
/** Search budgets (both injectable for tests). */
export interface FsSearchOptions {
    /** Row cap of the result list (default 200). */
    maxMatches?: number;
    /** Total entries visited before the walk gives up (default 100_000). */
    maxVisited?: number;
    /** Compiled exclude-pattern probe (the explorerExclude pref): matched
     *  entries never match AND are never descended — the search surface stays
     *  in lockstep with the tree listing. */
    exclude?: ExcludeTest;
}
/**
 * The plain-JS fallback walk: search `root` recursively for entries whose
 * name contains `query` (case-insensitive), or — for a query carrying a
 * path separator, which no NAME can contain — whose root-relative path
 * does.
 * @param root - absolute search root.
 * @param query - the name substring, or the path fragment for
 *  separator-carrying queries; empty matches nothing.
 * @param opts - budget overrides (tests).
 * @returns the matching paths RELATIVE to `root` ('/'-separated), sorted,
 *  plus which of them are directories and whether a budget cut the walk
 *  short. An unreadable level is skipped (permission errors never fail the
 *  whole search).
 */
export declare function searchFilesPlain(root: string, query: string, opts?: FsSearchOptions): Promise<FsSearchResult>;
/**
 * The fs.search dispatch: an absolute query is stat'ed directly (see the
 * module header), a separator-carrying fragment goes to the walk, and plain
 * name queries run the native engines first (when verified and healthy) with
 * the plain walk as fallback. Engine output is normalized onto the walk
 * contract — root-relative, '/'-separated, sorted, and split into
 * matches/dirs — so the route and the client stay unchanged. A blank query
 * matches nothing and touches neither the engines nor the filesystem.
 *
 * The engines keep their own cap (and report it through `truncated`), so a
 * root whose first `maxMatches` rows are ALL excluded comes back short with
 * `truncated: true` rather than silently hiding the remainder — the same
 * signal a budget-cut walk gives.
 */
export declare function searchFiles(root: string, query: string, opts?: FsSearchOptions): Promise<FsSearchResult>;
