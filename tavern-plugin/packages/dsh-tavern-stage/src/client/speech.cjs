// Stage speech identity and lookahead policy; the shared player owns synthesis and playback.
function createStageSpeech({player,available=()=>false,speechInput,character:characterOf,language,open,allowed}={}) {
let closed=false;
function readVoice(sessionId,input){
    if(closed)return Promise.reject(Object.assign(new Error('Stage speech disposed'),{name:'AbortError'}));
    return open(sessionId,input);
}
function stageVoiceHandle(sessionId, descriptor, config, paragraphId, availability) {
    if (closed) return null;
    if (descriptor?.narration) return stageNarratorHandle(sessionId, descriptor, config, paragraphId, availability);
    if (!descriptor || config?.voice?.enabled === false || !(availability ?? available())) return null;
    const input = speechInput({...descriptor, kind:'bubble'}, config);
    if (!input) return null;
    const character = characterOf(config,descriptor);
    const owner = sessionId + ':stage', id = JSON.stringify([paragraphId, descriptor.alias, input.text, input.mood,
        character.voiceKey, language(character)]);
    // Match transcript identity after authored/legacy names resolve to the same figure.
    const cacheKey = JSON.stringify([sessionId,character.alias,character.voiceKey,language(character),input.text,input.mood]);
    const selectionKey=descriptor.lineIdentity ? JSON.stringify([sessionId,...descriptor.lineIdentity]) : undefined;
    const request = {...input, owner, id, selectionKey, cacheKey:JSON.stringify([cacheKey,selectionKey])}, resource = () => readVoice(sessionId,{alias:character.alias});
    return {...request, prefetch:() => closed ? Promise.resolve() : player.prefetch(resource, request),
        click:options => closed ? Promise.resolve() : player.play(resource, {...request, handoff:options?.handoff === true, automatic:options?.automatic === true})};
}

// 旁白配音: the same player, queue, mixer bus and cache as a line; config.narrator exists only while it speaks on this card.
function stageNarratorHandle(sessionId, descriptor, config, paragraphId, availability) {
    if (closed) return null;
    const narrator = config?.narrator;
    if (!narrator || !(availability ?? available())) return null;
    const owner = sessionId + ':stage', text = descriptor.text, id = JSON.stringify([paragraphId, descriptor.lineIdentity, 'narrator', text, narrator.voiceKey]);
    const selectionKey = JSON.stringify([sessionId, ...descriptor.lineIdentity]);
    const request = {text, mood:null, owner, id, selectionKey, cacheKey:JSON.stringify([[sessionId, 'narrator', narrator.voiceKey, 'zh', text], selectionKey])};
    const resource = () => readVoice(sessionId,{narrator:true});
    // options.id: a 履历 narration row plays its pages under the row's one id (galBacklogNarration).
    return {...request, narration:true, prefetch:() => closed ? Promise.resolve() : player.prefetch(resource, request),
        click:options => closed ? Promise.resolve() : player.play(resource, {...request, id:options?.id || id, handoff:options?.handoff === true, automatic:options?.automatic === true})};
}

function stageVoiceWindowFromIndex(sessionId,index,turn,pages,page,config,limit = Infinity) {
    if (closed) return [];
    const handles = [], seen = new Set(), availability = available();
    const next = [...index.keys()].filter(number => number > turn).sort((a,b) => a-b)[0];
    for (const number of [turn,next]) {
        const row = index.get(number);
        if (!row) continue;
        // current/next first on jumps, then finish the whole viewed turn.
        for (const item of number === turn ? [...pages.slice(page),...pages.slice(0,page)] : row.text.pages) {
            if (item.pending || !item.voice) continue;
            const handle = number === turn ? item.voice : stageVoiceHandle(sessionId,item.voice,config,item.anchor.paragraphId,availability);
            // subtitle cards share one speech clip.
            const key = handle && JSON.stringify([handle.owner,handle.id]);
            if (handle && !seen.has(key)) {seen.add(key); handles.push(handle);}
            if (handles.length >= limit) return handles;
        }
    }
    return handles;
}

function stop(sessionId){if(!closed && player?.get()?.owner===sessionId+':stage')player.stopPlayback();}
return {handle:stageVoiceHandle,window:stageVoiceWindowFromIndex,available:()=>!closed&&available(),allowed,
    retain:handles=>{if(!closed)player.cancelPrefetch(handles);},stop,stopPlayback:stop,
    dispose(){closed=true;}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageSpeech};
