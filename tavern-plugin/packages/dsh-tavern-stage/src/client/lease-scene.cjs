// Stage lease scene: a pure reduction of a gameMode StageScene into actors, controller pages, the reading cursor and the
// phone standing actor. Whole-snapshot and in memory; it never writes Story Timeline, persistent stage state or saves.
function stageLeaseResolver() {
    return typeof figureResolution !== 'undefined' ? figureResolution : require('../../../dsh-presentation-protocol/src/figure-resolution.cjs');
}
const LEASE_MAX_ACTORS = 4;
// Exact names and aliases only (resolveFigureName); unresolved, ambiguous and conflicting names give no actor key.
function leaseActorKey(rows, name) {
    if (!name) return null;
    const found = stageLeaseResolver().resolveFigureName(rows, {alias:name, name});
    return found.status === 'resolved' ? found.actorKey : null;
}
// scene: {actors:[{name, emotion?, focus?}] (at most 4 kept, left to right), lines:[{id, speaker?, text, emotion?}]}.
// A line without a speaker is narration; a line whose speaker does not resolve keeps its text with no voice.
function leaseScene(scene, {rows, normalizeEmotion}) {
    if (!scene) return null;
    const emotionOf = raw => raw == null || raw === '' ? undefined : normalizeEmotion(raw);
    const kept = [];
    for (const actor of scene.actors || []) {
        if (kept.length >= LEASE_MAX_ACTORS) break;
        const alias = leaseActorKey(rows, actor.name);
        if (!alias || kept.some(item => item.alias === alias)) continue;
        kept.push({alias, emotion:emotionOf(actor.emotion), focus:actor.focus === true});
    }
    const focusAlias = kept.find(actor => actor.focus)?.alias ?? null;
    const actors = kept.map(actor => ({alias:actor.alias, emotion:actor.emotion, focus:actor.alias === focusAlias,
        dim:focusAlias !== null && actor.alias !== focusAlias}));
    const pages = (scene.lines || []).map(line => {
        const emotion = emotionOf(line.emotion), lineIdentity = [line.id];
        let voice = {narration:true, text:line.text, lineIdentity};
        if (line.speaker) {
            const alias = leaseActorKey(rows, line.speaker);
            voice = alias ? {alias, name:line.speaker, mood:emotion, text:line.text, lineIdentity} : null;
        }
        return {lineId:line.id, voice, text:line.text, emotion};
    });
    const standing = focusAlias ?? pages.at(-1)?.voice?.alias ?? null;
    return {actors, pages, standing};
}
// prevCursorId: the id of the last line read. Returns the index of the first unread line; 0 when there is no cursor or
// its line has disappeared (the reading starts again from the first line). Appended lines are read after the cursor.
function leaseCursor(prevCursorId, lines = []) {
    if (prevCursorId == null) return 0;
    const index = lines.findIndex(line => line.id === prevCursorId);
    return index < 0 ? 0 : index + 1;
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {leaseScene, leaseCursor};
