'use strict';
function createStageSpeaker({character:findCharacter, resolve, render}) {
function stageSpeakerRows(characters) {
    return characters.map(figure => ({...figure,actorKey:figure.alias}));
}
function stageSpeakerKey(config, rows, row) {
    const figure = row?.kind === 'line' ? findCharacter(config,row) : null;
    return figure ? (figure.ref && resolve(rows,figure.ref).actorKey) || figure.alias : '';
}
// Only the speaking figure (or the phone contact on a call) receives audio; everyone else stays silent.
function stageVoiceInputs(characters, {audio, speaker, skipping, turn, page, sessionId, phoneVoice, callAudio, phoneCallKey}) {
    return new Map(characters.map(figure => [figure.alias,render(figure,callAudio
        ? {audio:figure.alias === phoneVoice.alias ? callAudio : null,speaking:figure.alias === phoneVoice.alias,skipping,voiceKey:'phone-call:'+phoneCallKey,sessionId}
        : {audio,speaking:figure.alias === speaker,skipping,voiceKey:turn+':'+page,sessionId})]));
}
// Faces by canonical actor key; a line's avatar resolves its authored name to that key, never a raw alias.
function stagePortraits(avatars, sessionId) {
    return new Map(avatars.map(figure => [figure.alias,render(figure,{sessionId}).face]));
}
function stageAvatarOf(config, avatars, portraits, entry) {
    const character = findCharacter(config,entry);
    if (!character) return null;
    return portraits.get(resolve(stageSpeakerRows(avatars),character.ref || character.alias).actorKey) || null;
}
return {rows:stageSpeakerRows, key:stageSpeakerKey, voiceInputs:stageVoiceInputs, portraits:stagePortraits, avatarOf:stageAvatarOf};
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStageSpeaker};
