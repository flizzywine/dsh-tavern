// Reads the plugin's existing session state; no duplicate observation or player state.
function createStageRuntimeUi({React,sessions,kernel,performances,report=error=>console.warn('Stage performance kinds unavailable:',error)}) {
let closed=false;
const selectors=new Set();
function track(selector){
    const dispose=selector.dispose.bind(selector);let released=false;
    const release=()=>{if(released)return;released=true;selectors.delete(release);dispose();};
    if(closed)release();else selectors.add(release);
    return {...selector,dispose:release};
}
// React consumes the session runtime; it never owns an observation loop.
const stageEmptyStore = {select(fn) {
    const value = fn(kernel.createStageRuntimeState());
    return {getSnapshot:() => value,subscribe:() => () => {},dispose() {}};
}};
function useStageSelector(sessionId, select, equal = Object.is) {
    const store = (!closed && sessions.get(sessionId)) || stageEmptyStore;
    const selector = React.useMemo(() => track(store.select(select, equal)), [store]);
    React.useEffect(() => () => selector.dispose(), [selector]);
    return React.useSyncExternalStore(selector.subscribe, selector.getSnapshot);
}
const stageUiEqual = (a, b) => Object.keys(a).every(key => Object.is(a[key], b[key]));
// the session's performance kinds (stage-performance-kinds.cjs) - core and the installed
// managed mods' declarations - read once per stage mount into the runtime (SESSION_INPUTS performanceKinds), where the page's
// sequencing point reads which kinds hold the line; a settled history page replays the kinds
// with replay {stage:true}. Returns {settled (read, or failed and core kinds kept),
// replayable (null until read; isolated stage fixtures without the registry play nothing on history)}.
function useStagePerformanceKinds(sessionId,store) {
    const registry=typeof performances?.registry==='function';
    const [read,setRead]=React.useState({sessionId:null,replayable:null});
    React.useEffect(()=>{
        if(closed)return;
        if(!registry){setRead({sessionId,replayable:null});return;}
        let active=true;
        performances.read(sessionId).then(value=>{
            if(!active || closed)return;
            const kinds=performances.registry([{owner:'core',performances:performances.core},...value.kinds]).list();
            store.dispatch({type:'SESSION_INPUTS',performanceKinds:kinds});
            setRead({sessionId,replayable:kinds.filter(row=>row.replay.stage).map(row=>row.kind)});
        }).catch(error=>{
            if(active && !closed)report(error);
            if(active && !closed)setRead({sessionId,replayable:null});
        });
        return()=>{active=false;};
    },[sessionId,store]);
    return read.sessionId===sessionId ? {settled:true,replayable:read.replayable} : {settled:false,replayable:null};
}
function useStageRuntime(sessionId) {
    const store = sessions.get(sessionId);
    const inputs = useStageSelector(sessionId, state => ({source:state.source, latestSource:state.latestSource,
        text:state.text, textIndex:state.textIndex, cursor:state.cursor, replay:state.replay}), stageUiEqual);
    const accepted = useStageSelector(sessionId, state => state.accepted);
    const director = useStageSelector(sessionId, state => state.director);
    const ledger = useStageSelector(sessionId, state => state.ledger);
    const indicators = useStageSelector(sessionId, kernel.stageRuntimeIndicators, stageUiEqual);
    return {...inputs, accepted, director, ledger, indicators, store};
}

return {useSelector:useStageSelector,useRuntime:useStageRuntime,usePerformanceKinds:useStagePerformanceKinds,dispose(){
    if(closed)return;closed=true;const errors=[];
    for(const release of [...selectors])try{release();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Stage runtime UI cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageRuntimeUi};
