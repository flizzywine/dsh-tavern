'use strict';
function createStageAdmission({React, window, document, performance, setTimeout, clearTimeout, Spinner, StageLoadLine, loader}) {
let disposed = false;
const cleanups = new Set();
// The stage's one readiness state: pending / loading / slow cover the
// stage with the veil (slow only says 「仍在载入…」 after 10 s), revealing cross-fades a ready scene in, ready shows it with no
// loader. Nothing shows the scene and the loader together: a load that never settles keeps the veil (the Esc menu stays
// reachable over it), never a half-restored scene under a loading notice. Every consumer reads `visible` (ready only).
// held: the stage's configured skin is still on its way (useStageConfigSkin loading): the veil stays up rather than show
// the unskinned stage (the engine's quick menu and box) until the bundle lands.
// veilFading: the veil's own fade (its CSS transition or a skin's loading-leave) has not finished. Ready follows that fade,
// never a parallel timer: a loaded page starts the 250 ms fade late, and a timed ready left the veil at 6-10 % over the scene.
function galEntryPhase(elapsed, ready, revealedAt, shown, held = false, veilFading = false) {
    if (revealedAt !== null) return elapsed - revealedAt >= 250 && !veilFading ? 'ready' : 'revealing';
    if (held) return elapsed >= 300 ? 'loading' : 'pending';
    if (ready) return shown ? 'revealing' : 'ready';
    return elapsed >= 10000 ? 'slow' : elapsed >= 300 ? 'loading' : 'pending';
}

// the runtime store whose stage has finished its entry (ready, or still loading after 10 s).
// Speculative work for a stage that is still loading (voice beyond the first page and its status polling,
// adjacent-turn presentation reads) waits for it, so it does not compete with the reveal for the browser's
// six connections or for the main thread while the figures are built. Not a visual state: the veil follows `visible`.
const galEntryShown = (() => {
    let shown = null;
    const listeners = new Set();
    return {
        get: () => shown,
        set(store) { if (shown === store) return; shown = store; listeners.forEach(listener => listener()); },
        // The stage unmounted (closed, possibly before it was shown): waiters re-check.
        release(store) { if (shown === store) shown = null; listeners.forEach(listener => listener()); },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        // Resolves once `store`'s stage is shown, or right away when no stage of it is opening.
        wait(store, opening) {
            if (disposed || shown === store || !opening()) return Promise.resolve();
            return new Promise(resolve => { const stop = this.subscribe(() => { if (disposed || shown === store || !opening()) { stop(); resolve(); } }); });
        },
        // Resolves once no stage is entering (one is shown, or none is mounted): for stage work that is not session-bound.
        settled() { return this.wait(undefined, () => !shown && !!document.querySelector('.fork-gal-stage')); }
    };
})();

// Reveal decoded background, text and static stand-ins first; models fade in later without a load notice.
function galEntryBackdropSettled(state) {
    if (!state.pending.projection && !state.pending.resources) return true;
    const projection = state.projection;
    return !!projection?.figureKeys && projection.outstanding.every(key => key.startsWith('figure:') || key === 'music' || key === 'ambience');
}

// a round with nothing to present has no backdrop to accept, so
// its veil went loading -> slow and stayed through the whole first reply. Two shapes: no round at all (runtime `empty`), and
// a new chat's text-less opening (「跳过设定，直接开始」: turn 1 loaded with no page, its direction done or off with no scene,
// so no projection is ever requested). An unloaded history row (its text still to hydrate) is not this: it waits as before.
function galEntryNothingToShow(state) {
    if (!state.source) return state.empty === true;
    const row = state.textIndex?.get(state.source.turn), pending = state.pending;
    return !!row && !row.unloaded && !state.text.streaming && state.text.pages.length === 0 && !pending.text && !pending.director &&
        !pending.projection && !pending.resources && !state.carryRequest && ['done', 'off'].includes(state.director.phase);
}

function galEntryBackdropAccepted(state) {
    // Legacy projections admit the backdrop in the combined visual group, including an explicit clear.
    const provenance = state.accepted.provenanceByChannel;
    if (provenance?.background || provenance?.visual) return true;
    // Undirected/failed rounds may have no backdrop; finish their carry read before revealing.
    if (['off','error'].includes(state.director?.phase)) return !state.pending?.director && !state.carryRequest;
    // A read turn with no direction record (host `missing`: unknown, unbound) whose carry found no earlier direction has
    // nothing left to arrive: it is text-only. Since slow keeps the veil (cbdc59b87) it would otherwise never reveal.
    const director = state.director;
    return director?.phase === 'unknown' && director.revision >= 0 && !director.bindingKey && !state.pending?.director && !state.carryRequest && !state.carry;
}

// One entry gate, not a new persistent stage state. Later turns keep the existing
// incremental group presentation and one-shot ledger; only the first reveal waits.
function useGalEntry(store, rootRef, heldRef = null) {
    const [phase, setPhase] = React.useState('pending');
    const presented = React.useRef(-1), backdrop = React.useRef(-1);
    React.useEffect(() => {
        if (disposed) return;
        const start = performance.now();
        window.__dshRoundLoadTrace?.mark('stage.mount');
        let timer, shown = false, revealedAt = null, stopped = false;
        function poll() {
            if (stopped) return;
            const state = store.getSnapshot(), root = rootRef.current, elapsed = performance.now() - start;
            const images = root ? [...root.querySelectorAll('.fork-gal-box img, .fork-gal-standins img')] : [];
            const revision = state.accepted.presentationRevision;
            // Audio may wait indefinitely for an autoplay gesture; only visual resources gate entry.
            const drawn = !!root?.querySelector('.fork-gal-box') && document.fonts.status !== 'loading' && images.every(image => image.complete && image.naturalWidth > 0);
            const base = !!state.source && galEntryBackdropAccepted(state) && galEntryBackdropSettled(state) && drawn;
            const ready = base && (presented.current === revision || backdrop.current === revision) || galEntryNothingToShow(state) && drawn;
            // The revealing veil counts as faded once it is committed (data-entry) and has no running animation or transition
            // (getAnimations flushes style, so a fade that has not started yet is still seen).
            const veil = revealedAt === null ? null : root?.querySelector(':scope > .fork-gal-entry-overlay');
            const veilFading = !!veil && (root.dataset.entry !== 'revealing' || veil.getAnimations().some(animation => animation.playState !== 'finished'));
            const next = galEntryPhase(elapsed, ready, revealedAt, shown, heldRef?.current === true, veilFading);
            if (next === 'revealing' && revealedAt === null) revealedAt = elapsed;
            shown ||= next === 'loading' || next === 'slow';
            setPhase(next);
            if (next === 'ready' || next === 'slow') galEntryShown.set(store);
            if (next === 'ready') window.__dshRoundLoadTrace?.mark('stage.render-ready', {durationMs:Math.round(elapsed)});
            if (next !== 'ready') timer = setTimeout(poll, 32);
        }
        const stop = () => { stopped = true; clearTimeout(timer); cleanups.delete(stop); galEntryShown.release(store); };
        cleanups.add(stop);
        poll();
        return stop;
    }, [store]);
    const onPresented = React.useCallback(revision => { presented.current = revision; }, []);
    const onBackdrop = React.useCallback(revision => { backdrop.current = revision; }, []);
    return {phase, onPresented, onBackdrop, visible:phase === 'ready'};
}

// the active skin's loader art (art.spinner) is part of the veil. The stage config carries the
// skin document and its bundle key, so the veil leases that one image itself at once - before and independent of the scene's
// skin bundle, the background and the figures. One read per image for the page's lifetime; a failed read falls back to the
// shared wheel.
// null: the shared wheel (no skin loader); 'pending': an empty slot; else the overlay's marks, tokens and keyframes.
function useGalEntryLoader(skin) {
    const key = loader.key(skin);
    const [read, setRead] = React.useState(() => ({key, art:loader.get(key)}));
    React.useEffect(() => {
        if (!key || loader.has(key)) { setRead({key, art:loader.get(key)}); return; }
        let live = true;
        loader.read(key, skin).then(art => { if (live && !disposed) setRead({key, art}); },
            error => { console.warn('Stage skin loader art unavailable', error); if (live && !disposed) setRead({key, art:null}); });
        return () => { live = false; };
    }, [key, loader]);
    if (!key) return null;
    if (read.key === key && read.art !== undefined) return read.art;
    return loader.get(key) || 'pending';
}

// while a 入场演出 plays (stage-entrance.js, `entrance` = {loadPhase, bright}) the veil is only
// its progress line, at the bottom over the entrance: no hold colour, no wheel or skin loader art, no generic words; the line
// shows while the real load runs (loadPhase) and brightens for a moment when the player clicks before it is done.
function GalEntryOverlay(props) {
    const h = React.createElement, text = props.phase === 'slow' ? '\u4ecd\u5728\u8f7d\u5165\u2026' : '\u6b63\u5728\u8f7d\u5165\u2026';
    const entrance = props.entrance, loader = entrance ? null : props.loader, art = loader && loader !== 'pending' ? loader : null;
    return h('div', {className:'fork-gal-entry-overlay', role:props.phase === 'loading' || props.phase === 'slow' ? 'status' : undefined,
        'aria-hidden':props.phase === 'pending' || props.phase === 'ready' || undefined, 'data-fk-loader':loader === 'pending' ? 'pending' : undefined,
        'data-entrance':entrance ? '' : undefined, 'data-load':entrance ? entrance.loadPhase : undefined, 'data-bright':entrance?.bright || undefined,
        ...art?.marks, style:art?.tokens,
        onClick:event => event.stopPropagation(), onWheel:event => event.stopPropagation()},
        art?.loadingKeyframes ? h('style', null, art.loadingKeyframes) : null,
        // A row of parts (art.spinner.parts) is one unit: each part its own image and motion inside the spinner's box.
        art?.parts ? h('span', {className:'fork-spinner fork-gal-entry-spinner', 'aria-hidden':true},
            art.parts.map((part, index) => h('span', {key:index, className:'fork-gal-entry-part', 'data-fk-part':part.motion, style:part.tokens})))
            : h(Spinner, {delay:0, className:'fork-gal-entry-spinner'}),
        // the load's real steps and weighted progress while it runs (stage-load-progress.cjs).
        props.progress ? h(StageLoadLine, {progress:props.progress, fallback:text, nameOf:props.nameOf,
            revealed:props.phase === 'revealing' || props.phase === 'ready'}) : h('span', null, text));
}

return {
    shown:galEntryShown, useEntry:useGalEntry, useLoader:useGalEntryLoader, Overlay:GalEntryOverlay,
    dispose() {
        if (disposed) return;
        disposed = true;
        for (const stop of [...cleanups]) stop();
        galEntryShown.release(galEntryShown.get());
    }
};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageAdmission};
