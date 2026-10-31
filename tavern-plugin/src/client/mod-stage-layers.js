// Application-owned renderers; release archives never contribute executable browser code.
const MOD_STAGE_RENDERERS = {};
// a page turn revokes the mod's view (the server publishes
// no views until the new page's arrives, and a late previous-page view is filtered out), which used to unmount the
// layer and mount a fresh one — the 直播中 · 观众 chip blinked and the renderer forgot what it had shown. A layer that
// leaves the visible set is held (mounted, no view update) until its mod's next view; only a mod change, the stage
// unmount or a long silence (MOD_LAYER_HOLD_MS) removes it.
const MOD_LAYER_HOLD_MS = 30000;
// a view with a host (view.streamer) and no face set in its settings
// shows the face of the figure its host name — view.streamer.name, else the player's name — resolves to, through the
// phone's card-figure lookup (useCardFaces: every enabled figure of the card's and global packs, on stage or not).
// The player renaming mid-chat re-resolves at once. No figure or no face: the renderer's neutral face.
// The live-room bar draws the face up to 64 CSS px: prepared at 96 it stays sharp on 1.5× screens.
const MOD_HOST_FACE_PX=96;
const modHostName=(view,player)=>String(view?.streamer?.name || '').trim() || (player && player!=='你' ? player : '');
function modHostFace(view,player,faces) {
    if (!view?.streamer || view.streamer.avatar) return view;
    const url=faces.get(modHostName(view,player));
    return url ? {...view,streamer:{...view.streamer,avatar:{src:url}}} : view;
}
function ModStageLayers({sessionId,sourceKey,stage:facts,config}) {
    // the player's display name joins the read-only stage facts (the live room's 粉丝牌 name).
    const session=typeof useLiveTavernView==='function'?useLiveTavernView(sessionId,'mod-stage-layers'):null,player=String(session?.view?.playerName||'');
    const stage=React.useMemo(()=>({...facts,player}),[facts.title,facts.turn,facts.latestTurn,facts.scene,facts.bgm,player]);
    const marker=React.useRef(null),host=React.useRef(null),rows=React.useRef([]),current=React.useRef({sourceKey,stage}),held=React.useRef(new Map()),expiry=React.useRef(null);
    // Mods the reader just switched off (dsh-tavern-mod-scope): their layers leave at once, not after the save and reread.
    const presentation=React.useRef(new Map()),refresh=React.useRef(null),switchedOff=React.useRef(new Set());
    current.current={sourceKey,stage};
    const [hostNames,setHostNames]=React.useState(''),hostNamesRef=React.useRef('');
    const faceSource=stageSessions.get(sessionId)?.getSnapshot()?.source || null;
    const hostFaces=typeof useCardFaces==='function' ? useCardFaces({config,sessionId,source:faceSource,names:hostNames?hostNames.split('\n'):[],px:MOD_HOST_FACE_PX}) : new Map(),faces=React.useRef(hostFaces);
    faces.current=hostFaces;
    const facesKey=[...hostFaces].map(([name,url])=>name+'\u0000'+url).join('\n');
    const sync=()=>{
        const snapshot=stageSessions.get(sessionId)?.getSnapshot(),anchor=snapshot?.cursor?.anchor;
        const source=snapshot?.source,displayToken=source && JSON.stringify([source.sourceKey,source.generation,source.branchId,source.authorityEpoch]);
        const visible=rows.current.filter(row=>!switchedOff.current.has(row.modId) && (row.view?.displayTurn ?? row.context.settledTurn)===current.current.stage.turn &&
            (row.view?.displayToken?row.view.displayToken===displayToken:!current.current.sourceKey || row.context.sourceKey===current.current.sourceKey) &&
            (!anchor || !Number.isInteger(row.view?.anchor?.paragraph) || row.view.anchor.paragraph===anchor.para && row.view.anchor.charOffset===anchor.offset));
        const names=[...new Set(visible.map(row=>modHostName(row.view,current.current.stage.player)).filter(Boolean))].join('\n');
        if (names!==hostNamesRef.current) {hostNamesRef.current=names;setHostNames(names);}
        const now=Date.now(),layers=new Map();
        for(const row of visible){layers.set(row.modId,(row.manifest.uiLayers||[]).map(layer=>({...layer,modId:row.modId})));held.current.set(row.modId,{layers:layers.get(row.modId),at:now});}
        for(const [modId,hold] of held.current) {
            if(layers.has(modId))continue;
            if(switchedOff.current.has(modId)){held.current.delete(modId);continue;}
            if(snapshot?.visible!==false && now-hold.at>=MOD_LAYER_HOLD_MS){held.current.delete(modId);continue;}
            layers.set(modId,hold.layers);
        }
        clearTimeout(expiry.current);expiry.current=null;
        const waiting=[...held.current].filter(([modId])=>!visible.some(row=>row.modId===modId));
        if(waiting.length && snapshot?.visible!==false)expiry.current=setTimeout(sync,Math.max(16,Math.min(...waiting.map(([,hold])=>hold.at+MOD_LAYER_HOLD_MS-now))));
        host.current?.sync([...layers.values()].flat(),
            {sessionId,...visible[0]?.context,stage:current.current.stage},Object.fromEntries(visible.map(row=>{
                const values=presentation.current.get(row.modId);
                if(values && Object.entries(values).every(([key,value])=>row.view.settings?.[key]===value))presentation.current.delete(row.modId);
                const view=modHostFace(row.view,current.current.stage.player,faces.current);
                return [row.modId,values?{...view,...(values.view!==undefined?{view:values.view}:{}),settings:{...view.settings,...values}}:view];
            })));
    };
    React.useEffect(()=>{
        let live=true,reading=false,dirty=false,version=0;
        const sessionRuntime=stageViews.sessionRuntime;
        const root=marker.current.closest('.fork-gal-stage');
        host.current=createModUiLayerHost({root,renderers:MOD_STAGE_RENDERERS});
        // Streaming lines can arrive faster than reads: show each result, then read the latest once.
        const page=()=>JSON.stringify(stageSessions.get(sessionId)?.getSnapshot()?.cursor?.anchor);
        const read=async()=>{
            dirty=true;if(reading)return;reading=true;
            try {while(live&&dirty){dirty=false;const anchor=page(),own=version;try{const result=await rpc('getModStageViews',{sessionId},sessionId);if(live&&own===version&&anchor===page()){rows.current=result.views;sync();}else if(live&&own===version&&anchor!==page())dirty=true;}catch(error){if(live&&own===version&&anchor===page()){rows.current=[];sync();console.warn('Mod display read failed',error);}}}}
            finally{reading=false;}
        };
        const activity=()=>{if(!live)return;sessionRuntime.reannounce(sessionId);void read();};
        refresh.current=read;
        const visibility=()=>{if(!document.hidden)activity();else sync();};
        // A mod switched off or reconfigured: its held layer goes with the next read instead of waiting out the hold.
        const modsChanged=event=>{if(event.detail?.presentationOnly)return;presentation.current.clear();held.current.clear();activity();};
        const preview=event=>{const {modId,values}=event.detail;presentation.current.set(modId,{...presentation.current.get(modId),...values});sync();};
        const scope=event=>{const {modId,enabled}=event.detail;if(enabled)switchedOff.current.delete(modId);else switchedOff.current.add(modId);sync();};
        const changed=signal=>{if(live&&Array.isArray(signal?.snapshot?.views)){version++;rows.current=signal.snapshot.views;sync();}else void read();};
        const stop=tavernSessionSignals.subscribe(sessionId,'mod-view',changed,read,activity);
        window.addEventListener('dsh-tavern-mods-changed',modsChanged);window.addEventListener('dsh-tavern-mod-presentation',preview);window.addEventListener('dsh-tavern-mod-scope',scope);
        document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',visibility);activity();
        return()=>{live=false;refresh.current=null;stop();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',visibility);window.removeEventListener('dsh-tavern-mods-changed',modsChanged);window.removeEventListener('dsh-tavern-mod-presentation',preview);window.removeEventListener('dsh-tavern-mod-scope',scope);clearTimeout(expiry.current);expiry.current=null;held.current.clear();host.current.dispose();host.current=null;rows.current=[];};
    },[sessionId]);
    React.useEffect(()=>{sync();void refresh.current?.();},[sourceKey,stage]);
    React.useEffect(()=>{if (host.current) sync();},[facesKey]);
    return React.createElement('span',{ref:marker,'aria-hidden':true,style:{display:'none'}});
}
