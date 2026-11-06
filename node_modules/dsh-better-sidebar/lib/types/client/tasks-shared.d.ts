/**
 * Shared presentation bits of the Tasks page's two modes (graph + tree):
 * the state dot, the agent/workflow/task GLYPHS (host primitive icons — the
 * page draws no glyphs of its own), the short mono meta line, the node task
 * line, and the iconified live activity row ("activity glyph + wording").
 *
 * Card content contract (the page's answer to "everything is ellipsized"):
 *   line 1  state dot + agent icon + name   (11px semibold, one line)
 *   line 2  mode/model · activity           (9px mono, one line)
 *   line 3  live activity line              (running nodes only)
 *   line 4  owned shared task               (team members only)
 * Everything else lives in the popovers.
 *
 * {@link activityLine} is the ONE rule that resolves a node's merged activity
 * wording: the card's bottom bar and the node detail popover both read it, so
 * the two surfaces can never disagree about what a node is doing.
 */
import type { ReactNode } from 'react';
import { type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives';
import type { SidebarChildLiveView } from '../context-types.ts';
import type { TasksAgentNode, TasksFoldNode, TasksNodeState, TasksNodeTask, TasksWorkflowNode } from './tasks-model.ts';
import { type CopyKey } from './locales.ts';
/** The host StateDot semantic of a node display state. */
export declare function nodeDotState(state: TasksNodeState): StateDotState;
/** The short state word of a node (the meta line's second token). */
export declare function stateLabel(state: TasksNodeState): string;
/**
 * The merged activity line of one agent node — the ONE rule both surfaces
 * read (the card's bottom bar and the node detail popover).
 *
 * - a RUNNING node shows the host's own live wording for its newest range
 *   ("正在读取文件 · main.ts"), which is what the main conversation shows for
 *   the same work;
 * - a settled one shows the same summary in its completed form (the host's
 *   `done.*` phrasing) — running wording on a finished node would claim it is
 *   analysing something it already answered;
 * - a node the live channel carries NO summary for answers undefined, and the
 *   callers fall back to the state word. That case must stay distinguishable:
 *   the host's `thinking` wording is what a range with nothing dispatched
 *   reads as, not what "we know nothing about this node" reads as.
 */
export declare function activityLine(node: TasksAgentNode): string | undefined;
/**
 * The two facts every task display rule reads. Deliberately NARROWER than
 * either carrier (`TasksNodeTask` on the graph, `SidebarTeamTaskView` in the
 * board and the task window) so one rule serves all of them — the window sees
 * a `deleted` status the graph never draws, and only the shared rule needs to
 * know that a deleted task is not "blocked".
 */
export interface TaskStatusFacts {
    status: 'pending' | 'in_progress' | 'completed' | 'deleted';
    ready: boolean;
}
/** The task status label key. */
export declare function taskStatusKey(status: TaskStatusFacts['status']): CopyKey;
/**
 * Whether a shared task is HELD UP by its blockers.
 *
 * The service's `ready` flag means exactly one thing: "a pending task whose
 * every blocker completed, so it can be CLAIMED". It is therefore false for
 * every task that is not queued — which makes `!ready` the wrong test for
 * "blocked": a claimed task (in_progress) and a finished one both report
 * `ready: false`, and reading the flag alone labelled a task that is actively
 * being worked on as 阻塞 (reproduced on the real board: claiming a task made
 * its Tag flip from 待办 to 阻塞).
 */
export declare function taskBlocked(task: TaskStatusFacts): boolean;
/** The status word of a task row: its own status, or 阻塞 when held up. */
export declare function taskStatusLabel(task: TaskStatusFacts): string;
/** The tone of a task's status Tag (or dot) — the same three-way rule. */
export declare function taskTone(task: TaskStatusFacts): 'success' | 'info' | 'warning';
/** The host StateDot semantic of a task row/line. */
export declare function taskDotState(task: TaskStatusFacts): StateDotState;
/** First `limit` characters with an ellipsis when truncated. */
export declare function preview(text: string, limit?: number): string;
/** Collapse whitespace for single-line previews. */
export declare function flatten(text: string): string;
/** The host icon of one agent node (the lead and plain children share one). */
export declare function AgentGlyph(props: {
    node: TasksAgentNode;
    size?: number;
}): ReactNode;
/** The workflow-run glyph. */
export declare function WorkflowGlyph(props: {
    size?: number;
}): ReactNode;
/** The fold aggregate glyph. */
export declare function FoldGlyph(props: {
    size?: number;
}): ReactNode;
/**
 * The mode word of one catalog row, or undefined when it names no mode. DSH
 * 0.1.7 added `unknown` (a child the host's catalog fold kept without a
 * readable descriptor): it claims NEITHER mode, so the segment is omitted
 * rather than mislabelled.
 */
export declare function modeLabel(mode: TasksAgentNode['mode']): string | undefined;
/**
 * The mono meta line of an agent card — at most two short tokens:
 * - the topology root: 主代理 · 状态
 * - any other agent: 模式 · 状态 (a teammate without a catalog mode falls back
 *   to its team role, the one durable identity the roster still carries — the
 *   `agentTeam` projection has no model field to print, see team-projection.ts)
 */
export declare function agentMeta(node: TasksAgentNode): string;
/**
 * The identity CHIP of an agent card: the word that rides BESIDE the kind badge
 * (一次性 / 可持续), or the one team state the badge cannot express (准备中 /
 * 出错).
 *
 * It is a chip and not a line of its own because the mode is the same word on
 * every card of its kind: as a mono meta line it cost a 16px row to repeat
 * itself, and the reader's report was exactly "模型一次性的子代理一直显示一次性".
 * A plain teammate answers undefined — the badge already reads 成员 — and the
 * root answers undefined too (its badge reads 主代理).
 *
 * The state stays out of it: the card's bottom bar carries it (its dot, and its
 * word whenever no activity line takes that place), and the accessible name
 * keeps {@link agentMeta} with the state included, because a screen reader
 * never sees the bar's dot.
 */
export declare function agentChip(node: TasksAgentNode): string | undefined;
/** The mono meta line of a workflow run card: status · member tally. */
export declare function workflowMeta(node: TasksWorkflowNode): string;
/** The workflow run status label key. */
export declare function workflowStatusKey(status: TasksWorkflowNode['run']['status']): CopyKey;
/** The task a node surfaces first: in-progress, else pending, else the last. */
export declare function primaryTask(tasks: readonly TasksNodeTask[]): TasksNodeTask | undefined;
/**
 * The node's shared-task line: an icon, the primary task's subject, its
 * status word, and a `+N` tail when the agent owns more. Renders nothing
 * without tasks, so non-team nodes keep the three-line shape.
 */
export declare function TaskLine(props: {
    tasks: readonly TasksNodeTask[] | undefined;
    onOpenTask(taskId: string, anchor: HTMLElement): void;
}): ReactNode;
/**
 * The live activity row of a RUNNING agent: the merged process summary the
 * main conversation would show for the child's newest range (category wording
 * + the running call's detail), plus the flattened last text line underneath.
 * A running node with neither reads as thinking.
 *
 * The glyph follows the summary's own CATEGORY (the host's `ProcessActivity`),
 * so "正在读取文件" is prefixed by the read family and "正在运行命令" by the
 * command one — one fixed glyph made every row claim to be a shell command.
 */
export declare function LiveLine(props: {
    live: SidebarChildLiveView | undefined;
}): ReactNode;
/**
 * The fold aggregate's name line: two label previews, plus `+N` when the group
 * holds more.
 *
 * A roster aggregate can swallow dozens of members, and the card has one line
 * for them. Naming two and saying how many are left over is what keeps that
 * line honest at any size — the exact `+N` the team task line already uses,
 * not a second convention. The group's total is also on the badge, so `+N` is
 * a tail, never the only count.
 *
 * @param previews - member labels, in page order (see {@link TasksFoldNode.previews}).
 * @param count - how many members the group holds in total.
 */
export declare function foldPreviews(previews: readonly string[], count: number): string;
/**
 * The fold aggregate's failures, as its own line: `出错 N`, or undefined when
 * the group has none. The `done` row's bottom bar prints exactly this and
 * nothing else, because the badge above it already carries the count
 * (`✓ N 已完成`) — the same number twice on a 190px card was one of them
 * saying it again.
 */
export declare function foldErrorTally(node: TasksFoldNode): string | undefined;
/**
 * The fold aggregate's full tally (its accessible name and tooltip).
 *
 * The two groups read differently on purpose. The `done` row counts its
 * finished members and calls out failures beside them (`✓ 4 已完成 · 出错 1`
 * — a row of nothing but failures is `出错 N`), because "✓ N 已完成" alone
 * would quietly include them. The `idle` row says what the members are doing
 * now: nothing (`N 待命`), which is why they were swept away.
 *
 * The VISIBLE surfaces split this differently: the graph card's badge carries
 * the count and its bar carries {@link foldErrorTally}, so the tally's count
 * half is printed once. This full string stays the accessible name — a screen
 * reader never sees the badge.
 */
export declare function foldTally(node: TasksFoldNode): string;
