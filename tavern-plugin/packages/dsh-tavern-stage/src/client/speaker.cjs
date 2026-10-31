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
// The reducer has already consumed entry slots. Missing figures do not reserve invisible anchors.
function packStageMembers(state, stageable = () => true) {
    const cast = state.cast.filter(id => stageable(id));
    return cast.map((id, index) => ({id, x:(index + 1) / (cast.length + 1), gaze:state.actors[id].gaze, light:state.actors[id].figureLight}));
}
// preserve the live stage's listener/close-up dimming, independently of figure-light cues.
// A skin with dimListeners: false (stage-skin-adv.md: listeners keep full light) keeps only the close-up dimming.
function packFigureShade(alias, speaker, members, camera, dimListeners = true) {
    const speaking = alias === speaker;
    let shade = speaking || !dimListeners ? 1 : members.some(member => member.id === speaker) ? 0.8 : 0.94;
    if (camera?.mode === 'close' && camera.actor !== alias && !speaking) shade *= 0.82;
    return shade;
}

// a sprite figure whose outfit has no sprite image at all
// (not even calm) stands on the stage as the outfit's avatar, a small portrait (gal-stage.js), never vanishes.
function packSpriteStandIn(figure) {
    const resolution = figure?.spriteResolution;
    return figure?.form === 'sprite' && figure.views?.stage !== false && Boolean(resolution?.missing) && !resolution.state;
}
// One report row per on-stage sprite figure whose requested 差分 has no image of its own (selectPackFigure →
// resolveSpriteDisplay). Display-only: the data slot stays missing. `shown` is the emotion displayed instead, '@avatar'
// (the avatar stand-in) or null (nothing at all to show). `key` dedupes per figure · outfit · 差分.
function packSpriteFallbacks(characters, onStage = () => true, hasPortrait = () => false) {
    const rows = [];
    for (const figure of characters || []) {
        const resolution = figure?.spriteResolution;
        if (figure?.form !== 'sprite' || figure.views?.stage === false || !resolution?.missing || resolution.intentionalFallback || !onStage(figure.alias)) continue;
        const requested = resolution.requestedEmotion || 'calm', labels = resolution.labels || {};
        const shown = resolution.state ? resolution.resolvedEmotion || resolution.state.id : hasPortrait(figure.alias) ? '@avatar' : null;
        rows.push({key:JSON.stringify([figure.ref?.packId || '', figure.ref?.figureId || figure.alias, figure.outfitKey || '', requested]),
            alias:figure.alias, figure:labels.figure || '', outfit:figure.outfit?.label || figure.outfitKey || '', requested, shown,
            requestedLabel:labels[requested] || '', shownLabel:shown && shown !== '@avatar' ? labels[shown] || '' : ''});
    }
    return rows;
}

return {members:packStageMembers, shade:packFigureShade, standIn:packSpriteStandIn, fallbacks:packSpriteFallbacks, rows:stageSpeakerRows, key:stageSpeakerKey, voiceInputs:stageVoiceInputs, portraits:stagePortraits, avatarOf:stageAvatarOf};
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStageSpeaker};
