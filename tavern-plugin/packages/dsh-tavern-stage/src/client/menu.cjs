'use strict';
function createStageMenu({React, window, document, sounds:forkUiSfx, getSession}) {
let disposed = false;
const cleanups = new Set();
function own(cleanup) {
    let active = true;
    const stop = () => { if (!active) return; active = false; cleanups.delete(stop); cleanup(); };
    if (disposed) stop(); else cleanups.add(stop);
    return stop;
}
// the stage's system menu, galgame style. Esc on the stage
// (after any inner overlay has taken its own Esc) opens it: a centred opaque panel over the dimmed stage with
// 回到舞台 / 履历 / 回想 (the CG gallery) / 重新生成 (latest only; 跳到最新一轮 in its place while reading an earlier turn) / 设置 / 快捷键 / 返回主页面. The stage owns the open state and
// pauses auto / skip while it is open, like the backlog. Styled only through the stage UI tokens (--gal-ui-*,
// theme.css「stage system menu」).

// text rows only, the same list in every skin. 履历 is always
// a row, second, also where the screen has a LOG / 履历 control (the menu's way into it on touch and keyboard - L). 自动 / 跳过 are
// rows only where the screen shows no such control (options.controls: the ids the skin and width leave out - a phone, a skin
// without drawn buttons), right after 履历; 隐藏 (H / right click) and 上一页 (← / the backlog) are keys, and the stage entries (背景, BGM,
// 声音, 手机, 弹幕, 电影模式) live in the top bar, which stands over the open menu.
// Items in display order. options: { historical, latestTurn, busy, controls, auto, skipping, atEnd }.
function galMenuItems(options) {
    const items = [{ id: "resume", label: "回到舞台", sub: "RESUME", title: "回到舞台（Esc）" }];
    const controls = new Set(options?.controls || []);
    items.push({ id: "backlog", label: "履历", sub: "BACKLOG", title: "履历（L / 滚轮向上）" });
    if (controls.has("auto")) items.push({ id: "auto", label: options.auto ? "停止自动" : "自动", sub: "AUTO", title: "自动翻页（A）", on: Boolean(options.auto) });
    if (controls.has("skip")) items.push({ id: "skip", label: options.skipping ? "停止跳过" : "跳过", sub: "SKIP", title: "跳过（按住 Ctrl 快进）", on: Boolean(options.skipping), disabled: Boolean(options.atEnd) && !options.skipping });
    // the CG gallery lives here, not as a text button in the control row.
    items.push({ id: "gallery", label: "回想", sub: "RECOLLECTION", title: "回想（CG 图库）" });
    // regeneration is a latest-turn action, not historical editing; an earlier turn offers the way back instead.
    if (options?.historical) items.push({ id: "latest", label: "跳到最新一轮", sub: "LATEST",
        note: Number.isInteger(options.latestTurn) && options.latestTurn > 0 ? "第 " + options.latestTurn + " 轮" : "", title: "跳到最新一轮的最新一页" });
    else items.push({ id: "regenerate", label: "重新生成", sub: "REGENERATE", disabled: Boolean(options?.busy) });
    items.push({ id: "config", label: "设置", sub: "CONFIG", title: "设置" },
        // the first-run key list again (useGalFirstRunHints showKeys).
        { id: "keys", label: "快捷键", sub: "SHORTCUTS", title: "快捷键" },
        { id: "leave", label: "返回主页面", sub: "TITLE", title: "离开舞台，回到聊天（保留阅读位置）", separated: true });
    return items;
}
// Roving focus: ↑/↓ and Tab / Shift+Tab wrap (focus stays in the menu), Home / End jump. Other keys: null.
function galMenuStep(index, count, key, shift) {
    if (!(count > 0)) return null;
    const at = Number.isInteger(index) && index >= 0 && index < count ? index : 0;
    if (key === "ArrowDown" || key === "Tab" && !shift) return (at + 1) % count;
    if (key === "ArrowUp" || key === "Tab" && shift) return (at - 1 + count) % count;
    if (key === "Home" || key === "PageUp") return 0;
    if (key === "End" || key === "PageDown") return count - 1;
    return null;
}

// Read only the existing runtime's activity; presentation remains owned by the Phase F cutover.
function useGalMenuDirectorBusy(sessionId, turn) {
    const store = getSession(sessionId);
    const selection = React.useMemo(() => store ? store.select(state => state.source?.turn === turn && ["running", "partial"].includes(state.director.phase))
        : { subscribe: () => () => {}, getSnapshot: () => false, dispose() {} }, [store, turn]);
    React.useEffect(() => own(() => selection.dispose()), [selection]);
    return React.useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
}

// props: { sessionId, Regenerate, busy, historical, latestTurn, controls, auto, skipping, atEnd, onClose(),
// onAuto(), onSkip(), onBacklog(), onGallery(), onConfig(), onKeys(), onLatest(), onLeave() }.
// Focus moves to the first item on open and back to the opener on close (not when leaving the stage, which restores
// its own opener). Esc, right click or a click on the dimmed stage close it; the stage never sees keys typed here.
function GalMenu(props) {
    const h = React.createElement;
    const directorBusy = useGalMenuDirectorBusy(props.sessionId, props.latestTurn);
    const busy = props.busy || directorBusy;
    // props.regenerate opens straight into the 重新生成 dialog (the turn-end menu's
    // 「重新生成」); backing out of it then closes the whole menu instead of revealing the list.
    const [regenerateOpen, setRegenerateOpen] = React.useState(() => Boolean(props.regenerate && props.Regenerate));
    const closeRegenerate = () => { if (props.regenerate) props.onClose(); else setRegenerateOpen(false); };
    const [regenerateBusy, setRegenerateBusy] = React.useState(false);
    const items = galMenuItems({ historical: props.historical, latestTurn: props.latestTurn, busy: busy || regenerateBusy, controls: props.controls,
        auto: props.auto, skipping: props.skipping, atEnd: props.atEnd });
    const [active, setActive] = React.useState(0);
    const refs = React.useRef([]);
    const live = React.useRef(null);
    const leaving = React.useRef(false);
    live.current = { props, items, active, regenerateOpen };
    // Taken at the first render: an opening dialog (props.regenerate) moves focus in its own layout effect, before ours.
    const firstOpener = React.useRef(typeof document !== "undefined" ? document.activeElement : null);
    function focusItem(index) {
        setActive(index);
        const node = refs.current[index];
        if (node && node.focus) node.focus({ preventScroll: true });
    }
    // A user move (hover, arrows) ticks; the programmatic focus on open / after the dialog does not.
    function moveTo(index) {
        if (index !== live.current.active) forkUiSfx.play("move");
        focusItem(index);
    }
    function activate(index) {
        if (disposed) return;
        const current = live.current, item = current.items[index];
        if (!item || item.disabled) return;
        const p = current.props;
        forkUiSfx.play(item.id === "resume" ? "close" : "confirm");
        if (item.id === "resume") p.onClose();
        else if (item.id === "backlog") p.onBacklog();
        else if (item.id === "gallery") p.onGallery();
        else if (item.id === "regenerate") { setActive(index); setRegenerateOpen(true); }
        else if (item.id === "auto") p.onAuto();
        else if (item.id === "skip") p.onSkip();
        else if (item.id === "config") p.onConfig();
        else if (item.id === "keys") { if (p.onKeys) p.onKeys(); else p.onClose(); }
        else if (item.id === "latest") p.onLatest();
        else if (item.id === "leave") { leaving.current = true; p.onLeave(); }
    }
    function focusedIndex() {
        const focused = typeof document !== "undefined" ? document.activeElement : null;
        const at = refs.current.indexOf(focused);
        return at >= 0 && at < live.current.items.length ? at : live.current.active;
    }
    // Layout effect: the focus hand-back runs before an overlay opened from here (the backlog) takes focus.
    React.useLayoutEffect(function () {
        const opener = firstOpener.current;
        if (!live.current.regenerateOpen) focusItem(0);
        forkUiSfx.play("open");
        function onKey(event) {
            if (disposed || event.isComposing || live.current.regenerateOpen || live.current.props.leaving) return;
            const key = event.key;
            // the top bar (the stage entries) stands over the open menu in every skin: its
            // own keys stay its own, Tab leaves the list into it and comes back the native way.
            const hud = typeof document !== "undefined" ? Array.from(document.querySelectorAll(".fork-gal-stage.is-menu .fork-gal-topbar :is(button, [tabindex]):not([tabindex='-1']):not(:disabled)"))
                .filter(node => node.checkVisibility ? node.checkVisibility({ visibilityProperty: true }) : true) : [];
            if (hud.length && event.target?.closest?.(".fork-gal-topbar") && key !== "Escape") return;
            if (hud.length && key === "Tab" && focusedIndex() === (event.shiftKey ? 0 : live.current.items.length - 1)) {
                event.preventDefault(); event.stopImmediatePropagation(); hud[event.shiftKey ? hud.length - 1 : 0].focus({ preventScroll: true }); return;
            }
            // A held Esc (auto-repeat) is not a new press (the hold that leaves full screen must not toggle the menu).
            if (key === "Escape" && event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
            if (key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); forkUiSfx.play("close"); live.current.props.onClose(); return; }
            const next = galMenuStep(focusedIndex(), live.current.items.length, key, event.shiftKey);
            if (next !== null) { event.preventDefault(); event.stopImmediatePropagation(); moveTo(next); return; }
            if (key === "Enter" || key === " " || key === "Spacebar") {
                if (event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
                event.preventDefault(); event.stopImmediatePropagation(); activate(focusedIndex());
            }
        }
        window.addEventListener("keydown", onKey, true);
        return own(function () {
            window.removeEventListener("keydown", onKey, true);
            if (!leaving.current && opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
        });
    }, []);
    // The opener is hidden during the dialog's cleanup; restore it after the menu is visible again.
    React.useLayoutEffect(function () { if (!regenerateOpen) focusItem(active); }, [regenerateOpen]);
    // The historical item can come or go while open (a new turn arrives); keep the highlight on a real item.
    React.useEffect(function () { if (active >= items.length) setActive(items.length - 1); }, [items.length]);
    // A click on the dimmed stage or a right click: back out of the dialog first, else close the menu. (owner
    // 2026-10): not while a regeneration runs - only its 停止 (the wait, Esc, a right click on the dialog) ends it.
    function dismiss() {
        if (disposed || regenerateBusy) return;
        if (regenerateOpen) { forkUiSfx.play("cancel"); closeRegenerate(); } else { forkUiSfx.play("close"); props.onClose(); }
    }
    const children = [];
    items.forEach(function (item, index) {
        if (item.separated) children.push(h("div", { key: item.id + ":sep", className: "fork-gal-menu-sep", role: "separator" }));
        children.push(h("button", { key: item.id, ref: node => { refs.current[index] = node; }, type: "button", role: item.on === undefined ? "menuitem" : "menuitemcheckbox", tabIndex: index === active ? 0 : -1,
            className: "fork-gal-menu-item" + (index === active ? " is-active" : "") + (item.id === "leave" ? " is-leave" : ""), "data-item": item.id, title: item.title,
            style: { "--i": index }, "aria-disabled": item.disabled || undefined, "aria-checked": item.on === undefined ? undefined : item.on,
            onClick: event => { event.stopPropagation(); activate(index); },
            onPointerMove: () => { if (live.current.active !== index) moveTo(index); } },
            h("i", { className: "fork-gal-menu-gem", "aria-hidden": true }),
            h("b", null, item.label),
            h("span", { className: "fork-gal-menu-sub", "aria-hidden": true }, item.sub),
            item.note ? h("small", { className: "fork-gal-menu-note" }, item.note) : null));
    });
    // leaving (skin-interface.md §18 E3): the drawn menu's exit motion plays; it no longer takes input.
    return h("div", { className: "fork-gal-menu", role: "presentation", "data-leaving": props.leaving || undefined, inert: props.leaving || undefined,
        onClick: event => { event.stopPropagation(); if (event.target === event.currentTarget) dismiss(); },
        onWheel: event => event.stopPropagation(),
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); dismiss(); } },
        regenerateOpen && props.Regenerate ? h(props.Regenerate, { sessionId: props.sessionId, useChat: props.useChat, waitLines: props.waitLines, turn: props.latestTurn, busy, historical: props.historical, onBusy: setRegenerateBusy, onClose: closeRegenerate }) : null,
        h("div", { hidden: regenerateOpen, className: "fork-gal-menu-panel fk-surface", "data-level": "stage-panel", role: "menu", "aria-orientation": "vertical", "aria-label": "舞台菜单", onClick: event => event.stopPropagation() },
            h("i", { className: "fork-gal-menu-ornament", "aria-hidden": true }),
            h("i", { className: "fork-gal-menu-frame", "aria-hidden": true }),
            h("div", { className: "fork-gal-menu-head", "aria-hidden": true },
                h("i", { className: "fork-gal-menu-gem is-title" }), h("b", null, "MENU"), h("span", null, "菜单")),
            // --n: the item count, for a skin's tile grid (stage-skin-adv.md「art.menu.tiles」: its rows and its fit).
            h("div", { className: "fork-gal-menu-list", role: "presentation", style: { "--n": items.length } }, children),
            // a skin's drawn menu screen carries the title, the focused
            // item's description (its title, else its label) and the key guide on its own strips; hidden elsewhere (theme.css).
            h("div", { className: "fork-gal-menu-strip", "data-show": "title", "aria-hidden": true }, "菜单"),
            h("div", { className: "fork-gal-menu-strip", "data-show": "info", "aria-hidden": true }, items[active] ? items[active].title || items[active].label : ""),
            h("div", { className: "fork-gal-menu-strip", "data-show": "keys", "aria-hidden": true }, "Esc：返回　Enter：决定")));
}

return {Menu:GalMenu, items:galMenuItems, step:galMenuStep, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const stop of [...cleanups]) { try {stop();} catch (error) {errors.push(error);} }
    if (errors.length) throw new AggregateError(errors, 'Stage menu cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageMenu};
