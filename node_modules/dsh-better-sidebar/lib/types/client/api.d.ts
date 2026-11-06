import type { SidechatLiveEvent, SidechatLogEvent, SidechatModelCatalog, SidechatModelSelection, SidechatPendingInput, SidechatThreadInfo } from '../sidechat-core.ts';
import type { SidebarCreateTeamTaskRequest, SidebarChildLiveView, SidebarSessionEvent, SidebarTeamTaskView, SidebarUpdateTeamTaskRequest } from '../context-types.ts';
import type { WorkflowRunView } from '../workflow-runs.ts';
import type { GitGraphOptions, GitGraphResult } from '../git-graph.ts';
export type { GitGraphOptions, GitGraphResult, GitGraphEntry, GitGraphBranch } from '../git-graph.ts';
/** One wire failure. */
export declare class SidebarApiError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Explorer row (host fs-tree shape). */
export interface FsEntry {
    name: string;
    path: string;
    isDir: boolean;
    hidden: boolean;
    /** Whether the row is a symlink; `isDir` then describes the link's target. */
    isSymlink: boolean;
    /** For symlinks: the target is missing or unreadable (stat failed). */
    broken: boolean;
    /** Directory rows only: the contents are exactly one non-symlink child
     *  — the explorer folds such chains into one breadcrumb row. */
    compact?: boolean;
}
/** One level of a `fs.trees` batch: a listing, or that level's failure. */
export interface FsLevel {
    path: string;
    entries: FsEntry[];
    truncated: boolean;
    /** Present only when THIS level failed (the batch itself succeeded). */
    error?: string;
}
/** One changed path's line-count summary (host git shape, mirroring
 *  `GitLineCounts` in `src/git.ts`). A binary change is its own variant: git
 *  reports `-`/`-` for it, so there are no counts to show. */
export type GitLineCounts = {
    additions: number;
    deletions: number;
} | {
    binary: true;
};
/** Git status entry (host git shape). */
export interface GitStatusEntry {
    path: string;
    xy: string;
    /** Lines gained/lost on the INDEX side (index vs HEAD). ABSENT when git has
     *  no numstat row for the path on that side — an untracked file has none — so
     *  the row must not read that absence as `0`. */
    staged?: GitLineCounts;
    /** Lines gained/lost on the WORKTREE side (worktree vs index) — a separate
     *  reading, never one summed number. */
    unstaged?: GitLineCounts;
}
/** Git status snapshot. */
export interface GitStatusResult {
    isRepo: boolean;
    /** Absent when HEAD is detached; unborn branches keep their real name. */
    branch?: string;
    /** Native tracking ref (e.g. origin/main); never inferred from a remote. */
    upstream?: string;
    /** Present only when Git can compare HEAD with the tracking ref. */
    ahead?: number;
    behind?: number;
    detached?: boolean;
    operation?: 'merge' | 'rebase';
    entries: GitStatusEntry[];
    /** True when the host capped `entries` (huge untracked set); the panel
     *  shows a truncation notice instead of freezing (#369). */
    truncated?: boolean;
    root?: string;
    repositories?: string[];
}
/** One linked Git checkout. */
export interface GitWorktree {
    path: string;
    branch: string;
    current: boolean;
    changes: number;
}
/** One model a provider advertises (the pinned commit-message dropdown). */
export interface GitModelInfo {
    /** Provider-side model id (dispatched verbatim). */
    id: string;
    /** Display name; equals `id` when the adapter reports none. */
    name: string;
}
/** One provider route with the models its adapter advertises. */
export interface GitModelProvider {
    provider: string;
    name: string;
    models: GitModelInfo[];
}
/** The model catalog `git.models` answers with. It merges three sources so
 *  the picker is usable even before a conversation has run:
 *  - `providers`: the adapters' own catalog (`llm.listModels`),
 *  - `recent`: routes THIS session already used (newest first),
 *  - `default`: the harness default selection (`agent-default-model`), which
 *    exists without any session at all.
 *  `llm` says whether the harness exposes an LLM surface: an empty catalog is
 *  then "no adapters registered", not "the route failed". */
export interface GitModelCatalog {
    llm: boolean;
    providers: GitModelProvider[];
    recent: GitModelRoute[];
    default?: GitModelRoute;
}
/** One pinned-model value: the route the host dispatches on. */
export interface GitModelRoute {
    provider: string;
    model: string;
}
/** One git log row. */
export interface GitLogEntry {
    /** Short hash (7+ chars, display). */
    hash: string;
    /** Full 40-char hash (advanced operations). */
    hashFull: string;
    /** Full parent hashes in Git's order; root commits have none. */
    parents: string[];
    subject: string;
    author: string;
    /** ISO 8601 author date (`%ai`). */
    date: string;
    /** Ref decorations (--decorate=short), e.g. `HEAD -> main, origin/main`; '' when none. */
    refs: string;
}
/** One `git blame --porcelain` row (the editor's hover blame). */
export interface GitBlameLine {
    /** 1-based line number in the file as it exists in the worktree. */
    line: number;
    /** The blamed commit (40 hex chars; all zeros for an uncommitted line). */
    hash: string;
    author: string;
    /** ISO 8601 author time carrying the author's own UTC offset. */
    date: string;
    /** The commit's subject line. */
    summary: string;
}
/** Text read result. `mtimeMs` is the save route's conflict baseline. */
export interface FsTextResult {
    kind: 'text';
    content: string;
    size: number;
    mtimeMs?: number;
}
/** Binary read result (no content; images load through the media route).
 *  `head` carries the first bytes (base64) for viewer detect sniffing. */
export interface FsBinaryResult {
    kind: 'binary';
    size: number;
    mtimeMs?: number;
    head: string;
}
/**
 * The file is above the editable threshold: the host sends no document, only
 * the size and a 4 KiB sniff head. The viewer answers with a read-only paged
 * preview, and the head still lets a `detect`-based viewer claim the file.
 */
export interface FsTooLargeResult {
    kind: 'too-large';
    size: number;
    mtimeMs?: number;
    head: string;
}
/** One `fs.read` outcome. */
export type FsReadResult = FsTextResult | FsBinaryResult | FsTooLargeResult;
/** One page of a large text file (see `fs.readPage`). */
export interface FsPageResult {
    kind: 'text';
    /** The page's decoded lines (normally whole lines — the host trims at a break). */
    text: string;
    /** The byte offset this page started at (echoed back). */
    offset: number;
    /** Where the next page starts; equals `size` once the file is exhausted. */
    nextOffset: number;
    eof: boolean;
    /** The file's size in bytes. */
    size: number;
    mtimeMs?: number;
    /** The encoding the first page established (later pages decode identically). */
    encoding: string;
}
/** The `subagents.live` response: one row per tree child (and the root). */
export type SubagentLiveResult = {
    live: Record<string, SidebarChildLiveView>;
};
/** The `workflows.list` response: the tree's folded workflow runs. */
export type WorkflowsListResult = {
    runs: WorkflowRunView[];
};
/** The `teams.taskCreate` request payload (minus the rootSessionId). */
export type TeamsTaskCreateRequest = SidebarCreateTeamTaskRequest;
/** The `teams.taskUpdate` request payload (minus the rootSessionId). */
export type TeamsTaskUpdateRequest = SidebarUpdateTeamTaskRequest;
/**
 * One team-task write as CALLERS consume it. The board's READ path has no
 * route at all (it rides the Lead Session's `agentTeam` projection, see
 * team-projection.ts), and a rejected write is a RESULT rather than an
 * exception: the route answers 409 `team-conflict` for a stale revision and
 * 400 `team-error` otherwise, {@link writeTask} turns that failed envelope
 * back into `{ok:false, code, message}`, and the task window routes on the
 * code (a stale revision deserves its own wording, not "operation failed").
 */
export type TeamsTaskMutationResult = {
    ok: true;
    value: SidebarTeamTaskView;
} | {
    ok: false;
    code?: string;
    message: string;
};
/** One request's session scope: the conversation id plus its cwd when known. */ export interface SessionScope {
    sessionId: string;
    /** The session's working directory from the client list summary (optional). */
    cwd?: string;
    /** Selected Git repository when cwd is a workspace container. */
    repoRoot?: string;
}
/** One external-open request from the file tree. */
type OpenExternalPayload = {
    action: 'reveal';
    path: string;
} | {
    action: 'url';
    url: string;
};
/** The host route's success shape. */
type OpenExternalResult = {
    started: boolean;
};
/**
 * Dispatch an external-open request to the correct machine. SSH remote-editor
 * URLs stay in the synchronous user-click chain and navigate the client so
 * its registered vscode:// / cursor:// handler can launch. Everything else
 * keeps using the DSH host route.
 */
declare function openExternal(payload: OpenExternalPayload): Promise<OpenExternalResult>;
/** The sidebar API surface (session scope threaded through every call). */
export declare const api: {
    sessionCwd: (scope: SessionScope, signal?: AbortSignal) => Promise<{
        sessionId: string;
        cwd: string;
        root: string;
        parent: string | null;
    }>;
    fsTree: (scope: SessionScope, path: string, exclude?: readonly string[], signal?: AbortSignal) => Promise<{
        path: string;
        entries: FsEntry[];
        truncated: boolean;
    }>;
    /**
     * Batch listing: every requested level in ONE request (the tree's mount and
     * refresh send the expanded set instead of N `fsTree` calls). A level that
     * failed carries `error` in place — the batch itself still succeeds.
     * `exclude` carries the explorerExclude pref: matched entries never arrive
     * (the host filters, so no client-side pass is needed).
     */
    fsTrees: (scope: SessionScope, paths: readonly string[], exclude?: readonly string[], signal?: AbortSignal) => Promise<{
        levels: FsLevel[];
    }>;
    /** Global recursive file search rooted at the session cwd (the editor
     *  side panel's search box). A name query matches cwd-relative
     *  '/'-separated paths; a separator-carrying fragment matches by PATH;
     *  a query naming one path (absolute, `~/…`, `./x`, `../x`) is stat'ed
     *  through the same resolution fs.read uses and yields the RESOLVED
     *  absolute target as the single match. `dirs` names the subset that is a
     *  directory (the list navigates the tree for those — `fs.read` refuses a
     *  directory). `exclude` carries the explorerExclude pref: matched entries
     *  never match and are never descended (host-side, in lockstep with the
     *  tree; a pasted direct-open path is explicit intent and skips it). */
    fsSearch: (scope: SessionScope, query: string, exclude?: readonly string[], signal?: AbortSignal) => Promise<{
        matches: string[];
        dirs: string[];
        truncated: boolean;
    }>;
    fsRead: (scope: SessionScope, path: string, signal?: AbortSignal) => Promise<FsReadResult>;
    /** One page of a large text file, for the read-only paged preview.
     *  `offset` is the byte position to start at (0 for the first page); the
     *  response carries where to continue. */
    fsReadPage: (scope: SessionScope, path: string, offset: number, signal?: AbortSignal) => Promise<FsPageResult>;
    /** Save a file through the raw `/sidebar/write` route (the document IS the
     *  request body — no JSON escaping, so nothing caps the saved size).
     *  `expectedMtimeMs` is the mtime the draft was based on: a file that
     *  changed on disk since refuses with code `fs-conflict` (the editor then
     *  offers a reload) instead of clobbering those bytes — and so does a file
     *  that is no longer there at all, because a numeric baseline proves it was
     *  read from an existing file. `null` (the file did not exist yet) and
     *  omitted (older callers) both mean no gate. The response carries the
     *  fresh baseline. */
    fsWrite: (scope: SessionScope, path: string, content: string, expectedMtimeMs?: number | null) => Promise<{
        ok: true;
        mtimeMs?: number;
    }>;
    /** Rename one tree row within its directory (single-segment name; the
     *  server refuses existing destinations, the workspace root, and — while
     *  the fence is armed — anything resolving outside the workspace). */
    fsRename: (scope: SessionScope, path: string, name: string) => Promise<{
        path: string;
    }>;
    /** Permanently delete one tree row (recursive for directories; a symlink
     *  row unlinks the link only). The UI confirms before calling this. */
    fsRemove: (scope: SessionScope, path: string) => Promise<{
        path: string;
    }>;
    /** Create one directory row inside `path` (single-segment name; the server
     *  refuses existing destinations, the workspace root, and — while the fence
     *  is armed — anything resolving outside the workspace). */
    fsMkdir: (scope: SessionScope, path: string, name: string) => Promise<{
        path: string;
    }>;
    /** Create one EMPTY file row inside `path` (single-segment name; the server
     *  refuses existing destinations — without truncating them — plus the
     *  characters and Windows device names a file name may not use). */
    fsCreateFile: (scope: SessionScope, path: string, name: string) => Promise<{
        path: string;
    }>;
    /** Upload one file's raw bytes into `dir` (keeps the folder tree via
     *  `relativePath`); the host streams it under the session workspace. */
    uploadFile: (scope: SessionScope, dir: string, relativePath: string, body: Blob, signal?: AbortSignal) => Promise<{
        path: string;
        size: number;
    }>;
    gitWorktrees: (scope: SessionScope, signal?: AbortSignal) => Promise<GitWorktree[]>;
    gitStatus: (scope: SessionScope, worktree?: string, signal?: AbortSignal) => Promise<GitStatusResult>;
    gitDiff: (scope: SessionScope, path: string | undefined, staged: boolean, worktree?: string, signal?: AbortSignal) => Promise<{
        diff: string;
    }>;
    gitStage: (scope: SessionScope, path?: string, worktree?: string) => Promise<{
        ok: true;
    }>;
    gitUnstage: (scope: SessionScope, path?: string, worktree?: string) => Promise<{
        ok: true;
    }>;
    gitCommit: (scope: SessionScope, message: string, worktree?: string) => Promise<{
        ok: true;
    }>;
    /** Push the selected checkout's branch to its upstream; git's own failure
     *  message (no upstream, auth, non-fast-forward) crosses the wire as-is. */
    gitPush: (scope: SessionScope, worktree?: string) => Promise<{
        ok: true;
    }>;
    /** Pull into the selected checkout (`--ff-only` host-side: a diverged branch
     *  fails loudly rather than opening a merge editor nobody can answer). */
    gitPull: (scope: SessionScope, worktree?: string) => Promise<{
        ok: true;
    }>;
    /** Ask the host to generate a commit message from the pending changes: it
     *  streams the diff through the harness LLM on the pinned route (or the
     *  conversation's own) and answers with the route actually used.
     *  `language` follows the sidebar's active locale ('zh' | 'en'). */
    gitSuggestMessage: (scope: SessionScope, language: "zh" | "en", worktree?: string) => Promise<{
        message: string;
        provider: string;
        model: string;
    }>;
    /** The discoverable provider/model catalog for the Git card's pinned-route
     *  setting (advisory; empty when the harness exposes no LLM service). */
    gitModels: (scope: SessionScope, signal?: AbortSignal) => Promise<GitModelCatalog>;
    /** The route the NEXT commit-message suggestion would use (pinned → the
     *  conversation's own → the harness default); absent when none resolves.
     *  Cheaper than `gitModels`: no catalog discovery. */
    gitCommitModel: (scope: SessionScope, signal?: AbortSignal) => Promise<{
        route?: GitModelRoute;
        pinned: boolean;
    }>;
    gitBranch: (scope: SessionScope, worktree?: string, signal?: AbortSignal) => Promise<{
        current: string;
        names: string[];
    }>;
    gitCheckout: (scope: SessionScope, branch: string, worktree?: string) => Promise<{
        ok: true;
    }>;
    /** Read-only topological history; stale cursors require a fresh first page. */
    gitGraph: (scope: SessionScope, options?: GitGraphOptions, worktree?: string, signal?: AbortSignal) => Promise<GitGraphResult>;
    /** Recent commit history, lazily pageable (skip/count; defaults 0/30). */
    gitLog: (scope: SessionScope, count?: number, skip?: number, worktree?: string, signal?: AbortSignal) => Promise<GitLogEntry[]>;
    /** Full patch text of one commit (diff display for the history rows). */
    gitCommitDiff: (scope: SessionScope, hash: string, worktree?: string, signal?: AbortSignal) => Promise<{
        diff: string;
    }>;
    /** One file's content at a revision (`git show <rev>:<path>`); null when the
     *  revision has no such path. The diff views' on-demand hunk-fold expansion
     *  reads both sides' full contents through this. */
    gitShow: (scope: SessionScope, rev: string, path: string, worktree?: string, signal?: AbortSignal) => Promise<{
        content: string | null;
    }>;
    /** ONE file's whole uncommitted change (worktree against HEAD, staged and
     *  unstaged in one patch). The editor's change gutter maps this onto the
     *  buffer's line numbers; untracked files are marked from the status store
     *  instead, because no diff side ever lists them. */
    gitDiffHead: (scope: SessionScope, path: string, worktree?: string, signal?: AbortSignal) => Promise<{
        diff: string;
    }>;
    /** Blame ONE line range (`git blame --porcelain -L`). Never throws: every
     *  failure (untracked file, not a repository, command failure) answers with
     *  an empty list. Called on hover only — a file is never prefetched. */
    gitBlame: (scope: SessionScope, path: string, startLine: number, endLine: number, worktree?: string, signal?: AbortSignal) => Promise<{
        lines: GitBlameLine[];
    }>;
    /** The session's file-tool events past `afterSeq` (absent = whole window,
     *  floored at -1 host-side so a log opening on seq 0 is not dropped). With
     *  `wait` the host parks the request until the next tool event (or 25 s)
     *  instead of re-reading an unchanged window. */
    changesOps: (scope: SessionScope, afterSeq?: number, signal?: AbortSignal, wait?: boolean) => Promise<{
        events: SidebarSessionEvent[];
        lastSeq: number;
    }>;
    /** Discard the worktree changes of one file (the index is untouched). */
    gitDiscard: (scope: SessionScope, path: string, worktree?: string) => Promise<{
        ok: true;
    }>;
    /** Revert one commit onto the current branch. */
    gitRevert: (scope: SessionScope, hash: string, worktree?: string) => Promise<{
        ok: true;
    }>;
    /** Cherry-pick one commit onto the current branch. */
    gitCherryPick: (scope: SessionScope, hash: string, worktree?: string) => Promise<{
        ok: true;
    }>;
    /**
     * One batch live-preview fetch for the whole Subagent tree. The payload is
     * the already-resolved topology ROOT (not a session scope); the host
     * enumerates descendants once and folds every child's newest process range
     * into the main agent's merged-activity summary.
     */
    subagentsLive: (rootSessionId: string, signal?: AbortSignal) => Promise<SubagentLiveResult>;
    /**
     * The workflow runs of the whole tree, folded host-side from the
     * `tool-workflow/*` session events (the same four types the official
     * workflow-run panel folds). Empty when the tree never ran a workflow —
     * absence is the normal case, never an error.
     */
    workflowsList: (rootSessionId: string, signal?: AbortSignal) => Promise<WorkflowsListResult>;
    /** Create one shared task on the root-led team. */
    teamsTaskCreate: (rootSessionId: string, req: TeamsTaskCreateRequest) => Promise<TeamsTaskMutationResult>;
    /** CAS-mutate one shared task; a stale revision yields `team-conflict`. */
    teamsTaskUpdate: (rootSessionId: string, req: TeamsTaskUpdateRequest) => Promise<TeamsTaskMutationResult>;
    /** Create a Side Chat thread: a child session seeded with the parent's
     *  full log up to now. Empty question = immediate create (Codex-style):
     *  the thread opens empty, the first prompt carries the boundary. */
    sidechatStart: (sessionId: string, question?: string) => Promise<{
        childId: string;
    }>;
    /** Deliver one follow-up message to a Side Chat thread. */
    sidechatPrompt: (childId: string, text: string) => Promise<{
        accepted: true;
    }>;
    /** Abort a Side Chat thread's running turn (queued work is preserved). */
    sidechatCancel: (childId: string) => Promise<{
        accepted: true;
    }>;
    /** Release a Side Chat thread's live agent (history stays persisted). */
    sidechatDispose: (childId: string) => Promise<{
        accepted: true;
    }>;
    /** Live state + agent identity (provider/model/preset) of a thread. */
    sidechatInfo: (childId: string) => Promise<SidechatThreadInfo>;
    /** One transcript pull of a Side Chat thread: the thread's OWN events
     *  (the inherited seed is cut host-side and never crosses the wire).
     *  `afterSeq` narrows the response to the delta beyond it (poll tail).
     *  `live` is the thread's in-flight model deltas (DSH 0.1.5 publishes them
     *  outside the session log) — the CURRENT attempt on every pull, never a
     *  delta, so the caller replaces its live set instead of appending.
     *  `pending` is the thread's live UNCLAIMED inbox in claim order (all
     *  `next-step` entries, then the queued turns): the view renders those as
     *  pending bubbles, deduped by id against the durable `user/message` rows
     *  the claim later writes. */
    sidechatEvents: (childId: string, afterSeq?: number, signal?: AbortSignal) => Promise<{
        events: SidechatLogEvent[];
        live: SidechatLiveEvent[];
        pending: SidechatPendingInput[];
    }>;
    /** Drop one pending inbox message (no `messageId` = drop the whole queue).
     *  `removed` is how many the host actually took out; a cold thread answers
     *  `0` rather than failing. */
    sidechatDequeue: (childId: string, messageId?: string) => Promise<{
        accepted: true;
        removed: number;
    }>;
    /** The host's own model catalog for the per-thread picker. `available:
     *  false` means no catalog was readable (headless or older host) — the
     *  picker then offers only "inherit the parent conversation". */
    sidechatModels: () => Promise<SidechatModelCatalog>;
    /** Pin one Side Chat thread's model route (the host disables its own picker
     *  for subagent-origin sessions, so this is the only switch a side thread
     *  has). `reasoningEffort` is omitted unless chosen. */
    sidechatModel: (childId: string, provider: string, model: string, reasoningEffort?: string) => Promise<{
        accepted: true;
        selection: SidechatModelSelection;
    }>;
    /** Read the side card preferences (plugin-global, no session scope). */
    settingsGet: () => Promise<{
        value?: unknown;
        revision?: number;
        externalDisable?: boolean;
    }>;
    /** Merge a patch into the side card preferences (revision-guarded). */
    settingsUpdate: (patch: Record<string, unknown>, expectedRevision?: number) => Promise<{
        value?: unknown;
        revision?: number;
    }>;
    /** External open for the file tree's "open with" menu. Remote SSH editor
     *  URLs are launched on the browser/client machine; reveal and local URLs
     *  keep using the host's platform opener. */
    openExternal: typeof openExternal;
};
/** Absolute URL of the media route for one path (images only). */
export declare function mediaUrl(scope: SessionScope, path: string): string;
/** Absolute URL of the download route: serves raw bytes (binary-safe) with
 *  `Content-Disposition: attachment`, so the browser saves the file. */
export declare function downloadUrl(scope: SessionScope, path: string): string;
/**
 * Start one archive build. The host fences the selection and returns an id
 * IMMEDIATELY — the system's `zip` (or `tar`) packs it into a temp file in the
 * background, polled through {@link api.archiveStatus}. `paths` are absolute
 * paths in the session's namespace (the same values `fsTree` / `downloadUrl`
 * take); `name` is a STEM, because the host appends the extension of the tool
 * it actually has and returns the final name with the id.
 */
export declare function archiveBuild(scope: SessionScope, paths: readonly string[], name: string): Promise<{
    id: string;
    name: string;
    entries: number;
}>;
/** One archive build's state (the shape `archive.status` returns). */
export interface ArchiveBuildStatus {
    state: 'building' | 'ready' | 'error';
    /** Bytes written to the archive so far. */
    bytes: number;
    /** Present only when `state === 'error'` (the tool's own stderr tail). */
    error?: string;
}
/** Poll one archive build (its id came from {@link archiveBuild}). The session
 *  scope rides along exactly like `archive.build`: the host requires BOTH keys
 *  (`requireString(payload, 'id')` + `requireString(payload, 'sessionId')`), so
 *  a bare `{ id }` payload is refused with a 400 and the status is never read. */
export declare function archiveStatus(scope: SessionScope, id: string): Promise<ArchiveBuildStatus>;
/**
 * Absolute URL of one FINISHED archive's bytes (the `archive.status` result
 * must be `ready` first): GET /sidebar/archive?id=…&sessionId=… The session
 * scope rides along because the host answers only the session that built it.
 */
export declare function archiveDownloadUrl(scope: SessionScope, id: string): string;
/**
 * Absolute URL of the HTML preview route (see html-route.ts): the path is
 * fully encoded so the previewed page's relative assets resolve back into
 * the same route with the session scope intact. The UNC marker is
 * platform-neutral — the host's requireAbsolute resolves the decoded
 * forward-slash `//server/share/...` form on both win32 and POSIX — so no
 * client-side platform signal is needed.
 */
export declare function htmlUrl(scope: SessionScope, path: string): string;
/** One session-phase read: whether the session is still blank (no messages). */
export interface SessionPhase {
    /** True while the session has neither a user nor an assistant message. */
    blank: boolean;
}
/**
 * Read one session's blank phase. Blank sessions do not render the host's
 * session header, so the plugin's header-registered dock entry is unreachable
 * there (issue #698/#623) — the client uses this to render its fallback entry.
 * @param sessionId - the session to read.
 * @param signal - optional abort signal.
 * @returns the phase (`blank: false` when the session does not exist).
 */
export declare function sessionPhase(sessionId: string, signal?: AbortSignal): Promise<SessionPhase>;
