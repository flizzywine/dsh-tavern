// 「文字演出」 stage renderer. Plans come from textcard-presets.cjs;
// this file owns the DOM templates, optical centring, the frame-locked player and the stage hook.
// The player is imperative: the stage component never re-renders per card frame.
// @include textcard-presets.cjs
// @include textcard-vert-ink.cjs

const TEXTCARD_KIND = /^dsh\.textcard(?:\.|$)/;
function textcardAccepts(performance) {
    return !!performance && TEXTCARD_KIND.test(String(performance.kind || '')) && !!performance.payload &&
        (typeof performance.payload.style === 'string' || performance.kind === 'dsh.textcard.compound' && performance.payload.version === 1);
}

// ---------- optical centring ----------
// Full-width CJK punctuation sits on one side of its em box (「？」 at the end of 「真的？」), and letter-spacing adds a
// trailing gap: the layout box is centred, the ink is not. Each [data-tc-center] block is measured glyph by glyph —
// layout position from a DOM Range; ink bounds from canvas measureText (actualBoundingBox*) for horizontal and upright
// glyphs, and from the generated vert/vrt2 table (textcard-vert-ink.cjs, bin/textcard-vert-ink.py) for
// tategaki punctuation, whose rotated/shifted form canvas cannot see — and moved with `translate` so its ink box is
// centred on the block's layout box (the sample's ink centring). `halt` / `text-spacing-trim` do not fix ？！.
function textcardVertInk(style, ch) {
    // Only the first family renders the card; a fallback name later in the stack must not select the Noto table.
    if (typeof TEXTCARD_VERT_INK === 'undefined' || !/noto-serif-sc|Noto Serif SC/i.test(style.fontFamily.split(',')[0])) return null;
    const weight = Number(style.fontWeight) || 400, key = weight >= 600 ? '700' : weight >= 450 ? '500' : '400';
    return TEXTCARD_VERT_INK[key][ch] || null;
}
const textcardInkCache = new Map();
let textcardCanvas = null;
function textcardGlyphInk(doc, font, ch) {
    const key = font + '\u0000' + ch;
    let ink = textcardInkCache.get(key);
    if (ink) return ink;
    textcardCanvas ||= doc.createElement('canvas').getContext('2d');
    const c = textcardCanvas;
    c.font = font; c.textAlign = 'left'; c.textBaseline = 'ideographic';
    const m = c.measureText(ch);
    c.textBaseline = 'alphabetic';
    const a = c.measureText(ch);
    // ideo: relative to the em box bottom (vertical upright); alpha: relative to the alphabetic baseline, which sits
    // fontBoundingBoxAscent below the top of the inline content area (horizontal).
    ink = {left: -m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, top: -m.actualBoundingBoxAscent, bottom: m.actualBoundingBoxDescent, width: m.width,
        alphaTop: -a.actualBoundingBoxAscent, alphaBottom: a.actualBoundingBoxDescent, ascent: a.fontBoundingBoxAscent};
    if (textcardInkCache.size > 4000) textcardInkCache.clear();
    textcardInkCache.set(key, ink);
    return ink;
}
// The offset of a block follows from its layout alone, so it is kept per (card attributes, card size, block class and
// box size, and each text run's class, font, writing mode, letter-spacing and text): a repeated card skips the glyph walk.
// Nothing is kept while a font is loading (the glyphs may still be a fallback) and the cache empties when one finishes.
const textcardCenterCache = new Map();
let textcardCenterFonts = null;
function textcardCenterCacheable(doc) {
    const fonts = doc.fonts;
    if (!fonts) return false;
    if (textcardCenterFonts !== fonts) {
        textcardCenterFonts = fonts;
        textcardCenterCache.clear();
        fonts.addEventListener?.('loadingdone', () => textcardCenterCache.clear());
    }
    return fonts.status === 'loaded';
}
// Stage units: a docked stage is only scaled (createModStageDock); glyph metrics are in CSS px of the card.
function textcardLocalRect(r, k) {
    return k === 1 ? r : {left: r.left * k, right: r.right * k, top: r.top * k, bottom: r.bottom * k, width: r.width * k, height: r.height * k};
}
function textcardCenterOffset(doc, block, box, runs, k = 1) {
    const range = doc.createRange();
    let ink = null;
    for (const {text, style, vertical, size, font} of runs) {
        const value = text.nodeValue;
        for (let i = 0; i < value.length;) {
            const code = value.codePointAt(i), len = code > 0xffff ? 2 : 1, ch = value.slice(i, i + len);
            range.setStart(text, i); range.setEnd(text, i + len); i += len;
            if (!ch.trim()) continue;
            const r = textcardLocalRect(range.getBoundingClientRect(), k);
            if (!r.width && !r.height) continue;
            const table = vertical ? textcardVertInk(style, ch) : null;
            if (table) {
                const left = r.left + (r.width - size) / 2, em = size / 1000;
                const rect = {left: left + table[0] * em, right: left + size - table[1] * em, top: r.top + table[2] * em, bottom: r.top + size - table[3] * em};
                ink = ink ? {left: Math.min(ink.left, rect.left), right: Math.max(ink.right, rect.right), top: Math.min(ink.top, rect.top), bottom: Math.max(ink.bottom, rect.bottom)} : rect;
                continue;
            }
            const g = textcardGlyphInk(doc, font, ch);
            if (!(g.right > g.left)) continue;
            // Horizontal: the em box starts at the glyph's advance origin. Vertical upright: the em box is centred in
            // the column and its ideographic bottom sits one em below the glyph's top.
            const x0 = vertical ? r.left + (r.width - g.width) / 2 : r.left, base = vertical ? r.top + size : r.top + g.ascent;
            const rect = {left: x0 + g.left, right: x0 + g.right, top: base + (vertical ? g.top : g.alphaTop), bottom: base + (vertical ? g.bottom : g.alphaBottom)};
            ink = ink ? {left: Math.min(ink.left, rect.left), right: Math.max(ink.right, rect.right), top: Math.min(ink.top, rect.top), bottom: Math.max(ink.bottom, rect.bottom)} : rect;
        }
    }
    range.detach?.();
    if (!ink) return '';
    const dx = (box.left + box.right) / 2 - (ink.left + ink.right) / 2;
    const dy = block.dataset.tcCenter === 'xy' ? (box.top + box.bottom) / 2 - (ink.top + ink.bottom) / 2 : 0;
    return Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ? dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px' : '';
}
// Writes, then reads, then writes: every block's translate is cleared first, all of them are measured against one
// layout (blocks are never nested, so one block's translate cannot move another), and the offsets are written last.
function textcardCenter(card) {
    const doc = card.ownerDocument, view = doc.defaultView;
    const blocks = [...card.querySelectorAll('[data-tc-center]')];
    for (const block of blocks) block.style.translate = '';
    const cacheable = textcardCenterCacheable(doc);
    const d = card.dataset, cardKey = [d.layout, d.style, d.dir, d.face, d.size, d.motif, d.anchor, d.reduced, card.clientWidth, card.clientHeight].join('\u0001');
    const stage = card.closest('.fork-gal-stage'), outer = stage && blocks.length ? stage.getBoundingClientRect() : null;
    const k = outer && outer.width > 0 && Math.abs(outer.width - stage.offsetWidth) >= 1 ? stage.offsetWidth / outer.width : 1;
    const offsets = blocks.map(block => {
        const box = textcardLocalRect(block.getBoundingClientRect(), k);
        if (!box.width || !box.height) return '';
        const walker = doc.createTreeWalker(block, 4), runs = [];
        let key = cardKey + '\u0002' + block.className + '\u0001' + block.dataset.tcCenter + '\u0001' + box.width + '\u0001' + box.height;
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            const style = view.getComputedStyle(text.parentElement), vertical = style.writingMode.startsWith('vertical');
            const size = parseFloat(style.fontSize), font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
            runs.push({text, style, vertical, size, font});
            key += '\u0002' + text.parentElement.className + '\u0001' + font + '\u0001' + style.writingMode + '\u0001' + style.letterSpacing + '\u0001' + text.nodeValue;
        }
        if (cacheable && textcardCenterCache.has(key)) return textcardCenterCache.get(key);
        const offset = textcardCenterOffset(doc, block, box, runs, k);
        if (cacheable) {
            if (textcardCenterCache.size > 256) textcardCenterCache.clear();
            textcardCenterCache.set(key, offset);
        }
        return offset;
    });
    blocks.forEach((block, i) => { if (offsets[i]) block.style.translate = offsets[i]; });
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
            try { stageViews.textcardLayout.textcardFit(built.card); textcardCenter(built.card); } catch (_) { /* centring is cosmetic */ }
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
