// 入场演出 - the stage's opening performance in place of
// 「载入中」. A card whose own packs hold an `entrances` entry (蓝灯) and the global switch on (舞台设置 › 基础设置「入场演出」) open
// their stage with it (host: lib/domain/stage-entrance.js -> config.stage.entrance); otherwise the veil is the skin loader or the
// engine's wheel as before (entrance > skin loader > engine default).
//
// The engine draws only generic procedural primitives in WebGL2 (entranceRenderer); the dsh.entrance/1 document gives every
// colour, timing, intensity and shape, and its timeline (stage-entrance.cjs) decides what shows when. Rendering runs in a worker
// on an OffscreenCanvas, so the tunnel stays smooth while the load saturates the main thread (Live2D builds, decodes, React
// mounts); without workers it runs on the main thread. The real load gate stays the one authority (useGalEntry): the
// entrance only reads it - loading holds on the `hold` phase, ready plays on to the cover, the stage is revealed under the cover
// and the cover fades out over it. A click after the load is the engine's skip, the same for every entrance (
// 「黑屏转接」): the entrance stops on the frame it shows (the video pauses there, nothing more is drawn), black fades in over
// it, the stage is revealed under the black and the black fades out to it - its designed ending (a white-out) never plays.
// Before the load a click brightens the progress line.
// CONFIG 「减少动态」 or the OS reduced-motion preference: one still frame, then a fade. 光敏保护: the cover's white at most half.
// @include-protocol stage-entrance.cjs

function entranceSupported() {return stageViews.entranceRenderer.supported();}
function entranceStart(...args) {return stageViews.entranceRenderer.start(...args);}

// The run's fixed inputs as the stage opens: the document and the safety policy (stage-effects.cjs stageSafety: CONFIG is
// authoritative; the OS reduced-motion preference also stills this full-screen rush -).
function entranceRun(entrance) {
    const reading = typeof stageReading === 'object' && stageReading ? stageReading.get() : null;
    const osReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const safety = stageSafety(reading, osReduced), coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return {doc: entrance.document, ref: entrance.ref, safety, media: entrance.media ? {packId: entrance.ref.packId, ...entrance.media} : null,
        video: entrance.document.layers.video && entrance.video ? entrance.video : null,
        options: {reduced: safety.reducedMotion || safety.calm, photosensitive: safety.photosensitive, cap: coarse ? 1100000 : 8294400}};
}

function entranceMedia(run) {return stageViews.entranceMedia.read(run);}

// The stage's one entrance hook. `loadGate` is useGalEntry's gate (the only readiness authority). Returns the gate the stage
// shows (held on loading until the cover), the entrance element, the overlay's props and the stage root's attribute.
function useStageEntrance(store, entrance, loadGate) {
    // One run per stage entry, fixed as it opens; a later settings change waits for the next entry.
    const run = React.useMemo(() => entrance && entrance.document && entranceSupported() ? entranceRun(entrance) : null, [store]);
    const fresh = {run, started: false, covered: false, done: false, failed: false};
    const [held, setHeld] = React.useState(fresh);
    const status = held.run === run ? held : fresh;
    const patch = React.useCallback(change => setHeld(prev => ({...(prev.run === run ? prev : {...fresh}), ...change})), [run]);
    const [bright, setBright] = React.useState(0);
    React.useEffect(() => { if (!bright) return undefined; const timer = setTimeout(() => setBright(0), 1500); return () => clearTimeout(timer); }, [bright]);
    const active = !!run && !status.failed && !status.done;
    // Loaded: the gate's reveal has begun; the entrance plays on to its cover.
    const ready = loadGate.visible || loadGate.phase === 'revealing';
    // Never a permanent black screen: no first frame, no cover after the load, or no end after the cover drops the entrance.
    React.useEffect(() => {
        if (!active) return undefined;
        const left = !status.started ? 3000 + (run.video ? ENTRANCE_VIDEO_WAIT_MS : 0) : ready && !status.covered ? stageEntrance.stageEntranceDuration(run.doc) + 4000 : status.covered ? 8000 : 0;
        if (!left) return undefined;
        const timer = setTimeout(() => patch(status.covered ? {done: true} : {failed: true}), left);
        return () => clearTimeout(timer);
    }, [active, status.started, status.covered, ready]);
    const onEvent = React.useCallback(event => {
        if (event.type === 'started') patch({started: true});
        else if (event.type === 'cover') patch({covered: true});
        else if (event.type === 'done') patch({done: true});
        else if (event.type === 'error') { console.warn('Stage entrance unavailable:', event.message); patch({failed: true}); }
        else if (event.type === 'phase' && run.doc.phases.find(phase => phase.id === event.id)?.cover && typeof stageFlashGate === 'object') stageFlashGate.admit(run.safety);
    }, [run]);
    const hidden = active && !status.covered;
    const gate = hidden ? {...loadGate, phase: loadGate.phase === 'pending' ? 'pending' : 'loading', visible: false} : loadGate;
    return {gate, active, stageAttr: active ? status.covered ? 'covered' : 'playing' : undefined,
        overlay: active && !status.covered ? {loadPhase: loadGate.phase, bright: !!bright} : null,
        element: active ? React.createElement(StageEntrance, {key: 'entrance', run, ready, covered: status.covered, started: status.started, onEvent,
            onBright: () => setBright(Date.now())}) : null};
}

// How long a video layer may preload before the timeline starts without it (it joins when it can play).
const ENTRANCE_VIDEO_WAIT_MS = 2500;
// The skip (every entrance): black fades in over the frozen entrance, holds until the stage is
// shown under it, then fades out to the stage. CSS opacity transitions, so the compositor keeps them smooth while the reveal
// loads the main thread; each step follows the veil's own transition end, never a parallel timer (a loaded page started the
// fade late and showed the stage under a black still at 98%, or faded it out before it was ever fully up).
const ENTRANCE_SKIP_BLACK_MS = 200, ENTRANCE_SKIP_REVEAL_MS = 300;
// The keys that turn a page on the stage skip the entrance after the load (before it they brighten the line); the stage's
// other keys (back, Escape, letter shortcuts) wait until it is shown. Browser shortcuts (modifiers, F-keys) pass.
const ENTRANCE_KEYS = new Set(['Enter', ' ', 'ArrowRight', 'ArrowDown', 'PageDown']);
const ENTRANCE_HELD = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'Escape', 'Home', 'End', 'Tab']);
function StageEntrance({run, ready: loaded, covered, started, onEvent, onBright}) {
    const h = React.createElement, root = React.useRef(null), canvas = React.useRef(null), port = React.useRef(null);
    // With media, the entrance holds (its hold phase) until they have arrived too; a failed read plays on without them.
    const [mediaSettled, setMediaSettled] = React.useState(!run.media);
    const videoHost = React.useRef(null), player = React.useRef(null), frozen = React.useRef(false);
    // The skip: null | 'black' (fading in) | 'out' (the stage is shown, fading out). Mirrored in a ref for the key handler.
    const [skip, setSkip] = React.useState(null), skipRef = React.useRef(null);
    skipRef.current = skip;
    const ready = loaded && mediaSettled;
    const readyRef = React.useRef(ready);
    readyRef.current = ready;
    React.useLayoutEffect(() => {
        const box = root.current.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
        const px = (w, h) => [Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio))];
        // A video layer (stage-video.js) preloads first: the timeline starts once it can play through, cannot, or after
        // ENTRANCE_VIDEO_WAIT_MS (then it joins when ready, or its poster / the drawn layers stand in) - never a held stage.
        let live = true;
        // A skip freezes the video at once: a sync the worker posted before it saw the skip must not play or seek it again.
        const handle = event => { if (event.type !== 'video') onEvent(event); else if (!frozen.current) player.current?.sync(event); };
        const begin = () => {
            if (!live || port.current) return;
            port.current = entranceStart(canvas.current, run, px(box.width, box.height), handle);
            if (readyRef.current) port.current.input({ready: true});
        };
        if (run.video) {
            // No poster here: an entrance's own drawn layers are what stands in for a video it cannot play.
            const own = player.current = stageVideoPlayer(videoHost.current, run.video, {audio: run.doc.layers.video.audio === true, poster: false, readyMs: ENTRANCE_VIDEO_WAIT_MS});
            own.ready.then(begin);
            own.playable.then(() => { if (live && player.current === own) { begin(); port.current?.input({video: true}); } });
        } else begin();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
            const rect = entries[entries.length - 1].contentRect;
            port.current?.size(px(rect.width, rect.height));
        }) : null;
        observer?.observe(root.current);
        if (run.media) entranceMedia(run).then(files => { if (live) { port.current?.media(files); setMediaSettled(true); } },
            error => { console.warn('Stage entrance media unavailable', error); if (live) setMediaSettled(true); });
        return () => { live = false; observer?.disconnect(); port.current?.stop(); port.current = null; player.current?.dispose(); player.current = null; };
    }, [run]);
    React.useEffect(() => { if (ready) port.current?.input({ready: true}); }, [ready]);
    // The stage is shown under the cover: once that frame has painted, the cover may hand off (a skip's black fades out).
    React.useEffect(() => {
        if (!covered) return undefined;
        let second = 0;
        const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
            port.current?.input({revealed: true});
            if (skipRef.current) setSkip('out');
        }); });
        return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    }, [covered]);
    // The skip's black is up: the stage is revealed under it; faded out: the entrance ends.
    const onVeil = event => {
        if (event.target !== event.currentTarget || event.propertyName !== 'opacity') return;
        if (skip === 'black' && !covered) onEvent({type: 'cover'});
        else if (skip === 'out') onEvent({type: 'done'});
    };
    // A skip stops the entrance on the frame it shows: the timeline freezes, the video pauses there (never sought on).
    const act = () => {
        if (covered || skipRef.current) return;
        if (!readyRef.current) { onBright(); return; }
        frozen.current = true;
        port.current?.input({skip: true});
        player.current?.pause();
        setSkip('black');
    };
    React.useEffect(() => {
        const onKey = event => {
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            const page = ENTRANCE_KEYS.has(event.key);
            if (!page && !ENTRANCE_HELD.has(event.key) && !/^[a-z0-9]$/i.test(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            if (page && !event.repeat) act();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [covered]);
    const swallow = event => event.stopPropagation();
    // Until its first frame, the element itself is the document's backdrop colour (no flash of the hold colour). data-skip: black
    // (fading in over the frozen entrance) | covered (the stage under the black) | out (fading out to the stage).
    return h('div', {ref: root, className: 'fork-gal-entrance', 'aria-hidden': true, 'data-started': started || undefined,
        'data-skip': skip === 'black' && covered ? 'covered' : skip || undefined,
        style: started ? undefined : {backgroundColor: run.doc.palette[run.doc.background]},
        onClick: event => { event.stopPropagation(); act(); }, onWheel: swallow, onPointerDown: swallow,
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); }},
        h('canvas', {ref: canvas, className: 'fork-gal-entrance-canvas'}),
        run.video && h('div', {ref: videoHost, className: 'fork-gal-entrance-video'}),
        h('div', {className: 'fork-gal-entrance-veil', 'data-fk-layer': '', 'aria-hidden': true, onTransitionEnd: onVeil,
            style: {transitionDuration: (skip === 'out' ? ENTRANCE_SKIP_REVEAL_MS : ENTRANCE_SKIP_BLACK_MS) + 'ms'}}));
}
