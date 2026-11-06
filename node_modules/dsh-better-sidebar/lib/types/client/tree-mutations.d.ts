/**
 * Open-tab reconciliation after a file-tree mutation (rename/delete).
 *
 * The tree owns the rows; the TABS live in TWO spaces: the bottom workbench's
 * split tree (the sidebar state) and — where files actually open by default —
 * DSH's native right Sidebar, whose records the store cannot see (they are
 * reported by {@link SidebarSurface.pathTabs}, read through the service). Both
 * are walked here: skipping the native one left every right-column editor bound
 * to the OLD path, so its next save wrote a name the user had just renamed away
 * (recreating it) and a deleted file came back with no prompt.
 *
 * A rename must retarget every tab at the renamed path — files, and anything
 * under a renamed directory (the same subtree rule the delete path already
 * had) — so the editor content survives and later saves land on the new path;
 * a delete must close every tab at or under the removed path. Both ride the
 * SERVICE paths (`updateTab`/`closeTab`) rather than direct state reducers so
 * the registered lifecycle callbacks fire like any other tab mutation.
 */
import type { Context } from '../context-types.ts';
import { type SidebarStore } from './state.ts';
/**
 * The rename-marker key for one tab: the session its editor runs in, plus the
 * tab id.
 *
 * Native tab ids restart per session — `tab1` exists in every conversation —
 * so the id alone is not an identity. Keyed by the id alone, two seats' editors
 * shared one marker, and an editor whose own path did NOT move (its effect
 * clears the marker it finds) wiped the other seat's pending move; that other
 * editor then reloaded the renamed file and dropped the draft this whole
 * mechanism exists to protect. The session half is the one the editor reads in
 * its `scope.sessionId`, so the writers here and the reader in `EditorHost`
 * build the same key.
 */
export declare function pathTabKey(sessionId: string, tabId: string): string;
/** Whether this exact move is one `key` has not applied yet. Consumes it: a
 *  tab that never sees the move must not swallow a later, unrelated one. */
export declare function consumeRetargetedPath(key: string, from: string, to: string): boolean;
/** Forget a key's pending retargets. Called where the announcement can no
 *  longer be claimed — the editor unmounted (a fresh mount loads the record's
 *  current path anyway), loaded something else, or its tab is being closed —
 *  so the map cannot grow for the life of the page. */
export declare function clearRetargetedPath(key: string): void;
/** Retarget tabs after `oldPath` became `newPath` (title follows the new
 *  base name, matching how openFile titles editor tabs).
 *
 *  Files and anything under a renamed DIRECTORY are retargeted — the same
 *  subtree rule the delete path uses. The move is announced through
 *  {@link markRetargetedPath} so the editor keeps its document (and an unsaved
 *  draft) instead of reloading the new name. */
export declare function retargetPathTabs(ctx: Context, store: SidebarStore, oldPath: string, newPath: string): void;
/** Close tabs at or under the removed `target` (a directory takes its whole
 *  subtree of open files with it). A tab holding an unsaved draft asks first
 *  (the same guard + copy as the sidebar's tab close); declining keeps the
 *  tab — which is the user's call for the bottom workbench, and stays a
 *  conflict-gated save on the native side, never a silent re-create.
 *
 *  The question is asked in the tab's OWN session: the draft registry is keyed
 *  by `sessionId::tabId`, so a bare id read would look up a same-numbered tab in
 *  some other session (or nothing at all) and close a live draft unprompted. */
export declare function closePathTabs(ctx: Context, store: SidebarStore, target: string, unsavedMessage: string): void;
