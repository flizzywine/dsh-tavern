/**
 * Archive packing by the system's own tool, not by a writer of ours.
 *
 * This module replaces a hand-written ZIP encoder (~300 lines of local file
 * headers, central directory, CRC-32 and raw DEFLATE) plus a recursive walk.
 * Everything it did, `zip -r` does better: real DEFLATE, the platform's own
 * path handling, and streaming output that grows with the data instead of a
 * `Buffer.concat` of the whole archive.
 *
 * Two tools, tried in order, because neither is universal:
 *
 * - `zip` — what the file tree asks for, present on macOS and most Linux
 *   distributions. Always passed `-y`: without it Info-ZIP FOLLOWS symlinks,
 *   and a symlink loop (`a -> .`) then recurses until it is killed. `-y`
 *   stores the link itself, which is both loop-proof and a truer archive.
 *   (Verified against a real loop before this was written.)
 * - `tar` — present everywhere the plugin realistically runs, including
 *   Windows 10 1803+, where it is a built-in `bsdtar` and there is no `zip` at
 *   all. GNU tar and bsdtar both take the same `-czf -` invocation.
 *
 * Output always goes to stdout (`-` as the archive name) so the caller decides
 * where the bytes land; the route redirects them into a temp file, which is
 * what keeps the download streamable without holding the archive in memory.
 *
 * Nothing in this module runs a shell: `spawn` takes an argv array, and every
 * path is data. A path is never interpolated into a command string, so a
 * filename with `;` or `$(...)` in it is a filename.
 *
 * The spawn/probe functions are injectable so the test suite never depends on
 * a real `zip` being installed (AGENTS §6) — the same pattern `open-external`
 * and `search-engines` use.
 */
import { spawn } from 'node:child_process';
/** The archive tool actually in use. */
export type ArchiveTool = 'zip' | 'tar';
/** One available tool: its binary name, the invocation flags, and its suffix. */
export interface ArchiveToolSpec {
    tool: ArchiveTool;
    bin: string;
    /** `-czf -` / `-r -q -X -y -`: everything before the entry names. */
    flags: readonly string[];
    /** The download-name extension this tool produces. */
    ext: string;
}
/** How much stderr is kept for the failure message (tail, not head). */
export declare const ARCHIVE_STDERR_LIMIT = 4096;
/** The spawn face this module needs (injectable for tests). */
export type ArchiveSpawn = typeof spawn;
/** A resolved plan: where to run, what to run, and what to name the result. */
export interface ArchivePlan {
    spec: ArchiveToolSpec;
    /** Working directory the tool runs in (the selections' common ancestor). */
    cwd: string;
    /** Relative entry names, '/'-separated. */
    args: string[];
}
/**
 * The archive tool this host will use, or undefined when it has neither.
 *
 * The answer is cached for the process: `zip` does not appear or disappear
 * between two file-tree clicks, and a probe costs a process spawn.
 *
 * @param spawner - the spawn implementation (tests inject a fake).
 * @returns the tool spec, or undefined when no tool is available.
 */
export declare function resolveArchiveTool(spawner?: ArchiveSpawn): Promise<ArchiveToolSpec | undefined>;
/**
 * Resolve the first available tool from an ordered list.
 *
 * @param order - tool names to try, in order.
 * @param spawner - the spawn implementation.
 * @returns the first tool that answers, or undefined.
 */
export declare function tryTools(order: readonly ArchiveTool[], spawner?: ArchiveSpawn): Promise<ArchiveToolSpec | undefined>;
/** Drop the cached probe results (tests, and a profile change in dev). */
export declare function resetArchiveToolCache(): void;
/**
 * Build the argv/cwd plan for one selection.
 *
 * The tool's working directory is the selections' deepest COMMON ancestor, and
 * every selection is passed as its path relative to that directory — so the
 * archive names reproduce the tree the user sees: one selection is named by
 * its own basename (`src/`), two same-named files from different folders land
 * under different parents, and a selection that IS the common ancestor pushes
 * the base one level up so its name keeps a component.
 *
 * This replaces the old per-path "grow parent segments until unique" logic.
 * A path relative to a common ancestor is unique by construction, so the
 * disambiguation it performed is now a property of the layout instead of an
 * algorithm.
 *
 * @param selections - absolute paths, already fenced by the caller.
 * @param spec - the resolved tool.
 * @returns the plan to spawn.
 * @throws {SidebarError} bad-request when a selection has no usable name.
 */
export declare function planArchive(selections: readonly string[], spec: ArchiveToolSpec): ArchivePlan;
/** The outcome of one tool run. */
export interface ArchiveRunResult {
    /** The tool's exit code (0 = success). */
    code: number;
    /** The tail of stderr, for the failure message. */
    stderr: string;
}
/**
 * Run one planned tool, writing the archive to an already-open file handle.
 *
 * The caller owns the file descriptor: it stays open across the spawn so the
 * tool writes straight into the temp file, and the caller closes it once this
 * promise settles (closing it earlier would truncate a running child's output).
 *
 * @param plan - the plan from {@link planArchive}.
 * @param outputFd - writable file descriptor for the archive bytes.
 * @param spawner - the spawn implementation.
 * @param onSpawn - receives the child as soon as it exists, so the caller can
 *  hold on to it (plug-in teardown kills the builds it started).
 * @returns the exit code and the stderr tail; never rejects for a tool that
 *  ran and failed (a non-zero code is a result, not an exception).
 * @throws {SidebarError} fs-error when the tool cannot be started at all.
 */
export declare function runArchiveTool(plan: ArchivePlan, outputFd: number, spawner?: ArchiveSpawn, onSpawn?: (child: ReturnType<ArchiveSpawn>) => void): Promise<ArchiveRunResult>;
/** Maximum stem length, so the Content-Disposition header stays sane. */
export declare const ARCHIVE_STEM_MAX = 100;
/**
 * Sanitize a caller-supplied archive NAME into a stem, then apply the tool's
 * extension. Separators, control characters and quotes are stripped (a name
 * must never look like a path), and any archive suffix the caller guessed is
 * removed — the tool decides the real extension, not the client.
 *
 * @param raw - the requested name ('' or a bare suffix yields the default).
 * @param ext - the extension the resolved tool produces ('.zip' / '.tar.gz').
 * @returns a flat file name with that extension.
 */
export declare function archiveFileName(raw: string, ext: string): string;
/** The temporary archive file's name in the OS temp directory. */
export declare function archiveTempName(id: string, ext: string): string;
