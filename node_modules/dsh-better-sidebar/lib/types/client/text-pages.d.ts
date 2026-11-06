import { type SessionScope } from './api.ts';
/** The paging state one preview renders from. */
export interface TextPager {
    /** A single page append is in flight. */
    loading: boolean;
    /** The "load all" loop is running (its per-page appends also set `loading`). */
    loadingAll: boolean;
    /** Wire/transport failure of the last append; cleared once one succeeds. */
    error: string | null;
    /** Loaded page texts, in file order. Append-only — nothing is ever dropped. */
    pages: readonly string[];
    /** Absolute 1-based first line of each page (parallel to `pages`). */
    lineStarts: readonly number[];
    /** Total decoded lines across the loaded pages (the row cap's input). */
    totalLines: number;
    /** Bytes read so far (`nextOffset` — the same number, named for the UI). */
    loadedBytes: number;
    /** The file's size in bytes (0 until the first response arrives). */
    size: number;
    /** True once the file's last page has been read. */
    atEnd: boolean;
    /** True when `maxLines` is what stopped the reading (not EOF). */
    atCap: boolean;
    /** Append the next page, unless nothing may be appended any more. */
    loadMore: () => void;
    /**
     * Read every remaining page, one at a time, until EOF, the `maxLines`
     * ceiling, or a failure.
     */
    loadAll: () => void;
    /** Throw away everything and re-read from the first page (the refresh). */
    reload: () => void;
    /** The file's detected encoding, as the first page reported it. */
    encoding: string;
}
/**
 * Page through one file, appending.
 *
 * @param scope - the session scope.
 * @param path - the file to read ('' parks the hook).
 * @param enabled - false issues no request and keeps the previous state (a
 *  viewer that is merely hidden must not keep reading).
 * @param revision - bump to restart from the first page (the host's refresh).
 * @param maxLines - ceiling on accumulated lines. The hook stops appending
 *  once it is reached, and reports `atCap`. It lives HERE rather than in the
 *  caller because the accounting has to be synchronous: while `loadAll` walks
 *  pages in an `await` loop, a caller reading its own RENDERED row count would
 *  decide from a stale number and overshoot the ceiling by however many pages
 *  React had not re-rendered yet.
 * @returns the accumulator and its commands.
 */
export declare function useTextPager(scope: SessionScope, path: string, enabled: boolean, revision: number, maxLines?: number): TextPager;
/**
 * One page's text as rows. The host trims every page to a line break, so the
 * '' a trailing newline produces is dropped — except on an empty page, which is
 * no rows rather than one empty one.
 */
export declare function splitLines(text: string): string[];
