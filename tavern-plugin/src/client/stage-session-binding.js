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

// Temporary read delegates for controls that have not yet moved into the plugin.
const stageResourceAuthority = source => JSON.stringify([source.sessionId,source.authorityEpoch]);
const stageSessions = {
    get owner(){return stageViews?.sessions.owner || null;},
    get resourceOwner(){return stageViews?.sessions.resourceOwner || null;},
    get:id=>stageViews?.sessions.get(id) || null
};
function stageSessionInputs(ctx){
    const overlayModule=createSkinOverlayLoader();
    return {
        native:{sessions:ctx.sessions,selectedSessionId:()=>tavernMainSessionId(ctx.sessions),
            resolveChat:binding=>resolveConversationChatBinding(ctx.get('uiConversation')||ctx.get('conversation'),binding),
            views:liveTavernView,viewPaths:['chatId','mode','card','replyProjections','regeneratedDshTurns','suppressedDshTurns','latestAssistantTurn','historyWindow'].map(key=>[key]).concat([['tavernHelper','lifecycleRevision']]),
            coordination:tavernCoordination,settings:bubbleStore,storyTurn:tavernStoryTurnForDshTurn,projectionForTurn:tavernProjectionForTurn,superseded:galIsSuperseded},
        io:{presentation:args=>rpc('getAssetPackPresentation',args,args.sessionId),direction:args=>rpc('getStageDirection',args,args.sessionId),body:args=>rpc('getRoundBody',args,args.sessionId),
            probe:(method,args,signal)=>rpc(method,args,args.sessionId,{signal}),
            watch:(source,wake,reannounce)=>{
                const stops=[];
                try{for(const kind of ['stage-direction','tavern-state'])stops.push(tavernSessionSignals.subscribe(source.sessionId,kind,wake,wake,()=>{wake();reannounce();}));}
                catch(error){for(const stop of stops)try{stop();}catch(_){}throw error;}
                return ()=>{const errors=[];for(const stop of stops)try{stop();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage signals cleanup failed');};
            },notifications:{send:input=>rpc('notifyModPresentation',input,input.sessionId),browseMs:STAGE_HISTORY_SETTLE_MS,report:error=>console.warn('Mod presentation notification failed',error)}},
        assets:{createOwner:createStageResourceOwner,service:()=>packTransport?.service,decode:stageDecodeImage},
        dialogue:{character:bubbleCharacter,media:bubbleMediaDescriptor,moods:bubbleMoodList},
        preferences:{get:()=>({reading:stageReading.get(),film:stageFilm.get(),audio:forkStageAudio.get()}),
            subscribe(listener){const stops=[stageReading,stageFilm,forkStageAudio].map(source=>source.subscribe(listener));return ()=>{const errors=[];for(const stop of stops)try{stop();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage preferences cleanup failed');};}},
        text:{pageCards:stagePageCards,paginate:stageBlockPages},
        performance:{prepare:value=>Promise.all([...value.dependencies.filter(item=>item.document?.overlay).map(item=>overlayModule(item.document)),keyframeFonts(value)])},
        observation:{packs:{subscribe:listener=>{packListeners.add(listener);return ()=>packListeners.delete(listener);},runtimeChanged:listener=>spineRuntimeState.subscribe(listener)},portraits:avatarCache,media:{background:bgManual}}
    };
}
