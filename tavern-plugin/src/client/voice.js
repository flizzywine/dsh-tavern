// host speech descriptors only; the browser never registers voices or grants.
// @include pack-playback.cjs
// @include browser-speech.cjs
let forkTtsScope;
// The 配音 page's 浏览器朗读 row (service ttsBrowserSpeech): its voices and a 试听 at master volume.
const browserSpeechService = (function () {
    let current = null;
    return Object.freeze({
        available: () => Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance),
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
const voicePlayer = createPackVoicePlayer({now: forkForeground.now, schedule: forkForeground.setInterval, cancel: forkForeground.clearInterval, getClient:() => forkTtsScope?.get('ttsClient'),
    createSpeech:line => browserSpeechClip(line),
    prepareAudio:(audio,blob,result) => {if(audio.browserSpeech){audio.playbackRate=stageReading.get().voiceRate;return;}forkForeground.media(audio);forkStageAudio.prepareVoice(audio,blob,result.loudness);audio.preservesPitch=true;audio.playbackRate=stageReading.get().voiceRate;},
    disposeAudio:audio => { if (!audio.browserSpeech) forkStageAudio.release(audio); },
    onAudio:audio => forkStageAudio.voice(Boolean(audio))});
function voiceObservedTurn(_session,_turn,running) { return running; }
// @include voice-speech.cjs
function useVoiceBubbles(props,segments,_cardPath,config) {
    usePackRevision(() => Boolean(forkTtsScope?.get('ttsClient')?.available()));
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
        const id=JSON.stringify([index,text,mood,bubbleCharacter(config,segment)?.voiceKey]);
        const character = bubbleCharacter(config,segment);
        const cacheKey = JSON.stringify([props.sessionId,character.alias,character.voiceKey,characterVoiceLanguage(character),text,mood]);
        const selectionKey=props.stageSource ? JSON.stringify([props.sessionId,props.stageSource.nativeTurn,(props.stageParaBase||0)+(props.stageParaOffset||0)+(voiceOrdinals.get(index)||0)]) : undefined;
        const request={text,mood,owner,id,selectionKey,cacheKey:JSON.stringify([cacheKey,selectionKey])}, descriptor=()=>rpc('openAssetPackVoice',{alias:character.alias},props.sessionId);
        return [[index,{...request,sessionId:props.sessionId,player:voicePlayer.get(),get error(){return voicePlayer.getError(request);},prefetch:()=>voicePlayer.prefetch(descriptor,request),
            click:options=>voicePlayer.play(descriptor,{...request,handoff:options?.handoff===true})}]];
    }) : []);
    // Observe this message's failures as well as the active playback lease.
    React.useSyncExternalStore(voicePlayer.subscribe, () => {
        const player = voicePlayer.get();
        return JSON.stringify([available && player?.owner === owner ? [player.id,player.loading,player.error,Boolean(player.audio),player.audio?.paused] : null,
            Object.values(handles).map(handle => voicePlayer.getError(handle))]);
    });
    React.useEffect(()=>{
        if (active===props.sessionId || !props.voiceAuto || !available) return;
        for (const handle of Object.values(handles)) void handle.prefetch();
    },[active,props.sessionId,props.voiceAuto,available,JSON.stringify(Object.values(handles).map(handle=>handle.id))]);
    return handles;
}
function VoiceButton({voice}) {
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
        if (state === 'idle' || state === 'error') playTelemetry.record('voice_replay', voice.sessionId);
        click(event);
    }},
        state==='error'?h('span',{'aria-hidden':true},'⚠'):state==='loading'?h(Spinner,{className:'fork-voice-spinner'}):h('svg',{width:12,height:12,viewBox:'0 0 24 24','aria-hidden':true},h('path',{d:path,fill:'currentColor'})));
}
