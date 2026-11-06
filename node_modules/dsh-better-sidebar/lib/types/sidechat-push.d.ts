/**
 * Side-chat live push behind `/sidebar/ws/sidechat`.
 *
 * The side-chat transcript used to learn about new rows only by polling
 * `sidechat.events` every 2s while the thread ran, so a streaming answer, the
 * claim of a just-sent message, or a finished tool call could sit invisible for
 * up to two seconds. The host already knows the moment either happens: the
 * session append feed (`session/event`) carries every durable row, and the
 * process-local `agent/assistant-stream` frames carry in-flight model deltas
 * (they are deliberately NOT logged — see assistant-live.ts).
 *
 * This hub turns both feeds into per-thread INVALIDATION notices. A notice
 * never carries event bodies: the client re-pulls `sidechat.events` with its
 * `afterSeq`, so the transcript transport, its tail cap and its delta logic are
 * unchanged, a dropped socket self-heals, and there is exactly one source of
 * truth for what a thread contains.
 *
 * Two coalescing windows, shortest first: a durable append is worth telling the
 * reader about almost immediately (60ms), while stream deltas arrive tens of
 * times a second and are folded into one notice per 250ms — each notice costs
 * the client a pull that re-sends the CURRENT attempt's chunks, so faster would
 * only burn bandwidth.
 * @module dsh-better-sidebar/sidechat-push
 */
import type { WebSocket } from 'ws';
import type { Context } from './context-types.ts';
/** One frame the host pushes: the thread whose transcript is stale. */
export interface SidechatPushFrame {
    threadId: string;
}
/** The host-side push hub: one set of feeds, any number of sockets. */
export interface SidechatPushHub {
    /** Attach one accepted socket (reads its watch frames, pushes notices). */
    attach(ws: WebSocket): void;
    /** Release the session feeds (socket teardown stays with the server). */
    dispose(): void;
}
/**
 * Register the side-chat push feeds.
 * @param ctx - host plugin context (its `on` subscribes the append feed).
 * @returns the hub plus a disposer unbinding both listeners.
 */
export declare function createSidechatPushHub(ctx: Context): SidechatPushHub;
