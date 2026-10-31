'use strict';
function createStagePresentation({React, document, foreground:forkForeground, titleTiming, matchMedia, getComputedStyle, ResizeObserver, MutationObserver}) {
const GAL_NARROW_QUERY = '(max-width: 640px)';
// Title card (director `title`, one-shot): black screen, serif text typed out, a short hold, fade out.
// Click skips it. props.title: { text, nonce }.
// Timings: the resolved `title` effect (stage-effects.cjs); 减少动态 shows the text at once, holds, then fades out.
function GalTitle(props) {
    const h = React.createElement;
    const text = Array.from(props.title.text || "");
    const spec = props.timing || titleTiming, calm = props.reducedMotion === true;
    const [shown, setShown] = React.useState(calm ? text.length : 0);
    const [phase, setPhase] = React.useState(calm ? "hold" : "in"); // in → typing → hold → out
    React.useEffect(function () {
        let timer = 0;
        if (phase === "in") timer = forkForeground.setTimeout(() => setPhase("typing"), 1000 * spec.in);
        else if (phase === "typing") timer = shown < text.length ? forkForeground.setTimeout(() => setShown(n => n + 1), 1000 * spec.step) : forkForeground.setTimeout(() => setPhase("hold"), 60);
        else if (phase === "hold") timer = forkForeground.setTimeout(() => setPhase("out"), 1000 * spec.hold);
        else if (phase === "out") timer = forkForeground.setTimeout(() => props.onDone(), 1000 * spec.out);
        return () => forkForeground.clearTimeout(timer);
    }, [phase, shown]);
    return h("div", { className: "fork-gal-title is-" + phase, role: "status", "aria-label": props.title.text, title: "点击跳过",
        onClick: event => { event.stopPropagation(); if (phase !== "out") setPhase("out"); } },
        h("div", { className: "fork-gal-title-text", "aria-hidden": true },
            text.map((ch, i) => h("span", { key: i, className: i < shown ? "is-on" : "" }, ch))),
        h("i", { className: "fork-gal-title-rule", "aria-hidden": true }));
}
function useGalNarrow() {
    const has = typeof matchMedia === "function";
    const [narrow, setNarrow] = React.useState(() => has && matchMedia(GAL_NARROW_QUERY).matches);
    React.useEffect(function () {
        if (!has) return undefined;
        const list = matchMedia(GAL_NARROW_QUERY), changed = () => setNarrow(list.matches);
        changed();
        if (list.addEventListener) list.addEventListener("change", changed);
        return () => { if (list.removeEventListener) list.removeEventListener("change", changed); };
    }, []);
    return narrow;
}
// on phones the top bar's
// icons are one group at the top centre. The bar's free width (its padding: the screen edges or a skin's drawn corner buttons,
// theme.css) is where they may stand; the group packs into it as flex-wrap does and --fk-bar-group is its widest row, so
// the CSS can place a box of that width on the stage's centre line, or as near it as the corner buttons allow. One row is the
// box (centred); further rows start at its left edge, as text wraps. Wider
// screens lay the bar out without it.
function galTopbarGroup(bar) {
    const widths = [];
    const walk = node => {
        for (const child of node.children) {
            const style = getComputedStyle(child);
            if (style.display === "contents") walk(child);
            else if (style.display !== "none" && style.position !== "absolute" && style.position !== "fixed")
                widths.push(child.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight));
        }
    };
    walk(bar);
    // The free width with the group's box unset (its padding then is the free width's edges).
    bar.style.removeProperty("--fk-bar-group");
    const style = getComputedStyle(bar), free = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let widest = 0, row = 0;
    for (const width of widths) {
        if (row && row + width > free + 0.5) row = 0;
        row += width;
        widest = Math.max(widest, row);
    }
    if (widest) bar.style.setProperty("--fk-bar-group", Math.ceil(widest) + "px");
}
// Keeps --fk-bar-group on the bar element current while `on` (the phone breakpoint): the bar's size, and its icons coming, going or changing words.
function useGalTopbarGroup(bar, on) {
    React.useLayoutEffect(() => {
        if (!bar || !on) return undefined;
        let active = true;
        const measure = () => { if (active) galTopbarGroup(bar); };
        measure();
        const resize = new ResizeObserver(measure), mutate = new MutationObserver(measure);
        resize.observe(bar);
        mutate.observe(bar, { childList: true, subtree: true, characterData: true });
        return () => { active = false; resize.disconnect(); mutate.disconnect(); bar.style.removeProperty("--fk-bar-group"); };
    }, [bar, on]);
}

// the top bar is the stage entries'
// only home and adds nothing the original game lacks while reading. state (data-hud on the stage, theme.css「stage top bar
// reveal」): 'always' (mode), 'shown' - a mouse in the top fifth of the stage or over the bar (hidden 2 s after it leaves),
// keyboard focus inside the bar, or one of its popovers open - 'flash' - the place / track line for 3 s after a live change - or
// null. Touch reveals it with the menu (CSS). An entry with a badge stays on screen either way.
const GAL_HUD_ZONE = 0.2, GAL_HUD_LINGER = 2000, GAL_HUD_FLASH = 3000;
function useGalHudReveal(rootRef, { mode, labels, live }) {
    const [shown, setShown] = React.useState(false), [flash, setFlash] = React.useState(false);
    const timer = React.useRef(0), seen = React.useRef(labels);
    React.useEffect(function () {
        if (seen.current === labels) return undefined;
        seen.current = labels;
        if (!live || !labels.trim()) return undefined;
        setFlash(true);
        const at = forkForeground.setTimeout(() => setFlash(false), GAL_HUD_FLASH);
        return () => { forkForeground.clearTimeout(at); setFlash(false); };
    }, [labels]);
    React.useEffect(() => () => forkForeground.clearTimeout(timer.current), []);
    const bar = () => rootRef.current?.querySelector(".fork-gal-topbar");
    function show() { forkForeground.clearTimeout(timer.current); timer.current = 0; setShown(true); }
    // An open popover of an entry (BGM, background, danmaku, phone list) or focus inside keeps the bar; a hidden chip gives
    // its focus back to the stage.
    function linger() {
        if (timer.current) return;
        timer.current = forkForeground.setTimeout(function hide() {
            timer.current = 0;
            const node = bar(), focused = node && node.contains(document.activeElement);
            if (node && node.querySelector("[role='dialog'], [role='menu']")) { timer.current = forkForeground.setTimeout(hide, GAL_HUD_LINGER); return; }
            setShown(false);
            if (focused && rootRef.current) rootRef.current.focus({ preventScroll: true });
        }, GAL_HUD_LINGER);
    }
    return {
        state: mode === "always" ? "always" : shown ? "shown" : flash ? "flash" : null,
        onPointerMove(event) {
            if (mode === "always" || event.pointerType !== "mouse" || !rootRef.current) return;
            const rect = rootRef.current.getBoundingClientRect();
            if (event.clientY - rect.top < rect.height * GAL_HUD_ZONE || event.target?.closest?.(".fork-gal-topbar")) show();
            else if (shown) linger();
        },
        // The mouse leaving the stage (out of the window over the top edge too) starts the same linger.
        onPointerLeave(event) { if (mode !== "always" && event.pointerType === "mouse" && shown) linger(); },
        onFocus() { if (mode !== "always") show(); },
        onBlur(event) { if (mode !== "always" && !(event.relatedTarget && event.currentTarget.contains(event.relatedTarget))) linger(); }
    };
}

return {Title:GalTitle, useNarrow:useGalNarrow, useTopbarGroup:useGalTopbarGroup, useHudReveal:useGalHudReveal};
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStagePresentation};
