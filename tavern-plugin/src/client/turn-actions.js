// the action row under each reply.
//   [编辑] [变量] [重roll] [⋯]  time
// Edit / regenerate / delete / undo only apply to the latest round; the variable
// icon appears under every reply; the ⋯ menu holds latest-round rollback actions. Included inside
// the play-controls module so it reuses the upstream actions, which keep their own
// rules (hidden or disabled when unavailable).

const RECEIPT_TITLES = {
    pending: "变量结算中", updated: "变量已更新", partial: "变量部分更新失败", error: "变量更新失败",
    stale: "变量结算已过期", interrupted: "变量结算已中断", unchanged: "本轮无需更新变量"
};

// DSH turn of a reply: the host's fork map, else the Chat node carrying that message.
function dshTurnOf(view, messageId, chatTurn) {
    return Number(view && view.forkTurnsByMessageId && view.forkTurnsByMessageId[String(messageId || "")]) || Number(chatTurn) || 0;
}
function useChatTurn(props) {
    return props.useChat(function (state) {
        const nodes = state && state.legacy && state.legacy.nodes || [];
        for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i] && nodes[i].messageId === props.messageId) return Number(nodes[i].turn) || 0;
        return 0;
    });
}
function receiptForMessage(view, messageId, chatTurn) {
    const dshTurn = dshTurnOf(view, messageId, chatTurn);
    if (!dshTurn) return null;
    const storyTurn = tavernStoryTurnForDshTurn(view, dshTurn);
    const receipt = storyTurn ? tavernMvuReceiptForTurn(view, storyTurn) : null;
    return receipt ? { receipt: receipt, storyTurn: storyTurn } : null;
}

// Floating layer anchored to a button; closes on outside click and Esc.
function usePopover(open, setOpen, anchor, layer) {
    React.useEffect(function () {
        if (!open) return;
        function outside(event) { if (anchor.current && anchor.current.contains(event.target)) return; if (layer.current && layer.current.contains(event.target)) return; setOpen(false); }
        function escape(event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape, true);
        return function () { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); };
    }, [open]);
}

function ReceiptButton(props) {
    const h = React.createElement;
    const live = useLiveTavernView(props.sessionId, "receipt:" + String(props.messageId || ""));
    const [open, setOpen] = React.useState(false);
    const view = live.view;
    const found = receiptForMessage(view, props.messageId, useChatTurn(props));
    if (!found) return null;
    const receipt = found.receipt;
    const status = RECEIPT_TITLES[receipt.status] ? receipt.status : "unchanged";
    const busy = Boolean(view && view.activity && view.activity.busy);
    const changes = Array.isArray(receipt.changes) ? receipt.changes.length : 0;
    const failures = Array.isArray(receipt.failures) ? receipt.failures.length : 0;
    const title = RECEIPT_TITLES[status] + (status === "updated" && changes ? " · " + changes + " 项" : "") + (failures ? " · 失败 " + failures + " 项" : "") + "（点击查看详情）";
    const shown = status === "pending" && busy ? "running" : status;
    // Sliders icon + an inline count (not a corner badge); other states tint the icon.
    const detail = status === "updated" && changes ? (changes > 99 ? "99+" : String(changes)) : status === "partial" ? changes + "/" + (changes + failures) : "";
    const subtitle = "第 " + found.storyTurn + " 轮 · " + (status === "updated" ? (changes ? changes + " 项" : "已更新") : status === "partial" ? changes + " 项 · 失败 " + failures + " 项" : RECEIPT_TITLES[status]);
    return h(React.Fragment, null,
        h("button", { type: "button", className: "fork-receipt-icon", "data-receipt": shown, title: title, "aria-label": title, onClick: function () { setOpen(true); } },
            detail ? h("span", { className: "fork-receipt-count" }, detail) : null),
        open ? bodyPortal(h("div", { className: "fork-dialog-backdrop", onPointerDown: function (event) { if (event.target === event.currentTarget) setOpen(false); } },
            h("div", { className: "fork-dialog", role: "dialog", "aria-label": "第 " + found.storyTurn + " 轮变量结算",
                ref: function (node) { if (node && !node.contains(document.activeElement)) node.focus(); }, tabIndex: -1,
                onKeyDown: function (event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } } },
                h("header", { className: "fork-dialog-head" },
                    h("div", { className: "fork-dialog-title" },
                        h("strong", null, "变量变化"),
                        h("span", { className: "fork-dialog-subtitle", "data-status": status }, subtitle),
                        found.storyTurn === (view && view.settlementTurn) ? h(VariableRetryButton, { sessionId: props.sessionId, turn: found.storyTurn, status: status, busy: busy }) : null),
                    h("button", { type: "button", className: "fork-dialog-close", "aria-label": "关闭", onClick: function () { setOpen(false); } }, "×")),
                h("div", { className: "fork-dialog-body fork-var-body" },
                    h(VariableReceipt, { receipt: receipt, sessionId: props.sessionId, turn: found.storyTurn, latest: found.storyTurn === (view && view.settlementTurn), busy: busy }))))) : null);
}

function TurnMenu(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const [position, setPosition] = React.useState(null);
    const anchor = React.useRef(null), layer = React.useRef(null);
    usePopover(open, setOpen, anchor, layer);
    function toggle() {
        if (!open && anchor.current) { const rect = anchor.current.getBoundingClientRect(); setPosition({ left: rect.left, top: rect.bottom + 4 }); }
        setOpen(!open);
    }
    if (!props.latest) return null;
    return h(React.Fragment, null,
        h("button", { ref: anchor, type: "button", className: "fork-turn-more", title: "更多", "aria-label": "更多", "aria-haspopup": "menu", "aria-expanded": open, onClick: toggle }),
        open && position ? bodyPortal(h("div", { ref: layer, className: "fork-turn-menu", role: "menu", style: { left: position.left + "px", top: position.top + "px" },
            onClick: function (event) { if (event.target.closest("button:not(:disabled)")) window.setTimeout(function () { setOpen(false); }, 0); } },
            props.latest ? h(TavernUndoRollbackAction, props) : null,
            props.latest ? h(TavernRollbackAction, props) : null)) : null);
}

function TurnActions(props) {
    const mode = useTavernSessionMode(props.sessionId);
    const latestMessageId = props.useChat(latestTavernAssistantMessageId);
    if (!isPlayMode(mode) || !props.messageId) return null;
    const latest = props.messageId === latestMessageId;
    const h = React.createElement;
    return h("span", { className: "dsh-fork-turn-actions" },
        latest ? h("span", { "data-fork-turn": "edit", title: "编辑正文" }, h(TavernEditBodyAction, props)) : null,
        h("span", { "data-fork-turn": "speech" }, h(TavernBodySpeechAction, props)),
        h("span", { "data-fork-turn": "receipt" }, h(ReceiptButton, props)),
        latest ? h("span", { "data-fork-turn": "regen" }, h(CandidateAction, Object.assign({}, props, { only: "regen" }))) : null,
        h("span", { "data-fork-turn": "more" }, h(TurnMenu, Object.assign({}, props, { latest: latest }))));
}

// ---------------------------------------------------------------------------
// joint progress belongs to the button; only native foreground
// compaction owns a history divider. Keep dismissible failures below the story.
const compactionRuns = (function () {
    const runs = new Map(), listeners = new Set();
    function emit() { listeners.forEach(function (fn) { fn(); }); }
    return {
        subscribe(fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
        get(sessionId) { return runs.get(sessionId) || null; },
        set(sessionId, value) { if (value) runs.set(sessionId, value); else runs.delete(sessionId); emit(); }
    };
})();

// The native command outcome is diagnostic prose, not player copy. Keep the
// successful checkpoint available without exposing raw failure diagnostics.
// `data-fork-compaction` lets a later success supersede an earlier failure line (tavern.css).
function compactionSucceededRow(summary) {
    if (!summary) return React.createElement("div", { className: "fork-compaction-line", "data-fork-compaction": "succeeded" },
        React.createElement("span", { className: "fork-compaction-text" }, "已整理较早的剧情"));
    return React.createElement("details", { className: "fork-compaction-result", "data-fork-compaction": "succeeded" },
        React.createElement("summary", { className: "fork-compaction-line" }, "已整理较早的剧情"),
        React.createElement("div", { className: "fork-compaction-summary" }, summary));
}
function ManualCompactionNodeView(props) {
    const data = props.node.data;
    const outcome = data.command.outcome;
    if (data.compaction && outcome?.kind !== "error") return compactionSucceededRow(data.compaction.summary);
    const phase = outcome === null ? "running" : outcome.kind === "error" ? "failed" : "ended";
    const text = { running: "正在整理较早的剧情…", failed: "这次未能整理较早的剧情。", ended: "剧情整理已结束。" }[phase];
    return React.createElement("div", { className: "fork-compaction-line", role: "status", "data-fork-compaction": phase },
        React.createElement("span", { className: "fork-compaction-text" }, text));
}
// The 压缩上下文 button (and automatic compaction) land a native checkpoint without a
// command: it gets the same history row as a successful /compact.
function CompactionNodeView(props) {
    return compactionSucceededRow(props.node.data.summary);
}

function compactionMessage(message) {
    return String(message || "").replace(/Compacted (\d+) history items \(~([\d,]+) tokens\)\./g, function (_, count, tokens) {
        return "已压缩 " + count + " 条历史记录（原文约 " + Number(tokens.replace(/,/g, "")).toLocaleString("en-US") + " tokens）";
    });
}
// Receipts carry host/provider prose (English, diagnostics). Players read known
// receipts as plain Chinese and anything else as its status; the 调试视图 shows the raw text.
function compactionPlayerMessage(message) {
    const text = String(message || "").trim();
    if (/^(No compactable history yet\.?|没有可压缩的历史)$/.test(text)) return "暂时没有可以整理的较早剧情";
    if (/^Compacted \d+ history items/.test(text)) return compactionMessage(text);
    return /[A-Za-z]/.test(text) ? "" : text;
}
function compactionSideText(side) {
    if (!side) return "等待中";
    if (side.status === "dispatching") return "压缩中…";
    if (side.status === "pending") return "等待中";
    const label = { succeeded: "压缩完成", skipped: "无需压缩", failed: "压缩失败" }[side.status] || "等待中";
    if (debugViewOn()) return compactionMessage(side.message) || label;
    return side.status === "failed" ? label : compactionPlayerMessage(side.message) || label;
}
function compactionProgressTitle(operation) {
    return operation ? "前台：" + compactionSideText(operation.foreground) + "；后台：" + compactionSideText(operation.background) : "";
}
function useCompactionState(sessionId) {
    const local = React.useSyncExternalStore(compactionRuns.subscribe, function () { return compactionRuns.get(sessionId); });
    const live = useLiveTavernView(sessionId, "compaction:" + String(local && local.phase || ""));
    const state = live.view && live.view.contextCompaction || null;
    return { local: local, live: live, state: state, operation: state && state.operation,
        running: Boolean(local && local.phase === "running" || state && state.operation && state.operation.status === "running") };
}
function CompactionLine(props) {
    const h = React.createElement;
    const status = useCompactionState(props.sessionId);
    const local = status.local, live = status.live, state = status.state;
    const warning = state && state.warning || "";
    if (!isPlayMode(live.view && live.view.mode) || status.running) return null;
    let phase = null, text = "";
    // A failed run's text is diagnostic; players see only the history line 「这次未能整理较早的剧情。」.
    const failedRun = local && local.phase === "failed" || warning && status.operation && status.operation.status !== "completed";
    if (failedRun && !debugViewOn()) return null;
    if (local && local.phase === "failed") { phase = "failed"; text = local.message || "压缩未完成"; }
    else if (warning) { phase = "failed"; text = compactionMessage(warning); }
    if (!phase) return null;
    function dismiss() {
        compactionRuns.set(props.sessionId, null);
        if (warning) rpc("dismissCompactionWarning", { sessionId: props.sessionId }, props.sessionId).then(function () { liveTavernView.invalidate(props.sessionId); }, function (error) { tavernErrorHub.report("关闭压缩提示", error); });
    }
    return h("div", { className: "fork-compaction-line", "data-phase": phase, role: "status" },
        h("span", { className: "fork-compaction-text", title: text }, phase === "running" ? h(Spinner, { className: "fork-compaction-dots" }) : null, text),
        phase === "failed" ? h("button", { type: "button", className: "fork-compaction-dismiss", "aria-label": "关闭", title: "关闭", onClick: dismiss }, "×") : null);
}
