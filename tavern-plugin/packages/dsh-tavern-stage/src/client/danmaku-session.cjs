function createStageDanmakuSession({DANMAKU_LIMITS}) {
// A comment flies once per stage session. The ids a 飘屏 layer has drawn,
// dropped or seen finish outlive the layer: the host remounts it (page turns used to, a view switch, re-entering the
// stage) and the server re-reads a page's records with its clock at their offsets, so per-layer memory alone replayed
// the newest comments on every remount. History stays readable in the 直播风格 list; it never flies twice.
const DANMAKU_FLOWN = new Map();
function danmakuFlown(session) {
    const key = String(session || '');
    let set = DANMAKU_FLOWN.get(key);
    if (!set) { set = new Set(); DANMAKU_FLOWN.set(key, set); if (DANMAKU_FLOWN.size > 8) DANMAKU_FLOWN.delete(DANMAKU_FLOWN.keys().next().value); }
    return set;
}
function danmakuMarkFlown(session, id) {
    const set = danmakuFlown(session);
    set.add(id); if (set.size > DANMAKU_LIMITS.flown) set.delete(set.values().next().value);
}
// A clip export's replay of a round (the player has no replay) is the exception: while it plays,
// the round's comments fly again (a fresh flown set, every layer forgets what it played); when it ends, what had flown
// before counts as flown again. visit = the replay's stage visit: the host re-shows each page for it
// (view.page.visit), so until that view arrives the layer draws nothing — the view from before the replay would otherwise
// drop its long-past comments as late and count them as flown before the replay's own view could fly them.
const DANMAKU_REPLAY = new Map();
function danmakuReplay(session, on, visit = null) {
    const key = String(session || ''), saved = DANMAKU_REPLAY.get(key);
    if (on) { DANMAKU_REPLAY.set(key, { flown: saved?.flown || danmakuFlown(key), epoch: (saved?.epoch || 0) + 1, visit: visit === null ? null : String(visit) }); DANMAKU_FLOWN.set(key, new Set()); }
    else if (saved?.flown) { for (const id of danmakuFlown(key)) saved.flown.add(id); DANMAKU_FLOWN.set(key, saved.flown); DANMAKU_REPLAY.set(key, { flown: null, epoch: saved.epoch, visit: null }); }
}
// True while a replay waits for its own view (see above).
function danmakuReplayPending(session, view) {
    const replay = DANMAKU_REPLAY.get(String(session || ''));
    return !!replay?.flown && replay.visit !== null && String(view?.page?.visit ?? '') !== replay.visit;
}


function danmakuReplayEpoch(session){return DANMAKU_REPLAY.get(String(session || ''))?.epoch || 0;}
function dispose(){DANMAKU_FLOWN.clear();DANMAKU_REPLAY.clear();}

return {danmakuFlown, danmakuMarkFlown, danmakuReplay, danmakuReplayPending, danmakuReplayEpoch, dispose};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDanmakuSession};
