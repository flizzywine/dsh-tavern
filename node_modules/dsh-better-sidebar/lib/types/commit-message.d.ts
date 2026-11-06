/**
 * Commit-message suggestion: the prompt contract and the model-route
 * vocabulary shared by the `git.suggest-message` host route (src/index.ts)
 * and its tests. Deliberately free of cordis, git and the LLM service, so
 * the wording and the route parse stay unit-testable without a host.
 *
 * The generation itself runs through the harness LLM service (`ctx.llm`) with
 * the route the CONVERSATION runs on by default, or a route the user pinned in
 * the Git card's settings (see {@link parseModelRoute}). The plugin never
 * touches a credential: the harness resolves provider endpoints and keys.
 */
/** Max diff characters fed to the model. A huge change set is truncated (with
 *  an explicit marker) so bulk renames or generated-file diffs cannot flood
 *  the model context. */
export declare const SUGGEST_DIFF_LIMIT = 12000;
/** The prompt languages the suggestion supports (the panel's own locale). */
export type CommitPromptLanguage = 'zh' | 'en';
/** One assembled suggestion request (system + user halves). */
export interface CommitPrompt {
    system: string;
    user: string;
}
/** One provider/model route — the pair the LLM service dispatches on. */
export interface CommitModelRoute {
    provider: string;
    model: string;
}
/** Narrow an untrusted language value to the supported pair. */
export declare function normalizeLanguage(value: unknown): CommitPromptLanguage;
/** Truncate one diff to {@link SUGGEST_DIFF_LIMIT}, marking the cut. */
export declare function truncateDiff(diff: string): string;
/**
 * Parse a pinned route of the form `provider/model`. The FIRST slash splits:
 * a model id may carry its own slashes (e.g. a vendor-prefixed id), the
 * provider never does. Anything malformed (empty half, no slash) yields
 * undefined so the caller falls back to the conversation's own route.
 */
export declare function parseModelRoute(value: unknown): CommitModelRoute | undefined;
/** Cap of the conversation-derived route list (the adapter catalog is
 *  capped separately, host-side). */
export declare const MODEL_ROUTE_HISTORY_LIMIT = 20;
/**
 * One provider entry of the harness LLM catalog, read tolerantly: the
 * adapter-registration shape is not part of this plugin's contract, so every
 * plausible field is probed and an entry that yields no route is dropped
 * (never guessed) — a wrong route would fail at generation time instead.
 * @param entry - one `listProviders()` element.
 * @returns the provider route and a display label, or undefined.
 */
export declare function providerEntryOf(entry: unknown): {
    provider: string;
    label: string;
} | undefined;
/**
 * One model entry of a provider's advertised catalog (same tolerant read as
 * {@link providerEntryOf}).
 * @param entry - one `listModels()` element.
 * @returns the model id and a display name, or undefined.
 */
export declare function modelEntryOf(entry: unknown): {
    id: string;
    name: string;
} | undefined;
/**
 * The reasoning-effort ladder, lowest first. Effort ids are adapter-owned, so
 * this is only a RANKING hint: an id outside the ladder still forms a valid
 * route, it just cannot be ordered against these.
 */
export declare const REASONING_LEVEL_ORDER: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/**
 * The lowest reasoning effort a model advertises, from the `efforts` list of
 * its resolved model info. Commit-message drafting is a one-line generation:
 * the highest default (DSH's DeepSeek adapter defaults to `high` unless the
 * connection configures otherwise) spends the output budget on thinking and
 * can leave no text at all, so the cheapest supported level is requested
 * explicitly. Mirrors pi-web's generate-commit.
 *
 * An UNKNOWN effort id never outranks a known one; when every id is unknown
 * the adapter's own first entry wins (its declared order is the only signal
 * available).
 * @param efforts - `modelInfo.reasoning.efforts` (unknown shape).
 * @returns the effort id to request, or undefined when the model advertises
 * none (passing an effort to a non-reasoning model is rejected by the
 * harness, so the caller must omit the field entirely).
 */
export declare function lowestReasoningEffortOf(efforts: unknown): string | undefined;
/**
 * The harness's default model selection (settings namespace
 * `agent-default-model`), read tolerantly: it is the route a NEW conversation
 * would use, so it is available before any message is sent — unlike the
 * conversation-derived history.
 * @param selection - `agentDefaultModel.currentSelection()`.
 * @returns the default route, or undefined when the service or its value is
 * unavailable.
 */
export declare function defaultRouteOf(selection: unknown): CommitModelRoute | undefined;
/**
 * Every provider/model route a session's log has actually USED, newest first
 * and de-duplicated: the newest `request/header` event wins, so the list is
 * the routes this deployment really dispatched on — the fallback a pinned
 * model picker can always offer, even when the harness advertises no catalog.
 * @param events - the session's log events (newest last).
 * @param limit - max routes to return.
 * @returns the distinct routes, newest first.
 */
export declare function collectModelRoutes(events: readonly {
    type?: unknown;
    data?: unknown;
}[], limit?: number): CommitModelRoute[];
/**
 * The Conventional-Commits prompt for one pending change set. Staged wins
 * upstream (it is exactly what `git commit` records); `files` is the matching
 * path list and `diff` the already-truncated patch text.
 * @param language - the panel locale ('zh' | 'en').
 * @param files - the changed paths the diff covers (repo-root relative).
 * @param diff - the patch text (truncate with {@link truncateDiff} first).
 * @returns the system and user halves, in that language.
 */
export declare function buildCommitPrompt(language: CommitPromptLanguage, files: readonly string[], diff: string): CommitPrompt;
/** Drop the model's prose scaffolding: fenced blocks, quotes and blank runs.
 *  Models routinely wrap a one-line commit message in a code fence despite
 *  the instruction; the panel inserts the text straight into the commit box,
 *  so anything but the message itself would land in the commit. */
export declare function cleanSuggestion(text: string): string;
