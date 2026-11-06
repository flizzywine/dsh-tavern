'use strict';
// the BGM player.
// One page-wide owner decides what stageMusic plays for the selected session — in the stage and in chat
// alike, so opening or leaving the stage never restarts or doubles a track. It co-owns (pins) the loaded
// track it plays. 导演选曲 on: the director's accepted cue; off: the manual pick (cues are still recorded).
// The mode, the pick and pause last for the session only (localStorage by session id, never on the card).
const BGM_STORAGE = 'fork-bgm-sessions', BGM_KEEP = 32;
const bgmKey = ref => ref ? ref.packId + '/' + ref.assetId : '';
// Previous / next walk the whole list in its order and wrap; from outside the list they enter at an end.
function bgmStep(tracks, key, delta) {
    if (!tracks.length) return null;
    const at = tracks.findIndex(track => track.key === key);
    return tracks[at < 0 ? (delta > 0 ? 0 : tracks.length - 1) : (at + delta + tracks.length) % tracks.length];
}
function bgmSearch(tracks, query) {
    const q = String(query || '').trim().toLowerCase();
    return q ? tracks.filter(track => (track.name + '\n' + (track.pack || '')).toLowerCase().includes(q)) : tracks;
}


if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {bgmStep,bgmSearch,bgmKey};
