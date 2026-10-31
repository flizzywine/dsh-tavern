'use strict';
// ambience follows the BGM player's rule (bgm-player.cjs). One page-wide owner
// plays the selected session's accepted soundscape in the stage and in chat alike, so opening or leaving the stage
// never restarts or cuts a loop. It co-owns (pins) the loaded loops it plays, so a director handoff releasing the
// runner's pin cannot revoke a Blob URL that still sounds. The stage only adds its performance layer and waits for
// the fade it asked for (present). Background pausing is the sound policy's (foreground.js), not this owner's.

// player(): the soundscape player (createSoundscapePlayer), made on first use. session(id): the session's runtime
// store. owner(): the stage resource owner. authority(source): the resource owner's authority key.
function createAmbience({player, session, owner, authority}) {
    let active = null, store = null, selector = null, input = null, performance = null, instance = null;
    // pins: the loops the plan sounds, and the ones still fading out. leasing: descriptors whose lease is in flight.
    // epoch: bumped when the pins are dropped, so a lease that lands late is released instead of kept.
    const pins = new Map(), leasing = new Set();
    let epoch = 0, disposed = false;
    const sound = () => instance ||= player();
    function inputs(state) {
        return {plan:state?.accepted?.ambience || null,
            authority:state?.source ? authority(state.source) : null,
            snap:!!state && (state.cursor.skipping || state.cursor.mode === 'history')};
    }
    const same = (a, b) => !!a && !!b && Object.keys(a).every(key => Object.is(a[key], b[key]));
    // A loop sounds from the owner's pin of its media, as the BGM track does: a descriptor is leased (acquire waits until the
    // media is ready), an identity the owner already holds is co-owned (retain), a plain URL plays as it is. A descriptor whose
    // lease is still in flight yields null: that layer is left out and joins the plan when its lease lands (apply again), so
    // the other layers of the plan keep sounding.
    function sourced(layer, snap) {
        const pin = pins.get(layer.identity);
        if (pin) return {...layer, url:pin.handle.url};
        const owned = input?.authority ? owner() : null;
        if (typeof layer.url === 'object' && layer.url) { if (owned) lease(owned, layer, snap); return null; }
        const held = owned?.retain(layer.identity, input.authority) || null;
        if (!held) return layer;
        pins.set(layer.identity, held);
        return {...layer, url:held.handle.url};
    }
    function lease(owned, layer, snap) {
        if (leasing.has(layer.identity)) return;
        leasing.add(layer.identity);
        const mine = epoch;
        owned.acquire(layer.url, input.authority, {usage:'ambience'}).then(pin => {
            if (mine !== epoch) { pin.release(); return; }
            leasing.delete(layer.identity);
            pins.set(layer.identity, pin);
            apply(snap);
        }, () => { if (mine === epoch) leasing.delete(layer.identity); });
    }
    function apply(snap) {
        const layers = [...(input?.plan?.layers || [])];
        if (performance) layers.push({...performance, slot:'performance', id:performance.identity, lowpassHz:null});
        const plan = {version:1, layers:layers.map(layer => sourced(layer, snap)).filter(Boolean), warnings:input?.plan?.warnings || []};
        sound().apply(plan, {snap});
        const done = sound().whenSettled();
        // A loop that left the plan keeps its pin until its fade-out has ended.
        const stale = [...pins].filter(([identity]) => !layers.some(layer => layer.identity === identity));
        for (const [identity] of stale) pins.delete(identity);
        done.then(() => stale.forEach(([, pin]) => pin?.release()));
        return done;
    }
    function stop() {
        epoch++; leasing.clear();
        instance?.stop();
        for (const pin of pins.values()) pin?.release();
        pins.clear();
    }
    function changed() {
        if (disposed || !selector) return;
        const next = selector.getSnapshot(), previous = input;
        input = next;
        if (next.authority !== previous?.authority) { performance = null; stop(); }
        apply(next.snap || next.authority !== previous?.authority);
    }
    return {
        // The selected session; call again once its runtime store exists.
        activate(id) {
            if (disposed) return;
            id = id || null;
            const next = id ? session(id) : null;
            if (id === active && next === store) return;
            if (id !== active) { performance = null; stop(); }
            active = id; store = next;
            selector?.dispose();
            selector = store ? store.select(inputs, same) : null;
            selector?.subscribe(changed);
            input = selector ? selector.getSnapshot() : null;
            apply(true);
        },
        // The stage's consumer: a projection it presents now (the store may publish it a moment later).
        present(plan, snap) {
            if (disposed || !input) return Promise.resolve();
            input = {...input, plan:plan || null};
            return apply(snap);
        },
        // The stage performance's ambience layer (a loaded track, null clears it).
        performance(track, snap) { if (disposed) return; performance = track || null; return apply(snap); },
        // The runtime released or revoked its presentation: nothing of it sounds any more.
        release() { performance = null; if (input) input = {...input, plan:null}; stop(); },
        // A user gesture retries playback the autoplay policy refused.
        resume() { return instance?.resume(); },
        snapshot: () => ({plan:input?.plan || null, performance, player:instance?.snapshot() || null}),
        dispose() { if (disposed) return; disposed = true; selector?.dispose(); selector = null; store = null; active = null; input = null; performance = null; try {stop();} finally {instance?.dispose(); instance = null;} }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createAmbience};
