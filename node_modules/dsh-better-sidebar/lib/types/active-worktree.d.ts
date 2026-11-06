import type { Context } from './context-types.ts';
/**
 * The directory the sidebar should treat as the session's root.
 *
 * The cache is consulted BEFORE the probe, and concurrent asks for the same
 * (session, base) share ONE in-flight resolution: twelve route handlers funnel
 * through `cwdOf()`, so a burst of parallel `/sidebar/*` calls used to spawn a
 * `git rev-parse` process per call.
 * @param ctx - host plugin context.
 * @param sessionId - session whose tool calls are inspected.
 * @param base - the authoritative session cwd (already resolved by the caller).
 * @returns the active linked worktree, the repository top level, or `base`.
 */
export declare function activeWorktreeRootOf(ctx: Context, sessionId: string, base: string): Promise<string>;
