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

// Gaze direction on screen for a member: -1 left, 0 viewer, 1 right; null when not directed.
function galGaze(look, x, others) {
    if (!look) return null;
    if (look === "away") return x > 0.5 ? 1 : -1;
    const target = others[look];
    if (target == null || Math.abs(target - x) < 0.01) return 0;
    return target > x ? 1 : -1;
}
// where the current line's speaker stands, for skins that point at
// them (a bubble tail). The speaker is the alias the single resolver gave the line (bubbleCharacter); its place is
// where the scene reports the figure's body is drawn (layout.body: the picture's body centre through the figure's own
// transform and the settled camera, sampled once the figure stands still), else - a DOM stand-in, or before the first
// settled sample - the reported layout slot (galFigureLayout x) moved by the settled camera; times the reported stage
// width, so nothing is measured here. Spoken lines and inner monologue (both kind "line") anchor; narration, a speaker
// that is not drawn on stage (parked, no sprite or stand-in), a CG or the open phone does not -> null.
function galSpeakerAnchor({ line, speaker, layout, drawn, covered }) {
    if (covered || !line || line.kind !== "line" || !speaker || !layout || !(layout.width > 0) || !layout.x || !(speaker in layout.x) || !drawn(speaker)) return null;
    // Under a close-up (or any framed shot) the camera's settled goal moves the figure on screen: (x - fx) * zoom + ax.
    const c = layout.camera, slot = Number(layout.x[speaker]), body = layout.body?.[speaker];
    const x = Number.isFinite(body) ? body : c && c.zoom > 0 ? (slot - c.fx) * c.zoom + c.ax : slot;
    // A speaker framed out (or left as a sliver at the edge) has no anchor.
    if (!Number.isFinite(x) || x < 0.04 || x > 0.96) return null;
    // Three sides, like the original's three balloons (textLeft / textCenter / textRight): the middle fifth is the centre.
    return { x: Math.round(x * layout.width), width: Math.round(layout.width), u: Math.round(x * 1000) / 1000, side: x < 0.4 ? "left" : x > 0.6 ? "right" : "center" };
}
// who stays visible when the viewport or the skin's maxFigures cannot show the whole
// cast (gal-scene.js galFigureLayout). Deterministic for a page: the speaker, the close-up actor, the most recent
// other speakers, then stage order. Display only. Nothing persistent outranks recency: with two speakers
// alternating, each page shows the same pair (a gaze target ranked here swapped in on every other page).
function galFigurePriority(cast, first) {
    const out = [];
    for (const id of first.concat(cast)) if (id && cast.includes(id) && !out.includes(id)) out.push(id);
    return out;
}
// Speakers before the page, most recent first: this turn's earlier pages, then the earlier turns' pages (newest first).
function galRecentSpeakers(pages, page, earlier, aliasOf, limit = 6) {
    const out = [];
    const scan = (list, from) => {
        for (let i = from; list && i >= 0 && out.length < limit; i--) {
            const alias = list[i]?.kind === "line" ? aliasOf(list[i]) : "";
            if (alias && !out.includes(alias)) out.push(alias);
        }
    };
    scan(pages, page - 1);
    for (const list of earlier) scan(list, list ? list.length - 1 : -1);
    return out;
}
// whom a performance's speaker shot frames on
// this page and on which side. speakers: the on-stage speaker of every page from the shot's first page in this round to
// this one ('' for narration or a speaker not on stage, which keeps the shot). alternate: the first subject stands left, a
// new subject takes the other side, the same one keeps it; anchor: the side of the subject's ordinary stage slot (slotOf).
// Only the names in page order decide, so history, skip and refresh frame the same page the same way. Nobody yet: null.
function galShotSubject(speakers, rule, slotOf) {
    let alias = "", side = "";
    for (const id of speakers) {
        if (!id || id === alias) continue;
        side = rule === "anchor" ? (slotOf(id) > 0.5 ? "right" : "left") : !alias ? "left" : side === "left" ? "right" : "left";
        alias = id;
    }
    return alias ? { alias, side } : null;
}
// The shot's framing for a side: the declared side, else the other side mirrored (x, roll); roll omitted = 0.
function galShotSide(shot, side) {
    const other = side === "left" ? "right" : "left", own = shot.head[side], mirror = shot.head[other];
    const roll = shot.roll?.[side] ?? (shot.roll?.[other] !== undefined ? -shot.roll[other] : 0);
    return { head: own || [1 - mirror[0], mirror[1], mirror[2]], roll };
}

return {gaze:galGaze, anchor:galSpeakerAnchor, priority:galFigurePriority, recent:galRecentSpeakers, shotSubject:galShotSubject, shotSide:galShotSide, members:packStageMembers, shade:packFigureShade, standIn:packSpriteStandIn, fallbacks:packSpriteFallbacks, rows:stageSpeakerRows, key:stageSpeakerKey, voiceInputs:stageVoiceInputs, portraits:stagePortraits, avatarOf:stageAvatarOf};
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStageSpeaker};
