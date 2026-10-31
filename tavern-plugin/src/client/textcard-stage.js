// 「文字演出」 stage renderer. Plans come from textcard-presets.cjs;
// this file owns the DOM templates, optical centring, the frame-locked player and the stage hook.
// The player is imperative: the stage component never re-renders per card frame.
// @include textcard-presets.cjs

const TEXTCARD_KIND = /^dsh\.textcard(?:\.|$)/;
function textcardAccepts(performance) {
    return !!performance && TEXTCARD_KIND.test(String(performance.kind || '')) && !!performance.payload &&
        (typeof performance.payload.style === 'string' || performance.kind === 'dsh.textcard.compound' && performance.payload.version === 1);
}

// ---------- player ----------
// One card at a time; cards that arrive while one is up queue behind it (one colour change between them, no scene).
// Frame-locked on requestAnimationFrame with a 250 ms watchdog, so a throttled frame clock never leaves a card up.
// Every full-screen colour change waits for the shared gate. skip() ends the current card; cancel() removes everything.
function createTextcardPlayer({doc = document, now = () => performance.now(), raf = fn => requestAnimationFrame(fn), caf = id => cancelAnimationFrame(id),
    setInterval: every = (fn, ms) => setInterval(fn, ms), clearInterval: stopEvery = id => clearInterval(id), gate = createTextcardGate(), fontsReady = () => Promise.resolve(),
    fontsLoaded = () => false,
    context = () => ({}), onChange = () => {}} = {}) {
    let layer = null, queue = [], current = null, phase = 'idle', frameId = 0, watchdog = 0, sceneKey = 'scene', disposed = false;
    const log = {changes: [], cards: []};
    let snapshot = {phase, style: null, id: null};
    function emit() {
        const next = {phase, style: current ? current.plan.style : null, id: current ? current.id : null, sr: current && phase === 'up' ? current.plan.sr : ''};
        if (next.phase === snapshot.phase && next.id === snapshot.id) return;
        snapshot = next; onChange(snapshot);
    }
    function schedule() {
        if (disposed || !current && !queue.length) return;
        if (!frameId) frameId = raf(tick);
        if (!watchdog) watchdog = every(() => tick(now(), true), 250);
    }
    function stopClock() {
        if (frameId) caf(frameId); frameId = 0;
        if (watchdog) stopEvery(watchdog); watchdog = 0;
    }
    function changeColour(key, t) {
        if (key === sceneKey) return;
        gate.mark(t); log.changes.push(t); if (log.changes.length > 64) log.changes.shift();
        sceneKey = key;
    }
    function mount(entry, index, t) {
        const frame = entry.plan.frames[index];
        const built = stageViews.textcardLayout.textcardNode(doc, entry.plan, frame, context());
        if (layer) {
            layer.replaceChildren(built.card);
            stageViews.textcardLayout.textcardReadable(built.card, frame, entry.plan);
            try { stageViews.textcardLayout.textcardFit(built.card); stageViews.textcardCenter.center(built.card); } catch (_) { /* centring is cosmetic */ }
            if ((frame.layout || entry.plan.layout) === 'morph' && !frame.state.final && frame.state.converge) raf(() => built.card.classList.add('is-converging'));
        }
        changeColour(built.key, t);
        entry.deadline = frame.layout && entry.plan.style === 'count' && index > 0 ? entry.deadline + frame.ms : t + frame.ms;
        entry.index = index; entry.shownAt = t; entry.node = built.card;
        entry.record.frames.push(Math.round(t - (entry.record.t0 ?? t)));
        entry.record.t0 ??= t;
    }
    function keyOf(entry, index) { return stageViews.textcardLayout.textcardPaints(entry.plan.frames[index], entry.plan, context()).key; }
    function ready(entry, t) {
        // A colour change may paint only when the gate allows it; the previous state simply stays up.
        const key = entry.index < 0 ? keyOf(entry, 0) : keyOf(entry, entry.index);
        return key === sceneKey || gate.slot(t) <= t;
    }
    function finish(entry, skipped) {
        entry.record.skipped = skipped; entry.record.t1 = now();
        log.cards.push(entry.record); if (log.cards.length > 32) log.cards.shift();
        entry.resolve(skipped);
    }
    function exit(t) {
        if (sceneKey !== 'scene' && gate.slot(t) > t) return false;
        if (layer) layer.replaceChildren();
        if (sceneKey !== 'scene') { gate.mark(t); log.changes.push(t); }
        sceneKey = 'scene';
        return true;
    }
    function tick(t = now(), fromWatchdog = false) {
        if (!fromWatchdog) frameId = 0;
        if (disposed) return;
        t = fromWatchdog ? now() : t;
        if (!current && queue.length) { current = queue.shift(); current.index = -1; phase = 'pending'; emit(); }
        if (!current) {
            if (sceneKey !== 'scene' && !exit(t)) return schedule();
            phase = 'idle'; emit(); stopClock(); return;
        }
        const entry = current;
        if (entry.index < 0 && entry.skip) { finish(entry, true); current = null; return tick(t, fromWatchdog); }
        if (!entry.fontsReady) return schedule();
        if (entry.index < 0) {
            if (!ready(entry, t)) return schedule();
            mount(entry, 0, t); phase = 'up'; emit(); return schedule();
        }
        const frame = entry.plan.frames[entry.index];
        const due = entry.skip || t >= (frame.layout && entry.plan.style === 'count' ? entry.deadline : entry.shownAt + frame.ms - 8);
        if (!due) return schedule();
        const last = entry.index >= entry.plan.frames.length - 1;
        if (!last && !entry.skip) {
            const nextKey = keyOf(entry, entry.index + 1);
            if (nextKey !== sceneKey && gate.slot(t) > t) return schedule();
            mount(entry, entry.index + 1, t); return schedule();
        }
        // End of the card: straight into a queued card (one change), else back to the scene.
        const next = queue[0];
        if (next && next.fontsReady && !next.skip) {
            const key = keyOf(next, 0);
            if (key !== sceneKey && gate.slot(t) > t) return schedule();
            finish(entry, !!entry.skip); current = queue.shift(); current.index = -1;
            mount(current, 0, t); emit(); return schedule();
        }
        if (!exit(t)) return schedule();
        finish(entry, !!entry.skip); current = null; phase = queue.length ? 'pending' : 'idle'; emit();
        if (queue.length) return tick(t, fromWatchdog);
        stopClock();
    }
    return {
        attach(node) { layer = node; if (!node) cancelAll(true); },
        play(plan) {
            if (disposed || !plan || !plan.frames.length) return Promise.resolve(false);
            return new Promise(resolve => {
                // Fonts already in memory: the card mounts inside this call, in the same paint as the page turn.
                const entry = {id: Symbol('textcard'), plan, index: -1, skip: false, fontsReady: !!fontsLoaded(plan), resolve,
                    record: {style: plan.style, planned: plan.frames.map(frame => Math.round(frame.ms)), frames: [], skipped: false}};
                // Fonts get a bounded wait; a slow font never holds the story. Loaded fonts need neither the wait nor a
                // FontFaceSet.load per weight (a burst of queued cards would otherwise pay both for every card).
                if (!entry.fontsReady) Promise.race([Promise.resolve(fontsReady(plan)).catch(() => {}), new Promise(done => setTimeout(done, 600))]).then(() => { entry.fontsReady = true; schedule(); });
                queue.push(entry); // Admission already bounds accepted cards by the per-turn cap.
                if (!current) { current = queue.shift(); current.index = -1; phase = 'pending'; emit(); }
                if (current === entry && entry.fontsReady) tick(now(), true); else schedule();
            });
        },
        // Click / Space / Enter / wheel during a card: jump to its end. Returns whether a card consumed the input.
        skip() {
            if (!current) return false;
            current.skip = true; schedule(); tick(now(), true);
            return true;
        },
        cancel: cancelAll,
        snapshot: () => snapshot,
        log: () => ({changes: log.changes.slice(), cards: log.cards.slice(), peak: textcardPeak(log.changes, 1000)}),
        dispose() { cancelAll(true); disposed = true; },
    };
    function cancelAll(detached = false) {
        for (const entry of queue) entry.resolve(true);
        queue = [];
        // Visible cancellation still changes the full-screen colour; only teardown bypasses the gate.
        if (current && !detached && layer) { current.skip = true; tick(now(), true); return; }
        if (current) { finish(current, true); current = null; }
        if (layer) layer.replaceChildren();
        if (sceneKey !== 'scene') { const t = now(); gate.mark(t); log.changes.push(t); }
        sceneKey = 'scene'; stopClock(); phase = 'idle'; emit();
    }
}

// ---------- fonts ----------
// TEXTCARD_FACE is the one place that picks the card face. `library`: a font-library id, registered on demand, full font (no per-sample subset).
// `local`: installed full / PostScript names tried first through local(), for trying faces that are not in the library
// (never shipped); one installed face serves every card weight, like the single-weight HGP明朝B of the 物語 cards.
// If none is installed the library face is used. The tategaki punctuation table (textcard-vert-ink.cjs) was
// generated from the library's Noto Serif SC and applies only while that face renders.
const TEXTCARD_FACE = Object.freeze({library: 'noto-serif-sc', local: Object.freeze([])});
const TEXTCARD_LOCAL_FAMILY = 'DSH Textcard Local';
function textcardLocalFace(face) {
    if (!face.local.length || typeof document === 'undefined' || !document.fonts || typeof FontFace !== 'function') return Promise.resolve(null);
    const src = face.local.map(name => 'local(' + JSON.stringify(name) + ')').join(', ');
    const font = new FontFace(TEXTCARD_LOCAL_FAMILY, src, {weight: '100 900', display: 'block'});
    return font.load().then(() => { document.fonts.add(font); return JSON.stringify(TEXTCARD_LOCAL_FAMILY); }, () => null);
}
let textcardFamily = null, textcardFamilyValue;
function textcardFonts() {
    if (textcardFamily) return textcardFamily;
    const library = () => typeof tavernFonts === 'object' && tavernFonts && tavernFonts.ensure
        ? Promise.resolve(tavernFonts.ensure(TEXTCARD_FACE.library)).then(font => font && font.family || null, () => null) : Promise.resolve(null);
    textcardFamily = textcardLocalFace(TEXTCARD_FACE).then(local => local || library());
    textcardFamily.then(value => { textcardFamilyValue = value; });
    return textcardFamily;
}
const textcardGlyphs = plan => [...new Set(plan.frames.flatMap(frame => [...JSON.stringify(frame.state)]))].join('').slice(0, 400) || '文';
const textcardFaces = family => [400, 500, 700].map(weight => weight + ' 40px ' + family.split(',')[0]);
async function textcardFontsReady(plan, family) {
    if (!family || typeof document === 'undefined' || !document.fonts) return;
    await Promise.all(textcardFaces(family).map(face => document.fonts.load(face, textcardGlyphs(plan))));
}
// Synchronous: the family is known and every face the plan needs is loaded (or there is no library to wait for).
function textcardFontsLoaded(plan) {
    if (textcardFamilyValue === undefined) return false;
    if (!textcardFamilyValue || typeof document === 'undefined' || !document.fonts) return true;
    try { return textcardFaces(textcardFamilyValue).every(face => document.fonts.check(face, textcardGlyphs(plan))); } catch (_) { return false; }
}

// ---------- stage hook ----------
// props: {sessionId, reducedMotion (stage CONFIG 「减少动态」, R20: not the OS setting), blocked (an overlay is open or
// skip is running: any card ends at once)}.
// Returns {accepts(performance), play(effect, {accent}) → Promise, skip() → consumed, cancel(), up, busy, node};
// accent is the 形象色 of the speaker of the line the card precedes.
function textcardPlan(payload, reduced, accent) {
    const plan = planTextcard(payload, {reduced});
    return plan ? {...plan, accent: typeof accent === 'string' ? accent : ''} : null;
}
function useTextcardStage({sessionId, reducedMotion, blocked}) {
    const h = React.createElement;
    const ctx = React.useRef({}); ctx.current = {reducedMotion: reducedMotion === true};
    const [family, setFamily] = React.useState(null);
    const [state, setState] = React.useState({phase: 'idle', sr: ''});
    const familyRef = React.useRef(null); familyRef.current = family;
    const player = React.useMemo(() => createTextcardPlayer({
        now:forkForeground.now, raf:forkForeground.requestAnimationFrame, caf:forkForeground.cancelAnimationFrame,
        setInterval:forkForeground.setInterval, clearInterval:forkForeground.clearInterval,
        context: () => ctx.current, onChange: setState, fontsLoaded: textcardFontsLoaded,
        fontsReady: plan => textcardFonts().then(value => { if (value && familyRef.current !== value) setFamily(value); return textcardFontsReady(plan, value); }),
    }), [sessionId]);
    React.useEffect(() => () => player.dispose(), [player]);
    // Register the family early so the first card does not wait for it.
    React.useEffect(() => { let live = true; textcardFonts().then(value => { if (live && value) setFamily(value); }); return () => { live = false; }; }, []);
    React.useEffect(() => { if (blocked) player.cancel(); }, [blocked, player]);
    const play = React.useCallback((effect, options = {}) => {
        const performance = effect && effect.performance;
        if (!textcardAccepts(performance)) return Promise.resolve(false);
        return player.play(textcardPlan(performance.payload, ctx.current.reducedMotion, options.accent));
    }, [player]);
    // Test hook (debug instance / browser tests): replay a payload through the same plan, gate and player.
    React.useEffect(() => {
        const debug = {play: (payload, accent) => player.play(textcardPlan(payload, ctx.current.reducedMotion, accent)), skip: () => player.skip(), cancel: () => player.cancel(),
            state: () => player.snapshot(), log: () => player.log(), plan: payload => planTextcard(payload, {reduced: ctx.current.reducedMotion})};
        window.forkTextcardDebug = debug;
        return () => { if (window.forkTextcardDebug === debug) delete window.forkTextcardDebug; };
    }, [player]);
    const attach = React.useCallback(node => player.attach(node), [player]);
    const up = state.phase === 'up', busy = state.phase !== 'idle';
    const node = h('div', {className: 'fork-tc-layer' + (up ? ' is-up' : ''), style: family ? {'--tc-mincho': family} : undefined},
        h('div', {ref: attach, className: 'fork-tc-host', 'aria-hidden': true}),
        h('span', {className: 'fork-tc-sr', 'aria-live': 'polite'}, up ? state.sr : ''));
    return {accepts: textcardAccepts, play, skip: player.skip, cancel: player.cancel, up, busy, node};
}
