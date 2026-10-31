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

// music: stageMusic. session(id): the session's runtime store. owner(): the stage resource owner.
// read(id): the card's bound-pack music ({tracks}). authority(source): the resource owner's authority key.
function createBgmPlayer({music, session, owner, read, storage, authority, now = Date.now, clock = globalThis}) {
    let disposed = false;
    const listeners = new Set(), performanceListeners = new Set(), lists = new Map();
    let performance = null, restored = undefined, restoreTransition = null;
    const tokenKey = token => JSON.stringify(token);
    const notifyPerformance = (type, value, reason) => performanceListeners.forEach(fn => fn({type, instanceKey:value.instanceKey, reason}));
    let active = null, store = null, selector = null, input = null, snapshot = null, reloadTimer = 0;
    let mine = {follow:true, manual:null, paused:false}, generation = 0, playback = 0, held = [], retried = '', error = false;
    function saved() { try { return JSON.parse(storage?.getItem(BGM_STORAGE) || '{}') || {}; } catch (_) { return {}; } }
    function remember() {
        const all = saved();
        if (!active) return;
        if (mine.follow && !mine.paused && !mine.overridden) delete all[active];
        else all[active] = {follow:mine.follow, manual:mine.manual, paused:mine.paused, ...(mine.overridden ? {overridden:mine.overridden} : {}), at:now()};
        for (const id of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(BGM_KEEP)) delete all[id];
        try { storage?.setItem(BGM_STORAGE, JSON.stringify(all)); } catch (_) {}
    }
    function inputs(state) {
        const stage = state?.settings?.config?.stage, cue = state?.accepted?.music || null;
        return {available:!!stage?.enabled, enabled:stage?.music !== false, settings:state?.settings || null,
            authority:state?.source ? authority(state.source) : JSON.stringify([active, null]),
            snap:!!state && (state.cursor.skipping || state.cursor.mode === 'history'),
            request:state?.accepted?.musicRequest || null,
            cue:cue && {key:bgmKey(cue.ref), ref:cue.ref, name:cue.name || '', identity:cue.identity, url:cue.url, volume:cue.volume, loopStart:cue.loopStart, loopEnd:cue.loopEnd, loudness:cue.loudness}};
    }
    const same = (a, b) => !!a && !!b && Object.keys(a).every(key => key === 'cue'
        ? a.cue?.identity === b.cue?.identity && a.cue?.url === b.cue?.url && a.cue?.volume === b.cue?.volume && a.cue?.loopStart === b.cue?.loopStart && a.cue?.loopEnd === b.cue?.loopEnd
        : key === 'request' ? tokenKey(a.request?.key) === tokenKey(b.request?.key) : Object.is(a[key], b[key]));
    function resolveRef(ref) {
        if (!ref) return null;
        if (bgmKey(ref) === input?.cue?.key) return input.cue;
        const track = lists.get(active)?.tracks.find(item => item.key === bgmKey(ref));
        if (track) return track;
        error = true;
        return null;
    }
    function override(reason) {
        if (!performance) return;
        const old = performance;
        mine.overridden = {instanceKey:old.instanceKey};
        performance = null; restored = undefined; generation++;
        remember(); notifyPerformance('overridden', old, reason);
    }
    function target() {
        if (!active || !input?.enabled) return null;
        if (mine.follow) {
            if (performance && !performance.yielded) return performance.track && {...performance.track, key:bgmKey(performance.track.ref), source:'performance', snap:performance.snap, fadeMs:performance.fadeMs};
            const cue = restored === undefined ? input.cue : resolveRef(restored);
            return cue && {...cue, source:'director', restoring:restored !== undefined, ...restoreTransition};
        }
        const pick = mine.manual;
        if (!pick) return null;
        const track = lists.get(active)?.tracks.find(item => item.key === pick.key);
        if (track) return {key:track.key, name:track.name, identity:track.identity, descriptor:track.descriptor, volume:track.volume, loopStart:track.loopStart, loopEnd:track.loopEnd, loudness:track.loudness, source:'manual'};
        // A pick outside the list (the cue when 导演选曲 went off) plays from the cue's own pin.
        const retained = input.cue?.identity === pick.identity ? input.cue : held.findLast(item => item.identity === pick.identity);
        return {...pick, url:retained?.url, volume:retained?.volume, loopStart:retained?.loopStart, loopEnd:retained?.loopEnd, loudness:retained?.loudness, source:'manual'};
    }
    function view() {
        const list = lists.get(active), current = target();
        return Object.freeze({sessionId:active, available:!!input?.available, enabled:!!input?.enabled,
            follow:mine.follow, paused:mine.paused, error, loading:!!list?.loading, tracks:list?.tracks || [],
            cue:input?.cue ? {key:input.cue.key, name:input.cue.name} : null,
            current:current ? {key:current.key, name:current.name, source:current.source} : null});
    }
    function publish() { snapshot = view(); listeners.forEach(fn => fn()); }
    // Keep the pin of `keep` and everything newer (a crossfade still sounds the previous one).
    function release(keep) {
        const at = keep ? held.findLastIndex(item => item.identity === keep) : held.length;
        if (at > 0) held.splice(0, at).forEach(item => item.release());
    }
    async function apply() {
        if (disposed) return;
        const run = ++generation, goal = target(), playing = music.get();
        publish();
        if (!goal || mine.paused && playing.identity !== goal.identity) {
            const epoch = ++playback;
            const done = music.stop(!(!goal && input?.enabled && mine.follow && !mine.paused && !input.snap));
            const settled = () => { if (epoch === playback) release(null); };
            if (done) done.then(settled); else settled();
            return;
        }
        if (mine.paused) { music.pause(); return; }
        if (playing.identity === goal.identity && playing.current) { music.trim?.(goal.volume, {loopStart:goal.loopStart,loopEnd:goal.loopEnd}); music.resume(); return; }
        let pin = null;
        try {
            pin = goal.descriptor ? await owner()?.acquire(goal.descriptor, input.authority, {usage:'bgm'})
                : owner()?.retain(goal.identity, input.authority) || null;
        } catch (_) {
            if (run !== generation) return;
            if (goal.restoring) { music.stop(); release(null); error = true; publish(); return; }
            // A stale descriptor (the pack changed) gets one fresh list; a second failure is shown.
            if (retried !== goal.identity) { retried = goal.identity; void load(active); }
            else { error = true; publish(); }
            return;
        }
        if (run !== generation) { pin?.release(); return; }
        // Performance URLs are borrowed from the owner, never a fallback after revocation.
        const url = pin?.handle.url || (goal.source !== 'performance' && !goal.restoring ? goal.url : null);
        if (!url) { pin?.release(); music.stop(); release(null); error = true; publish(); return; }
        retried = '';
        if (error) { error = false; publish(); }
        held.push({identity:goal.identity, url, volume:goal.volume, loopStart:goal.loopStart, loopEnd:goal.loopEnd, loudness:goal.loudness, release:pin ? pin.release : () => {}});
        const epoch = ++playback;
        const done = music.play(url, goal.snap ?? input.snap, goal.identity, {fadeMs:goal.fadeMs, volume:goal.volume, loopStart:goal.loopStart, loopEnd:goal.loopEnd, loudness:goal.loudness,
            trace:{reason:'bgm:' + goal.source + (goal.restoring ? '-restore' : ''), ref:goal.ref, label:goal.name}});
        const settled = () => { if (epoch !== playback) return; if (music.get().error) { error = true; release(null); publish(); } else if (music.get().identity === goal.identity) release(goal.identity); };
        if (done) done.then(settled); else settled();
    }
    async function load(id) {
        if (disposed) return;
        const previous = lists.get(id)?.tracks || [];
        lists.set(id, {tracks:previous, loading:true});
        if (id === active) publish();
        let tracks = previous;
        try {
            tracks = ((await read(id))?.tracks || []).map(track => ({key:bgmKey(track.ref), name:track.name || '',
                pack:track.pack || '', ref:track.ref, identity:track.identity, volume:track.volume, loopStart:track.loopStart, loopEnd:track.loopEnd, loudness:track.loudness, descriptor:track.url}));
        } catch (_) { /* Keep the last list; what plays keeps its pin. */ }
        if (disposed) return;
        lists.set(id, {tracks, loading:false});
        if (id !== active) return;
        // A pick that left the card's packs (and no longer sounds) hands back to the director.
        const pick = mine.manual;
        if (!mine.follow && pick && !tracks.some(track => track.key === pick.key) && music.get().identity !== pick.identity) {
            mine = {...mine, follow:true, manual:null}; remember();
        }
        void apply();
    }
    function changed() {
        if (disposed || !selector) return;
        const next = selector.getSnapshot(), reload = next.settings !== input?.settings || next.authority !== input?.authority;
        const previous = input;
        input = next;
        if (next.authority !== previous?.authority) {
            if (performance) { const old = performance; performance = null; notifyPerformance('released', old, 'authority-changed'); }
            restored = undefined; generation++; music.stop(); release(null);
        } else if (tokenKey(next.request?.key) !== tokenKey(previous?.request?.key) && next.request) {
            restored = undefined; restoreTransition = null;
            if (performance) {
                performance.directorRequest = next.request;
                if (!performance.lock || next.request.force) {
                    performance.yielded = true;
                }
            }
        }
        if (reload) { clock.clearTimeout(reloadTimer); reloadTimer = clock.setTimeout(() => load(active), 250); }
        void apply();
    }
    function set(next) { if (disposed) return; mine = {...mine, ...next}; remember(); void apply(); }
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        subscribePerformance(fn) { performanceListeners.add(fn); return () => performanceListeners.delete(fn); },
        acquirePerformance(options) {
            if (disposed) return {status:"stale"};
            const {sessionId, authority:auth, instanceKey, phaseKey, token, track, lock = true, restore = 'previous', restoreTarget, snap = false} = options;
            if (sessionId !== active || auth !== input?.authority) return {status:'stale'};
            if (tokenKey(mine.overridden?.instanceKey) === tokenKey(instanceKey) || !mine.follow) {
                mine.overridden = {instanceKey}; remember();
                return {status:'overridden'};
            }
            if (performance && tokenKey(performance.instanceKey) === tokenKey(instanceKey)) {
                if (!performance.handle.update({phaseKey, token, track, snap})) return {status:'stale'};
                if (restoreTarget && (snap || restoreTarget.directorRequest)) performance.directorRequest = restoreTarget.directorRequest;
                if (performance.directorRequest?.force) { performance.yielded = true; void apply(); }
                return {status:'acquired', handle:performance.handle};
            }
            const outgoing = performance;
            const previous = outgoing ? outgoing.previous : !snap && !restoreTarget?.directorRequest && target()?.ref || restoreTarget?.previous || null;
            const value = {instanceKey, phaseKey, token, track, lock, restore, previous, snap, fadeMs:track?.fadeMs,
                directorRequest:restoreTarget?.directorRequest || outgoing?.directorRequest || null,
                yielded:!!restoreTarget?.directorRequest?.force};
            const current = supplied => performance === value && input?.authority === auth && (!supplied || tokenKey(supplied) === tokenKey(value.token));
            value.handle = {
                update(next) {
                    if (!current() || next.token?.playbackEpoch < value.token?.playbackEpoch || next.token?.instanceKey && tokenKey(next.token.instanceKey) !== tokenKey(instanceKey)) return false;
                    Object.assign(value, next); void apply(); return true;
                },
                release({token:releaseToken, reason = 'exit', restoreTarget:target, fadeMs, snap:releaseSnap} = {}) {
                    if (!releaseToken || !current(releaseToken)) return false;
                    performance = null;
                    restoreTransition = {fadeMs, snap:releaseSnap};
                    if (restore === 'previous' && !value.yielded) {
                        const request = value.directorRequest || target?.directorRequest;
                        restored = request ? request.ref : value.previous;
                    } else restored = undefined;
                    notifyPerformance('released', value, reason);
                    void apply(); return true;
                }
            };
            performance = value; restored = undefined; restoreTransition = null;
            if (mine.overridden) { delete mine.overridden; remember(); }
            if (outgoing) notifyPerformance('released', outgoing, 'replaced');
            notifyPerformance('acquired', value, 'acquire'); void apply();
            return {status:'acquired', handle:value.handle};
        },
        get: () => snapshot ||= view(),
        // The selected session; call again once its runtime store exists.
        activate(id) {
            if (disposed) return;
            id = id || null;
            const next = id ? session(id) : null;
            if (id === active && next === store) return;
            if (id !== active) {
                const value = id ? saved()[id] : null;
                if (performance) { const old = performance; performance = null; notifyPerformance('released', old, 'session-changed'); }
                restored = undefined;
                mine = {follow:value?.follow !== false, manual:value?.follow === false && value.manual || null, paused:!!value?.paused, overridden:value?.overridden || null};
                retried = ''; error = false;
            }
            active = id; store = next;
            selector?.dispose();
            selector = store ? store.select(inputs, same) : null;
            selector?.subscribe(changed);
            input = selector ? selector.getSnapshot() : inputs(null);
            if (id) void load(id); else void apply();
        },
        // Pack contents changed: refresh the list (a stale pick re-resolves from it).
        invalidate() { if (active) void load(active); },
        pick(key) {
            const track = lists.get(active)?.tracks.find(item => item.key === key);
            if (track) { override('pick'); set({follow:false, manual:{key:track.key, name:track.name, identity:track.identity}, paused:false}); }
        },
        step(delta) {
            const next = bgmStep(lists.get(active)?.tracks || [], snapshot?.current?.key || input?.cue?.key || '', delta);
            if (next) this.pick(next.key);
        },
        // On: jump to the director's current cue. Off: keep what plays as the pick.
        follow(on) {
            const cue = target();
            if (!on) override('follow');
            set(on ? {follow:true, manual:null} : {follow:false, manual:cue ? {key:cue.key, name:cue.name, identity:cue.identity} : null});
        },
        pause(paused) { set({paused:!!paused}); },
        // Autoplay can refuse the first play(); a later user gesture retries it.
        kick() { const playing = music.get(); if (active && !mine.paused && playing.current && playing.paused) music.resume(); },
        dispose() {
            if (disposed) return; disposed = true; playback++;
            generation++; clock.clearTimeout(reloadTimer); selector?.dispose(); selector = null; store = null; active = null;
            if (performance) notifyPerformance('released', performance, 'dispose');
            performance = null; restored = undefined;
            music.stop(); release(null); listeners.clear(); performanceListeners.clear();
        }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createBgmPlayer, bgmStep, bgmSearch, bgmKey, BGM_STORAGE};
