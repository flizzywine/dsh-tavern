import type { Context } from '../context-types.ts';
/** What the caller hands the hook. */
export interface SessionRootOptions {
    /**
     * Whether this caller is on screen. Defaults to true; a parked caller
     * (`visible: false`) holds no timer and issues no request, and keeps the
     * last resolved root until it comes back.
     */
    visible?: boolean;
}
/**
 * Resolve the live workspace root for one session.
 * @param ctx - client plugin context (owns the session list feed + API).
 * @param sessionId - the session to resolve; `undefined` resolves to `undefined`.
 * @param options - `visible: false` parks this caller (no polling).
 * @returns the host's active root, falling back to the list summary cwd.
 */
export declare function useSessionRoot(ctx: Context, sessionId: string | undefined, options?: SessionRootOptions): string | undefined;
