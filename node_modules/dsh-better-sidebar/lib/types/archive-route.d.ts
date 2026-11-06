import type { SidebarHttpResponse } from './context-types.ts';
import { type ArchiveSpawn, type ArchiveToolSpec } from './archive-tools.ts';
/** How many archives one host may build at the same time. */
export declare const ARCHIVE_MAX_BUILDING = 4;
/** How long a finished (or failed) archive stays downloadable. */
export declare const ARCHIVE_TTL_MS: number;
/** The finished archive on disk. */
interface ArchiveFile {
    path: string;
    size: number;
}
/** One archive build: the state the client polls, plus the finished file. */
interface ArchiveTask {
    id: string;
    sessionId: string;
    /** The final download name (the tool's extension already applied). */
    name: string;
    state: 'building' | 'ready' | 'error';
    /** Bytes written so far (the temp file's size while building). */
    bytes: number;
    error?: string;
    file?: ArchiveFile;
    /** When the task stops being downloadable (set when it settles). */
    expiresAt: number;
}
/** The status shape the client reads (never carries the bytes). */
export interface ArchiveStatus {
    state: 'building' | 'ready' | 'error';
    bytes: number;
    error?: string;
}
/** Why a download/status read could not be served. */
export type ArchiveLookup = {
    ok: true;
    task: ArchiveTask;
} | {
    ok: false;
    reason: 'missing' | 'forbidden' | 'building' | 'expired' | 'error';
    message: string;
};
/**
 * The `content-disposition` value for one archive download.
 *
 * A non-latin1 name (a Chinese folder → `报告.zip`) CANNOT go into the header
 * verbatim: Node's `writeHead` validates header values and rejects anything
 * above U+00FF with `Invalid character in header content` — the route turned
 * that into a 500. So the name is sent twice, exactly like `/sidebar/file`
 * does for a download: an ASCII-only `filename="…"` fallback for old clients
 * and the RFC 5987 `filename*=UTF-8''…` form (percent-encoded, therefore pure
 * ASCII) for everyone else, which wins in every current browser.
 */
export declare function contentDispositionOf(name: string): string;
/**
 * Answer one `GET /sidebar/archive?id=&sessionId=` from the task table.
 *
 * Split out of index.ts because this mapping IS the contract: 400 without
 * both parameters, 403 for another session's task, 409 while it builds, 410
 * for a failed build, 404 for unknown/expired/already-downloaded, 200 with the
 * RFC 5987 disposition otherwise. Kept here so all six branches are testable
 * without a live cordis mount.
 *
 * The bytes are STREAMED from the temp file and the task is released only once
 * the stream settles: releasing first (as the buffered version could) would
 * unlink the file the response is still reading from.
 *
 * @param tasks - the plugin's task table.
 * @param query - the request's `sessionId` / `id` values (null = absent).
 * @param res - the response face.
 * @throws {SidebarError} for every non-200 branch (callers turn it into the
 *  JSON error envelope they already use). Thrown BEFORE any header commits, so
 *  the envelope is still deliverable.
 */
export declare function respondArchiveDownload(tasks: ArchiveTasks, query: {
    sessionId: string | null;
    id: string | null;
}, res: SidebarHttpResponse): Promise<void>;
/**
 * The host-side archive task table.
 *
 * A selection is planned up front (cheap: one probe + a couple of path joins)
 * and then packed in the BACKGROUND, so the client gets an id immediately and
 * the download only starts once the bytes actually exist. The table is bounded
 * twice — {@link ARCHIVE_MAX_BUILDING} concurrent builds and
 * {@link ARCHIVE_TTL_MS} since a finished one — and every read is
 * session-scoped, so one session can never fetch another's archive.
 */
export interface ArchiveTasks {
    /** Start a build; rejects when the tool is missing or the cap is hit. */
    start(input: {
        sessionId: string;
        name: string;
        paths: readonly string[];
    }): Promise<{
        id: string;
        name: string;
        entries: number;
    }>;
    /** Poll one task (a settled task past its TTL reads as missing). */
    status(id: string, sessionId: string): ArchiveStatus;
    /** Look one task up for a download; `sessionId` must match the builder's. */
    lookup(id: string, sessionId: string): ArchiveLookup;
    /** Release a task (called after its bytes were served): deletes the temp file. */
    release(id: string): void;
    /** Number of live tasks (tests / diagnostics). */
    size(): number;
    /** Kill every running build and delete every temp file (plugin teardown). */
    dispose(): void;
}
/** Options of {@link createArchiveTasks} (tests inject the spawn + temp dir). */
export interface ArchiveTaskOptions {
    spawn?: ArchiveSpawn;
    /** Directory the temp archives live in (defaults to the OS temp directory). */
    tempDir?: string;
    /** Resolve the archive tool (defaults to the real probe). `spawner` is
     *  undefined when the table was built without an injected spawn. */
    resolveTool?: (spawner: ArchiveSpawn | undefined) => Promise<ArchiveToolSpec | undefined>;
}
/** Create one archive task table (one per plugin mount). */
export declare function createArchiveTasks(options?: ArchiveTaskOptions): ArchiveTasks;
export {};
