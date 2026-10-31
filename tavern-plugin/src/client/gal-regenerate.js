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
    const messageId=props.useChat(latestTavernAssistantMessageId);
    return stageViews ? React.createElement(stageViews.regenerate.Regenerate,{...props,messageId,commands:{submit:galSubmitRegeneration,stop:galStopRegeneration}}) : null;
}
