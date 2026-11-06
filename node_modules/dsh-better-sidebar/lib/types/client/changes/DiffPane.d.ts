/**
 * The changes tab's shared bottom preview pane: one selected target — a git
 * worktree change, a commit patch, or a session file op — rendered through
 * the unified diff stack (the same one the diff tab uses). Git targets load
 * through the shared {@link useGitDiffTarget} hook (refreshable, with the
 * untracked full-addition fallback); op targets are pure snapshots. The pane
 * is resizable by drag (clamped; the height commits to the tab's persisted
 * meta on release) and by keyboard; git targets can expand into a dedicated
 * diff tab via the shell.
 *
 * The pane's views are TABS, one per question: `content` answers "what is in
 * the file" (every read op, and the rendered view for md/html/pdf ops — the
 * plugin's renderers no longer hide behind a toggle inside the diff view),
 * `diff` answers "what changed" (git targets, write/edit ops), and extra
 * views the caller hosts (the graph commit's `details` card) sit ahead of
 * both. A read op has no `diff` tab — nothing changed. With one or zero tabs
 * the pane is byte-for-byte the strip-less preview of before.
 */
import { type ReactNode } from 'react';
import type { Context } from '../../context-types.ts';
import type { SessionScope } from '../api.ts';
import type { SidebarDiffRef, SidebarTab } from '../state.ts';
import { type FileOp } from './ops.ts';
/**
 * Clamp one pane height to the pane's own bounds: never below the content
 * minimum, never above 70% of the window. Both the drag handler and the
 * RESTORE path (a height persisted under a taller window) run through this,
 * so a saved value can never open the pane taller than the viewport allows.
 */
export declare function clampPaneHeight(value: number): number;
/** What the pane is showing right now. */
export type ChangesPreview = {
    kind: 'git';
    ref: SidebarDiffRef;
} | {
    kind: 'op';
    path: string;
    op: FileOp;
    prior?: string;
};
/** The render view of one html op target: the route-src iframe. Extracted
 *  (and exported) so the always-sandboxed contract is pinned directly by the
 *  sandbox spec — this surface has NO no-sandbox escape hatch. */
export declare function HtmlRenderPreview(props: {
    src: string;
    title: string;
}): import("react").JSX.Element;
/** One tab of the pane's optional strip. */
export interface PaneTab {
    readonly id: string;
    readonly label: string;
}
/**
 * A compact tab strip — a real tablist with roving focus: the active tab is
 * the only tab stop, and Left/Right/Home/End move focus AND selection (the
 * standard automatic-activation model). Born as the bottom pane's strip
 * (details / diff); the changes tab's header reuses it for the lens switcher
 * so the page's two switchers read as one component. Rendered only when the
 * caller hosts more than one view, so a diff-only preview never grows a strip.
 */
export declare function PaneTabStrip(props: {
    tabs: readonly PaneTab[];
    active: string;
    onSelect(id: string): void;
    className?: string;
    label?: string;
}): import("react").JSX.Element;
/** The diff tab a git preview expands into (the shell owns placement). */
export declare function diffTabOf(ref: SidebarDiffRef): SidebarTab;
export interface DiffPaneProps {
    target: ChangesPreview;
    ctx: Context;
    scope: SessionScope;
    /** The persisted pane height (px); drag commits a new one upwards. */
    height: number;
    onHeightCommit: (height: number) => void;
    onClose: () => void;
    /** Expand the current git target into a dedicated diff tab. */
    onExpand: () => void;
    /** The pane's views. The host may PIN the set (the changes tab pins
     *  details/content/diff so the panel is identical in every lens; a pinned
     *  id with nothing to show renders its empty state instead of vanishing).
     *  Omitted, the set is composed from what this target actually offers. */
    tabs?: readonly PaneTab[];
    /** Bodies for ids the pane does not build itself (the caller's views). */
    bodies?: Readonly<Record<string, ReactNode>>;
    /** The active tab id; an id not listed lands on the built-in home. */
    activeTab?: string;
    onSelectTab?(id: string): void;
}
export declare function DiffPane({ target, ctx, scope, height, onHeightCommit, onClose, onExpand, tabs, bodies, activeTab, onSelectTab }: DiffPaneProps): import("react").JSX.Element;
