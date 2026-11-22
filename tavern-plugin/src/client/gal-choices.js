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
    const taskForMessage = useCandidateRound(sessionId, messageId, running, coordination.view?.task);
    const panel = candidatePanelForRound(panelState, sessionId, messageId, running);
    const commands={
        clear:()=>setCandidatePanel(null),
        async stop(taskId){try{await rpc('stopChoices',{taskId},sessionId);setCandidatePanel(null);}finally{liveTavernView.invalidate(sessionId);tavernCoordination.invalidate(sessionId);}},
        async generate(){
            try{await interactions.generateCandidates(sessionId,messageId);}
            finally{liveTavernView.invalidate(sessionId);}
        }
    };
    return stageViews ? React.createElement(stageViews.choices.Choices,{...props,panel,taskForMessage,running,messageId,commands,decode:decodeUnicodeEscapes}) : null;
}
