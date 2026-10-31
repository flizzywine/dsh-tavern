// session-owned inputs and continuous read-only direction observation.
// D supplies resource effects; F switches the UI. No second player runs here.
// @include-protocol performance-state.cjs
// @include-protocol performance-timeline.cjs
// @include mod-projection.cjs
// @include phone-beat.cjs
// @include-stage lifetime.cjs
// @include-stage entry.cjs
// @include stage-runtime.cjs
// @include stage-page-index.cjs
// @include stage-text-index.cjs
// @include stage-resources.cjs
// @include stage-ui.js
// @include-protocol stage-skin.cjs
// @include stage-skin-adapter.cjs
// @include stage-skin-ui.js
// @include stage-skin-decoration.js
// @include stage-rects.cjs
// @include skin-overlay-loader.cjs
// @include performance-keyframe-layer.js
// @include performance-layer.js

// gal-entry.js (stage bundle) owns the entry signal; harnesses that load this file alone treat every stage as shown.
const stageResourceAuthority = source => JSON.stringify([source.sessionId,source.authorityEpoch]);
const stageEntryShown = () => typeof galEntryShown === 'undefined' ? {get: () => undefined, subscribe: () => () => {}, wait: () => Promise.resolve()} : galEntryShown;
const stageSessions = {
    owner: null,
    resourceOwner: null,
    get(sessionId) { return this.owner?.get(sessionId) || null; },
    start(ctx) {
        return startStageClientLifetime(({own, active}) => {
        const preferences = {
            get: () => ({reading: stageReading.get(), film: stageFilm.get(), audio: forkStageAudio.get()}),
            subscribe(listener) {
                const stops = [stageReading, stageFilm, forkStageAudio].map(source => source.subscribe(listener));
                return () => stops.forEach(stop => stop());
            }
        };
        const resourceOwner = createStageResourceOwner({service:() => packTransport?.service,decode:stageDecodeImage});
        this.resourceOwner = resourceOwner;
        own(() => { if (this.resourceOwner === resourceOwner) this.resourceOwner = null; });
        own(() => resourceOwner.dispose());
        const resourceDebug = {readiness:() => {
            const sessionId = tavernMainSessionId(ctx.sessions) || null;
            return {sessionId,viewPhase:sessionId ? liveTavernView.getSnapshot(sessionId).phase : null};
        }, read:(method,args,signal) => {
            if (!['getStageDirection','getDialogueBubbles','getAssetPackPresentation'].includes(method)) throw new Error('Unsupported read-only probe method');
            return rpc(method,{...args,readOnly:true},args.sessionId,{signal});
        }, firstPage:(config,body) => {
            const paragraph = body?.paragraphs.find(row => stagePageCards(row).length);
            if (!paragraph) return null;
            const character = bubbleCharacter(config,paragraph);
            return {page:{index:0,para:paragraph.para,offset:stagePageCards(paragraph)[0].offset,
                kind:paragraph.kind,speaker:character?.alias || null},
                portrait:bubbleMediaDescriptor(character,paragraph.mood,bubbleMoodList(config,character?.alias))};
        }, bubbleResources:config => {
            const state = this.get(window.__dshTavernSelectedSessionId)?.getSnapshot();
            return (state?.text.pages || []).filter(page => page.kind === 'line').map(page => {
                const character = bubbleCharacter(config,page);
                return bubbleMediaDescriptor(character,page.mood,bubbleMoodList(config,character?.alias));
            }).filter(Boolean);
        }, snapshot:() => ({...resourceOwner.debug(), runtime: (() => {
            const state = this.get(window.__dshTavernSelectedSessionId)?.getSnapshot();
            const pageIndex = state?.text.pages.findIndex(page => page.anchor?.para === state.cursor.anchor?.para && page.anchor?.offset === state.cursor.anchor?.offset);
            const page = pageIndex >= 0 ? state.text.pages[pageIndex] : null;
            return state ? {source:state.source, visible:state.visible, opened:state.opened, cursor:state.cursor,
                page:page ? {index:pageIndex,para:page.anchor.para,offset:page.anchor.offset,kind:page.kind,speaker:bubbleCharacter(state.settings?.config,page)?.alias || null,
                    portrait:bubbleMediaDescriptor(bubbleCharacter(state.settings?.config,page),page.mood,bubbleMoodList(state.settings?.config,bubbleCharacter(state.settings?.config,page)?.alias))} : null,
                pending:state.pending, projection:state.projection, director:state.director, lookahead:resources.lookahead(state.source?.sessionId),
                // what the stage shows, for stage capture; a figure is drawn from local bytes.
                accepted:{background:!!state.accepted.scene?.background, skin:!!state.accepted.scene?.skin,
                    figures:(state.accepted.figures || []).map(figure => ({alias:figure.alias, form:figure.form, drawn:/"(?:blob|data):/.test(JSON.stringify(figure))}))},
                observation:state.observation, text:{revision:state.text.revision,
                    streaming:state.text.streaming, units:state.text.units?.length ?? 0, pages:state.text.pages.length}} : null;
        })()})};
        window.forkStageResourceDebug = resourceDebug;
        own(() => { if (window.forkStageResourceDebug === resourceDebug) delete window.forkStageResourceDebug; });
        const overlayModule=createSkinOverlayLoader();
        const connection = stageViews.sessionRuntime.createConnection({resources:{
            foreground:forkForeground,
            resolveSpeaker:(state,page) => bubbleCharacter(state.settings?.config,page)?.alias,
            async idle(id,current) {
                // Speculation must not compete with model upload or the atomic entry reveal.
                while (current()) {
                    const root = document.querySelector('.fork-gal-stage');
                    if (!root || window.__dshTavernSelectedSessionId !== id) return false;
                    if (root.dataset.entry === 'ready') {
                        await new Promise(resolve => typeof requestIdleCallback === 'function' ? requestIdleCallback(resolve) : setTimeout(resolve,0));
                        return current();
                    }
                    await new Promise(resolve => setTimeout(resolve,100));
                }
                return false;
            },
            preparePerformance:value => Promise.all([...value.dependencies.filter(item=>item.document?.overlay).map(item=>overlayModule(item.document)),keyframeFonts(value)]),
            music:() => bgmPlayer,
            performance:(id,intent) => stageConsumers.get(id)?.performance?.(intent),
            read: args => rpc('getAssetPackPresentation',args,args.sessionId),
            present:(id,intent) => stageConsumers.get(id)?.present(intent),
            play:(id,value,token) => stageConsumers.get(id)?.play(value,token),
            cancelPlayback:(id,intent) => stageConsumers.get(id)?.cancel(intent),
            progress: stageViews.progress.store,
            owner: resourceOwner
        },direction:{
            read: args => rpc('getStageDirection', args, args.sessionId),
            // an arrow keeps `this` = stageSessions. The director source calls `watch` bare, and the
            // real signal service runs onConnect synchronously when already connected (履历 jump, re-entry, remount) and on
            // every reconnect snapshot; a method shorthand there threw `this.get is not a function` and failed the stream.
            watch: (source, wake, reannounce) => {
                const stops = ['stage-direction','tavern-state'].map(kind =>
                    tavernSessionSignals.subscribe(source.sessionId, kind, wake, wake, () => {wake();reannounce();}));
                return () => stops.forEach(stop => stop());
            }
        },notifications:{send:input=>rpc('notifyModPresentation',input,input.sessionId),browseMs:STAGE_HISTORY_SETTLE_MS,report:error=>console.warn('Mod presentation notification failed',error)},session:{
            readBody: args => rpc('getRoundBody',args,args.sessionId),
            opened:false,
            sessions: ctx.sessions,
            selectedSessionId: () => tavernMainSessionId(ctx.sessions),
            visible: () => !document.hidden,
            resolveChat: binding => resolveConversationChatBinding(ctx.get('uiConversation') || ctx.get('conversation'), binding),
            views: liveTavernView,
            viewPaths: ['chatId', 'mode', 'card', 'replyProjections', 'regeneratedDshTurns', 'suppressedDshTurns',
                'latestAssistantTurn', 'historyWindow'].map(key => [key]).concat([['tavernHelper', 'lifecycleRevision']]),
            coordination: tavernCoordination,
            settings: bubbleStore,
            preferences,
            storyTurn: tavernStoryTurnForDshTurn,
            createIndex: () => createStageTextIndex({paginate: stageBlockPages, projectionForTurn: tavernProjectionForTurn,
                storyTurn: tavernStoryTurnForDshTurn,
                superseded: galIsSuperseded})
        },waitForEntry:(store,source)=>stageEntryShown().wait(store, () => window.__dshTavernSelectedSessionId === source.sessionId && !!document.querySelector('.fork-gal-stage'))});
        const {owner,resources}=connection;
        own(() => connection.dispose());
        this.owner = owner;
        own(() => { if (this.owner === owner) this.owner = null; });
        connection.start();
        // the session index survives transcript virtualization. Only the
        // selected chat's sealed latest lines and viewed/next turns are synthesized.
        let voiceStore = null, stopVoiceSource = null;
        own(() => stopVoiceSource?.());
        const syncVoice = () => {
            if (!active()) return;
            const id = tavernMainSessionId(ctx.sessions) || null;
            const store = id ? owner.get(id) : null;
            if (store !== voiceStore) {
                stopVoiceSource?.(); voiceStore = store; stopVoiceSource = null;
                if (store) {
                    const source = store.select(state => ({textIndex:state.textIndex,source:state.source,latestSource:state.latestSource,
                        settings:state.settings,opened:state.opened,interrupted:state.interrupted}),stageUiEqual);
                    const stop = source.subscribe(syncVoice);
                    stopVoiceSource = () => {stop();source.dispose();};
                }
            }
            const state = store?.getSnapshot(), handles = [];
            const config = state?.settings?.config;
            const latest = state?.latestSource?.turn;
            // While this session's stage is entering, its own first-page window (gal-stage.js) is the only voice
            // needed: the rest of the latest body would take the entry's connections. It warms once the entry is shown.
            const entering = typeof galEntryShown !== 'undefined' && !!document.querySelector('.fork-gal-stage') && galEntryShown.get() !== store;
            const turns = new Set(latest === undefined || entering ? [] : [latest]);
            // Historical lookahead waits for reveal; sealed lines in the latest body can warm immediately.
            if (state?.opened && state.source && (typeof galEntryShown === 'undefined' || galEntryShown.get() === store)) {
                turns.add(state.source.turn);
                const next = [...state.textIndex.keys()].filter(turn => turn > state.source.turn).sort((a,b) => a-b)[0];
                if (next !== undefined) turns.add(next);
            }
            const available = stageVoiceAvailable();
            for (const turn of turns) {
                const row = state.textIndex.get(turn);
                if (!row || state.interrupted && turn === latest) continue;
                for (const page of row.text.pages) {
                    if (page.pending) continue;
                    const handle = stageVoiceHandle(id,page.voice,config,page.anchor.paragraphId,available);
                    if (handle) handles.push(handle);
                }
            }
            voicePlayer.cancelPrefetch(handles);
            for (const handle of handles) void handle.prefetch();
        };
        own(ctx.sessions.list.subscribe(syncVoice));
        own(stageEntryShown().subscribe(syncVoice));
        own(bubbleStore.subscribe(syncVoice));
        if (typeof packListeners !== 'undefined') { packListeners.add(syncVoice); own(() => packListeners.delete(syncVoice)); }
        syncVoice();
        // the BGM player follows the selected session (after the owner made its store).
        // The manual background (bg-manual.js) follows the same session.
        // Ambience (stage-ambience.js) follows the same session as the BGM, in the stage and in chat.
        const bgmSelect = () => { bgmPlayer.activate(tavernMainSessionId(ctx.sessions) || null); bgManual.activate(tavernMainSessionId(ctx.sessions) || null); ambience.activate(tavernMainSessionId(ctx.sessions) || null); };
        own(() => bgmPlayer.activate(null));
        own(() => bgManual.activate(null));
        own(() => ambience.activate(null));
        own(ctx.sessions.list.subscribe(bgmSelect));
        const bgmKick = () => { bgmPlayer.kick(); ambience.resume(); };
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
        own(() => { avatarGeneration++; avatarCache.select(null); });
        own(() => stopAvatarSource?.());
        const pumpAvatars = () => {
            // Catalogue faces are speculative; leave the connection slots to the entry page.
            const entering = typeof galEntering !== 'undefined' && !!galEntering.get();
            if (active() && (entering || document.querySelector('.fork-gal-stage')) && stageEntryShown().get() !== avatarStore) return;
            while (avatarFlights < 2 && avatarQueue.length) {
                avatarFlights++;
                avatarQueue.shift()().finally(() => { avatarFlights--; pumpAvatars(); });
            }
        };
        own(() => pumpAvatars());
        const avatarRevisions = new Map();
        const syncAvatars = () => {
            if (!active()) return;
            const id = tavernMainSessionId(ctx.sessions) || null;
            if (id !== avatarSession) { avatarSession = id; avatarGeneration++; prefetches.clear(); }
            avatarCache.select(id);
            const store = id ? owner.get(id) : null;
            if (store !== avatarStore) {
                stopAvatarSource?.(); avatarStore = store; stopAvatarSource = null;
                if (store) {
                    const source = store.select(state => state.source);
                    const stop = source.subscribe(syncAvatars);
                    stopAvatarSource = () => { stop(); source.dispose(); };
                }
            }
            if (!id) return;
            const source = store?.getSnapshot().source;
            const characters = bubbleStore.get(id)?.config?.characters || [];
            for (const character of characters) {
                const descriptor = character.avatarMedia?.default;
                if (!descriptor || (avatarRevisions.has(descriptor.ref.packId) && avatarRevisions.get(descriptor.ref.packId) !== descriptor.revision)) continue;
                avatarCache.revision(descriptor.ref.packId,descriptor.revision);
                const avatar = {...descriptor,sessionId:id}, key = JSON.stringify(avatar), generation = avatarGeneration;
                if (!source || prefetches.has(key) || avatarCache.get(avatar)) continue;
                const job = new Promise(resolve => avatarQueue.push(() => (!active() || generation !== avatarGeneration ? Promise.resolve()
                    : resourceOwner.acquire(descriptor,JSON.stringify([source.sessionId,source.authorityEpoch])).then(async pin => {
                        try {
                            if (generation === avatarGeneration) await avatarCache.prepare(avatar,pin.handle.url);
                        } finally { pin.release(); }
                    })).catch(() => {}).finally(resolve))).finally(() => { if (prefetches.get(key) === job) prefetches.delete(key); });
                prefetches.set(key,job);
            }
            pumpAvatars();
        };
        own(stageEntryShown().subscribe(pumpAvatars));
        own(ctx.sessions.list.subscribe(syncAvatars));
        own(bubbleStore.subscribe(syncAvatars));
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
                avatarCache.revision(event.packId,event.revision);
            }
            for (const id of Object.keys(ctx.sessions.list.getSnapshot().byId || {})) {
                const store = owner.get(id), source = store?.getSnapshot().source;
                if (!source) continue;
                resources.invalidate(id);
                if (event?.type === 'unavailable') resources.suspend(id);
                else if (event?.revision === null && event.packId) resources.revoke(id,{packId:event.packId},store.dispatch,store.getSnapshot);
                else store.dispatch({type:'REFRESH_BEGIN',source});
            }
            if (event) { bgmPlayer.invalidate(); bgManual.invalidate(); }
        };
        if (typeof packListeners !== 'undefined') { packListeners.add(packChanged); own(() => packListeners.delete(packChanged)); }
        // installing the Cubism Core re-reads open stages, so figures shown as their
        // static sprite switch to Live2D in place (no reload, no state change). Importing the Spine runtime does the same.
        
        const stopSpineRuntime = typeof spineRuntimeState !== 'undefined' ? spineRuntimeState.subscribe(() => packChanged(null)) : () => {};
        own(stopSpineRuntime);
        const visibility = () => {
            if (!active()) return;
            const snapshot = ctx.sessions.list.getSnapshot();
            for (const id of Object.keys(snapshot.byId || {})) owner.get(id)?.dispatch({type: 'VISIBILITY', visible: !document.hidden});
        };
        // Visibility is observation/visual policy only. Never mute audio on hide.
        document.addEventListener('visibilitychange', visibility);
        own(() => document.removeEventListener('visibilitychange', visibility));
        visibility();
        });
    }
};
