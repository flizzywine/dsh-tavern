// 「文字演出」 stage renderer. Plans come from textcard-presets.cjs;
// this file owns the DOM templates, optical centring, the frame-locked player and the stage hook.
// The player is imperative: the stage component never re-renders per card frame.
// @include textcard-presets.cjs

const TEXTCARD_KIND = /^dsh\.textcard(?:\.|$)/;
function textcardAccepts(performance) {
    return !!performance && TEXTCARD_KIND.test(String(performance.kind || '')) && !!performance.payload &&
        (typeof performance.payload.style === 'string' || performance.kind === 'dsh.textcard.compound' && performance.payload.version === 1);
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
    const player = React.useMemo(() => stageViews.textcardPlayers.create({
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
