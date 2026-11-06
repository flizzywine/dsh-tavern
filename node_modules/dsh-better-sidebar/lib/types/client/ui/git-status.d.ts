import { type GitStatusResult, type SessionScope } from '../api.ts';
/** The semantic class of one changed path (drives the row's ink). */
export type GitTone = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'copied' | 'conflict';
/** One path's git state, derived from its two-letter porcelain code. */
export interface GitFileStatus {
    /** Display letter: the index side wins, else the worktree side ('??' → 'U'). */
    letter: string;
    tone: GitTone;
    /** The index (staged) side carries a change. */
    staged: boolean;
    /** The worktree (unstaged) side carries a change. */
    unstaged: boolean;
}
/**
 * Derive one path's status from its porcelain `XY` code, or `undefined` for a
 * clean (`'  '`) or ignored (`'!!'`) entry. Untracked (`??`) reports 'U' —
 * git's own letter for "not in the index" would be a blank.
 */
export declare function statusOfXY(xy: string): GitFileStatus | undefined;
/**
 * Force a re-read of one session's git status (after stage/commit/discard,
 * or from a manual refresh). Queues one fetch when another is in flight.
 * Every live key of that session is refreshed, so the tree and the changes
 * page never disagree.
 */
export declare function invalidateGitStatus(sessionId: string): void;
/** The consumer-facing view of one key's status. */
export interface GitStatusView {
    /** The last snapshot, or null before the first answer. */
    snapshot: GitStatusResult | null;
    loading: boolean;
    error: boolean;
    /** Re-read now (queued when a fetch is already in flight). */
    refresh(): void;
    /** The status of one absolute path, or undefined when clean/unknown. */
    statusOf(absolutePath: string): GitFileStatus | undefined;
    /** Whether `absoluteDir` or anything under it has a change. */
    dirHasChanges(absoluteDir: string): boolean;
}
/**
 * Subscribe to the shared git status of one session (optionally of one linked
 * worktree). While `visible` is true the consumer holds the answer; while
 * `poll` is also true it holds the automatic timer (at `pollMs`, escalated by
 * the slow tiers). `poll: false` is for a consumer that wants one reading and
 * event-driven refreshes — the editor's gutter — so it can never keep a git
 * process running in the background.
 */
export declare function useGitStatus(scope: SessionScope, options?: {
    worktree?: string;
    visible?: boolean;
    pollMs?: number;
    poll?: boolean;
}): GitStatusView;
