'use strict';
function createStageText({React, document, performance, ResizeObserver, getComputedStyle,
    clock:forkForeground, fonts:tavernFonts, sounds:forkUiSfx, defaultTextSpeed}) {
// 逐字显示 (features/stage-typewriter.js): a page's line is typed out glyph by glyph, at the reader's 文字速度
// (CONFIG › 文字, modules/stage-runtime.js `textSpeed`, milliseconds per glyph; 0 shows the whole line at once).
// A glyph is a grapheme (an emoji with its modifiers or a letter with its marks is one step).
const STAGE_GLYPH_SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function stageGlyphs(text) {
	const value = String(text || "");
	return STAGE_GLYPH_SEGMENTER ? Array.from(STAGE_GLYPH_SEGMENTER.segment(value), part => part.segment) : Array.from(value);
}
// Extra glyph steps to wait after glyphs[index]: after a sentence end (also behind its closing quote, 。」) and a
// line break, a shorter one after a comma; none inside a run of punctuation or at the end.
function stageGlyphPause(glyphs, index) {
	const closers = /^[」』）)】〉》”"’'］\]]$/u, next = glyphs[index + 1];
	if (next === undefined || closers.test(next) || /^[、，,。．.！!？?…‥：:；;～~—―]$/u.test(next)) return 0;
	let at = index;
	while (at > 0 && closers.test(glyphs[at])) at--;
	const glyph = glyphs[at];
	if (glyph === "\n" || /^[。．.！？!?…‥]$/u.test(glyph) && (glyph !== "." || /^\s$/.test(next))) return 5;
	if (/^[、，,；;：:～~]$/u.test(glyph)) return 2;
	if (/^[—―]$/u.test(glyph)) return 1;
	return 0;
}
// Milliseconds before glyphs[index + 1] shows: one step at the reader's speed, plus the pause after glyphs[index].
function stageGlyphDelay(glyphs, index, speed) {
	return speed * (1 + (index >= 0 ? stageGlyphPause(glyphs, index) : 0));
}
// How long a glyph fades in (tavern.css 「stage typewriter」 dsh-tavern-stage-glyph-in).
const STAGE_GLYPH_FADE_MS = 220;


// textbox glyph hops are cut-out animation shot "on twos" - one even 12/s clock for
// the reveal steps and the glyph poses. 83.3 ms is exactly 5 frames at
// 60 Hz (10 at 120, 12 at 144), so every pose is held the same number of frames. The authored textFx.stepFps (6-14)
// was read literally before; 8/s glyph hops over a 60 Hz display alternated 7/8-frame holds and read as lag. The
// collage pieces keep their own slower authored clock (skin-overlay-motion.cjs).
const STAGE_SKIN_TEXT_FPS = 12;
function stageSkinReveal(skin, speed, {reducedMotion = false, photosensitive = true} = {}) {
    const fx = !skin || reducedMotion || photosensitive && skin.photosensitive ? {reveal:'type'} : skin.textFx;
    const interval = 1000/STAGE_SKIN_TEXT_FPS;
    const stepMs = fx.reveal === 'type' ? Math.min(speed * 1.2,Math.max(speed,fx.cps ? 1000/fx.cps : speed)) : interval;
    // The glyph track (skin-interface.md §18 E1): `poses` entrance poses (the reveal's own two, or textFx.poses), each held
    // `hold` whole steps (textFx.stepFps on the 12/s grid: round(12 / stepFps)); a glyph is at rest after poses x hold steps.
    return {kind:fx.reveal,stepMs,chars:fx.reveal === 'type' ? 1 : Math.max(fx.charsPerStep || 1,Math.ceil(interval/Math.max(1,speed))),
        chunk:fx.reveal === 'type' ? 1 : fx.charsPerStep || 1,maxDurationScale:1.2,speed,
        poses:fx.poses?.length || 2,hold:fx.stepFps ? Math.max(1,Math.round(STAGE_SKIN_TEXT_FPS/fx.stepFps)) : 1,jitter:fx.emphasis === 'jitter' ? fx.jitter ?? 1 : 0};
}
// A glyph's seeded entrance offset for emphasis jitter: [x, y] em within ± jitter x 0.05em.
function stageSkinGlyphJitter(index, jitter) {
    const r=k => ((Math.imul(index * 2 + k + 1,2654435761) >>> 0) % 1000) / 999 * 2 - 1;
    return [r(0),r(1)].map(v => Math.round(v * jitter * 50) / 1000);
}
// Glyphs revealed on hop step `step` (1-based) when `shown` are already out. The reading speed stays the budget:
// step k may show floor(k*stepMs/speed) glyphs, in authored chunks (charsPerStep) - a slow reader gets held steps
// on the same 12/s grid instead of a slower clock.
function stageSkinRevealCount(reveal, shown, step) {
    if (reveal.kind !== 'stutter') {
        const due = Math.floor(step*reveal.stepMs/Math.max(1,reveal.speed));
        return shown < due ? Math.max(reveal.chunk || 1,due-shown) : 0;
    }
    // Deterministic hesitation, but never an unbounded zero-character stall.
    const random = (Math.imul(step + 1,1103515245) + 12345) >>> 0;
    return Math.max(random % (2*reveal.chars + 1),Math.floor(step*reveal.stepMs/Math.max(1,reveal.speed*reveal.maxDurationScale))-shown,0);
}

// galgame typewriter (theme.css "stage typewriter"). The whole page is laid out from the
// first frame and glyphs are only revealed (opacity), so shown text never re-wraps: line breaks, kinsoku and
// the box are fixed before the first character appears. While the text still streams in, the last glyphs (and
// an unfinished Latin word) stay hidden so later text cannot move them. Each glyph fades in with a slight rise;
// the rhythm pauses briefly after punctuation. Fonts settle before the first glyph.
// props.speed: milliseconds per character (the reading preference; 0 shows the whole line at once).
// Measure visual lines only when text/fonts/width change. The line clock never queries layout.
function GalNarrationLines(props) {
    const h = React.createElement, ref = React.useRef(null), clock = React.useRef(null);
    const fontsReady = useGalFontsReady();
    const fontRevision = React.useSyncExternalStore(tavernFonts.subscribe, tavernFonts.getSnapshot);
    const glyphs = React.useMemo(() => stageGlyphs(props.text), [props.text]);
    const limit = Math.max(0, Math.min(galRevealLimit(glyphs, props.pending), glyphs.length - (props.pending && props.movable ? stageGlyphs(props.movable).length : 0)));
    const text = glyphs.slice(0, limit).join('');
    const [lines, setLines] = React.useState([]), [visible, setVisible] = React.useState(0);
    const instant = props.instant || props.reducedMotion || props.speed === 0;
    const callbacks = React.useRef(props); callbacks.current = props;
    React.useLayoutEffect(() => {
        if (!fontsReady || !ref.current) return;
        const parent = ref.current.parentElement;
        const measure = () => {
            const probe = document.createElement('span'), style = getComputedStyle(parent);
            Object.assign(probe.style, { display:'block', position:'absolute', visibility:'hidden', pointerEvents:'none', whiteSpace:'pre-wrap',
                width:(parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))+'px' });
            probe.textContent = text; parent.appendChild(probe);
            const node = probe.firstChild, range = document.createRange(), result = [];
            let offset = 0, top = null;
            for (const glyph of stageGlyphs(text)) {
                range.setStart(node, offset); range.setEnd(node, offset + glyph.length); offset += glyph.length;
                const y = Math.round(range.getBoundingClientRect().top);
                if (top !== y || !result.length) { result.push(''); top = y; }
                result[result.length - 1] += glyph;
            }
            probe.remove();
            setLines(old => old.join('\u0000') === result.join('\u0000') ? old : result);
        };
        measure();
        const observer = new ResizeObserver(measure); observer.observe(parent);
        document.fonts?.addEventListener('loadingdone', measure);
        return () => { observer.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
    }, [text, fontsReady, fontRevision, props.skin]);
    React.useEffect(() => {
        if (!lines.length || props.hold || !fontsReady) return;
        if (clock.current === null) clock.current = forkForeground.now();
        const timers = [], {fade, stagger} = props.lines;
        const show = count => {
            setVisible(count);
            callbacks.current.onVisible?.(lines.slice(0, count).join(''));
            if (count === lines.length && !callbacks.current.pending) callbacks.current.onDone?.();
        };
        if (instant) show(lines.length);
        else lines.forEach((_, i) => timers.push(forkForeground.setTimeout(() => show(i + 1), Math.max(0, clock.current + (i * stagger + fade) * 1000 - forkForeground.now()))));
        return () => timers.forEach(timer => forkForeground.clearTimeout(timer));
    }, [lines, instant, fontsReady, props.hold, props.pending, props.lines.fade, props.lines.stagger]);
    return h('span', {ref, className:'fork-gal-narration-lines', 'data-instant':instant || undefined, 'data-held':props.hold || !fontsReady || undefined},
        lines.map((line, i) => h('span', {key:i, className:'fork-gal-narration-line', style:{'--nar-fade':props.lines.fade+'s', '--nar-delay':(i * props.lines.stagger)+'s', '--nar-rise':'calc('+(props.lines.rise || 0)+' * var(--nar-u))'}, 'data-visible':i < visible || undefined}, line.replace(/\r?\n$/, '') || '\u200b')));
}
function GalTypewriter(props) {
    const speed = props.speed == null ? defaultTextSpeed : props.speed;
    const instant = Boolean(props.instant) || !(speed > 0);
    const pending = Boolean(props.pending);
    const reveal = props.skin ? stageSkinReveal(props.skin,speed,{reducedMotion:props.reducedMotion === true,photosensitive:props.photosensitive !== false}) : null;
    const stepped = reveal && reveal.kind !== 'type' && !instant;
    const fadeMs = STAGE_GLYPH_FADE_MS;
    // Skin hop clock (stepped reveals only): the current hop step and the step each glyph appeared on.
    const [skinStep,setSkinStep] = React.useState(0);
    const hop = React.useRef({step:0,t0:null,base:0,born:[]});
    const glyphs = React.useMemo(() => stageGlyphs(props.text), [props.text]);
    // props.movable: the tail a streaming page may still hand to the next page (stagePageMovableTail); held too.
    const limit = Math.max(0, Math.min(galRevealLimit(glyphs, pending), glyphs.length - (pending && props.movable ? stageGlyphs(props.movable).length : 0)));
    const fontsReady = useGalFontsReady();
    const [shown, setShown] = React.useState(instant ? limit : 0);
    const visible = instant ? limit : Math.min(shown, limit);
    // Only the glyphs still fading in are separate elements (one per glyph); shown text is one run and the
    // hidden rest another, so the text paints exactly as plain text (no per-glyph shadow overlap) once settled.
    const [settled, setSettled] = React.useState(-1);
    const onDone = React.useRef(props.onDone), onReveal=React.useRef(props.onReveal), onVisible=React.useRef(props.onVisible);
    onVisible.current=props.onVisible;
    React.useLayoutEffect(()=>{onVisible.current?.(glyphs.slice(0,visible).join(""));},[visible,glyphs,props.visibleKey]);
    onDone.current = props.onDone;onReveal.current=props.onReveal;
    // When the next glyph is due. A streaming chunk re-renders the page (new text after the shown glyphs); the glyph
    // keeps its time instead of restarting the wait, which stalled typing at every pause while chunks kept arriving.
    const due = React.useRef(null);
    React.useEffect(function () {
        if (stepped) return; // the hop clock below drives stepped skin reveals
        if (!pending && visible >= glyphs.length) onDone.current && onDone.current();
        if (instant || !fontsReady || visible >= limit) {
            due.current = null;
            const timer = forkForeground.setTimeout(() => setSettled(visible), fadeMs + 40);
            return () => forkForeground.clearTimeout(timer);
        }
        // the page is laid out but its first glyph waits while the previous face clears (useGalFaceHandoff).
        if (props.hold) { due.current = null; return; }
        const delay = stageGlyphDelay(glyphs, visible - 1, reveal?.stepMs || speed);
        const now = forkForeground.now();
        if (!due.current || due.current.visible !== visible) due.current = { visible, at: now + delay };
        const timer = forkForeground.setTimeout(() => {
            setShown(Math.min(limit,visible + 1));
            onReveal.current?.(visible);
        },Math.max(0, due.current.at - now));
        return () => forkForeground.clearTimeout(timer);
    }, [visible, limit, glyphs, pending, instant, fontsReady, speed, stepped, reveal?.kind, reveal?.stepMs, reveal?.chars, Boolean(props.hold)]);
    // stepped skin reveals are cut-out animation on twos. One frame-quantized clock
    // (absolute from its start, read at the frame's own time) drives both the reveal steps and every glyph's pose,
    // so poses never drift off the steps and each is held the same number of display frames. A glyph enters in
    // one clean step (hop 0), lands on the next (hop 1) and then holds at rest; there are no CSS animation timers.
    // A long task skips poses rather than slowing the reading speed. The page reports done once its last glyphs
    // have landed, so the final hop is not cut short by the typed state.
    React.useEffect(function () {
        if (!stepped || !fontsReady) return;
        // The face handoff hold (props.hold) stops the hop clock too; it restarts with a fresh step when released.
        if (props.hold) { hop.current.t0 = null; return; }
        const state = hop.current, settledAt = visible > 0 ? (state.born[visible - 1] ?? 0) + reveal.poses * reveal.hold : 0;
        if (visible >= limit && state.step >= settledAt) {
            state.t0 = null;
            if (!pending && visible >= glyphs.length) onDone.current && onDone.current();
            return;
        }
        let frame = null;
        const tick = function () {
            const now = galFrameNow();
            if (state.t0 === null) { state.t0 = now; state.base = state.step + 1; }
            // 2 ms absorbs frame timestamp jitter without moving a step across a frame boundary (a 144 Hz frame is 6.9 ms).
            const step = state.base + Math.floor((now - state.t0 + 2) / reveal.stepMs);
            if (step <= state.step) { frame = forkForeground.requestAnimationFrame(tick); return; }
            let next = visible;
            for (let k = state.step + 1; k <= step; k++) {
                const count = next < limit ? Math.min(limit - next, stageSkinRevealCount(reveal, next, k)) : 0;
                // §18 E5: the skin's type cue (silent unless its sound palette has one; every n-th step).
                if (count > 0) { onReveal.current?.(next); if (k === step && typeof forkUiSfx === "object" && forkUiSfx) forkUiSfx.play("type"); }
                for (let i = next; i < next + count; i++) state.born[i] = k;
                next += count;
            }
            state.step = step;
            frame = null;
            setShown(next); setSkinStep(step);
        };
        frame = forkForeground.requestAnimationFrame(tick);
        return () => { if (frame !== null) forkForeground.cancelAnimationFrame(frame); };
    }, [stepped, fontsReady, visible, limit, glyphs, pending, skinStep, reveal?.kind, reveal?.stepMs, reveal?.chunk, reveal?.speed, reveal?.poses, reveal?.hold, Boolean(props.hold)]);
    // Glyphs before `settled` finished fading earlier (a held streaming tail), so they never fade again.
    const tail = Math.ceil(fadeMs/Math.max(1,speed))+1;
    // A glyph holds each of its `poses` entrance poses `hold` steps (stageSkinReveal), then joins the shown run.
    const span = stepped ? reveal.poses * reveal.hold : 0;
    const landed = stepped ? hop.current.born.findIndex((born, i) => i < visible && born + span > skinStep) : -1;
    const done = instant ? visible : stepped ? (landed < 0 ? visible : landed) : Math.min(visible, Math.max(0, settled, visible - tail));
    const h = React.createElement;
    const fx = stepped ? props.skin.textFx : null;
    return h("span", { className: "fork-gal-type" + (instant ? " is-instant" : ""), 'data-skin-reveal':stepped ? reveal.kind : undefined,
            'data-skin-poses':fx?.poses ? fx.poses.length : undefined, 'data-skin-emphasis':fx?.emphasis || undefined },
        done > 0 ? h("span", { key: "shown", className: "fork-gal-type-shown" }, glyphs.slice(0, done).join("")) : null,
        glyphs.slice(done, visible).map((glyph, index) => {
            const at = done + index, jitter = reveal?.jitter ? stageSkinGlyphJitter(at, reveal.jitter) : null;
            return h("span", { key: at, className: "fork-gal-glyph" }, glyph,
                stepped ? h('span',{className:'fork-skin-glyph-paint','data-glyph':glyph,'data-hop':Math.min(reveal.poses,Math.floor((skinStep-(hop.current.born[at] ?? skinStep))/reveal.hold)),'aria-hidden':true,
                    style:jitter ? {'--gj-x':jitter[0] + 'em','--gj-y':jitter[1] + 'em'} : undefined}) : null);
        }),
        visible < glyphs.length ? h("span", { key: "rest", className: "fork-gal-type-rest" }, glyphs.slice(visible).join("")) : null);
}
// The presentation clock (forkForeground: stops while the window is in the background) at the current frame's start.
// Inside a frame callback document.timeline.currentTime is the frame time shared by every callback of that frame, so
// a Live2D or Pixi callback that ran first cannot push a hop step across a frame boundary.
function galFrameNow() {
    const now = forkForeground.now(), frame = typeof document !== "undefined" ? document.timeline?.currentTime : null;
    return typeof frame === "number" && typeof performance !== "undefined" ? now - Math.max(0, performance.now() - frame) : now;
}
// A streaming page keeps its last two glyphs (and a Latin word still being written) hidden: a following 。 or 」
// may pull the glyph before it onto the next line (kinsoku), and a growing word may wrap as a whole.
function galRevealLimit(glyphs, pending) {
    if (!pending) return glyphs.length;
    const word = glyph => /^[\p{L}\p{N}'\u2019-]$/u.test(glyph || "") && !/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u.test(glyph || "");
    let end = Math.max(0, glyphs.length - 2);
    while (end > 0 && word(glyphs[end - 1]) && word(glyphs[end])) end--;
    return end;
}
function useGalFontsReady() {
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    const [ready, setReady] = React.useState(() => !fonts || fonts.status === "loaded");
    React.useEffect(function () {
        if (ready) return;
        let live = true;
        const done = () => { if (live) setReady(true); };
        fonts.ready.then(done, done);
        const timer = forkForeground.setTimeout(done, 800);
        return () => { live = false; forkForeground.clearTimeout(timer); };
    }, []);
    return ready;
}


return {Typewriter:GalTypewriter, NarrationLines:GalNarrationLines};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageText};
