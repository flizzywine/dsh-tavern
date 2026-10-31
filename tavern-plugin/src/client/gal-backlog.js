// Host chat snapshots and canonical direction projection enter through this adapter.
function useGalPlayerInputs(sessionId, useChat) {
    const nodes = useChat ? useChat(snapshot => snapshot && snapshot.legacy && snapshot.legacy.nodes || null) : null;
    const live = useLiveTavernView(sessionId, "gal-backlog");
    const view = live && live.view;
    return React.useMemo(function () {
        const sources = view && view.inputSources;
        return stageViews.backlogRows.galPlayerInputs(nodes, dsh => tavernStoryTurnForDshTurn(view, dsh),
            dsh => sources && Object.prototype.hasOwnProperty.call(sources, String(dsh)) && sources[dsh] != null ? String(sources[dsh]) : null);
    }, [nodes, view]);
}
function GalBacklog(props) {
    const inputs=useGalPlayerInputs(props.sessionId,props.useChat);
    const chatId=useLiveTavernView(props.sessionId,"gal-backlog")?.view?.chatId || "";
    const readDirection=React.useMemo(()=>props.readDirection ? async request=>{
        const value=await props.readDirection(request);
        const projected=value.token ? await projectStageDirection(value,{sessionId:props.sessionId,turn:request.turn}) : null;
        return projected ? {...value,entries:projected.entries} : value;
    } : null,[props.sessionId,props.readDirection]);
    return stageViews ? React.createElement(stageViews.backlogView.Backlog,{...props,inputs,chatId,readDirection}) : null;
}
