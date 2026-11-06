import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { Context } from './context-types.ts';
import { SIDE_INJECTION_SOURCE_KIND, type SidechatLiveEvent, type SidechatLogEvent, type SidechatModelCatalog, type SidechatModelSelection, type SidechatPendingInput, type SidechatThreadInfo } from './sidechat-core.ts';
import type { AssistantLiveBuffer } from './assistant-live.ts';
/**
 * The plugin's producer-owned message source kind. Message sources are a
 * merge-extensible sum type — DSH 0.1.7 has no shared catch-all `plugin`
 * kind, so every producer declares its own in its own module (the same
 * `declare module` seam dsh-time-context / dsh-tmux-context use). The kind
 * itself is {@link SIDE_INJECTION_SOURCE_KIND}: exactly the `plugin:<name>`
 * value DSH's own v3→v4 migration derives for the rows this plugin wrote
 * under 0.1.6, so old and new logs carry one shape.
 */
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** Side-chat context injection (boundary prompt + parked in-progress snapshot). */
        'dsh-better-sidebar': {
            kind: typeof SIDE_INJECTION_SOURCE_KIND;
        };
    }
}
/**
 * The session-local model selection event. Its owning package
 * (`dsh-api-session-controller`) is not a plugin dependency, but the event is
 * part of the durable session format the plugin must write to change a
 * thread's model the way the host's own composer does — so the key is
 * declared here with the exact shape that package's own projection folds
 * (provider, model, optional branded effort).
 */
declare module '@deepseek-ai/dsh-session' {
    interface SessionEventMap {
        /** Session-local model selection for the next request. */
        'model/selection': {
            provider: string;
            model: string;
            reasoningEffort?: ReasoningEffortId;
        };
    }
}
/** The Side Chat routes of the sidebar API (wire method names). */
export interface SidechatRoutes {
    /** Create a side thread child seeded with the parent's log up to now.
     *  `question` is optional: empty creates an EMPTY thread (Codex-style
     *  immediate create); the first `sidechat.prompt` then carries the
     *  boundary + snapshot and earns the thread its real label. */
    'sidechat.start'(payload: unknown): Promise<{
        childId: string;
    }>;
    /** Deliver one follow-up message to a thread (live, or cold-resumed). */
    'sidechat.prompt'(payload: unknown): Promise<{
        accepted: true;
    }>;
    /** Abort the thread's running turn (queued work is preserved). */
    'sidechat.cancel'(payload: unknown): Promise<{
        accepted: true;
    }>;
    /** Release the thread's live agent (session and history stay persisted). */
    'sidechat.dispose'(payload: unknown): Promise<{
        accepted: true;
    }>;
    /** Live state + the thread's EFFECTIVE model route and preset. */
    'sidechat.info'(payload: unknown): Promise<SidechatThreadInfo>;
    /** The thread's OWN transcript events, seed-cut host-side (the inherited
     *  parent log never crosses the wire); `afterSeq` narrows the response to
     *  the delta beyond it (poll tail). `live` carries the thread's in-flight
     *  model deltas, which DSH 0.1.5 publishes outside the session log — it is
     *  the CURRENT attempt's rows on every poll, never a delta. `pending` is
     *  the thread's live UNCLAIMED inbox in claim order: accepted input that
     *  has not reached the log yet, so the transcript can show it instead of
     *  looking dead until a claim logs it. */
    'sidechat.events'(payload: unknown): Promise<{
        events: SidechatLogEvent[];
        live: SidechatLiveEvent[];
        pending: SidechatPendingInput[];
    }>;
    /** Drop one unclaimed inbox message, or the whole queue when `messageId` is
     *  omitted. A cold thread has nothing live to drop and answers `removed: 0`. */
    'sidechat.dequeue'(payload: unknown): Promise<{
        accepted: true;
        removed: number;
    }>;
    /** The host model catalog the composer itself lists (degraded to
     *  `available: false` when the host exposes no such service). */
    'sidechat.models'(payload: unknown): Promise<SidechatModelCatalog>;
    /** Install one model selection on the thread: durably logged as
     *  `model/selection` (the host's own commit shape) and applied to the next
     *  request through the agent-scoped selection the host installs for its
     *  composer. */
    'sidechat.model'(payload: unknown): Promise<{
        accepted: true;
        selection: SidechatModelSelection;
    }>;
}
/** Build the Side Chat routes (all optional services degrade to a wire
 *  error the tab surfaces inline). The record keys are the FULL wire method
 *  names the /sidebar/api dispatcher looks up (`api[method]`).
 *  @param ctx - host plugin context.
 *  @param live - the live assistant stream buffer; absent only in tests that
 *    never exercise streaming (then every `live` response is empty). */
export declare function buildSidechatApi(ctx: Context, live?: AssistantLiveBuffer): SidechatRoutes;
