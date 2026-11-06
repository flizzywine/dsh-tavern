/**
 * Unsaved-edit registry: which editor tabs currently hold a draft that
 * differs from disk. The editor host registers its tab's dirty state here
 * (the toolbar report already carries it), so the flows that would silently
 * drop the draft can ask first:
 *
 * - the sidebar's tab close (the X button, the middle click, the tab context
 *   menu, and the tree's close-on-rename/delete path all land there),
 * - the browser unload (refresh / close tab / navigate away) through a
 *   `beforeunload` guard.
 *
 * Module-level and keyed by `sessionId::tabId`: a tab id is unique only WITHIN
 * one session — the native right column counts its own `tab1`…, and the bottom
 * workbench reuses `editor:<path>` for the same file in every session. Keyed by
 * the bare tab id, session B's editor mounting over the same id DELETED session
 * A's record (its mount reports `dirty === false`), so A's still-live draft
 * outlived its guard and a refresh dropped it without a word. The native
 * surface accounts the same way (`viewKey`, native/tab-adapter.tsx).
 * An entry is written while a tab is dirty and deleted the moment it goes
 * clean (save) or its host unmounts (tab closed, in-place path switch), so a
 * stale entry can never keep a guard armed.
 */
/**
 * Publish one tab's dirty state: `true` registers the draft (session + path
 * ride along for scoped queries), `false` / `undefined` clears it.
 */
export declare function setEditorDirty(tabId: string, dirty: boolean, sessionId: string, path: string): void;
/**
 * Drop a tab's entry (its editor host unmounted). Idempotent.
 * @param sessionId - the owning session; omitted drops the id in EVERY session
 *  (the shape tests use for cleanup — a caller that knows its session should
 *  always name it, or it would clear a same-numbered tab elsewhere).
 */
export declare function clearEditorDirty(tabId: string, sessionId?: string): void;
/**
 * Whether one tab holds an unsaved draft.
 * @param sessionId - the owning session; omitted matches the id in any session
 *  (the conservative read: a caller that cannot name the session should still
 *  warn rather than pass a live draft through).
 */
export declare function isEditorDirty(tabId: string, sessionId?: string): boolean;
/** How many tabs hold unsaved drafts across every session (the unload guard). */
export declare function dirtyCount(): number;
/** Subscribe to dirty-set changes; returns the disposer. */
export declare function subscribeEditorDirty(listener: () => void): () => void;
/** The change counter (a stable `useSyncExternalStore` snapshot). */
export declare function editorDirtyRevision(): number;
/**
 * Ask before dropping `tabId`'s unsaved draft. Returns true when the caller
 * may proceed (the tab is clean, the user confirmed, or no `confirm` is
 * available — letting a tab become unclosable would be worse than skipping one
 * prompt). On confirm the entry is cleared immediately, so a follow-up close in
 * the same tick does not double-prompt; the editor host's own cleanup would do
 * it one commit later anyway.
 *
 * Shared by the sidebar's tab close and the file tree's close-on-delete so
 * both paths warn exactly once, with the same copy.
 * @param sessionId - the owning session (see {@link isEditorDirty} for the
 *  omitted case).
 */
export declare function confirmDiscardDraft(tabId: string, message: string, sessionId?: string): boolean;
