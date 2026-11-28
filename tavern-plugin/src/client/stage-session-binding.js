// session-owned inputs and continuous read-only direction observation.
// D supplies resource effects; F switches the UI. No second player runs here.
// @include-protocol performance-state.cjs
// @include-protocol performance-timeline.cjs
// @include mod-projection.cjs
// @include source-beat.cjs
// @include stage-runtime.cjs
// @include stage-page-index.cjs
// @include-protocol stage-skin.cjs

// Temporary read delegates for controls that have not yet moved into the plugin.
function useStageSelector(...args) { return stageViews.runtimeUi.useSelector(...args); }
const stageResourceAuthority = source => JSON.stringify([source.sessionId,source.authorityEpoch]);
const stageSessions = {
    get owner(){return stageViews?.sessions.owner || null;},
    get resourceOwner(){return stageViews?.sessions.resourceOwner || null;},
    get:id=>stageViews?.sessions.get(id) || null
};
function stageSessionInputs(ctx, signals){
    return {
        native:{sessions:ctx.sessions,selectedSessionId:()=>tavernMainSessionId(ctx.sessions),
            resolveChat:binding=>resolveConversationChatBinding(ctx.get('uiConversation')||ctx.get('conversation'),binding),
            views:liveTavernView,viewPaths:['chatId','mode','card','replyProjections','regeneratedDshTurns','suppressedDshTurns','latestAssistantTurn','historyWindow'].map(key=>[key]).concat([['tavernHelper','lifecycleRevision']]),
            coordination:tavernCoordination,settings:bubbleStore,storyTurn:tavernStoryTurnForDshTurn,projectionForTurn:tavernProjectionForTurn,superseded:galIsSuperseded},
        io:{presentation:args=>rpc('getAssetPackPresentation',args,args.sessionId),direction:args=>rpc('getStageDirection',args,args.sessionId),body:args=>rpc('getRoundBody',args,args.sessionId),
            probe:(method,args,signal)=>rpc(method,args,args.sessionId,{signal}),
            watch:(source,wake)=>{
                const stops=[];
                try{for(const kind of ['stage-direction','tavern-state'])stops.push(signals.subscribe(source.sessionId,kind,wake,wake,wake));}
                catch(error){for(const stop of stops)try{stop();}catch(_){}throw error;}
                return ()=>{const errors=[];for(const stop of stops)try{stop();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage signals cleanup failed');};
            }},
        // The resource owner and image decoding come from the stage client (entry.js, resources.cjs).
        assets:{service:()=>packTransport?.service},
        dialogue:{character:bubbleCharacter,media:bubbleMediaDescriptor,moods:bubbleMoodList},
        preferences:{get:()=>({reading:stageReading.get(),film:stageFilm.get(),audio:forkStageAudio.get()}),
            subscribe(listener){const stops=[stageReading,stageFilm,forkStageAudio].map(source=>source.subscribe(listener));return ()=>{const errors=[];for(const stop of stops)try{stop();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage preferences cleanup failed');};}},
        text:{pageCards:stagePageCards,paginate:stageBlockPages},
        observation:{packs:{subscribe:listener=>{packListeners.add(listener);return ()=>packListeners.delete(listener);},runtimeChanged:listener=>vendorRuntimeChanged(listener)},portraits:avatarCache,media:{background:bgManual}}
    };
}

// Workbench pages can request the same optional client independently of any open card.
let stageClientHold = null;
const galStageHold = () => stageClientHold?.() || (() => {});

function installStageFrontend(ctx, signals, registrations) {
    const report = error => tavernErrorHub.report('舞台', error);
    const loader = createStageClientLoader({
        sessions: ctx.sessions, views: liveTavernView,
        runtime: {
            read: ({workbench}) => rpc(workbench ? 'prepareStageWorkbench' : 'getStageRuntimeStatus', {}),
            subscribe: (changed, wake) => signals.subscribe('plugin:dsh-tavern-stage', 'plugin-lifecycle', changed, wake, wake)
        },
        load: () => import('/api/dsh-tavern/client-assets/stage-client.mjs'),
        install: plugin => ctx.plugin(plugin),
        report
    });
    ctx.provide('tavernStageFrontend', Object.freeze({availability: loader.availability, registrations, report,
        sessionInputs: () => stageSessionInputs(ctx, signals), stageLeases: tavernStageLeases}));
    ctx.effect(() => {
        stageClientHold = loader.hold;
        return () => { if (stageClientHold === loader.hold) stageClientHold = null; };
    }, 'dsh-tavern: stage client hold');
    ctx.effect(loader.start, 'dsh-tavern: stage client loader');
}
