'use strict';
function createStageText({React, document, performance, ResizeObserver, getComputedStyle,
    clock:forkForeground, fonts:tavernFonts, sounds:forkUiSfx, defaultTextSpeed,
    stageGlyphs, stageGlyphDelay, STAGE_GLYPH_FADE_MS, stageSkinReveal, stageSkinRevealCount, stageSkinGlyphJitter}) {
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
