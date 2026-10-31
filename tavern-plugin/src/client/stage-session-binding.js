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
        return startStageClientLifetime(({own}) => {
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
            read: args => rpc('getAssetPackPresentation',args,args.sessionId),
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
        },observation:{
            document, resourceOwner,
            selection:{current:()=>tavernMainSessionId(ctx.sessions),list:ctx.sessions.list},
            settings:bubbleStore,
            packs:{subscribe:listener=>{packListeners.add(listener);return ()=>packListeners.delete(listener);},runtimeChanged:listener=>spineRuntimeState.subscribe(listener)},
            entry:{shown:stageEntryShown(),hasDisplay:()=>!!document.querySelector('.fork-gal-stage'),entering:()=>!!galEntering.get()},
            portraits:avatarCache,media:{background:bgManual}
        },waitForEntry:(store,source)=>stageEntryShown().wait(store, () => window.__dshTavernSelectedSessionId === source.sessionId && !!document.querySelector('.fork-gal-stage'))});
        const {owner,resources}=connection;
        own(() => connection.dispose());
        this.owner = owner;
        own(() => { if (this.owner === owner) this.owner = null; });
        connection.start();

        });
    }
};
