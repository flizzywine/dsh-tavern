'use strict';
// the manual stage background.
// The BGM player's model for the picture: one page-wide owner per selected session. 导演布景 on shows the director's
// accepted background; off shows the manual pick while the director's changes are still recorded — presentation only,
// director state and history never change. The pick is leased through the stage resource owner (its cache, no other)
// and the mode and pick last for the session only (localStorage by session id, never on the card).
const BG_STORAGE = 'fork-bg-sessions', BG_KEEP = 32, BG_HANDOFF_MS = 2500;
// The list order, prev / next and search are the BGM player's (one implementation).
const {bgmStep:bgStep, bgmSearch:bgSearch, bgmKey:bgKey} = typeof bgmStep === 'function'
    ? {bgmStep, bgmSearch, bgmKey} : require('./bgm-player.cjs');
// The scene as shown: the director's accepted projection with the manual picture in place of its own; time of day,
// mood and grade stay the director's. Never written back. A picture the player switched to (a pick, or the director's
// when 导演布景 went back on: userIdentity) carries userTransition: a cross-fade, a cut under 「减少动态」 (calm).
function bgManualScene(scene, shown, userIdentity, calm) {
    const userTransition = calm ? 'cut' : 'fade';
    if (!shown) return userIdentity && scene?.backgroundMedia?.identity === userIdentity ? {...scene, userTransition} : scene;
    const {stageTheme, ...rest} = scene || {};
    return {...rest, background:shown.ref, backgroundName:shown.name, backgroundUrl:shown.url, backgroundMedia:{identity:shown.identity, url:shown.url},
        compensateBackground:shown.compensate === true, timeMatched:shown.timeMatched === true, ...(shown.stageTheme ? {stageTheme:shown.stageTheme} : {}), manual:true, userTransition};
}

// session(id): the session's runtime store. owner(): the stage resource owner. read(id): the card's bound-pack
// backgrounds ({backgrounds}). authority(source): the resource owner's authority key.
function createBgManual({session, owner, read, storage, authority, now = Date.now, clock = globalThis}) {
    const listeners = new Set(), lists = new Map();
    let active = null, store = null, selector = null, input = null, snapshot = null, reloadTimer = 0, handoffTimer = 0;
    let mine = {follow:true, manual:null}, frozen = null, shown = null, held = [], generation = 0, retried = '', error = false, userIdentity = null;
    function saved() { try { return JSON.parse(storage?.getItem(BG_STORAGE) || '{}') || {}; } catch (_) { return {}; } }
    function remember() {
        const all = saved();
        if (!active) return;
        if (mine.follow) delete all[active];
        else all[active] = {follow:false, manual:mine.manual, at:now()};
        for (const id of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(BG_KEEP)) delete all[id];
        try { storage?.setItem(BG_STORAGE, JSON.stringify(all)); } catch (_) {}
    }
    function inputs(state) {
        const scene = state?.accepted?.scene || null;
        return {available:!!state?.settings?.config?.stage?.enabled, settings:state?.settings || null,
            authority:state?.source ? authority(state.source) : JSON.stringify([active, null]), time:scene?.timeOfDay ?? null,
            cue:scene?.background ? {key:bgKey(scene.background), name:scene.backgroundName || '', ref:scene.background, identity:scene.backgroundMedia?.identity || null,
                url:scene.backgroundUrl || null, compensate:scene.compensateBackground, timeMatched:scene.timeMatched, stageTheme:scene.stageTheme} : null};
    }
    const same = (a, b) => !!a && !!b && Object.keys(a).every(key => key === 'cue'
        ? a.cue?.identity === b.cue?.identity && a.cue?.key === b.cue?.key && a.cue?.name === b.cue?.name && a.cue?.url === b.cue?.url
        : Object.is(a[key], b[key]));
    const rows = () => lists.get(active)?.rows || [];
    // What 导演布景 off shows: the pick in the time of day the director is at; a pick outside the list (the director's
    // picture when the switch went off) is the frozen copy of that picture.
    function target() {
        if (!active || mine.follow || !mine.manual) return null;
        const row = rows().find(item => item.key === mine.manual.key);
        if (row) { const view = row.views[input?.time || ''] || row.views['']; return {key:row.key, name:row.name, ref:row.ref, ...view}; }
        return frozen?.key === mine.manual.key ? frozen : null;
    }
    function view() {
        const list = lists.get(active), manual = !mine.follow && mine.manual;
        const row = manual && (list?.rows || []).find(item => item.key === manual.key);
        return Object.freeze({sessionId:active, available:!!input?.available, follow:mine.follow, error, loading:!!list?.loading, rows:list?.rows || [],
            cue:input?.cue ? {key:input.cue.key, name:input.cue.name} : null, shown, userIdentity,
            current:manual ? {key:manual.key, name:row?.name || manual.name, source:'manual'} : input?.cue ? {key:input.cue.key, name:input.cue.name, source:'director'} : null});
    }
    function publish() { snapshot = view(); listeners.forEach(fn => fn()); }
    // Keep the pin of `keep` and everything newer; older pins go once the scene's cross-fade is over.
    function release(keep) {
        const at = keep ? held.findLastIndex(item => item.identity === keep) : held.length;
        if (at > 0) held.splice(0, at).forEach(item => item.release());
    }
    function show(next) {
        shown = next; publish();
        clock.clearTimeout(handoffTimer);
        handoffTimer = clock.setTimeout(() => release(shown?.identity || null), BG_HANDOFF_MS);
    }
    async function apply() {
        const run = ++generation, goal = target();
        if (!goal) { if (shown) show(null); else publish(); return; }
        if (shown?.identity === goal.identity) { if (shown.name !== goal.name || shown.compensate !== goal.compensate) show({...goal, url:shown.url}); else publish(); return; }
        publish();
        let pin = null;
        try {
            pin = goal.retain ? owner()?.retain(goal.identity, input.authority) || null
                : await owner()?.acquire(goal.url, input.authority, {usage:'background'}) || null;
        } catch (_) {
            if (run !== generation) return;
            // A stale descriptor (the pack changed) gets one fresh list; a second failure is shown.
            if (retried !== goal.identity) { retried = goal.identity; void load(active); }
            else { error = true; publish(); }
            return;
        }
        if (run !== generation) { pin?.release(); return; }
        if (!pin) { error = true; publish(); return; }
        retried = ''; error = false;
        held.push({identity:goal.identity, release:pin.release});
        show({...goal, url:pin.handle.url});
    }
    async function load(id) {
        const previous = lists.get(id)?.rows || [];
        lists.set(id, {rows:previous, loading:true});
        if (id === active) publish();
        let next = previous, ok = false;
        try {
            next = ((await read(id))?.backgrounds || []).map(row => ({...row, key:bgKey(row.ref)}));
            ok = true;
        } catch (_) { /* Keep the last list; what shows keeps its pin. */ }
        lists.set(id, {rows:next, loading:false});
        if (id !== active) return;
        // A pick that left the card's packs hands back to the director.
        const pick = mine.manual;
        if (ok && !mine.follow && pick && !next.some(row => row.key === pick.key) && frozen?.key !== pick.key) { mine = {follow:true, manual:null}; remember(); }
        void apply();
    }
    function changed() {
        const next = selector.getSnapshot(), previous = input;
        input = next;
        if (next.cue?.identity !== previous?.cue?.identity) userIdentity = null;
        if (next.authority !== previous?.authority) { generation++; frozen = null; shown = null; release(null); }
        if (next.settings !== previous?.settings || next.authority !== previous?.authority) { clock.clearTimeout(reloadTimer); reloadTimer = clock.setTimeout(() => load(active), 250); }
        void apply();
    }
    function set(next) { mine = {...mine, ...next}; remember(); void apply(); }
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: () => snapshot ||= view(),
        // The selected session; call again once its runtime store exists.
        activate(id) {
            id = id || null;
            const next = id ? session(id) : null;
            if (id === active && next === store) return;
            if (id !== active) {
                const value = id ? saved()[id] : null;
                mine = {follow:value?.follow !== false, manual:value?.follow === false && value.manual || null};
                generation++; frozen = null; shown = null; release(null); retried = ''; error = false; userIdentity = null;
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
            const row = rows().find(item => item.key === key);
            if (row) set({follow:false, manual:{key:row.key, name:row.name}});
        },
        step(delta) {
            const next = bgStep(rows(), snapshot?.current?.key || input?.cue?.key || '', delta);
            if (next) this.pick(next.key);
        },
        // On: jump to the director's current background. Off: keep what shows as the pick.
        follow(on) {
            if (on) { userIdentity = input?.cue?.identity || null; set({follow:true, manual:null}); return; }
            const cue = input?.cue;
            if (cue && !rows().some(row => row.key === cue.key) && cue.identity) frozen = {...cue, retain:true};
            set({follow:false, manual:cue ? {key:cue.key, name:cue.name} : null});
        },
        dispose() {
            generation++; clock.clearTimeout(reloadTimer); clock.clearTimeout(handoffTimer); selector?.dispose(); selector = null; store = null; active = null;
            shown = null; frozen = null; release(null); listeners.clear();
        }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createBgManual, bgManualScene, bgStep, bgSearch, BG_STORAGE, BG_HANDOFF_MS};
