// React consumes the session runtime; it never owns an observation loop.
const stageEmptyStore = {select(fn) {
    const value = fn(createStageRuntimeState());
    return {getSnapshot:() => value,subscribe:() => () => {},dispose() {}};
}};
function useStageSelector(sessionId, select, equal = Object.is) {
    const store = stageSessions.get(sessionId) || stageEmptyStore;
    const selector = React.useMemo(() => store.select(select, equal), [store]);
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
    const registry=typeof createStagePerformanceRegistry==='function';
    const [read,setRead]=React.useState({sessionId:null,replayable:null});
    React.useEffect(()=>{
        if(!registry){setRead({sessionId,replayable:null});return;}
        let active=true;
        rpc('getStagePerformanceKinds',{},sessionId).then(value=>{
            if(!active)return;
            const kinds=createStagePerformanceRegistry([{owner:'core',performances:STAGE_PERFORMANCE_CORE},...value.kinds]).list();
            store.dispatch({type:'SESSION_INPUTS',performanceKinds:kinds});
            setRead({sessionId,replayable:kinds.filter(row=>row.replay.stage).map(row=>row.kind)});
        }).catch(error=>{
            console.warn('Stage performance kinds unavailable:',error);
            if(active)setRead({sessionId,replayable:null});
        });
        return()=>{active=false;};
    },[sessionId,store]);
    return read.sessionId===sessionId ? {settled:true,replayable:read.replayable} : {settled:false,replayable:null};
}
function useStageRuntime(sessionId) {
    const store = stageSessions.get(sessionId);
    const inputs = useStageSelector(sessionId, state => ({source:state.source, latestSource:state.latestSource,
        text:state.text, textIndex:state.textIndex, cursor:state.cursor, replay:state.replay}), stageUiEqual);
    const accepted = useStageSelector(sessionId, state => state.accepted);
    const director = useStageSelector(sessionId, state => state.director);
    const ledger = useStageSelector(sessionId, state => state.ledger);
    const indicators = useStageSelector(sessionId, stageRuntimeIndicators, stageUiEqual);
    return {...inputs, accepted, director, ledger, indicators, store};
}

function useStagePosition(...args) { return stageViews.position.usePosition(...args); }

function stageVoiceHandle(sessionId, descriptor, config, paragraphId, available) {
    if (descriptor?.narration) return stageNarratorHandle(sessionId, descriptor, config, paragraphId, available);
    if (!descriptor || config?.voice?.enabled === false || !(available ?? stageVoiceAvailable())) return null;
    const input = segmentSpeechInput({...descriptor, kind:'bubble'}, config);
    if (!input) return null;
    const character = bubbleCharacter(config,descriptor);
    const owner = sessionId + ':stage', id = JSON.stringify([paragraphId, descriptor.alias, input.text, input.mood,
        character.voiceKey, characterVoiceLanguage(character)]);
    // Match transcript identity after authored/legacy names resolve to the same figure.
    const cacheKey = JSON.stringify([sessionId,character.alias,character.voiceKey,characterVoiceLanguage(character),input.text,input.mood]);
    const selectionKey=descriptor.lineIdentity ? JSON.stringify([sessionId,...descriptor.lineIdentity]) : undefined;
    const request = {...input, owner, id, selectionKey, cacheKey:JSON.stringify([cacheKey,selectionKey])}, resource = () => rpc('openAssetPackVoice', {alias:character.alias}, sessionId);
    return {...request, prefetch:() => voicePlayer.prefetch(resource, request),
        click:options => voicePlayer.play(resource, {...request, handoff:options?.handoff === true, automatic:options?.automatic === true})};
}

// 旁白配音: the same player, queue, mixer bus and cache as a line; config.narrator exists only while it speaks on this card.
function stageNarratorHandle(sessionId, descriptor, config, paragraphId, available) {
    const narrator = config?.narrator;
    if (!narrator || !(available ?? stageVoiceAvailable())) return null;
    const owner = sessionId + ':stage', text = descriptor.text, id = JSON.stringify([paragraphId, descriptor.lineIdentity, 'narrator', text, narrator.voiceKey]);
    const selectionKey = JSON.stringify([sessionId, ...descriptor.lineIdentity]);
    const request = {text, mood:null, owner, id, selectionKey, cacheKey:JSON.stringify([[sessionId, 'narrator', narrator.voiceKey, 'zh', text], selectionKey])};
    const resource = () => rpc('openAssetPackVoice', {narrator:true}, sessionId);
    // options.id: a 履历 narration row plays its pages under the row's one id (galBacklogNarration).
    return {...request, narration:true, prefetch:() => voicePlayer.prefetch(resource, request),
        click:options => voicePlayer.play(resource, {...request, id:options?.id || id, handoff:options?.handoff === true, automatic:options?.automatic === true})};
}

// callers that build many handles (every page of a turn, each render) look the
// TTS client up once and pass `available`; the host service lookup per handle was a page-turn hot spot.
function stageVoiceAvailable() { return typeof forkTtsScope !== 'undefined' && !!forkTtsScope?.get('ttsClient')?.available(); }
function stageVoiceWindowFromIndex(sessionId,index,turn,pages,page,config,limit = Infinity) {
    const handles = [], seen = new Set(), available = stageVoiceAvailable();
    const next = [...index.keys()].filter(number => number > turn).sort((a,b) => a-b)[0];
    for (const number of [turn,next]) {
        const row = index.get(number);
        if (!row) continue;
        // current/next first on jumps, then finish the whole viewed turn.
        for (const item of number === turn ? [...pages.slice(page),...pages.slice(0,page)] : row.text.pages) {
            if (item.pending || !item.voice) continue;
            const handle = number === turn ? item.voice : stageVoiceHandle(sessionId,item.voice,config,item.anchor.paragraphId,available);
            // subtitle cards share one speech clip.
            const key = handle && JSON.stringify([handle.owner,handle.id]);
            if (handle && !seen.has(key)) {seen.add(key); handles.push(handle);}
            if (handles.length >= limit) return handles;
        }
    }
    return handles;
}

function useStageConsumers(...args) { return stageViews.displayConsumers.useConsumers(...args); }
