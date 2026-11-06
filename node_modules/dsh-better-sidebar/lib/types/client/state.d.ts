/**
 * Per-session sidebar state: the bottom workbench's split-pane tree, open
 * tabs, and the explorer expansion set. One state instance per conversation
 * id, persisted to localStorage under `dsh-sidebar:v1:<id>` so a reload
 * restores the exact layout of the session it belongs to — switching
 * conversations swaps the whole state (memory + isolation).
 *
 * The split tree is a recursive structure: a leaf holds a tab group, a split
 * divides the space row- or column-wise with fractional sizes. All tree
 * operations are pure functions over the node, unit-tested in tests/state.spec.ts.
 */
import { type SidebarPrefs } from '../prefs-shared.ts';
/**
 * Tab type identifier. Builtins register their ids (editor / git / terminal
 * / subagent / browser / diff) through the sidebar service; external
 * plugins register their own (e.g. `'my-plugin:db'`). Kept as `string` so
 * the registry stays open.
 */
export type TabType = string;
/** What a diff tab shows: a worktree/index change of one path, or one commit's full patch. */
export type SidebarDiffRef = {
    kind: 'worktree';
    path: string;
    staged: boolean;
    untracked?: boolean;
    worktree?: string;
    repoRoot?: string;
} | {
    kind: 'commit';
    hash: string;
    hashFull: string;
    subject: string;
    worktree?: string;
    repoRoot?: string;
};
/** One open tab. `path` carries the file (editor) or is absent (git/terminal);
 *  `diff` carries the change a diff tab shows; `meta` (v0.12.0+) carries
 *  plugin-owned JSON-serializable state, preserved across reloads. */
export interface SidebarTab {
    id: string;
    type: TabType;
    title: string;
    path?: string;
    /** The 1-based line a file reference named (`a/b.c#L131`, `a/b.c:131`).
     *  Transient by design: `sanitizePersistedTab` copies a whitelist of known
     *  fields, and this one is deliberately left out — a link's landing line is
     *  a one-shot navigation target, and a reload that yanked the reader back
     *  to a line they scrolled away from days ago would be worse than starting
     *  at the top. Same spirit as `revealed`. */
    line?: number;
    diff?: SidebarDiffRef;
    /** Plugin-owned state (v0.12.0+): MUST be JSON-serializable — it is
     *  persisted with the layout and restored verbatim on reload. */
    meta?: unknown;
}
/** A tab group. */
export interface SidebarLeaf {
    kind: 'leaf';
    id: string;
    tabs: SidebarTab[];
    active: string | null;
}
/** A recursive split between child panes (fractional sizes summing to 1). */
export interface SidebarSplit {
    kind: 'split';
    id: string;
    dir: 'row' | 'col';
    sizes: number[];
    children: SplitNode[];
}
export type SplitNode = SidebarLeaf | SidebarSplit;
/** The full per-session state. */
export interface SidebarState {
    /** The pane receiving newly opened tabs (the last pane the user touched). */
    activePane: string | null;
    /** Monotonic browser tab counter (ids survive reloads). */
    nextBrowser: number;
    /** Explorer expansion set (absolute directory paths). */
    expanded: string[];
    /**
     * Explorer rows highlighted by a "Show in folder" reveal (absolute paths).
     * Transient by design: sanitizeState never restores it, so a reload starts
     * unhighlighted.
     */
    revealed: string[];
    /**
     * Tab types whose page the reader has not looked at yet: written when a
     * background activation opens its page WITHOUT taking the column over
     * (src/client/sidebar/use-host-feeds.ts) and cleared the moment that page
     * becomes the one on screen. Deliberately NOT transient — it survives the
     * tab body's unmount, a session switch and a reload, because an unread page
     * stays unread until it is read.
     */
    unread: TabType[];
    /** Whether the bottom panel (the plugin's one workbench) is open. */
    bottomOpen: boolean;
    /** The bottom panel's height (clamped to the contract range). */
    bottomHeight: number;
    /** The bottom workbench's split tree. */
    bottomSplits: SplitNode;
}
export declare const TAB_MAX_WIDTH = 160;
/** Bottom panel geometry contract (the upper bound is the viewport, enforced
 *  by {@link setBottomHeight}). */
export declare const BOTTOM_MIN = 120;
export declare const BOTTOM_DEFAULT = 220;
/** The conversation column keeps at least this much height when the bottom
 *  workbench claims space (see {@link setBottomHeight}). */
export declare const CONVERSATION_MIN = 280;
/** Mint a fresh uid-based tab id. The `'editor:' + path` convention only
 *  covers openSidebarFile opens (per-path dedupe); opens that must not
 *  dedupe (the tree's "open to the side") mint through here. */
export declare function mintTabId(): string;
/**
 * A fresh default state: one empty pane in the bottom workbench, closed.
 * (The right column belongs to DSH's native Sidebar, so this plugin's own
 * layout has nothing to seed — its welcome cards offer the openable types on
 * first expansion.)
 */
export declare function makeDefaultState(): SidebarState;
/** Walk the tree and apply `visit` to the leaf with the given id. */
export declare function mapLeaf(node: SplitNode, paneId: string, visit: (leaf: SidebarLeaf) => void): SplitNode;
/** The first leaf of the tree (fallback pane when activePane is gone). */
export declare function firstLeaf(node: SplitNode): SidebarLeaf;
/** Find the leaf containing a tab id, if any. */
export declare function leafWithTab(node: SplitNode, tabId: string): SidebarLeaf | undefined;
/** All leaves of the tree, depth-first. */
export declare function allLeaves(node: SplitNode): SidebarLeaf[];
/** Whether a tab is open anywhere in the session's workbench. */
export declare function tabOpenIn(state: SidebarState, tabId: string): boolean;
/** Replace a leaf with a split of it plus a fresh empty leaf. */
export declare function splitLeafAt(node: SplitNode, paneId: string, dir: 'row' | 'col'): SplitNode;
/**
 * Split a leaf by inserting a fresh leaf holding `tab` beside it — the
 * VSCode drag-to-edge gesture. `dir` is the split direction ('row' for
 * left/right, 'col' for up/down); `front` places the new leaf first (left/
 * up) or second (right/down).
 * @returns the new tree plus the fresh leaf's id (the drop's active pane).
 */
export declare function insertLeafAt(node: SplitNode, paneId: string, dir: 'row' | 'col', tab: SidebarTab, front: boolean): {
    node: SplitNode;
    leafId: string;
};
/** Where a tab drop lands on a pane: an edge creates a split, center merges. */
export type DropZone = 'left' | 'right' | 'up' | 'down' | 'center';
/**
 * The VSCode drag gesture: move a tab out of its pane and either merge it
 * into the target pane (center) or split the target pane with the tab in a
 * fresh leaf (edge). The source pane collapses when it empties.
 */
export declare function moveTabToEdge(state: SidebarState, fromPane: string, tabId: string, toPane: string, zone: DropZone): SidebarState;
/**
 * Remove a leaf from the tree. A split left with one child promotes that
 * child; removing the last leaf yields an empty leaf.
 */
export declare function removeLeafAt(node: SplitNode, paneId: string): SplitNode;
/** Close a tab; an emptied leaf is removed (unless it is the only pane). */
export declare function closeTab(state: SidebarState, paneId: string, tabId: string): SidebarState;
/** Activate a tab in its pane (the pane's own tree). */
export declare function activateTab(state: SidebarState, paneId: string, tabId: string): SidebarState;
/**
 * Mark one tab TYPE as having a page the reader has not looked at yet (the
 * dot drawn on its tab). Identity-preserving when it is already marked, so a
 * repeat activation does not churn the store (and therefore localStorage).
 */
export declare function markUnread(state: SidebarState, type: TabType): SidebarState;
/** Clear one tab type's unread mark (the reader just looked at its page). */
export declare function clearUnread(state: SidebarState, type: TabType): SidebarState;
/** Whether one tab type is currently marked unread. */
export declare function isUnread(state: SidebarState | undefined, type: TabType): boolean;
/** Update the display fields of one open tab (title / path / meta) without
 *  re-opening it. The browser tab persists its current URL and hostname
 *  title through this reducer so a reload restores the visited page. A
 *  missing tab id is a no-op. The tab may live in either tree or a free
 *  window.
 *
 *  A PATH CHANGE is a new open: the transient landing line (#826) is dropped
 *  with it. `line` belongs to the navigation that delivered the file, not to
 *  the tab — an in-place switch or a rename that kept it would send the next
 *  file to the previous file's line (and force a markdown file into the
 *  editor, which is how the reader gets stuck). */
export declare function patchTab(state: SidebarState, tabId: string, patch: {
    title?: string;
    path?: string;
    meta?: unknown;
}): SidebarState;
/**
 * Land a tab in the workbench's first pane — the plugin's own opens (its
 * bottom-panel + menu, and every open when no native surface is installed):
 * the plugin owns no right column any more (DSH's native sidebar is the
 * right one), so the bottom workbench is the only tree.
 * @param state - the session state.
 * @param tab - the tab to land.
 * @returns the next state, with the bottom panel open.
 */
export declare function openTabInBottomPane(state: SidebarState, tab: SidebarTab): SidebarState;
/** Move a tab from one pane to another (insert at index; -1 appends).
 *  The panes may live in DIFFERENT trees — dragging a tab between the two
 *  panels removes it from its own tree and lands it in the other one. */
export declare function moveTab(state: SidebarState, fromPane: string, tabId: string, toPane: string, index?: number): SidebarState;
/** Split the active pane (or the pane containing the active tab). */
export declare function splitPane(state: SidebarState, dir: 'row' | 'col'): SidebarState;
/**
 * Open a diff tab the VSCode way: an existing instance of the same change is
 * focused wherever it lives; otherwise the tab joins the first pane that
 * already holds diff tabs (diff panes are sticky — repeated clicks stack
 * there); on the FIRST diff of a layout the source pane splits vertically so
 * the diff lands in a fresh pane below it ("默认在下半栏新增一个").
 *
 * This is split-tree placement surgery, not registry dispatch: the diff tab
 * descriptor's `dedupeKey` is `(tab) => tab.id`, and the existing-instance
 * check below is exactly that rule — the two agree by construction (asserted
 * in tests). Diff tabs minted by the Git view carry change-derived ids, so
 * the id check is the per-change dedupe.
 * @returns the new state, with the diff pane active.
 */
export declare function openDiffTab(state: SidebarState, sourcePaneId: string, tab: SidebarTab): SidebarState;
/** Expand/collapse the bottom workbench. */
export declare function toggleBottomPanel(state: SidebarState): SidebarState;
/** Set the bottom workbench height (clamped to the contract range). The
 * upper bound leaves the conversation column at least {@link CONVERSATION_MIN}
 * tall — without the cap the workbench could swallow the whole viewport and
 * squeeze the conversation to zero height. */
export declare function setBottomHeight(state: SidebarState, height: number): SidebarState;
/** Toggle a directory in the explorer expansion set. */
export declare function toggleExpanded(state: SidebarState, path: string): SidebarState;
/**
 * The absolute ancestor directories between the explorer root (`cwd`) and each
 * given path, EXCLUDING the paths themselves: the levels a lazy tree must have
 * expanded before those rows can exist. Empty strings and non-strings are
 * skipped; the result is de-duplicated in first-seen order.
 * @param cwd - the explorer's root (session working directory).
 * @param files - absolute paths whose ancestors are wanted.
 */
export declare function ancestorDirs(cwd: string | undefined, files: readonly string[]): string[];
/**
 * Reveal files in the explorer: expand every ancestor directory between the
 * explorer root and each file (so the lazy tree actually shows the row) and
 * record the paths for highlighting. The reveal set is transient —
 * sanitizeState never restores it, so a reload starts unhighlighted.
 * @param state - current sidebar state.
 * @param cwd - the explorer's root (session working directory).
 * @param files - absolute paths to highlight (parent dirs are expanded).
 * @returns the next state, or the same reference when nothing is revealed.
 */
export declare function revealPaths(state: SidebarState, cwd: string | undefined, files: readonly string[]): SidebarState;
/** Adjust one split divider: `i` is the left/top child index, delta in fractions. */
export declare function resizeSplit(node: SplitNode, splitId: string, index: number, delta: number): SplitNode;
/** State-level {@link resizeSplit} route: the divider may live in either
 *  tree (split ids are globally unique). */
export declare function resizeSplitIn(state: SidebarState, splitId: string, index: number, delta: number): SidebarState;
/**
 * Cross-session panel width: the last dragged width, shared by EVERY
 * conversation (the panel width is a layout preference, not per-session
 * content). Written on every persist, read at session load and on
 * cache-hit session switches, so a drag in one conversation carries to all
 * the others (last drag wins).
 */
/** Immutable snapshot handed to React (replaced only on real changes). */
export interface SidebarSnapshot {
    sessionId: string | undefined;
    state: SidebarState | undefined;
    /**
     * The current side card prefs. Carried IN the snapshot (not a separate
     * subscription) so prefs changes re-render the consumers that gate on
     * them — the + menu hides a tab type the moment its switch flips.
     */
    prefs: SidebarPrefs;
}
/**
 * Structural validation of one persisted state. A malformed or stale shape
 * (older layouts, hand-edited storage) must fall back to the default instead
 * of crashing the panel on every reload; the restored width is also clamped
 * to the current viewport so a stale fullscreen width can never crush the
 * app shell (margin-right larger than the window) or cover the whole screen.
 * @returns a clean state, or undefined to fall back to the default.
 */
export declare function sanitizeState(parsed: unknown): SidebarState | undefined;
/** The session-scoped store: one state per conversation, localStorage-backed. */
export declare class SidebarStore {
    private readonly bySession;
    private snapshot;
    private readonly listeners;
    /** Per-session persist debounce timers (v0.12.0+: one per session, so a
     *  targeted open never cancels another session's pending write). */
    private readonly persistTimers;
    /**
     * The `getSessionStates()` answer, rebuilt on the next read after a write.
     * Callers use the map as a memo input / `useSyncExternalStore` value, so a
     * fresh copy per call invalidated every downstream memo on each render.
     */
    private sessionStatesCache;
    /** User-facing side card prefs seeding brand-new session states (defaults until the settings RPC resolves). */
    private prefs;
    /**
     * External disable (the dsh-web-ui family's aionui-panel provider choice):
     * while true the sidebar must not mount at all. Not part of the snapshot —
     * nothing renders on it; the mount gate and the intercept predicates read
     * it directly.
     */
    private suspended;
    /**
     * Set the external-disable flag (from the settings route) and remember it
     * for the mount gate and the intercept predicates.
     */
    setSuspended(suspended: boolean): void;
    /** Whether the sidebar is externally disabled (aionui-panel chosen). */
    getSuspended(): boolean;
    /**
     * Replace the side card prefs (the settings RPC result / settings page
     * write). Notifies like any store change: the snapshot carries the prefs,
     * so consumers that gate on enable switches (the + menu, derived flows)
     * re-render with the new values immediately.
     */
    setPrefs(prefs: SidebarPrefs): void;
    /** The current side card prefs (seeds new sessions; persisted states win). */
    getPrefs(): SidebarPrefs;
    /** Select a session (or none); loads its persisted state. */
    setSession(sessionId: string | undefined): void;
    subscribe(listener: () => void): () => void;
    /**
     * Mark one tab type as unread in the CURRENT session (the dot on its tab).
     *
     * Reached from the background-activation path alone, so it refuses to
     * notify when there is nothing to draw: a repeat mark keeps the state
     * reference AND skips the listener fan-out, which is what lets a test (and
     * the render path) treat a notification as "the marker really changed".
     * Returns whether the marker was set.
     */
    markUnread(type: TabType): boolean;
    /**
     * Clear one tab type's unread mark in a NAMED session — the reader switched
     * to that page. The current session goes through the publishing path (the
     * dot has to disappear from the shell AND from the native chip, both of
     * which read the published snapshot); a session that is not on screen takes
     * the targeted path, which publishes nothing: its stored state is updated so
     * the mark is already gone when the reader switches to it.
     *
     * `reduceFor` is deliberately not used for the current session: it never
     * touches the published snapshot, so reading the mark back (or rendering
     * from it) would keep seeing the old value.
     *
     * A type that is not marked is a strict no-op in both paths — no notify, no
     * persist — so a carrier can call this on every visibility change.
     * Returns whether a mark was cleared.
     */
    clearUnread(type: TabType, sessionId?: string): boolean;
    getSnapshot(): SidebarSnapshot;
    /** Mutate the current session's state (no-op without a session). */
    update(mutator: (draft: SidebarState) => void): void;
    /**
     * Whether a tab still exists in its session's state. Views use this on
     * unmount to tell "the tab was closed" (release the terminal now) from
     * "the tree re-rendered / the conversation switched" (the tab is still
     * open — keep the terminal alive through the host's reconnect grace).
     * Checks the session's own map entry (the current snapshot may already
     * point at another session when a conversation switch unmounts the old
     * one's tabs).
     */
    tabOpen(sessionId: string, tabId: string): boolean;
    /**
     * One session's cached state, or `undefined` when it has never been loaded
     * in this run (see {@link getSessionStates} for the whole map). The
     * reference is STABLE while nothing writes that session — the store's state
     * objects are immutable and replaced wholesale — so a hot reader may use it
     * as a memo input instead of copying the whole map per render.
     */
    getSessionState(sessionId: string): SidebarState | undefined;
    /**
     * Read-only view of EVERY cached session's state (v0.17.0+): the whole-map
     * read, for a caller that needs several sessions at once (a per-session
     * question should use {@link getSessionState} — it does not allocate).
     * Callers MUST treat the returned map as read-only (mutations go through
     * {@link reduce} / {@link reduceFor}); it is a cached SNAPSHOT, invalidated
     * by the next write, so two reads with no write between them return the same
     * object — a fresh copy per call invalidated every consumer's memo on every
     * render. A session that has never been visited in this run is absent (its
     * pinned tabs are not visible until first load — accepted as YAGNI by the
     * design), and the same is true of a session evicted by the retention cap
     * ({@link SESSION_STATE_CAP}) until it is loaded again.
     */
    getSessionStates(): ReadonlyMap<string, SidebarState>;
    /** Apply a pure reducer (returns the next state). */
    reduce(reducer: (state: SidebarState) => SidebarState): void;
    /**
     * Apply a pure reducer to a TARGET session's state (not the active one),
     * loading it on demand and persisting the result — WITHOUT switching the
     * active snapshot or notifying (the UI must not follow along). Used by the
     * service's targeted `openTab(seed, scope)`: the open lands in the target
     * session's layout and is visible whenever the user switches to it.
     */
    reduceFor(sessionId: string, reducer: (state: SidebarState) => SidebarState): void;
    /**
     * Record one session's state: refresh its recency and bound the map.
     * Every write to `bySession` goes through here, so the LRU order and the
     * `getSessionStates()` snapshot stay in step with the entries.
     */
    private putSession;
    /**
     * Drop the least recently touched sessions beyond {@link SESSION_STATE_CAP}.
     * The current session is never dropped, and an evicted session's state is
     * not lost: it lives in localStorage, so the next `setSession` reloads it.
     */
    private evictSessions;
    /**
     * Write one session's state NOW instead of waiting for its debounce timer.
     * Eviction flushes before dropping an entry: the in-memory copy is what the
     * reader sees until they switch back, and a pending write that landed after
     * a switch-back would leave the reloaded state behind the storage one.
     */
    private flushPersist;
    private writePersisted;
    private schedulePersist;
    /**
     * Fan one store change out to every subscribed listener. A throwing
     * listener is CONTAINED instead of aborting the loop.
     *
     * `service.subscribeState` hands this store's own `subscribe` to consumer
     * plugins, and `notify()` runs inline in whatever call site mutated the
     * store — `setSession` from the Sidebar's mount effect, `reduce` from a
     * click handler. An exception escaping here therefore surfaces as a
     * render/commit-phase error, and the shell's ROOT RenderBoundary swaps the
     * ENTIRE sidebar for its error strip: one plugin misreading a field this
     * store no longer carries (0.19.0 dropped the right column's `splits`
     * tree) takes the panel down for every other plugin and for the user.
     *
     * Isolating per listener also keeps the remaining listeners running —
     * React's own useSyncExternalStore callback shares this loop, so a crash
     * in one subscriber no longer costs the healthy ones their re-render.
     */
    private notify;
}
/**
 * Create one sidebar store instance. Production code calls this only from
 * the client plugin's `apply` (the instance is handed to components as a
 * prop); tests call it directly. No module-level singleton: the store's
 * lifetime belongs to the plugin activation, exactly like the official
 * `createXXXStore()` factory rule.
 */
export declare function createSidebarStore(): SidebarStore;
