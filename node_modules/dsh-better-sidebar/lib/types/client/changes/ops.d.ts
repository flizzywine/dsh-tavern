/**
 * 将会话日志中的直接调用与 PTC 子调用整理为文件操作，供本轮文件视角使用。
 */
import type { SidebarSessionEvent } from '../../context-types.ts';
/** The file-touching operation kinds the tracer distinguishes. */
export type FileOpKind = 'read' | 'write' | 'edit';
/** One extracted file operation. */
export interface FileOp {
    /** 直接调用使用 callId，PTC 子调用使用 subCallId。 */
    readonly callId: string;
    readonly kind: FileOpKind;
    /** Path resolved against the session cwd when available. */
    readonly path: string;
    /** Unix epoch ms of the call; the result time when only that is known. */
    readonly time: number;
    /** True while the call has no result yet. */
    readonly running: boolean;
    /** True when the result reported an error. */
    readonly isError: boolean;
    /** The result's error text when isError; presented instead of the payload. */
    readonly errorText?: string;
    /** For 'edit': the model's exact replacement payload. */
    readonly edit?: {
        oldString: string;
        newString: string;
    };
    /** For 'write': the full new content. */
    readonly content?: string;
    /** For 'read': the file content returned by the tool result. */
    readonly read?: string;
}
/**
 * Fold a session event log into the file operations it contains, newest
 * first. A `tool/call` seeds a running op (payload from the model's
 * arguments); its `tool/result` settles it (read content, error text).
 *
 * A `<code>` block's file tools never surface as `tool/call`: they arrive as
 * a PTC pair — `tool/ptc-dispatch-start` (arguments as a parsed OBJECT, keyed
 * by `subCallId`) and `tool/ptc-dispatch` (the same payload plus the result).
 * The dispatch row is self-contained, so a missing start still yields a row,
 * and the pair inherits the start's time to order as ONE operation.
 * @param events - the session's append-only event log (oldest → newest).
 * @param cwd - the session working directory used to resolve relative paths.
 * @returns the ordered operation list.
 */
export declare function extractFileOps(events: readonly SidebarSessionEvent[], cwd?: string): FileOp[];
/**
 * The last content known for a path before the given operation, synthesized
 * from earlier ops: a write's payload is authoritative, an edit implies its
 * old side. Best effort — a write with no known prior content diffs against
 * nothing (all-added).
 */
export declare function knownContentBefore(ops: readonly FileOp[], path: string, before: FileOp): string | undefined;
/**
 * Strip the DSH read-tool response envelope down to the file's raw content,
 * PRESERVING blank lines (unlike {@link parseReadLines}, which drops them):
 * drops the <content> wrapper, the "(Showing lines ...)" note, and the
 * per-line "<n>: " prefixes. The markdown reading mode needs the blank lines
 * because markdown block structure depends on them.
 */
export declare function parseReadContent(raw: string): string;
/** One parsed read line: the file's own line number and its content text. */
export interface ReadLine {
    readonly line: number;
    readonly text: string;
}
/**
 * Parse a DSH read result into file lines with their real line numbers:
 * drops the <content> envelope and "(Showing lines ...)" note; recovers the
 * "<n>: " prefix as the line number, falling back to sequential counting.
 */
export declare function parseReadLines(raw: string): ReadLine[];
