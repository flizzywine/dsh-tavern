// Stage speaker and lip-sync routing: voice resolves authored names; stage figures use canonical actor keys.
// The client includes this source inside its module factory (dependencies are its neighbours); Node requires them.
function stageSpeakerCharacter(config, entry) {
    return (typeof bubbleCharacter === 'function' ? bubbleCharacter : require('./bubble-line.cjs').bubbleCharacter)(config, entry);
}
function stageSpeakerResolve(rows, name) {
    return (typeof figureResolution !== 'undefined' ? figureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs')).resolveFigureName(rows, name);
}
function stageSpeakerRender(figure, options) {
    return (typeof packFigureRenderInputs === 'function' ? packFigureRenderInputs : require('./pack-playback.cjs').packFigureRenderInputs)(figure, options);
}
function stageSpeakerRows(characters) {
    return characters.map(figure => ({...figure,actorKey:figure.alias}));
}
function stageSpeakerKey(config, rows, row) {
    const figure = row?.kind === 'line' ? stageSpeakerCharacter(config,row) : null;
    return figure ? (figure.ref && stageSpeakerResolve(rows,figure.ref).actorKey) || figure.alias : '';
}
// Only the speaking figure (or the phone contact on a call) receives audio; everyone else stays silent.
function stageVoiceInputs(characters, {audio, speaker, skipping, turn, page, sessionId, phoneVoice, callAudio, phoneCallKey}) {
    return new Map(characters.map(figure => [figure.alias,stageSpeakerRender(figure,callAudio
        ? {audio:figure.alias === phoneVoice.alias ? callAudio : null,speaking:figure.alias === phoneVoice.alias,skipping,voiceKey:'phone-call:'+phoneCallKey,sessionId}
        : {audio,speaking:figure.alias === speaker,skipping,voiceKey:turn+':'+page,sessionId})]));
}
// Faces by canonical actor key; a line's avatar resolves its authored name to that key, never a raw alias.
function stagePortraits(avatars, sessionId) {
    return new Map(avatars.map(figure => [figure.alias,stageSpeakerRender(figure,{sessionId}).face]));
}
function stageAvatarOf(config, avatars, portraits, entry) {
    const character = stageSpeakerCharacter(config,entry);
    if (!character) return null;
    return portraits.get(stageSpeakerResolve(stageSpeakerRows(avatars),character.ref || character.alias).actorKey) || null;
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { stageSpeakerRows, stageSpeakerKey, stageVoiceInputs, stagePortraits, stageAvatarOf };
