// Display-owned media policy. Shared speech playback remains a supplied service.
function createStageDisplayConsumers({React,displays,ambience,sfx,voice}){
let disposed=false;const instances=new Set();
// The runner awaits these actual consumer acknowledgements before retiring outgoing pins.
function useStageConsumers(sessionId, store, onEvent, performanceAdapter, cgAdapter, modAdapter) {
    const event = React.useRef(onEvent); event.current = onEvent;
    const performanceSink=React.useRef(performanceAdapter);performanceSink.current=performanceAdapter;
    const cgSink=React.useRef(cgAdapter);cgSink.current=cgAdapter;
    const modSink=React.useRef(modAdapter);modSink.current=modAdapter;
    const display = React.useMemo(() => ({current:null}), [sessionId,store]);
    const onPresented = React.useCallback(revision => display.current?.confirm(revision), [display]);
    React.useLayoutEffect(() => {
        if(disposed)return;
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
                    if (next !== scene) { scene = next; carried.forEach(id => sfx.stopToken(id)); carried.clear(); }
                }
                if (intent.groups.includes('cg')) waits.push(cgSink.current?.(intent));
                if (intent.groups.includes('ambience')) waits.push(ambience.present(value.ambience, snap));
                if (intent.groups.some(group => ['visual','background','avatars'].includes(group) || group.startsWith('figure:'))) waits.push(display.current.waitPresented(value.presentationRevision));
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
                    if(!voice.allowed(state.director,token.anchor.para,state.settings?.config?.stage?.director===true))return;
                    const handle = voice.handle(sessionId, value, state.settings?.config, token.anchor.paragraphId);
                    return handle?.click({handoff:true,automatic:true});
                }
                if (value.url) {
                    ringing.add(token.id);
                    return sfx.play(value.url, value.identity, value.ref, token.id, value.gain ?? 1,
                        {...value, trace: {reason: 'director-event', token: token.key, turn: token.source?.turn, para: token.anchor?.para}})
                        .finally(() => { ringing.delete(token.id); carried.delete(token.id); });
                }
                return event.current(value, token);
            },
            cancel(intent) {
                if (!intent.token) modSink.current?.cancel(intent);
                if (intent.reason === 'revoked' && intent.token) sfx.stopToken(intent.token.id);
                else if (intent.reason === 'page-changed') { ringing.forEach(id => carried.add(id)); voice.stopPlayback(sessionId); }
                else { sfx.stop(); voice.stopPlayback(sessionId); }
            }
        };
        const connection=displays.attach(sessionId,consume);
        display.current=connection;
        let closed=false;
        const close=()=>{
            if(closed)return;closed=true;instances.delete(close);
            connection.detach();
            if(display.current===connection)display.current=null;
            const errors=[];
            // Leaving the display preserves the scene's page-wide ambience and BGM.
            for(const cleanup of [()=>store.dispatch({type:'STAGE_OPEN',opened:false}),()=>ambience.performance(null,true),()=>sfx.stop(),()=>voice.stop(sessionId)]){
                try{cleanup();}catch(error){errors.push(error);}
            }
            if(errors.length)throw new AggregateError(errors,'Stage display cleanup failed');
        };
        instances.add(close);
        try{store.dispatch({type:'STAGE_OPEN', opened:true, revealed:false});}
        catch(error){try{close();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage display startup failed');}throw error;}
        return close;
    }, [sessionId, store]);
    return onPresented;
}

return {useConsumers:useStageConsumers,dispose(){
    if(disposed)return;disposed=true;const errors=[];
    for(const close of [...instances])try{close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Stage displays cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDisplayConsumers};
