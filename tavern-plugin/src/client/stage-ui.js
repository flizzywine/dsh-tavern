// React consumes the session runtime; it never owns an observation loop.
const stageConsumers = new Map();
const stageEmptySnapshot = createStageRuntimeState();
const stageEmptyStore = {select(fn) {
    const value = fn(stageEmptySnapshot);
    return {getSnapshot:() => value,subscribe:() => () => {},dispose() {}};
}};
function useStageSelector(sessionId, select, equal = Object.is) {
    const store = stageSessions.get(sessionId) || stageEmptyStore;
    const selector = React.useMemo(() => store.select(select, equal), [store]);
    React.useEffect(() => () => selector.dispose(), [selector]);
    return React.useSyncExternalStore(selector.subscribe, selector.getSnapshot);
}
const stageUiEqual = (a, b) => Object.keys(a).every(key => Object.is(a[key], b[key]));
function useStageModHistory(sessionId) {
    const [history,setHistory]=React.useState(null);
    React.useEffect(()=>{
        let active=true,reading=false,dirty=false;
        async function read() {
            if(reading){dirty=true;return;}
            reading=true;
            // {turns, kinds}: the stored performances by turn and the managed mods' declared kinds.
            try {const value=await rpc('getStageModHistory',{},sessionId);if(active)setHistory({turns:value.turns,kinds:value.kinds});}
            catch (_) { /* A failed read never replaces a previously accepted history. */ }
            finally {reading=false;if(active && dirty){dirty=false;void read();}}
        }
        setHistory(null);void read();
        const stop=tavernSessionSignals.subscribe(sessionId,'stage-direction',read,read,read);
        return()=>{active=false;stop();};
    },[sessionId]);
    return history;
}
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

function useStagePosition(sessionId, runtime, parts, pages, {restored, onSelect}) {
    const writer = React.useMemo(() => {
        let storage = null;
        try { storage = localStorage; } catch (_) {}
        return galPositionWriter(sessionId,storage,setTimeout,clearTimeout);
    },[sessionId]);
    const turn = runtime.source?.turn || 0;
    const page = Math.max(0,pages.findIndex(item => sameAnchor(item.anchor,runtime.cursor.anchor)));
    // the turn's text digest is hashed once per parts array, not on every render.
    const textDigest = React.useMemo(() => galTextDigest(parts), [parts]);
    const anchor = pages[page]?.anchor;
    const active = {turn,page,textDigest,pageCount:pages.length,anchor:anchor ? {para:anchor.para,offset:anchor.offset} : null,latestSeenTurn:runtime.latestSource?.turn || turn};
    // A replay (clip export, a 履历 row's single replay) is not a reading position: the bookmark stays where the reader was.
    const ready = restored && runtime.cursor.mode !== 'replay' && !runtime.text.streaming && galPositionReady(null,turn,parts,pages);
    React.useEffect(() => {
        if (ready) writer.write(active);
        else writer.discard();
    },[writer,turn,page,textDigest,ready,pages.length,active.latestSeenTurn]);
    React.useEffect(() => {
        window.addEventListener('pagehide',writer.flush);
        return () => {window.removeEventListener('pagehide',writer.flush);writer.flush();};
    },[writer]);
    // The shown page is read to its end: the runtime's in-page reading progress (one-shots placed after it).
    return [page,index => {
        onSelect();
        if (index !== page) stageSessions.owner.navigate(sessionId,turn,index,index > page);
    },writer.saved,() => {
        const current = pages[page];
        runtime.store.dispatch({type:'READ_PROGRESS',source:runtime.source,anchor:current?.anchor,readThrough:(current?.anchor.offset || 0) + (current?.text.length || 0)});
    }];
}

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

// The runner awaits these actual consumer acknowledgements before retiring outgoing pins.
function useStageConsumers(sessionId, store, onEvent, performanceAdapter, cgAdapter, modAdapter) {
    const event = React.useRef(onEvent); event.current = onEvent;
    const performanceSink=React.useRef(performanceAdapter);performanceSink.current=performanceAdapter;
    const cgSink=React.useRef(cgAdapter);cgSink.current=cgAdapter;
    const modSink=React.useRef(modAdapter);modSink.current=modAdapter;
    const pending = React.useRef(new Map());
    const onPresented = React.useCallback(revision => {
        for (const [key, resolve] of pending.current) if (key <= revision) { pending.current.delete(key); resolve(); }
    }, []);
    React.useLayoutEffect(() => {
        // ambience is the page-wide owner's (stage-ambience.cjs), in the stage and in chat
        // alike, as music is the BGM player's; the stage hands it what it presents and its performance layer.
        // a page turn lets a sounding one-shot SE ring out (stage-sfx.js caps
        // it). `carried` are the SE tokens rung over from an earlier page; a scene (background) change cuts them.
        const ringing = new Set(), carried = new Set(), sceneOf = accepted => JSON.stringify(accepted?.scene?.background ?? null);
        let scene = sceneOf(store.getSnapshot().accepted);
        const consume = {
            present(intent) {
                if (intent.type === 'playback-policy') return;
                if (intent.type === 'release-presentation' || intent.type === 'revoke-presentation') { ambience.release(); modSink.current?.cancel(intent); return cgSink.current?.(intent); }
                // music is the BGM player's (bgm-player.cjs), in the stage and in chat alike.
                const waits = [], value = intent.accepted, snap = intent.transition === 'snap';
                if (intent.groups.includes('visual') || intent.groups.includes('background')) {
                    const next = sceneOf(value);
                    if (next !== scene) { scene = next; carried.forEach(id => stageSfx.stopToken(id)); carried.clear(); }
                }
                if (intent.groups.includes('cg')) waits.push(cgSink.current?.(intent));
                if (intent.groups.includes('ambience')) waits.push(ambience.present(value.ambience, snap));
                if (intent.groups.some(group => ['visual','background','avatars'].includes(group) || group.startsWith('figure:'))) waits.push(new Promise(resolve => {
                    const previous = pending.current.get(value.presentationRevision);
                    pending.current.set(value.presentationRevision, () => {previous?.(); resolve();});
                }));
                return Promise.all(waits);
            },
            performance(intent) {
                if(intent.type === 'layer') {
                    const layer=intent.layer.ambience, ref=layer?.ref;
                    const track=ref && intent.value.dependencies.find(item => item.ref.packId===ref.packId && item.ref.kind===ref.kind && item.ref.assetId===ref.assetId);
                    ambience.performance(track ? {...track,gain:10**((layer.gainDb || 0)/20)} : null, intent.snap);
                } else if(intent.type === 'clear') ambience.performance(null, true);
                return performanceSink.current?.(intent);
            },
            play(value, token) {
                if (store.getSnapshot().accepted.cg && ['act','emote','focus'].includes(value.kind)) return;
                if (value.kind === 'voice') {
                    const state=store.getSnapshot();
                    if(!phoneModAutoVoiceAllowed(state.director,token.anchor.para,state.settings?.config?.stage?.director===true))return;
                    const voice = stageVoiceHandle(sessionId, value, state.settings?.config, token.anchor.paragraphId);
                    return voice?.click({handoff:true,automatic:true});
                }
                if (value.url) {
                    ringing.add(token.id);
                    return stageSfx.play(value.url, value.identity, value.ref, token.id, value.gain ?? 1,
                        {...value, trace: {reason: 'director-event', token: token.key, turn: token.source?.turn, para: token.anchor?.para}})
                        .finally(() => { ringing.delete(token.id); carried.delete(token.id); });
                }
                return event.current(value, token);
            },
            cancel(intent) {
                if (!intent.token) modSink.current?.cancel(intent);
                if (intent.reason === 'revoked' && intent.token) stageSfx.stopToken(intent.token.id);
                else if (intent.reason === 'page-changed') { ringing.forEach(id => carried.add(id)); voicePlayer.stopPlayback(); }
                else { stageSfx.stop(); voicePlayer.stopPlayback(); }
            }
        };
        stageConsumers.set(sessionId, consume);
        // The stage opens behind its loading veil / 入场演出; it reveals itself (STAGE_REVEAL) when that ends.
        store.dispatch({type:'STAGE_OPEN', opened:true, revealed:false});
        return () => {
            store.dispatch({type:'STAGE_OPEN', opened:false});
            stageConsumers.delete(sessionId);
            // Leaving the stage keeps the scene's ambience (as the BGM); only the performance's own layer ends with it.
            ambience.performance(null, true); stageSfx.stop(); voicePlayer.stop();
            onPresented(Infinity);
        };
    }, [sessionId, store]);
    return onPresented;
}
