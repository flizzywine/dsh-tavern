'use strict';
function createStageSkinButtons({React, foreground:forkForeground, ResizeObserver, MutationObserver}) {
// a skin's on-stage quick buttons, drawn
// from its own bundle images (stageSkinArt in stage-skin-adapter.cjs). They are the existing quick actions, not new ones:
// backlog (履历), auto (its lit image while on), skip (跳过: fast page turns to the latest page) and menu - the stage menu (Esc), the one
// entry to everything the original lacks, in place of the folded menu control. Placed in art px of the skin's design screen
// (--art-u, theme.css「stage skin: art」); on phones in one touch-sized unit, all hanging from the top edge (ntop). Enter / Space
// act on a keyboard-focused button and never also turn the page; after a pointer press they page (the stage's key guard,
// galKeyboardFocus in gal-stage.js).
const STAGE_SKIN_BUTTON_LABELS = {backlog: "履历（L）", auto: "自动翻页（A）", skip: "跳过", menu: "菜单（Esc）"};
// a button with a tint mask (the SKIP frame) carries its image and mask
// (--art-btn-img / --art-btn-tint): theme.css recolours the masked part with the speaker's colour as it does the box trim.
// a button with a hint (art.buttons.*.hint) shows its action's real
// key - keyCaps, the stage's binding table (GAL_KEY_CAPS in gal-stage.js) - as a key cap in place of its image's
// own input prompt (the image shows only its label part). The row is cap, then label, and the hinted rows of one corner
// share the cap's outer edge (button.col, stageSkinArt), whatever widths the original prompt glyphs had. Decorative: the
// button's label already names the key.
// decor (art.decor): the original's still HUD prints with no action here, drawn in the same layer, hidden from assistive tech.
// A skin mode's buttons (modes.<id>.buttons, button.mode) are the same actions, marked data-fk-mode-button: the 计时器 plate
// they are drawn beside (e.g. a debate's fast-forward) does not step away from them (TIMER_SKIN_ART).
// A mode's hud.beside timer (button.dock, stageSkinArt): while the stage shows a 计时器 the row stands just left of it, centred
// on it, wherever the plate is (its own reference grid, moved clear of other art) - the layer carries the timer's left edge
// and middle (--dock-x / --dock-y, px in the layer) and data-timer-dock; without a timer each button keeps its own place.
// Measured when the stage resizes, the timer mounts, moves or resizes - never per frame.
function useTimerDock(docked) {
    const ref = React.useRef(null);
    React.useLayoutEffect(() => {
        const layer = ref.current, stage = layer?.parentElement;
        if (!docked || !layer || !stage) return;
        let frame = 0, timer = null, observedPlate = null, active = true;
        const size = new ResizeObserver(() => schedule()), moves = new MutationObserver(() => schedule());
        const measure = () => {
            frame = 0;
            if (!active) return;
            const next = [...stage.children].find(node => node.classList.contains("fork-timer")) || null;
            if (next !== timer) { moves.disconnect(); moves.observe(stage, { childList: true }); if (next) moves.observe(next, { attributes: true }); timer = next; }
            const plate = timer?.querySelector(".fork-timer-plate, .fork-timer-pill");
            if (plate !== observedPlate) {
                if (observedPlate) size.unobserve(observedPlate);
                if (plate) size.observe(plate);
                observedPlate = plate;
            }
            const box = plate?.getBoundingClientRect();
            if (!box?.width) { layer.removeAttribute("data-timer-dock"); return; }
            const own = layer.getBoundingClientRect();
            layer.style.setProperty("--dock-x", Math.round(box.left - own.left) + "px");
            layer.style.setProperty("--dock-y", Math.round(box.top + box.height / 2 - own.top) + "px");
            layer.setAttribute("data-timer-dock", "");
        };
        const schedule = () => { if (active && !frame) frame = forkForeground.requestAnimationFrame(measure); };
        size.observe(stage);
        moves.observe(stage, { childList: true });
        measure();
        return () => { active = false; size.disconnect(); moves.disconnect(); if (frame) forkForeground.cancelAnimationFrame(frame); layer.removeAttribute("data-timer-dock"); layer.style.removeProperty("--dock-x"); layer.style.removeProperty("--dock-y"); };
    }, [docked]);
    return ref;
}
function StageSkinButtons({buttons, decor = [], keyCaps, auto, skipping, atEnd, menuOpen, onBacklog, onAuto, onSkip, onMenu}) {
    const h = React.createElement;
    const dock = useTimerDock(buttons.some(button => "dock" in button));
    const on = {auto: Boolean(auto), skip: Boolean(skipping)};
    const run = {backlog: onBacklog, auto: onAuto, skip: onSkip, menu: onMenu};
    const place = item => ({ "--art-bw": item.width, "--art-bh": item.height, ...("top" in item ? { "--art-top": item.top } : { "--art-by": item.bottom }), ...("ntop" in item ? { "--art-ntop": item.ntop } : null), ...("left" in item ? { "--art-left": item.left } : { "--art-right": item.right }) });
    return h("div", { ref: dock, className: "fork-stage-skin-buttons", role: buttons.length ? "toolbar" : undefined, "aria-label": buttons.length ? "舞台快捷按钮" : undefined, onClick: event => event.stopPropagation() },
        decor.map((item, index) => h("img", { key: "decor-" + index, className: "fork-stage-skin-decor", src: item.url, alt: "", "aria-hidden": true, draggable: false, style: place(item) })),
        buttons.map(button => {
            const lit = on[button.action] === true, menu = button.action === "menu";
            const label = button.action === "auto" && lit ? "停止自动（A）" : button.action === "skip" && lit ? "停止跳过" : STAGE_SKIN_BUTTON_LABELS[button.action];
            const cap = button.hint && keyCaps ? keyCaps[button.hint.action] || null : null;
            // data-action is also the stage's skip-control mark (GAL_SKIP_CONTROL): a press here toggles, it is not a stop.
            // data-on-art: the button has its own lit image; without one the pressed look is theme.css's (stage skin: art).
            const phone = button.narrow || null;
            return h("button", { key: (button.mode ? button.mode + ":" : "") + button.action, type: "button", className: "fork-stage-skin-button", "data-action": button.action, "data-fk-mode-button": button.mode || undefined, "data-dock": "dock" in button ? "" : undefined, "data-narrow": phone ? "" : undefined, "data-on-art": button.on ? "" : undefined, "data-tint": button.tint ? "" : undefined, "data-hint": cap ? "" : undefined, "data-col": cap && !("left" in button) ? "" : undefined, title: label, "aria-label": label,
                "aria-pressed": button.action in on ? lit : undefined, "aria-haspopup": menu ? "menu" : undefined, "aria-expanded": menu ? Boolean(menuOpen) : undefined,
                disabled: button.action === "skip" && atEnd && !lit,
                style: { "--art-bw": button.width, "--art-bh": button.height, ...(button.tint ? { "--art-btn-img": 'url("' + (lit && button.on ? button.on : button.url) + '")', "--art-btn-tint": 'url("' + button.tint + '")' } : null), ...("top" in button ? { "--art-top": button.top } : { "--art-by": button.bottom }), ...("ntop" in button ? { "--art-ntop": button.ntop } : null), ...("left" in button ? { "--art-left": cap ? button.col : button.left } : cap ? { "--art-col": button.col } : { "--art-right": button.right }), ...(cap ? { "--art-hint-w": button.hint.w, "--art-hint-h": button.hint.h } : null), ...("dock" in button ? { "--art-dock": button.dock } : null),
                    ...(phone ? { "--art-ntop": phone.ntop, "--art-nbw": phone.width, "--art-nbh": phone.height, ...("left" in phone ? { "--art-nleft": phone.left } : { "--art-nright": phone.right }) } : null) },
                onClick: event => { event.stopPropagation(); run[button.action](); } },
                ...(cap ? [h("span", { key: "key", className: "fork-stage-skin-key", "aria-hidden": true }, h("kbd", null, cap))] : []),
                h("img", { key: "img", src: lit && button.on ? button.on : button.url, alt: "", draggable: false }),
                // narrow (P5): the phone art, shown at 640px and less in place of the design image (theme.css)
                ...(phone ? [h("img", { key: "phone", className: "fork-stage-skin-phone", src: lit && phone.on ? phone.on : phone.url, alt: "", draggable: false })] : []));
        }));
}

return {SkinButtons:StageSkinButtons};
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStageSkinButtons};
