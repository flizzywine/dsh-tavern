import type { Context } from '../../context-types.ts';
import type { SessionScope } from '../api.ts';
import { type GraphDetailsSelection } from './GitGraphSection.tsx';
import type { SidebarDiffRef, SidebarStore } from '../state.ts';
/**
 * How many scopes' commit drafts are remembered. The lens is a kept-mounted tab
 * body, so this record lives for the page: without a bound, a session that
 * walked through many projects would pin one message per project forever.
 */
export declare const COMMIT_DRAFT_CAP = 32;
/**
 * Write one scope's draft into the record, remembering at most
 * {@link COMMIT_DRAFT_CAP} scopes. Re-writing a key moves it to the back, so
 * the draft evicted past the cap is the scope typed into longest ago — a typed
 * message for another project is never what a commit here submits (the record
 * is keyed by scope, and `commit()` reads only its own key).
 *
 * @param prev - the current record (never mutated).
 * @param key - the scope key (session + cwd).
 * @param text - the draft (`''` = cleared; the key stays, so it reads back as
 *  an empty box rather than as a missing one).
 * @returns the next record.
 */
export declare function withCommitDraft(prev: Record<string, string>, key: string, text: string): Record<string, string>;
export interface GitLensProps {
    scope: SessionScope;
    /** @deprecated The sidebar store is no longer read here (the fence guard it
     *  fed is gone); the prop stays for the caller's shape. */
    store: SidebarStore;
    onOpenFile: (path: string) => void;
    /** Preview one change in the shared bottom pane (worktree or commit ref). */
    onPreview: (ref: SidebarDiffRef) => void;
    /** The ref currently previewed (row highlight); null when the pane is closed. */
    selectedRef: SidebarDiffRef | null;
    /** Preview one commit the GRAPH selected. Unlike a change-row preview this
     *  does not move the bottom pane to `diff`: the FIRST graph selection lands
     *  on `details` (the tab decides when the entry arrives). Defaults to
     *  {@link GitLensProps.onPreview}. */
    onGraphPreview?: (ref: SidebarDiffRef) => void;
    /** Drop a preview whose commit left the graph (a refresh that lost the row). */
    onClearPreview?: () => void;
    /** The graph's selected commit, reported upward for the tab's bottom pane
     *  (`details` tab, see {@link CommitDetails}). Null when nothing is selected
     *  there; a HIDDEN graph keeps its report, the pane below is shared. */
    onDetailsChange?: (selection: GraphDetailsSelection | null) => void;
    /** The tab is on screen: the lens retains its store slot. */
    visible: boolean;
    /** THIS lens is the one on screen inside the tab. A hidden (retained) lens
     *  neither polls nor keeps fetching — only its state is kept. */
    active?: boolean;
    /** The tab's context, for the registered file/folder icon chain (absent →
     *  the host's built-in artwork, exactly like the file tree falls back). */
    ctx?: Context;
}
export declare function GitLens(props: GitLensProps): import("react").JSX.Element;
