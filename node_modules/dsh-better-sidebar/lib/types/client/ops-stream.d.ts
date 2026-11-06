import { type SessionScope } from './api.ts';
/** The delta cadence: the changes tab's session-lens poll of the same route. */
export declare const FILE_OPS_INTERVAL_MS = 2500;
/** The op kinds that changed a file's bytes. */
export type FileOpTouchKind = 'write' | 'edit';
/** The newest settled write/edit of one path. */
export interface FileOpTouch {
    readonly kind: FileOpTouchKind;
    /** The published revision this touch belongs to (compare with a baseline). */
    readonly revision: number;
    /** The originating tool call's event time (epoch ms). */
    readonly time: number;
}
/** What a member reads: the published state of its session's stream. */
export interface FileOpStreamState {
    /** Monotonic per-session counter, bumped once per published delta. */
    readonly revision: number;
    /** Comparison key ({@link fileOpKey}) → that path's newest settled touch. */
    readonly touched: ReadonlyMap<string, FileOpTouch>;
}
/**
 * The comparison key of one path, so a model-spelled path and an editor tab's
 * absolute path meet: relative paths are resolved against the session cwd
 * ({@link resolveSidebarPath}), `.`/`..` segments are folded lexically, both
 * separators unify to '/', and Windows-style paths (drive letters, UNC
 * shares) fold case — the same file may be spelled either way there.
 * @param cwd - the session working directory (undefined = nothing to join onto).
 * @param path - an absolute or session-relative path.
 * @returns the comparison key (never a path to hand back to the host).
 */
export declare function fileOpKey(cwd: string | undefined, path: string): string;
/**
 * Join one session's file-operation stream while `enabled`, and read its
 * published state. Every mounted editor of a session calls this; exactly one
 * of them (the elected leader) runs the poll.
 * @param scope - the session whose log is watched (sessionId + cwd).
 * @param enabled - whether this tab is on screen and holds a real file (a
 * parked tab must not keep polling, and a folder/path-less window has no file
 * to watch).
 * @returns the session's published touches, stable between deltas.
 */
export declare function useFileOpStream(scope: SessionScope, enabled: boolean): FileOpStreamState;
