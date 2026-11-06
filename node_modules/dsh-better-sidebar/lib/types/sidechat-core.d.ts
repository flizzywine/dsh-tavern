/**
 * Pure side-conversation ("Side Chat") logic shared by the host routes and
 * the client tab. Framework-free (no React, no Node) so both halves and the
 * node test environment can import it.
 *
 * A side thread is a child session the plugin creates ITSELF with a custom
 * seed — the parent's model-visible history up to the click moment. When the
 * parent has summarized (its last compaction checkpoint replaces the
 * shadowed span on the surface), the seed is REBASED onto that checkpoint:
 * surviving pre-cut surface nodes, the checkpoint, and the post-compaction
 * tail — proven equivalent to a full-log fork by folding both (compactionTail)
 * — instead of physically duplicating the whole log. Without a compaction,
 * or whenever the rebasing cannot be proven, the seed is the parent's FULL
 * event log verbatim. The log model forbids open-turn seeds, so an
 * in-flight parent turn is copied verbatim and CLOSED with synthetic
 * `step/end` + `turn/end{reason: 'interrupted'}` events: the child sees the
 * partial turn as honestly frozen ("cut off"), never as a completed answer.
 * The one case that cannot be closed honestly — a tool call still executing
 * (no `tool/result` yet; providers reject dangling assistant calls) — falls
 * back to cutting before the open turn and carrying the partial content as
 * a structured text snapshot inside the boundary prompt.
 */
import type { SidebarHistoryEntry, SidebarSessionSummary } from './context-types.ts';
import type { AssistantLiveChunk } from './assistant-live.ts';
/** The durable thread-label prefix (also the row filter in the client list). */
export declare const SIDE_LABEL_PREFIX = "Side: ";
/** The pinned label of a freshly created thread that no prompt has reached
 *  yet (Codex-style immediate create: the tab opens an EMPTY thread, the
 *  first composer message carries the boundary and earns the real label).
 *  The client renders it localized; the prefix keeps the row filter honest. */
export declare const SIDE_NEW_THREAD_TITLE = "Side: New thread";
/** Maximum code points kept in a durable thread label (matches subagent labels). */
export declare const LABEL_MAX_CHARS = 48;
/** The boundary message's opening line — the transcript mapping drops user
 *  rows starting with it (same first line as dsh-sidechain's boundary, so
 *  the two plugins' threads render consistently in either UI). */
export declare const SIDE_BOUNDARY_PREFIX = "Side conversation boundary";
/** The plugin's producer-owned source kind, stamped on the source of
 *  context-injection messages (boundary prompt + parked snapshot) so the
 *  transcript recognizes them structurally — not by text prefix. Session
 *  format v4 retired the bare `kind: 'plugin'` + `plugin` pair; a plugin is
 *  now identified by its own `plugin:<name>` kind, which is exactly what
 *  DSH's own v3→v4 migration derives for rows this plugin wrote earlier, so
 *  both generations read back under one shape. */
export declare const SIDE_INJECTION_SOURCE_KIND = "plugin:dsh-better-sidebar";
/**
 * The boundary prompt delivered as the thread's first user message: the
 * inherited seed is reference context only, never active instruction.
 * Model-facing contract — change only with intent, tests pin the sentences.
 */
export declare const SIDE_BOUNDARY_PROMPT = "Side conversation boundary.\n\nEverything before this boundary is inherited history from the parent session: its completed turns, its pending question, and \u2014 if the parent was mid-turn \u2014 its in-progress output frozen at the moment this side conversation started. It is reference context only. It is not your current task.\n\nDo not continue, execute, or complete any instructions, plans, tool calls, approvals, edits, or requests from before this boundary. Only messages submitted after this boundary are active user instructions for this side conversation.\n\nMode: this is a continuable side conversation. Your answers stay in this side thread and are viewed in the side panel; they are never delivered into the parent session.";
/** One seed event (structural mirror of the durable SessionEvent). The
 *  envelope fields are preserved verbatim: surface-eligible events
 *  (user/message, assistant/message, tool/result) REQUIRE the `surfaceOp`
 *  marker (and may carry `sourceEventSeqs`) — the seed validator rejects
 *  them without it. */
export interface SeedEvent {
    type: string;
    seq: number;
    time: number;
    data: Record<string, unknown>;
    /** Surface marker of message-producing events ('append' | replace op). */
    surfaceOp?: unknown;
    /** Seq numbers of earlier events this event cites as sources. */
    sourceEventSeqs?: unknown;
    /** Reader-skip marker of purely informational events. */
    ignorable?: true;
}
/** The minimal structural face of a session-log event this module reads
 *  (loose enough to accept both the host's real SessionEvent and the
 *  client's SidebarSessionEvent mirror). */
export interface SidechatLogEvent {
    type: string;
    seq: number;
    time: number;
    data: unknown;
}
/**
 * One live assistant delta on the plugin's wire, mirroring DSH 0.1.5's
 * client-only `assistant/live-chunk` presentation row.
 *
 * DSH 0.1.5 no longer logs `assistant/chunk`: an in-flight attempt's deltas
 * are process-local frames (`agent/assistant-stream`, folded by
 * {@link ./assistant-live.ts}) and reach the transcript through the plugin's
 * own `sidechat.events` route as these rows. They are NOT durable — the
 * route returns the current attempt's rows on every poll and the client
 * replaces its live set each time; the durable `assistant/message` settles
 * them by `turn:step`.
 */
export interface SidechatLiveEvent {
    type: 'assistant/live-chunk';
    /** Ordering key among live rows only; durable seqs stay authoritative. */
    seq: number;
    time: number;
    data: {
        attemptId: string;
        turn: number;
        step: number;
        /** Dense zero-based position within the attempt. */
        index: number;
        /** The raw model stream chunk. */
        chunk: Record<string, unknown>;
    };
}
/**
 * Project buffered live chunks into wire rows.
 * @param chunks - the session's active-attempt chunks, in index order.
 * @param tailSeq - the session's last durable seq (live rows order after it).
 * @returns the rows to append to the transcript feed.
 */
export declare function liveEventsOf(chunks: readonly AssistantLiveChunk[], tailSeq: number): SidechatLiveEvent[];
/** The result of cutting a parent log into a side-thread inheritance. */
export interface SidechatInheritance {
    /** The child seed: contiguous from seq 0, ends outside any open turn. */
    seed: SeedEvent[];
    /**
     * Structured snapshot of the parent's in-progress turn when it could NOT
     * be included as events (a tool call was still executing); null when the
     * seed already carries the whole picture.
     */
    snapshot: string | null;
}
/**
 * Whether the open turn ending the log has a `tool/call` without its paired
 * `tool/result` in the CURRENT open step. Providers reject dangling
 * assistant calls, so such a turn cannot be honestly closed and the
 * inheritance must fall back to the snapshot.
 */
export declare function hasDanglingToolCall(events: readonly SidechatLogEvent[], turnStart: number): boolean;
/**
 * Build the side-thread inheritance for one parent log: the full event log
 * up to the click moment, honestly closed when it ends inside an open turn.
 * When the parent has compacted, the log is first rebased onto its last
 * summarizing compaction (`compactionTail`) — same model-visible surface, a
 * fraction of the durable copy.
 * @param events - the parent's log (live or persisted).
 * @param live - the parent's in-flight stream chunks (DSH 0.1.5+ publishes
 *   them outside the log); used only by the snapshot fallback.
 */
export declare function buildSidechatInheritance(events: readonly SidechatLogEvent[], live?: readonly AssistantLiveChunk[]): SidechatInheritance;
/**
 * Structured text snapshot of the parent's OPEN turn (from its `turn/start`
 * to the log tail): the assistant/reasoning output so far and the tool
 * activity — executed tools with their result text, the still-executing one
 * marked. Returns null when there is no open turn or nothing to show.
 *
 * The in-flight step's text is NOT in the log on DSH 0.1.5 (the model stream
 * is process-local until it settles), so it comes from `live`; settled steps
 * read their durable `assistant/message` content, and a failed attempt reads
 * its embedded `assistant/attempt.stream`.
 * @param events - the parent's log.
 * @param live - the parent's in-flight stream chunks, in index order.
 */
export declare function buildOpenTurnSnapshot(events: readonly SidechatLogEvent[], live?: readonly AssistantLiveChunk[]): string | null;
/** One side-thread row in the client's thread list. */
export interface SideThreadRow {
    id: string;
    /** The durable thread title ('Side: …'). */
    title: string;
    /** Whether the thread's agent is currently running. */
    running: boolean;
}
/**
 * Derive the side threads of one parent session from the client session list:
 * durable `origin: 'subagent'` children of the parent whose pinned title
 * carries the thread label prefix (our creation path pins it via
 * sessionTitle.rename; dsh-sidechain threads share the convention, so they
 * are visible here too).
 */
export declare function sideThreadRows(byId: Readonly<Record<string, SidebarSessionSummary>>, sessionId: string): SideThreadRow[];
/** Truncate + prefix a question into a durable thread label. */
export declare function sideLabel(question: string): string;
/**
 * Whether the thread log already carries the side boundary message — i.e.
 * the first prompt was delivered. Tolerant to the content shape (block
 * array or bare string) and to inherited seed messages (only an OWN
 * boundary message starts with the prefix; seed messages came from the
 * parent's log, which never contains one).
 */
export declare function boundaryDelivered(events: readonly SidechatLogEvent[]): boolean;
/**
 * Whether a logged user/message is a CONTEXT INJECTION (the boundary prompt
 * plus the parked in-progress snapshot) rather than a real user message.
 * New threads deliver the injection via `agent.inject` stamped with a
 * non-'user' source kind; threads created before that split carry
 * boundary+question in ONE 'user' message, recognized by the boundary
 * prefix. Both render as one collapsible injection row — never as a user
 * bubble.
 */
export declare function isContextInjectionMessage(data: Record<string, unknown>): boolean;
/** The info the thread header shows (live runtime state + agent identity). */
export interface SidechatThreadInfo {
    /** A live agent drives the thread right now (false = cold/persisted). */
    live: boolean;
    /** Live lifecycle state; absent on cold threads. */
    status?: 'idle' | 'running';
    /** Provider route the thread actually requests with (see
     *  {@link parentModelSelection} — NOT the frozen creation-time default). */
    provider?: string;
    /** Model id the thread actually requests with. */
    model?: string;
    /** Reasoning effort of the effective selection, when the log records one. */
    reasoningEffort?: string;
    /** The recorded agent preset (live header, or persisted on cold reads). */
    preset?: string;
}
/**
 * One UNCLAIMED inbox message of a live side thread — the queue the next step
 * or turn will claim. The transcript renders these as pending user bubbles
 * (with a spinner and a dequeue affordance) instead of leaving accepted input
 * invisible until a claim logs it as a durable `user/message`.
 */
export interface SidechatPendingInput {
    /** Durable message identity — the `sidechat.dequeue` key. */
    id: string;
    /** Which boundary will claim it; `next-step` entries are claimed first. */
    target: 'next-turn' | 'next-step';
    /** Flattened text of the message content ('' when it carries no text). */
    text: string;
}
/** One routable model in the host model catalog (a structural slice of the
 *  session controller's own `modelCatalog` rows). */
export interface SidechatModelInfo {
    id: string;
    name?: string;
    description?: string;
    /** Provider-declared reasoning efforts, when the model has any. */
    reasoning?: {
        efforts: readonly {
            id: string;
            name?: string;
            description?: string;
        }[];
        defaultEffort?: string;
    };
}
/** One provider group of the host model catalog. */
export interface SidechatModelGroup {
    id: string;
    name?: string;
    models: readonly SidechatModelInfo[];
}
/**
 * The host model catalog as the side-chat model picker consumes it. Sourced
 * from the host's own `sessionController.modelCatalog()` (the exact catalog
 * the main composer lists), degraded to `available: false` when that service
 * is absent — the picker then offers only "inherit the parent".
 */
export interface SidechatModelCatalog {
    /** Whether a host catalog was readable at all. */
    available: boolean;
    /** The deployment default selection, when readable. */
    default?: SidechatModelSelection;
    /** Provider groups with at least one routable model. */
    groups: readonly SidechatModelGroup[];
    /** Providers whose catalog read failed (kept so the picker can say so). */
    failures: readonly {
        id: string;
        name?: string;
        message: string;
    }[];
}
/** The identity one inbox message carries (`MessageId`, a branded string). */
export declare function pendingInputId(message: unknown): string | undefined;
/**
 * Project one agent's inbox into wire rows, in CLAIM order: every `next-step`
 * entry first, then the queued turns (the host's `Inbox.claim` drains exactly
 * that way). Messages without an identity are skipped — they could not be
 * dequeued, so showing them as pending would offer a dead button.
 */
export declare function pendingInputs(nextStep: readonly unknown[], nextTurn: readonly unknown[]): SidechatPendingInput[];
/**
 * Fold a log's `agent/inbox/spliced` events into the message ids STILL pending
 * after it — the durable record of the inbox (the host's own
 * `inboxProjectionDefinition` semantics: apply every splice in order).
 *
 * This is the reading the ghost sweep needs: a seeded thread's inherited
 * prefix can leave messages "pending" that the parent had already claimed
 * (the claim splice sits inside the parent's open turn, which the seed
 * truncation cuts away), and those must never be delivered as the child's
 * own input.
 * @param events - the log (or any prefix of it), contiguous from seq 0.
 * @param limit - exclusive upper bound of event count to fold (the inherited
 *   prefix length, or the whole log).
 * @returns the ids of messages still pending after the folded events.
 */
export declare function pendingIdsInLog(events: readonly SidechatLogEvent[], limit?: number): string[];
/**
 * The message ids a seeded thread INHERITED as still-pending but never
 * actually owned: fold only the inherited prefix (`[0, inheritedEventCount)`),
 * which is exactly the region the parent's own claim splices may have been
 * cut out of. The caller removes precisely these from the live inbox, so a
 * user's genuinely queued side-thread input is never touched.
 * @param events - the thread's log.
 * @param inheritedEventCount - the thread's inherited prefix length.
 * @returns the ghost message ids present in the prefix fold.
 */
export declare function inheritedPendingIds(events: readonly SidechatLogEvent[], inheritedEventCount: number): string[];
/**
 * The thread's effective model selection: `pending ?? lastUsed` of its own
 * `model/selection` / `request/header` fold (see {@link parentModelSelection},
 * which this is the same projection as). Used by the routes to report what the
 * thread will actually request with.
 */
export declare function effectiveModelSelection(events: readonly SidechatLogEvent[]): SidechatModelSelection | undefined;
/** The events a thread produced itself: everything after the LAST
 *  `session/end-seed` marker (the fork-seed boundary). A log with no marker
 *  (a thread created before seeding existed) is returned whole. */
export declare function threadOwnLogEvents(events: readonly SidechatLogEvent[]): SidechatLogEvent[];
/** {@link threadOwnLogEvents} over history rows (the client cache shape). */
export declare function threadOwnEvents(entries: readonly SidebarHistoryEntry[]): SidechatLogEvent[];
/**
 * Whether the thread has at least one completed turn — the save-as-new-
 * session precondition (`session.fork` refuses to fork before the first
 * `turn/end`).
 */
export declare function threadHasCompletedTurn(entries: readonly SidebarHistoryEntry[]): boolean;
/** Whether the thread ends with a user message that no completed turn
 *  answered yet — such a pending follow-up is NOT carried into the saved
 *  session (the fork cut is the last `turn/end`). */
export declare function threadTrailingPending(entries: readonly SidebarHistoryEntry[]): boolean;
/**
 * The agent preset a session actually runs: newest `agent-preset/selected`
 * event wins, else the creation header (mirror of the dsh-agent-presets
 * resolveSessionPreset helper — replicated here to avoid a host dependency
 * on that package).
 */
export declare function resolvePresetId(header: {
    agentPreset?: string;
}, events: readonly SidechatLogEvent[]): string | undefined;
/** One model route as the durable log records it (the shape of a
 *  `model/selection` event payload and of the core `modelSelection`
 *  projection rows). */
export interface SidechatModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/**
 * The model selection a session CURRENTLY runs, projected from its durable
 * log (mirror of the core `modelSelection` projection — replicated here
 * like resolvePresetId to avoid a host dependency). An explicit
 * `model/selection` event stays PENDING until a same-route `request/header`
 * consumes it; the value the composer's model selector shows is
 * `pending ?? lastUsed`.
 *
 * This is NOT what `agent.options.provider/model` holds: those freeze the
 * creation-time deployment default and are never rewritten by a UI model
 * switch — DSH 0.1.5 routes requests through the session-local selection
 * and its `agent/request` waterfall instead. Anyone inheriting "the
 * parent's current model" must read this projection; inheriting
 * `parent.options` verbatim silently ships the stale creation default
 * (issue #368).
 *
 * A `request/header` contributes provider/model/effort, EXCEPT when its
 * effort is marked as an adapter default (`adapterDefaults.reasoningEffort`)
 * which the core selection getter deliberately does not adopt as a sticky pick.
 */
export declare function parentModelSelection(events: readonly SidechatLogEvent[]): SidechatModelSelection | undefined;
