// host speech descriptors only; the browser never registers voices or grants.
// @include pack-playback.cjs
// @include browser-speech.cjs
let forkTtsScope;
// The page's voice service client (ttsClient), read from the scope on each use.
const pageTtsClient = () => forkTtsScope?.get('ttsClient');
// The 配音 page's 浏览器朗读 row (service ttsBrowserSpeech): its voices and a 试听 at master volume.
const browserSpeechService = (function () {
    let current = null;
    return Object.freeze({
        available: browserSpeechSupported,
        voices: () => browserSpeechVoiceList(window.speechSynthesis),
        speak(line) {
            current?.pause();
            const clip = browserSpeechClip(line, true);
            current = clip;
            return new Promise(resolve => { clip.onended = () => resolve(true); clip.onpause = () => resolve(false); clip.play().catch(() => resolve(false)); })
                .finally(() => { if (current === clip) current = null; });
        },
        stop() { current?.pause(); }
    });
})();
const voicePlayer = createPackVoicePlayer({now: forkForeground.now, schedule: forkForeground.setInterval, cancel: forkForeground.clearInterval, getClient:pageTtsClient,
    createSpeech:line => browserSpeechClip(line),
    prepareAudio:(audio,blob,result) => {if(audio.browserSpeech){audio.playbackRate=stageReading.get().voiceRate;return;}forkForeground.media(audio);forkStageAudio.prepareVoice(audio,blob,result.loudness);audio.preservesPitch=true;audio.playbackRate=stageReading.get().voiceRate;},
    disposeAudio:audio => { if (!audio.browserSpeech) forkStageAudio.release(audio); },
    onAudio:audio => forkStageAudio.voice(Boolean(audio))});
// Whether the voice service is on for this page (ttsClient): the stage voices and a reply's 🔊 show only then.
const ttsClientAvailable = () => Boolean(pageTtsClient()?.available());
function voiceObservedTurn(_session,_turn,running) { return running; }
// @include voice-speech.cjs
function useVoiceBubbles(props,segments,_cardPath,config) {
    usePackRevision(ttsClientAvailable);
    const client=forkTtsScope?.get('ttsClient');
    const owner=String(props.sessionId)+':'+String(props.voiceScope);
    const active = React.useSyncExternalStore(galActive.subscribe,galActive.get);
    const available = client?.available() && !props.interrupted && config?.voice?.enabled !== false;
    React.useEffect(()=>{
        const invalidate=event=>{ if (event?.type === 'unavailable') voicePlayer.invalidate(); };
        const off=packTransport?.service.subscribe(invalidate), host=tavernSessionSignals?.subscribe(props.sessionId,'tavern-state',invalidate);
        return()=>{off?.();host?.();if(voicePlayer.get()?.owner===owner)voicePlayer.stop();};
    },[owner]);
    const voiceOrdinals = new Map(galParagraphs([{segments,streaming:false}]).map((unit,n)=>[unit.index,n]));
    const handles = Object.fromEntries(available ? segments.flatMap((segment,index)=>{
        const input = segmentSpeechInput(segment,config);
        if (!input) return [];
        const {text,mood} = input;
        const character = input.general ? null : bubbleCharacter(config,segment);
        const id=JSON.stringify([index,text,mood,input.general ? 'general' : character.voiceKey]);
        const speaker = input.general ? ['general',config.voice.general,segment.name] : [character.alias,character.voiceKey,characterVoiceLanguage(character)];
        const cacheKey = JSON.stringify([props.sessionId,...speaker,text,mood]);
        const selectionKey=props.stageSource ? JSON.stringify([props.sessionId,props.stageSource.nativeTurn,(props.stageParaBase||0)+(props.stageParaOffset||0)+(voiceOrdinals.get(index)||0)]) : undefined;
        const request={text,mood,owner,id,selectionKey,cacheKey:JSON.stringify([cacheKey,selectionKey])}, descriptor=()=>rpc('openAssetPackVoice',input.general ? {general:true} : {alias:character.alias},props.sessionId);
        return [[index,{...request,sessionId:props.sessionId,player:voicePlayer.get(),get error(){return voicePlayer.getError(request);},prefetch:()=>voicePlayer.prefetch(descriptor,request),
            click:options=>voicePlayer.play(descriptor,{...request,handoff:options?.handoff===true})}]];
    }) : []);
    // Observe this message's failures as well as the active playback lease.
    React.useSyncExternalStore(voicePlayer.subscribe, () => {
        const player = voicePlayer.get();
        return JSON.stringify([available && player?.owner === owner ? [player.id,player.loading,player.error,Boolean(player.audio),player.audio?.paused] : null,
            Object.values(handles).map(handle => voicePlayer.getError(handle))]);
    });
    // A reply streaming with voice plays its lines as they arrive, with no tap: the mixer stays awake meanwhile (stage-audio.js keepAwake).
    const streamingVoice=Boolean(available && props.streaming && props.voiceAuto);
    React.useEffect(()=>{ forkStageAudio.keepAwake(owner,streamingVoice); return()=>forkStageAudio.keepAwake(owner,false); },[owner,streamingVoice]);
    React.useEffect(()=>{
        if (active===props.sessionId || !props.voiceAuto || !available) return;
        for (const handle of Object.values(handles)) void handle.prefetch();
    },[active,props.sessionId,props.voiceAuto,available,JSON.stringify(Object.values(handles).map(handle=>handle.id))]);
    return handles;
}
// glyph speaker (the stage backlog's rows): a speaker whose body stays still while its sound-wave arcs light in sequence as the
// line plays (theme.css 「backlog voice waves」); a skin's art.voice.waves draws the arcs from its own images (the i layers).
// Both are decorative layers (data-fk-layer): only they fade, never the button or its label.
const VOICE_SPEAKER_BODY = 'M2 9h3.5L10 5v14l-4.5-4H2z';
const VOICE_SPEAKER_WAVES = ['M12.5 9.5a3.5 3.5 0 0 1 0 5', 'M14.9 7a7 7 0 0 1 0 10', 'M17.4 4.6a10.5 10.5 0 0 1 0 14.8'];
function VoiceSpeaker() {
    const h = React.createElement;
    return [h('svg',{key:'glyph',className:'fork-voice-speaker','data-fk-layer':'',width:12,height:12,viewBox:'0 0 24 24','aria-hidden':true},
        h('path',{d:VOICE_SPEAKER_BODY,fill:'currentColor'}),
        VOICE_SPEAKER_WAVES.map((d,index)=>h('path',{key:index,className:'fork-voice-wave','data-wave':index+1,d,fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round'}))),
        h('span',{key:'art',className:'fork-voice-art-waves','data-fk-layer':'','aria-hidden':true},[1,2,3].map(wave=>h('i',{key:wave,className:'fork-voice-wave','data-wave':wave})))];
}
function VoiceButton({voice, glyph}) {
    const current=voice.player?.owner===voice.owner&&voice.player?.id===voice.id?voice.player:null;
    const failure = current?.error || voice.error;
    const error = {QWEN_INVALID_TEXT:'这句没有可朗读内容或被 Qwen 拒绝，请修改台词后重播',VOICE_NOT_FOUND:'声音绑定未解析，请重新选择该人物的声音','voice-unbound':'声音绑定未解析，请重新选择该人物的声音',QWEN_MODEL_NOT_FOUND:'Qwen 当前服务无法访问此配音模型（404），请在百炼控制台检查模型开通状态与区域',QWEN_RESOURCE_NOT_FOUND:'Qwen 语音服务资源不存在（404），请检查区域、模型与音色',QWEN_AUDIO_NOT_FOUND:'Qwen 合成音频下载失败（404），请重试',QWEN_REQUEST_FAILED:'Qwen 语音服务请求失败'}[failure] || failure;
    const state = error ? 'error' : current?.loading ? 'loading' : current?.audio ? (current.audio.paused ? 'paused' : 'playing') : 'idle';
    const label = {idle:'合成并播放',loading:'正在准备语音',playing:'暂停播放',paused:'继续播放',error:'重试语音'}[state];
    const h = React.createElement;
    const path = state === 'playing' ? 'M6 4h4v16H6zm8 0h4v16h-4z' : state === 'error' ? 'M11 4h2v10h-2zm0 13h2v3h-2z' : 'M7 4v16l14-8z';
    const click = current?.audio && !current.error ? event => {
        event?.stopPropagation();
        forkLipSync.wake();
        if (current.audio.paused) current.audio.play().catch(() => {});
        else current.audio.pause();
    } : voice.click;
    return h('button',{type:'button',className:'fork-voice-button','data-voice-state':state,'aria-label':label,'aria-busy':state==='loading',disabled:state==='loading',title:error||label,onClick:event=>{
        if (state === 'idle' || state === 'error') tavernPlayEvents.emit('voice_replay', voice.sessionId);
        click(event);
    }},
        state==='error'?h('span',{'aria-hidden':true},'⚠'):state==='loading'?h(Spinner,{className:'fork-voice-spinner'}):glyph==='speaker'?h(VoiceSpeaker):h('svg',{width:12,height:12,viewBox:'0 0 24 24','aria-hidden':true},h('path',{d:path,fill:'currentColor'})));
}
