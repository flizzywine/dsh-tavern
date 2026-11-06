/**
 * The `changes.ops` route: the session's file-tool events, as a `seq > afterSeq`
 * delta. Split out of `src/index.ts` because the wait form keeps a request open
 * (see below) and that plumbing deserves its own module.
 *
 * A PRIMED client (one that already holds the baseline) asks with `wait: true`:
 * the request parks until a matching tool event lands — or {@link WAIT_MS}
 * expires — instead of re-reading an unchanged window every poll. The reply is
 * still the same delta shape, so the client never needs a second code path.
 */
import type { Context, SidebarSessionEvent } from './context-types.ts';
/**
 * Build the `changes.ops` handler for one plugin context.
 * @param ctx - host plugin context (sessions + sessionPersistence).
 * @returns the route handler.
 */
export declare function createChangesOpsApi(ctx: Context): (payload: unknown, signal?: AbortSignal) => Promise<{
    events: SidebarSessionEvent[];
    lastSeq: number;
}>;
