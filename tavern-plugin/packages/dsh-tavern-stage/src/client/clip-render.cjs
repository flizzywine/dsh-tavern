// Export-only entry: never installed by apply(ctx), never shares the owner's session/store.
// Runs inside the stage client (entry.js createStageClipReplay) over the core names of clipReplayCore() (main.js);
// the core bindings it replaces for the export page go through that object's setters.
async function mountClipReplay(snapshot, transport, stagePlugin) {
    if (document.location.hostname !== 'clip-export.invalid') throw new Error('Isolated export page required');
    // A clip export has no live session: its signals never fire.
    core.tavernSessionSignals = {subscribe:()=>()=>{}};
    const localStorageValues = structuredClone(snapshot.frameStorage || {});
    // A narration page's voice (旁白配音, pageVoices) is the narrator's, matched by its page text.
    const voices = snapshot.paragraphs.flatMap(row=>[row.voice,...(row.pageVoices || [])]).filter(Boolean), voiceRequests=[];
    const cachedClient = {apiVersion:1,available:()=>true,subscribe:()=>()=>{},
        async synthesize(input) {
            const voice=voices.find(row=>(row.narration || row.selectionKey===input.selectionKey) && row.input.text===input.text && row.alias===input.voice.id);
            voiceRequests.push({frame:window.clipFrame,selectionKey:input.selectionKey,key:voice?.key || null});
            if(voiceRequests.length>128)voiceRequests.shift();
            if(!voice)throw new Error('export-voice-missing');
            return {key:voice.key,ticket:voice.key,mime:'audio/wav',cacheHit:true,durationMs:voice.durationMs,loudness:voice.loudness};
        },
        async audio(key) {const value=window.clipOriginalVoices.get(key);if(!value)throw new Error('export-voice-missing');return value.blob;}
    };
    core.forkTtsScope = {get:name=>name==='ttsClient'?cachedClient:null};
    voicePlayer.setEnabled(true);
    const bindAudio=forkStageAudio.bind,makeMusic=forkStageAudio.musicVoice,normalAnalyser=forkStageAudio.analyser,prepareVoice=forkStageAudio.prepareVoice;
    forkStageAudio.bind=(node,layer,url,authored)=>{
        node.clipLayer=layer;const record=bindAudio(node,layer,url,authored);
        Object.defineProperty(node,'clipGain',{configurable:true,get:()=>record.gain?window.clipGraphGain(record.gain):1});
        return record;
    };
    forkStageAudio.musicVoice=(url,volume,identity,loudness)=>{const voice=makeMusic(url,volume,identity,loudness);voice.input.clipMusic={url};return voice;};
    forkStageAudio.prepareVoice=(node,blob,loudness)=>{
        if(loudness)prepareVoice(node,blob,loudness);
        const value=[...window.clipOriginalVoices.values()].find(value=>value.blob===blob);
        if(value){node.clipBuffer=value.buffer;node.clipDuration=value.buffer.duration;node.clipLayer='voice';node.clipVoiceKey=value.key;}
    };
    forkStageAudio.analyser=node=>node?.clipBuffer?{fftSize:1024,getFloatTimeDomainData(out){
        const buffer=node.clipBuffer,position=Math.floor(node.currentTime*buffer.sampleRate);out.fill(0);
        for(let i=0;i<out.length;i++)for(let channel=0;channel<buffer.numberOfChannels;channel++)out[i]+=(buffer.getChannelData(channel)[position+i] || 0)/buffer.numberOfChannels;
    }}:normalAnalyser(node);
    const clipExportTransport = core.clipExportTransport = async (method,args) => {
        if(method === 'syncSession')return {cardPath:snapshot.cardPath,liveSession:false,tasks:{}};
        if(method === 'openAssetPackVoice') {const voice=voices.find(row=>args.narrator ? row.narration : row.alias===args.alias);return voice?{available:true,voice:{source:'clip-export',id:voice.alias},scope:'clip-export',language:voice.language}:{available:false,diagnostics:['export-voice-missing']};}
        if(method === 'saveStagePlaybackMeasurement' || method === 'ackCgPlayed')return {saved:false};
        if(method === 'getFrameStorage')return {values:localStorageValues};
        if(method === 'updateFrameStorage') {
            for(const op of args.ops) {
                if(op.op === 'clear')for(const key of Object.keys(localStorageValues)){if(key.startsWith(op.namespace))delete localStorageValues[key];}
                else if(op.op === 'remove')delete localStorageValues[op.key];else localStorageValues[op.key]=op.value;
            }
            return {ok:true,applied:args.ops.length};
        }
        return transport(method,args);
    };
    const sessionId = snapshot.sessionId, settings = {config:snapshot.config,cardPath:snapshot.cardPath};
    const stable = value => ({getSnapshot:()=>value,subscribe:()=>()=>{}});
    const view = {chatId:snapshot.chatId,mode:'story',card:{path:snapshot.cardPath},replyProjections:snapshot.turns.map(row=>({turn:row.turn,body:row.body})),regeneratedDshTurns:snapshot.regeneratedDshTurns || {}};
    const native = {nodes:new Map((snapshot.nativeNodes || []).map(row=>[row.id,row]))};
    const binding = {session:stable({running:false})};
    const media = {leaseMedia:args=>transport('leaseMedia',args),leaseBundle:args=>transport('leaseBundle',args),releaseLease:ticket=>transport('releaseLease',{ticket}),subscribe:()=>()=>{}};
    core.packTransport = {available:()=>true,service:media};
    bubbleStore.set(sessionId,settings);
    // The stage package's client mounts here through the same host boundary as in play (tavernStageFrontend); its
    // session runtime starts from these export inputs instead of the owner's sessions, store and signals.
    const inputs = {
        native:{sessions:{list:stable({current:sessionId,byId:{[sessionId]:{}}}),binding:()=>binding},selectedSessionId:()=>sessionId,resolveChat:()=>stable(native),
            views:{select:()=>stable({view}),invalidate(){}},viewPaths:[],coordination:{getSnapshot:()=>({view:{}}),subscribe:()=>()=>{}},
            settings:{get:()=>settings,subscribe:()=>()=>{},load(){}},storyTurn:(_view,turn)=>turn,
            projectionForTurn:(value,turn)=>value.replyProjections.find(row=>row.turn===turn),superseded:()=>false},
        // The stage sessions add the Live2D core (getLive2dRuntime through probe, the snapshot's live2dStatus).
        io:{presentation:args=>transport('getAssetPackPresentation',args),direction:args=>transport('getStageDirection',args),body:args=>transport('getRoundBody',args),probe:(method,args)=>transport(method,args),watch:()=>()=>{}},
        assets:{createOwner:createStageResourceOwner,service:()=>media,async decode(blob,url) {
            if (!blob.type.startsWith('image/')) return null;
            const image = new Image();image.src=url;await image.decode();return image;
        }},
        dialogue:{character:bubbleCharacter,media:bubbleMediaDescriptor,moods:bubbleMoodList},
        preferences:{get:()=>({reading:stageReading.get(),audio:forkStageAudio.get(),film:false}),subscribe:()=>()=>{}},
        text:{pageCards:stagePageCards,paginate:stageBlockPages},
        observation:{packs:{subscribe:()=>()=>{},runtimeChanged:listener=>spineRuntimeState.subscribe(listener)},portraits:avatarCache,media:{background:bgManual}}
    };
    let mountError = null;
    const host = Object.freeze({report:error=>{mountError=error;},sessionInputs:()=>inputs,registrations:[
        ({createNavigation}) => bindStageNavigation(createNavigation, null, {playCue(){},checkSetup:null,getSessionId:()=>sessionId}),
        ({createViews}) => bindStageViews(createViews),
        () => galStageLifetime()]});
    const effects = [];
    // (the export page has no other plugins: the services the stage provides to them - stageFeatures - have no reader here)
    stagePlugin.apply({get:name=>name==='tavernStageFrontend'?host:undefined,provide(){},effect:run=>{effects.push(run());}});
    const owner = core.stageViews?.sessions.owner;
    if (!owner) throw mountError || new Error('Export stage did not mount');
    const views = core.stageViews;
    bgmPlayer.activate(sessionId);
    window.__dshTavernSelectedSessionId = sessionId;
    // The capture viewport is the frame: entering asks for no full screen, which would resize a controlled headless window.
    document.documentElement.requestFullscreen = undefined;
    galEnter(sessionId,{turn:snapshot.from.turn,para:snapshot.from.para});
    const root = document.createElement('div');document.body.appendChild(root);
    const style = document.createElement('style');
    style.textContent = 'html,body{margin:0;overflow:hidden}*,*::before,*::after{cursor:none!important}.fork-gal-stage{position:fixed!important;inset:0!important}.fork-gal-topbar,.fork-gal-controls,.fork-gal-notices,.fork-gal-first-run,.fork-gal-hints,.fork-gal-quick,.fork-gal-runtime-status,.fork-gal-menu-fold,.fork-gal-voice,.fork-widget-source-controls,.fork-gal-meta,.fork-gal-entry-overlay,.fork-stage-load-progress,.fork-stage-skin-buttons{display:none!important}';
    document.head.appendChild(style);
    const rendered = ReactDOM.createRoot(root), pager = {current:null};
    ReactDOM.flushSync(()=>rendered.render(React.createElement(views.controller.Stage,{sessionId,data:settings,clipPager:pager,choiceProps:{useChat:select=>select(native),useSession:select=>select({running:false})},onExit(){}})));
    const state = () => owner.get(sessionId).getSnapshot();
    const locate = (turn,para) => {
        const row = state().textIndex.get(turn);
        return row?.text.pages.findIndex(page=>page.anchor.para===para) ?? -1;
    };
    return {
        diagnostics:()=>({voiceEnabled:snapshot.config.voice?.enabled,voiceRequests,playerError:voicePlayer.get()?.error,
            cursor:state().cursor,replay:state().replay,pending:state().pending,projection:state().projection,director:{phase:state().director.phase,through:state().director.through},
            ledger:Object.values(state().ledger).map(row=>({kind:row.descriptor.kind,status:row.status,reason:row.reason,anchor:row.token.anchor}))}),
        state:()=>({pending:state().pending,cursor:state().cursor,source:state().source,director:{phase:state().director.phase,error:state().director.error,token:state().director.token},entry:document.querySelector('.fork-gal-stage')?.dataset.entry}),
        async replay(turn,para=1) {await owner.navigate(sessionId,turn,0,false,para,true);owner.replay(sessionId,{para,offset:0});},
        async paragraph(turn,para,card=0) {const index=locate(turn,para);if(index<0)throw new Error('Missing export paragraph');await owner.navigate(sessionId,turn,index+card,true,undefined,true);},
        pages:(turn,para)=>state().textIndex.get(turn)?.text.pages.filter(page=>page.anchor.para===para).map(page=>({text:page.text,anchor:page.anchor,narration:page.voice?.narration ? page.voice.text : null})) || [],
        // The text box pager's cards: history pages are read without playing anything. Each
        // card carries the share of its page's voice at which the stage's auto mode turns it (galSubtitleVoiceTime); the
        // host times them with clipParagraphFrames (stage-auto-timing.cjs).
        async view(turn,para,card) {await owner.navigate(sessionId,turn,0,false,para,true);const index=locate(turn,para);if(index<0)throw new Error('Missing export paragraph');await owner.navigate(sessionId,turn,index+card,false,undefined,true);},
        cards(turn,para,card) {
            const shown=pager.current;
            return shown && !shown.provisional && shown.turn===turn && shown.page===locate(turn,para)+card ? shown.cards.map((card,index)=>({text:card.text,voiceAt:views.subtitles.voiceTime(shown.cards,index,1)})) : null;
        },
        card:()=>({card:pager.current.card,text:pager.current.cards[pager.current.card]?.text}),
        subpage(card) {if(pager.current.card!==card)ReactDOM.flushSync(()=>pager.current.show(card));},
        speech(segment) {return segmentSpeechInput({...segment,kind:'bubble'},snapshot.config);},
        async close() {ReactDOM.flushSync(()=>rendered.unmount());for(const stop of effects.splice(0).reverse())stop?.();core.clipExportTransport=null;}
    };
}
