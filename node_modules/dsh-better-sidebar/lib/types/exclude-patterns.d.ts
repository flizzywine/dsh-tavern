/** Hard cap on how many patterns one request may carry (extras dropped). */
export declare const EXCLUDE_PATTERN_LIMIT = 64;
/** Hard cap on one pattern's length (longer ones dropped). */
export declare const EXCLUDE_PATTERN_MAX_LENGTH = 256;
/** One entry probe: the entry's absolute path and its base name. */
export type ExcludeTest = (entryPath: string, name: string) => boolean;
/**
 * A compiled probe plus the canonical identity of the pattern set it was
 * built from. The identity exists so a caller can key a cache on the
 * FILTERING, not just on the directory: the host's level cache stores rows
 * already filtered, so serving a listing compiled from one pattern list to a
 * request carrying another would keep showing rows the user just excluded
 * (and hide rows just un-excluded) for the rest of the TTL. Two calls that
 * normalized to the same patterns share a key, so the cache still absorbs
 * repeat listings of an unchanged list.
 */
export interface ExcludeMatcher extends ExcludeTest {
    /** Canonical identity of the compiled pattern set ('' when nothing valid). */
    readonly key: string;
}
/**
 * Compile the wire patterns into one entry probe.
 * @param raw - the request payload's `exclude` field (anything; validated).
 * @param root - the session cwd the path-anchored patterns resolve against.
 * @param platform - case-folding semantics (`'win32'` matches insensitively).
 * @returns the probe (with its {@link ExcludeMatcher.key}), or undefined when
 * nothing valid was declared (callers skip filtering entirely then — the
 * no-pattern fast path).
 */
export declare function compileExcludePatterns(raw: unknown, root: string, platform?: NodeJS.Platform | 'posix'): ExcludeMatcher | undefined;
