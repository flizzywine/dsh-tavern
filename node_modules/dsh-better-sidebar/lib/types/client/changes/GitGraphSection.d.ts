/**
 * The Git lens's commit-graph area: read-only history, lazily paged, never
 * checking anything out. No status subscription and no timer — the section
 * unfolds, becomes visible, changes branch or takes a refresh tick, and those
 * are the only request triggers.
 *
 * Mounted by {@link GitLens} on the repo/worktree target the lens has already
 * selected; it owns its own bounded page (`git.graph`) and reports the
 * selected commit upward for the tab's bottom pane (`details` tab). */
import { type MouseEvent } from 'react';
import { api, type SessionScope } from '../api.ts';
import type { SidebarDiffRef } from '../state.ts';
type GraphPage = Awaited<ReturnType<typeof api.gitGraph>>;
/** One commit row of the graph page. */
export type GraphEntry = GraphPage['entries'][number];
/** The selected graph commit plus the render context only the lens owns: the
 *  remote ref names that tone the details card's ref pills, and the palette
 *  slot of the selected row's lane so the card's pills match the graph. */
export interface GraphDetailsSelection {
    readonly entry: GraphEntry;
    readonly remotes: ReadonlySet<string>;
    readonly slot: number;
}
export interface GitGraphSectionProps {
    scope: SessionScope;
    worktree?: string;
    visible: boolean;
    refreshTick?: number;
    onPreview: (ref: SidebarDiffRef) => void;
    selectedRef: SidebarDiffRef | null;
    onClearPreview?: () => void;
    /** The selected commit, reported upward for the changes tab's bottom pane
     *  (`details` tab). Fires on every selection change — a refresh that drops
     *  the entry included — and unmounting ends it at `null`. HIDING the lens
     *  deliberately does not clear it: the bottom pane is one region shared by
     *  all three lenses, independent of which lens is on top. */
    onDetailsChange?: (selection: GraphDetailsSelection | null) => void;
    /** Row context menu: the Git lens's advanced commit actions (view / copy /
     *  revert / cherry-pick). Absent, the rows simply carry no menu. */
    onContextMenu?: (event: MouseEvent<HTMLButtonElement>, entry: GraphEntry) => void;
}
/** HEAD is the local-current marker; remote refs read muted, local ones brand.
 *  Exported for {@link CommitDetails}, which renders the same pills. */
export declare function refTone(ref: string, remotes: ReadonlySet<string>): 'head' | 'remote' | 'local';
/** One ref pill's paint model: the display name, the tone rung and whether it
 *  carries the "currently checked out" check. */
export interface RefPillModel {
    readonly name: string;
    readonly tone: 'head' | 'remote' | 'local';
    readonly current: boolean;
}
/** The pills one entry's refs render as, in the refs' own order. A literal
 *  `HEAD` never becomes a pill of its own — it folds into the current local
 *  branch's pill as a leading check, the convention every graph tool shares
 *  (GitLens, GitKraken, …); only a DETACHED head renders it standalone. The
 *  current branch's pill takes the emphasised `head` tone. */
export declare function refPills(refs: readonly string[], remotes: ReadonlySet<string>): RefPillModel[];
/** One pill: the ref-kind icon (branch / remote globe) plus the name, with a
 *  leading check when this is the branch the worktree stands on. `slot` paints
 *  the pill in the commit's LANE colour (the same palette mapping the edges
 *  and the node dot resolve through), so a branch head is recognisable by
 *  colour alone. Shared by the graph rows, the hover card and the details
 *  card so a ref reads the same everywhere. */
export declare function RefPill({ pill, slot }: {
    pill: RefPillModel;
    slot?: number;
}): import("react").JSX.Element;
export declare function GitGraphSection({ scope, worktree, visible, refreshTick, onPreview, selectedRef, onClearPreview, onDetailsChange, onContextMenu }: GitGraphSectionProps): import("react").JSX.Element;
export {};
