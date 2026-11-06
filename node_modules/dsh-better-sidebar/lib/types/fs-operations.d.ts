/** Inputs of one upload: the session scope plus the request body stream. */
export interface WorkspaceUploadInput {
    /** The session workspace root (the base of session-relative targets). */
    cwd: string;
    /** Upload directory chosen by the client — absolute, session-relative, or `~`-relative (#713). */
    dir: string;
    /** Relative path below `dir` (absolute paths, '.', '..' and empty segments refused). */
    relativePath: string;
    /** The request body stream (raw bytes). */
    chunks: AsyncIterable<string | Uint8Array>;
    /** @deprecated IGNORED — containment was removed. Do not pass it. */
    fence?: boolean;
}
/**
 * Stream `chunks` into `dir/relativePath` atomically: a uniquely named temp
 * sibling receives the bytes, then is renamed over the target. The parent
 * directory is created on demand (recursive), so folder uploads work before
 * any level exists. The unique temp name keeps concurrent uploads to the same
 * target independent (each writes and renames its own file; the last rename
 * wins) and never blocks later uploads after a crashed process.
 *
 * There is NO size cap: the bytes flow through a bounded write stream, so a
 * 100 GB upload costs the host the same memory as a 1 KB one. A failed or
 * aborted upload still leaves neither a partial target nor a temp file.
 *
 * @throws SidebarError with a wire code for shape failures; the temp file is
 * always removed on failure.
 */
export declare function writeWorkspaceUpload(input: WorkspaceUploadInput): Promise<{
    path: string;
    size: number;
}>;
/** Inputs of one editor save. */
export interface WorkspaceWriteInput {
    /** The session workspace root (the base of session-relative targets). */
    cwd: string;
    /** Target path as the editor addresses it (absolute, session-relative, or `~`-relative). */
    path: string;
    /** The document to store, with LF line endings (CodeMirror has no other line model). */
    content: string;
    /**
     * The mtime the draft was based on. A file that changed on disk since is
     * REFUSED with `fs-conflict` instead of silently clobbering whatever wrote
     * it — and so is a file that is GONE: a numeric baseline proves it was read
     * from a file that existed, so "no stat" is a change the user made rather
     * than permission to re-create the path. `undefined` = no gate (a brand-new
     * file has no baseline — creating one is a different intent with its own
     * entry points, `fs.createFile` and the upload writer).
     */
    expectedMtimeMs?: number;
}
/**
 * Write one editor document to disk, preserving the file's own byte encoding
 * and line ending.
 *
 * Two guarantees ride together here, and both are about NOT rewriting what the
 * user did not touch:
 *
 * - **line endings** — the client transports an LF document, so writing it
 *   verbatim would turn one edited line into a whole-file diff on every CRLF
 *   checkout (#871). The EOL detected at read time is restored before encoding.
 * - **byte encoding** — GBK / UTF-16 / BOM'd UTF-8 files stay in their own
 *   encoding instead of being rewritten as UTF-8 (#523).
 *
 * The write is atomic (uniquely named temp sibling + rename) and the temp file
 * is removed on every failure path.
 *
 * @throws {SidebarError} fs-conflict (409) when `expectedMtimeMs` no longer
 *  matches the file OR the file is no longer there at all, fs-error when the
 *  write itself fails.
 */
export declare function writeWorkspaceText(input: WorkspaceWriteInput): Promise<{
    mtimeMs?: number;
}>;
/** Inputs of one tree-row rename. */
export interface WorkspaceRenameInput {
    /** The session workspace root (the base of session-relative targets). */
    cwd: string;
    /** Row path as the tree displays it (may be a symlink); absolute, session-relative, or `~`-relative. */
    path: string;
    /** The new base name (single segment — rename never moves across directories). */
    name: string;
    /** @deprecated IGNORED — containment was removed. Do not pass it. */
    fence?: boolean;
}
/**
 * Rename one tree row within its directory: `path` → `<parent>/<name>`.
 * The new name must be a single path segment (this is rename, not move);
 * an existing destination is refused (POSIX rename would clobber it
 * silently); the workspace root itself is never renamable; a symlink row
 * renames the link, not its target. A no-op rename (same name) succeeds
 * without touching the filesystem.
 *
 * @throws SidebarError with a wire code for shape, existence and root
 * failures.
 */
export declare function renameWorkspaceEntry(input: WorkspaceRenameInput): Promise<{
    path: string;
}>;
/** Inputs of one new directory row. */
export interface WorkspaceMkdirInput {
    /** The session workspace root (the base of session-relative targets). */
    cwd: string;
    /** Absolute path of the PARENT row as the tree displays it (a directory). */
    path: string;
    /** The new directory's base name (single segment — mkdir never nests). */
    name: string;
    /** @deprecated IGNORED — containment was removed. Do not pass it. */
    fence?: boolean;
}
/**
 * Create one directory inside an existing tree row: `<path>/<name>`.
 * The name must be a single path segment; an existing destination is refused
 * (mkdir would otherwise fail with EEXIST anyway, but the explicit check
 * yields the same "already exists" sentence rename uses); the parent row may
 * be any directory the host user can write.
 *
 * @throws SidebarError with a wire code for shape and existence failures.
 */
export declare function mkdirWorkspaceEntry(input: WorkspaceMkdirInput): Promise<{
    path: string;
}>;
/** Inputs of one new file row. */
export interface WorkspaceCreateFileInput {
    /** The session workspace root (the base of session-relative targets). */
    cwd: string;
    /** Absolute path of the PARENT row as the tree displays it (a directory). */
    path: string;
    /** The new file's base name (single segment — creating never nests). */
    name: string;
    /** @deprecated IGNORED — containment was removed. Do not pass it. */
    fence?: boolean;
}
/**
 * Create one EMPTY file inside an existing tree row: `<path>/<name>`.
 * The name must be one path segment and must survive a Windows host
 * ({@link assertCreatableFileName}); an existing destination — file OR
 * directory — is refused with the same "already exists" sentence rename and
 * mkdir use, and is never truncated (the write itself is `wx`, so a name that
 * appears between the check and the write is refused too, never clobbered);
 * the parent row may be any directory the host user can write (an unwritable
 * one surfaces the filesystem's own refusal text).
 *
 * @throws SidebarError with a wire code for shape, existence and write
 * failures.
 */
export declare function createWorkspaceFile(input: WorkspaceCreateFileInput): Promise<{
    path: string;
}>;
/** Inputs of one tree-row delete. */
export interface WorkspaceRemoveInput {
    /** The session workspace root (the base of session-relative targets). */
    cwd: string;
    /** Absolute path of the row as the tree displays it (may be a symlink). */
    path: string;
    /** @deprecated IGNORED — containment was removed. Do not pass it. */
    fence?: boolean;
}
/**
 * Delete one tree row permanently (there is no trash on the host): files are
 * unlinked, directories removed recursively, a symlink row unlinks the LINK
 * only (lstat decides, so a link to a directory does not recurse into its
 * target). The workspace root itself is never removable.
 *
 * @throws SidebarError with a wire code for existence and root failures.
 */
export declare function removeWorkspaceEntry(input: WorkspaceRemoveInput): Promise<{
    path: string;
}>;
