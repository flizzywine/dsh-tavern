// included inside play-controls to share body regeneration and its projections.
// Resolves to what was started (the candidate task for 选项), which galStopRegeneration may need.
async function galSubmitRegeneration(sessionId, turn, target, guidance, messageId) {
    const text = String(guidance || "").trim();
    let started = null;
    if (target === "body") await submitBodyRegeneration(sessionId, { tail: null }, text);
    else if (target === "mvu") await rpc("retryMvuSettlement", { turn, guidance: text }, sessionId);
    else if (target === "director") await rpc("retryStageDirection", { turn, guidance: text }, sessionId);
    else if (target === "choices") started = await submitCandidateTask(sessionId, messageId, text);
    liveTavernView.invalidate(sessionId);
    tavernCoordination.invalidate(sessionId);
    return started;
}
// the dialog's 停止 goes through the stop each kind of work already
// has, no parallel mechanism. 正文 runs inside the submit: the stage's interrupt (round-history interruptTurn) stops the
// regeneration's run, and the regeneration itself then restores the original round. MVU / 舞台指导 / 选项 only enqueue
// background work, so their stop follows the enqueue: 选项 the text box chip's stopChoices, MVU the menu's 停止后台
// (stopBackground), 舞台指导 that round's director (stopStageDirection; a director is not background work to 停止后台).
async function galStopRegeneration(sessionId, target, started, turn) {
    if (target === "body") { await interruptStageTurn(sessionId); return; }
    try {
        if (target === "choices") {
            if (started && started.taskId) await rpc("stopChoices", { taskId: started.taskId }, sessionId);
            setCandidatePanel(null);
        } else if (target === "director") {
            await rpc("stopStageDirection", { turn }, sessionId);
        } else {
            const current = coordinationView(await rpc("syncSession", { kind: "candidate" }, sessionId), sessionId).activity;
            const activity = current && (current.busy || current.phase === "pending") ? current : null;
            if (activity && activity.operationId) await rpc("stopBackground", { operationId: activity.operationId }, sessionId);
        }
    } catch (error) { tavernErrorHub.report("停止重新生成", error); }
    finally { liveTavernView.invalidate(sessionId); tavernCoordination.invalidate(sessionId); }
}

function GalRegenerate(props) {
    const h = React.createElement;
    const messageId = props.useChat(latestTavernAssistantMessageId);
    const [target, setTarget] = React.useState("body");
    const [guidance, setGuidance] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    // stopping - the wait shows 「正在停止」 until the run has ended.
    const [stopping, setStopping] = React.useState(false);
    const stopRef = React.useRef(false); // 停止 was asked for this submit
    // while it submits the button row is the stage wait (wait-lines.js), as the text box
    // shows while a reply is written; each submit opens on its own line.
    const waitRef = React.useRef(null);
    if (!busy) waitRef.current = null;
    else if (!waitRef.current) waitRef.current = stageWaitLinesEpisode(null, "regenerate", (props.waitLines || STAGE_WAIT_LINES).length);
    const pending = React.useRef(""); // the target being submitted
    const root = React.useRef(null);
    const live = React.useRef(props);
    live.current = props;
    // galgame UI cues (ui-sfx.js): target radios toggle, 取消 / Esc / right click cancel, 确定 confirms.
    useForkUiSfxControls(root);
    // a running regeneration is never left behind by a closed dialog. While it runs, Esc and
    // right click are its 停止 (as on every stage wait) and the dialog stays until the run has ended; it then returns to
    // its form with the target and guidance kept. A click on the dimmed stage does nothing meanwhile (gal-menu.js).
    function stop() {
        if (!pending.current || stopRef.current) return;
        forkUiSfx.play("cancel");
        stopRef.current = true;
        setStopping(true);
        if (pending.current === "body") void galStopRegeneration(live.current.sessionId, "body");
    }
    function dismiss() {
        if (pending.current) { stop(); return; }
        forkUiSfx.play("cancel");
        live.current.onClose();
    }
    React.useLayoutEffect(function () {
        const opener = document.activeElement;
        root.current.querySelector('[role="radio"][aria-checked="true"]').focus({ preventScroll: true });
        function onKey(event) {
            if (event.isComposing) return;
            if (event.key === "Escape") {
                event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) dismiss();
            } else if (event.key === "Tab") {
                const nodes = Array.from(root.current.querySelectorAll('[role="radio"][aria-checked="true"]:not(:disabled), textarea:not(:disabled), button:not([role="radio"]):not(:disabled)'));
                const at = nodes.indexOf(document.activeElement);
                event.preventDefault(); event.stopImmediatePropagation();
                if (!nodes.length) return;
                nodes[(at + (event.shiftKey ? nodes.length - 1 : 1)) % nodes.length].focus({ preventScroll: true });
            }
        }
        window.addEventListener("keydown", onKey, true);
        return function () {
            window.removeEventListener("keydown", onKey, true);
            if (opener && opener.isConnected) opener.focus({ preventScroll: true });
        };
    }, []);
    // Back from a stopped or failed run the wait that held focus is gone: focus returns to the form.
    const wasBusy = React.useRef(false);
    React.useLayoutEffect(function () {
        if (wasBusy.current && !busy && !root.current.contains(document.activeElement)) root.current.querySelector('[role="radio"][aria-checked="true"]').focus({ preventScroll: true });
        wasBusy.current = busy;
    }, [busy]);
    async function submit(event) {
        event.preventDefault();
        if (pending.current || props.busy || props.historical) return;
        pending.current = target; stopRef.current = false; setBusy(true);
        props.onBusy(true);
        let close = false;
        try {
            const started = await galSubmitRegeneration(props.sessionId, props.turn, target, guidance, messageId);
            // 停止 during an enqueue: stop the work it just started. A 正文 that committed before its stop took effect stays.
            if (stopRef.current && target !== "body") await galStopRegeneration(props.sessionId, target, started, props.turn);
            close = !stopRef.current || target === "body";
        } catch (error) {
            // A stopped 正文 fails as 「没有完成…正文保持原样」: that is the stop, not an error.
            if (!stopRef.current) tavernErrorHub.report("重新生成", error);
        }
        finally { pending.current = ""; stopRef.current = false; setStopping(false); setBusy(false); props.onBusy(false); }
        if (close) props.onClose();
    }
    const targets = [
        ["body", "正文", "重写本轮回复；之后照常结算与导演"],
        // 「MVU」 keeps four segments on one line; the (?) and its title say what it is.
        ["mvu", "MVU", "变量结算。保留正文，重新结算本轮 MVU 变量"],
        ["director", "舞台指导", "保留正文与变量，重新生成本轮演出"],
        ["choices", "选项", "保留正文、变量与舞台，只重新生成本轮选项"]
    ];
    // fork-gal-confirm: the stage's confirm dialogs, drawn by a skin's art.confirm (stage-skin-adv.md).
    return h("form", { ref: root, className: "fork-gal-menu-panel fork-gal-regenerate fork-gal-confirm", role: "dialog", "aria-modal": true, "aria-label": "重新生成", "aria-busy": busy, onSubmit: submit,
        onClick: event => event.stopPropagation(), onKeyDown: event => event.stopPropagation(), onContextMenu: event => { event.preventDefault(); event.stopPropagation(); dismiss(); } },
        // no grey helper text — what each target does lives behind the title's 「?」 (and each option's title).
        h("h2", null, "重新生成", typeof HelpTip === "function" ? h(HelpTip, { label: "重新生成说明" }, targets.map(([id, label, note]) => h("span", { key: id }, label + "：" + note))) : null),
        // the target is the shared Segmented in the stage skin (was native
        // radios); ←→ choose, each option keeps its one-line title.
        h(Segmented, { base: "fork-gal-config-seg", className: "fork-gal-regenerate-targets", label: "重新生成目标", value: target, disabled: busy, onChange: setTarget,
            options: targets.map(([id, label, note]) => [id, label, false, note, { "data-target": id }]) }),
        h("label", { className: "fork-gal-regenerate-guidance" }, "本次指导（可选）",
            h(TextArea, { rows: 2, value: guidance, disabled: busy, onChange: setGuidance })),
        // the wait is its own 停止 (StageWaitStop, as the text box's wait):
        // hover or focus shows 「■ 停止」, a click / Enter / Space / Esc stops; on touch the first tap arms it.
        busy ? h("div", { className: "fork-gal-regenerate-actions is-waiting", role: "status", "aria-label": stopping ? "正在停止" : "正在重新生成" },
            h(StageWaitStop, { label: "正在重新生成", busy: stopping, onStop: stop }, h(StageWaitLines, { first: waitRef.current.first, start: waitRef.current.start, lines: props.waitLines }))) :
        h("div", { className: "fork-gal-regenerate-actions" },
            // The words in a span: a skin's drawn buttons (art.confirm) tint their first glyph (::first-letter needs a block box).
            h("button", { type: "button", "data-ui-sfx": "cancel", onClick: props.onClose }, h("span", null, "取消")),
            h("button", { type: "submit", "data-ui-sfx": "confirm", disabled: props.busy || props.historical }, h("span", null, "确定"))));
}
