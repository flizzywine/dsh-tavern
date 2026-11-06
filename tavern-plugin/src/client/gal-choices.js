function decodeUnicodeEscapes(value) {
    const text = String(value == null ? "" : value);
    return /\\u[0-9a-fA-F]{4}/.test(text) ? text.replace(/(?:\\u[0-9a-fA-F]{4})+/g, run => { try { return JSON.parse('"' + run + '"'); } catch (_) { return run; } }) : text;
}
function GalChoices(props) {
    const sessionId=props.sessionId;
    const panelState = useCandidatePanel();
    const running = props.useSession(snapshot => snapshot.running === true);
    const messageId = props.useChat(latestTavernAssistantMessageId);
    const coordination = useTavernCoordination(sessionId, String(running) + ":" + String(messageId || ""));
    const task = coordination.view && coordination.view.task;
    const taskForMessage = task && task.kind === "candidate" && task.input && String(task.input.messageId || "") === String(messageId || "") ? task : null;
    const panel = panelState && panelState.sessionId === sessionId && panelState.messageId === messageId ? panelState : null;
    // Mirror mailbox progress and failures too: a hidden composer must not leave us waiting forever.
    React.useEffect(function () {
        if (!taskForMessage) return;
        if (taskForMessage.busy)
            setCandidatePanel({ sessionId, messageId, phase: "loading", choices: [], error: "" });
        else if (taskForMessage.status === "succeeded" && taskForMessage.result && taskForMessage.result.candidates)
            setCandidatePanel(readyCandidatePanel(sessionId, messageId, taskForMessage.result.candidates));
        else if (taskForMessage.status === "cancelled")
            setCandidatePanel(null);
        else if (taskForMessage.terminal)
            setCandidatePanel({ sessionId, messageId, phase: "error", choices: [], error: playerErrorText(taskForMessage.error || "选项生成未完成", { fallback: "选项生成未完成" }) });
    }, [sessionId, messageId, taskForMessage && taskForMessage.taskId, taskForMessage && taskForMessage.version, taskForMessage && taskForMessage.status]);
    const commands={
        clear:()=>setCandidatePanel(null),
        async stop(taskId){try{await rpc('stopChoices',{taskId},sessionId);setCandidatePanel(null);}finally{liveTavernView.invalidate(sessionId);tavernCoordination.invalidate(sessionId);}},
        async generate(){
            setCandidatePanel({sessionId,messageId,phase:'loading',choices:[],error:''});
            try{await submitCandidateTask(sessionId,messageId,'');}
            catch(err){setCandidatePanel({sessionId,messageId,phase:'error',choices:[],error:playerErrorText(err,{fallback:'选项生成未完成'})});}
            finally{liveTavernView.invalidate(sessionId);tavernCoordination.invalidate(sessionId);}
        }
    };
    return stageViews ? React.createElement(stageViews.choices.Choices,{...props,panel,taskForMessage,running,messageId,commands,decode:decodeUnicodeEscapes}) : null;
}
