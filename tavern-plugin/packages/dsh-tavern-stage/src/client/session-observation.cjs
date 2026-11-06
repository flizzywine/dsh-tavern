// Session policy belongs to the plugin; adapters provide native facts and shared media/cache operations.
function createStageSessionObservation({owner,resources,resourceOwner,selection,settings,packs,entry,voice,portraits,media,document}) {
    let closed=false,started=false;
    const cleanups=[];
    const active=()=>!closed;
    const own=cleanup=>{if(closed)cleanup();else cleanups.push(cleanup);};
    const equal=(a,b)=>a===b || (!!a && !!b && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(key=>Object.is(a[key],b[key])));
    function observe(store,select,listener,compare){
        const source=store.select(select,compare);let stop;
        try{stop=source.subscribe(listener);}catch(error){source.dispose();throw error;}
        let released=false;
        return ()=>{if(released)return;released=true;try{stop();}finally{source.dispose();}};
    }
    function dispose(){
        if(closed)return;closed=true;const errors=[];
        for(const cleanup of cleanups.reverse())try{cleanup();}catch(error){errors.push(error);}
        if(errors.length)throw new AggregateError(errors,'Stage observation cleanup failed');
    }
    function start(){
        if(closed)throw new Error('Stage observation disposed');
        if(started)return;started=true;
        try{
        // the session index survives transcript virtualization. Only the
        // selected chat's sealed latest lines and viewed/next turns are synthesized.
        let voiceStore = null, stopVoiceSource = null;
        own(() => stopVoiceSource?.());
        const syncVoice = () => {
            if (!active()) return;
            const id = selection.current() || null;
            const store = id ? owner.get(id) : null;
            if (store !== voiceStore) {
                stopVoiceSource?.(); voiceStore = store; stopVoiceSource = null;
                if (store) {
                    stopVoiceSource = observe(store,state => ({textIndex:state.textIndex,source:state.source,latestSource:state.latestSource,
                        settings:state.settings,opened:state.opened,interrupted:state.interrupted}),syncVoice,equal);
                }
            }
            const state = store?.getSnapshot(), handles = [];
            const config = state?.settings?.config;
            const latest = state?.latestSource?.turn;
            // While this session's stage is entering, its own first-page window (gal-stage.js) is the only voice
            // needed: the rest of the latest body would take the entry's connections. It warms once the entry is shown.
            const entering = entry.hasDisplay() && entry.shown.get() !== store;
            const turns = new Set(latest === undefined || entering ? [] : [latest]);
            // Historical lookahead waits for reveal; sealed lines in the latest body can warm immediately.
            if (state?.opened && state.source && entry.shown.get() === store) {
                turns.add(state.source.turn);
                const next = [...state.textIndex.keys()].filter(turn => turn > state.source.turn).sort((a,b) => a-b)[0];
                if (next !== undefined) turns.add(next);
            }
            const available = voice.available();
            for (const turn of turns) {
                const row = state.textIndex.get(turn);
                if (!row || state.interrupted && turn === latest) continue;
                for (const page of row.text.pages) {
                    if (page.pending) continue;
                    const handle = voice.handle(id,page.voice,config,page.anchor.paragraphId,available);
                    if (handle) handles.push(handle);
                }
            }
            voice.retain(handles);
            for (const handle of handles) void handle.prefetch();
        };
        own(selection.list.subscribe(syncVoice));
        own(entry.shown.subscribe(syncVoice));
        own(settings.subscribe(syncVoice));
        own(packs.subscribe(syncVoice));
        syncVoice();
        // the BGM player follows the selected session (after the owner made its store).
        // The manual background (bg-manual.js) follows the same session.
        // Ambience (stage-ambience.js) follows the same session as the BGM, in the stage and in chat.
        const bgmSelect = () => { if(!active())return; media.music.activate(selection.current() || null); media.background.activate(selection.current() || null); media.ambience.activate(selection.current() || null); };
        own(() => media.music.activate(null));
        own(() => media.background.activate(null));
        own(() => media.ambience.activate(null));
        own(selection.list.subscribe(bgmSelect));
        const bgmKick = () => { if(!active())return; media.music.kick(); media.ambience.resume(); };
        document.addEventListener('pointerdown', bgmKick, true);
        own(() => document.removeEventListener('pointerdown', bgmKick, true));
        document.addEventListener('keydown', bgmKick, true);
        own(() => document.removeEventListener('keydown', bgmKick, true));
        bgmSelect();
        const prefetches = new Map(), avatarQueue = [];
        let avatarGeneration = 0, avatarSession = null, avatarStore = null, stopAvatarSource = null, avatarFlights = 0;
        // the card's whole face catalogue (118 for a large card) was acquired at once on
        // session selection; in the debug slot that burst kept ~124 lease/control requests in flight for 15-28 s each, ahead
        // of the stage's first page. Two in flight, as bubbleMediaPool's and the runner's idle face warm-ups.
        own(() => { avatarGeneration++; portraits.select(null); });
        own(() => stopAvatarSource?.());
        const pumpAvatars = () => {
            // Catalogue faces are speculative; leave the connection slots to the entry page.
            const entering = entry.entering();
            if (active() && (entering || entry.hasDisplay()) && entry.shown.get() !== avatarStore) return;
            while (avatarFlights < 2 && avatarQueue.length) {
                avatarFlights++;
                avatarQueue.shift()().finally(() => { avatarFlights--; pumpAvatars(); });
            }
        };
        own(() => pumpAvatars());
        const avatarRevisions = new Map();
        const syncAvatars = () => {
            if (!active()) return;
            const id = selection.current() || null;
            if (id !== avatarSession) { avatarSession = id; avatarGeneration++; prefetches.clear(); }
            portraits.select(id);
            const store = id ? owner.get(id) : null;
            if (store !== avatarStore) {
                stopAvatarSource?.(); avatarStore = store; stopAvatarSource = null;
                if (store) {
                    stopAvatarSource = observe(store,state => state.source,syncAvatars);
                }
            }
            if (!id) return;
            const source = store?.getSnapshot().source;
            const characters = settings.get(id)?.config?.characters || [];
            for (const character of characters) {
                const descriptor = character.avatarMedia?.default;
                if (!descriptor || (avatarRevisions.has(descriptor.ref.packId) && avatarRevisions.get(descriptor.ref.packId) !== descriptor.revision)) continue;
                portraits.revision(descriptor.ref.packId,descriptor.revision);
                const avatar = {...descriptor,sessionId:id}, key = JSON.stringify(avatar), generation = avatarGeneration;
                if (!source || prefetches.has(key) || portraits.get(avatar)) continue;
                const job = new Promise(resolve => avatarQueue.push(() => (!active() || generation !== avatarGeneration ? Promise.resolve()
                    : resourceOwner.acquire(descriptor,JSON.stringify([source.sessionId,source.authorityEpoch])).then(async pin => {
                        try {
                            if (active() && generation === avatarGeneration) await portraits.prepare(avatar,pin.handle.url);
                        } finally { pin.release(); }
                    })).catch(() => {}).finally(resolve))).finally(() => { if (prefetches.get(key) === job) prefetches.delete(key); });
                prefetches.set(key,job);
            }
            pumpAvatars();
        };
        own(entry.shown.subscribe(pumpAvatars));
        own(selection.list.subscribe(syncAvatars));
        own(settings.subscribe(syncAvatars));
        syncAvatars();
        // deletion is authoritative even while observation timers sleep.
        // Other transport events only request validation; disconnect is not revoke: a lost
        // connection stops the reads in flight and keeps every mounted figure, background, skin and face; reconnecting
        // ('available', then the feed's reset) re-reads them. Deleting, disabling or unbinding a pack still revokes below
        // (revision null) or through the projection's 'revoked' answer.
        const packChanged = event => {
            if (!active()) return;
            if (event?.type === 'unavailable') { avatarGeneration++; prefetches.clear(); }
            else if (event?.type === 'available') syncAvatars();
            else if (event?.packId && event.revision !== undefined) {
                resourceOwner.invalidateDerived({packId:event.packId});
                avatarRevisions.set(event.packId,event.revision);
                portraits.revision(event.packId,event.revision);
            }
            for (const id of Object.keys(selection.list.getSnapshot().byId || {})) {
                const store = owner.get(id), source = store?.getSnapshot().source;
                if (!source) continue;
                resources.invalidate(id);
                if (event?.type === 'unavailable') resources.suspend(id);
                else if (event?.revision === null && event.packId) resources.revoke(id,{packId:event.packId},store.dispatch,store.getSnapshot);
                else store.dispatch({type:'REFRESH_BEGIN',source});
            }
            if (event) { media.music.invalidate(); media.background.invalidate(); }
        };
        own(packs.subscribe(packChanged));
        // installing the Cubism Core re-reads open stages, so figures shown as their
        // static sprite switch to Live2D in place (no reload, no state change). Importing the Spine runtime does the same.

        const stopSpineRuntime = packs.runtimeChanged(() => packChanged(null));
        own(stopSpineRuntime);
        const visibility = () => {
            if (!active()) return;
            const snapshot = selection.list.getSnapshot();
            for (const id of Object.keys(snapshot.byId || {})) owner.get(id)?.dispatch({type: 'VISIBILITY', visible: !document.hidden});
        };
        // Visibility is observation/visual policy only. Never mute audio on hide.
        document.addEventListener('visibilitychange', visibility);
        own(() => document.removeEventListener('visibilitychange', visibility));
        visibility();
        }catch(error){
            try{dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage observation startup failed');}
            throw error;
        }
    }
    return {start,dispose};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSessionObservation};
