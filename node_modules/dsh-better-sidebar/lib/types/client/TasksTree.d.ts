/**
 * The tree mode of the Tasks page: the SAME unified model rendered as the
 * classic indentation tree — nested children on a hairline thread, the plugin's
 * row metrics (12px title / 11px mono meta), the left accent bar on the current
 * session, dashed fold rows, and the shared bottom-right control cluster (view
 * toggle + fold toggle) so switching back is always possible.
 *
 * Behaviour contract: `role="tree"` / `role="treeitem"` + `aria-level`, a
 * `[data-tasks-row]` focus order, ArrowUp / ArrowDown / Home / End focus moves,
 * Enter / Space activation, and the fold rows (a fold row reveals its OWN
 * group; the control cluster keeps the page-level switch).
 *
 * Readability: rows sit on the page's 32px rhythm (a 2px accent bar marks the
 * current session, hover is the native fill, settled rows recede), and every
 * line that can be ellipsised carries its full text as `title` — the label, the
 * workflow name and the fold previews.
 */
import { type ReactNode } from 'react';
import type { TasksAgentNode, TasksFoldNode, TasksNode, TasksWorkflowNode } from './tasks-model.ts';
export interface TasksTreeProps {
    nodes: readonly TasksNode[];
    folded: boolean;
    /**
     * Nodes whose SUBTREE the reader folded away (the tree's own disclosure, one
     * axis beside the page's settled-leaf rule). A parent not listed here shows
     * its children.
     */
    collapsedIds: ReadonlySet<string>;
    /** One row's disclosure control. */
    onToggleCollapse(nodeId: string): void;
    /** 全部收起: hide every subtree. */
    onCollapseAll(): void;
    /** 全部展开: show every subtree again. */
    onExpandAll(): void;
    onNodeInfo(node: TasksAgentNode, anchor: HTMLElement): void;
    onWorkflowInfo(node: TasksWorkflowNode, anchor: HTMLElement): void;
    /** Open the shared task window for one task id. */
    onOpenTask(taskId: string, anchor: HTMLElement): void;
    /** The control cluster's page-level fold switch. */
    onToggleFold(): void;
    /** A fold row's own click: reveal THIS group's members only. */
    onExpandGroup(node: TasksFoldNode): void;
    mode: 'graph' | 'tree';
    onModeChange(mode: 'graph' | 'tree'): void;
    /** Fallback loading row while the root catalog hydrates. */
    loading?: boolean;
}
export declare function TasksTree(props: TasksTreeProps): ReactNode;
