// the BGM player. One panel, two placements: in the stage the
// HUD track label is its chip; in chat a header chip opens the same panel. State: bgmPlayer (bgm-player.cjs);
// volume: CONFIG › 声音 only (PROPOSAL §八: no second slider here). Styles: .fork-bgm-* on --bgm-* tokens,
// mapped from the stage theme (--gal-ui-*) or the chat theme (--fork-*) in theme.css.
// @include bgm-player.cjs
const bgmListeners = new Set();
const bgmChanged = () => {for (const listener of bgmListeners) listener();};
const bgmAbsent = Object.freeze({sessionId:null,available:false,enabled:false,follow:true,paused:false,error:false,loading:false,tracks:[],cue:null,current:null});
const bgmPlayer = {
    get:() => stageViews?.bgm.get() || bgmAbsent,
    subscribe(fn) {bgmListeners.add(fn); return () => bgmListeners.delete(fn);},
    subscribePerformance:fn => stageViews?.bgm.subscribePerformance(fn) || (() => {}),
    acquirePerformance:options => stageViews?.bgm.acquirePerformance(options) || {status:'stale'},
    ...Object.fromEntries(['activate','invalidate','pick','step','follow','pause','kick'].map(name =>
        [name,(...args) => stageViews?.bgm[name](...args)]))
};
function useBgm() { return React.useSyncExternalStore(bgmPlayer.subscribe, bgmPlayer.get); }
// As the stage mixer: focus moves in on open; Esc or a click outside closes (on the bare stage that click
// only dismisses, it does not also turn the page).
function useBgmPopover(open, close, chip, panel, stage) {
    React.useEffect(function () {
        if (!open) return undefined;
        const first = panel.current && panel.current.querySelector(".fork-bgm-play:not(:disabled), input, button");
        if (first) first.focus({ preventScroll: true });
        // A chip folded into a closed menu (phone play ⋯) hands focus back to that menu's trigger.
        function done(refocus) {
            close();
            const node = chip.current;
            if (refocus && node) (node.offsetParent === null && node.closest(".dsh-tavern-more-actions")?.querySelector("[data-fork-more]") || node).focus();
        }
        function onKey(event) { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); done(true); } }
        function swallow(event) { event.stopPropagation(); event.preventDefault(); }
        let timer = 0;
        function outside(event) {
            if ((panel.current && panel.current.contains(event.target)) || (chip.current && chip.current.contains(event.target))) return;
            done(false);
            if (stage && !(event.target && event.target.closest && event.target.closest("button, input, select, textarea, a"))) {
                document.addEventListener("click", swallow, { capture: true, once: true });
                timer = setTimeout(() => document.removeEventListener("click", swallow, true), 600);
            }
        }
        window.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", outside, true);
        return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", outside, true); clearTimeout(timer); };
    }, [open]);
}
// The player: now playing + 导演选曲, transport, a searchable list (the card's bound packs, in order).
function BgmPanel(props) {
    const h = React.createElement, s = useBgm();
    const [query, setQuery] = React.useState("");
    const list = bgmSearch(s.tracks, query), playing = Boolean(s.current && !s.paused);
    const stop = event => event.stopPropagation();
    const control = (icon, label, action, disabled, className) => h("button", { type: "button", className: "fork-bgm-button" + (className ? " " + className : ""),
        title: label, "aria-label": label, disabled: Boolean(disabled), onClick: action }, h(Icon, { name: icon, size: 18 }));
    function arrows(event) {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const rows = Array.from(event.currentTarget.querySelectorAll("button")), at = rows.indexOf(document.activeElement);
        const next = rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
        if (next) { event.preventDefault(); next.focus(); }
    }
    return h("div", { ref: props.panelRef, "data-level": "popover", className: "fk-surface fork-bgm fork-bgm-panel" + (props.chat ? " is-chat" : ""), style: props.style, role: "dialog", "aria-label": "BGM",
        onClick: stop, onWheel: stop, onContextMenu: stop, onKeyDown: stop },
        h("div", { className: "fork-bgm-head" },
            h("i", { className: "fork-bgm-gem", "aria-hidden": true }),
            h("b", { className: "fork-bgm-title", title: s.current ? s.current.name : "" }, s.current ? s.current.name : "BGM"),
            h("label", { className: "fork-bgm-follow", title: "导演选曲" },
                h(Switch, { bare: true, checked: s.follow, disabled: !s.enabled, onChange: on => bgmPlayer.follow(on) }), // the one switch
                h(Icon, { name: "stage", size: 15 }), h("span", null, "导演选曲"))),
        !s.enabled ? h("div", { className: "fork-bgm-off" }, h("span", null, "BGM 已关闭"),
            h("span", { className: "fork-bgm-hint" }, "在 舞台设置 › 基础设置 打开")) :
        h(React.Fragment, null,
            h("div", { className: "fork-bgm-controls" },
                control("prev", "上一首", () => bgmPlayer.step(-1), !s.tracks.length),
                control(playing ? "pause" : "play", playing ? "暂停" : "播放", () => bgmPlayer.pause(playing), !s.current, "fork-bgm-play fk-on-accent"),
                control("next", "下一首", () => bgmPlayer.step(1), !s.tracks.length)),
            h(SearchBox, { className: "fork-bgm-search", icon: h(Icon, { name: "search", size: 15 }), value: query, placeholder: "搜索", label: "搜索曲目", onChange: setQuery }),
            s.error ? h("p", { className: "fork-bgm-error", role: "alert" }, "载入失败") : null,
            list.length ? h("ul", { className: "fork-bgm-list", "aria-label": "曲目", onKeyDown: arrows },
                list.map(track => h("li", { key: track.key },
                    h("button", { type: "button", className: "fork-bgm-track", "aria-current": s.current && s.current.key === track.key ? "true" : undefined,
                        title: track.pack || track.name, onClick: () => bgmPlayer.pick(track.key) },
                        h("span", null, track.name),
                        s.cue && s.cue.key === track.key ? h("span", { className: "fork-bgm-cue", role: "img", title: "导演选曲", "aria-label": "导演选曲" }, h(Icon, { name: "stage", size: 13 })) : null))))
                : h("p", { className: "fork-bgm-empty" }, s.loading ? "正在载入…" : query ? "无匹配" : "暂无曲目")));
}
// Stage placement: the HUD track label (with its change moment) is the chip; the panel drops below the HUD.
function BgmStage(props) {
    const h = React.createElement, s = useBgm();
    const [open, setOpen] = React.useState(false);
    const chip = React.useRef(null), panel = React.useRef(null);
    // galgame UI cues (ui-sfx.js), stage placement only; the chat placement stays silent.
    useBgmPopover(open, () => { forkUiSfx.play("close"); setOpen(false); }, chip, panel, true);
    useForkUiSfxControls(panel, open);
    // the entry's state for the skin's menu.
    if (typeof useStageEntryState === "function") useStageEntryState("bgm", { available: true, on: Boolean(s.current && !s.paused && s.enabled), detail: s.current ? s.current.name : "" });
    return h(React.Fragment, null,
        // The track half of the HUD line; the place half is the background entry (bg-manual.js).
        h(GalHudLabels, { only: "track", place: props.place, track: s.current, scope: props.sessionId, live: props.live,
            music: { ref: chip, open, paused: s.paused || !s.enabled, toggle: () => { forkUiSfx.play(open ? "close" : "open"); setOpen(!open); } } }),
        open ? h(BgmPanel, { panelRef: panel }) : null);
}
// Chat placement: a header chip (only for a card with the stage) and the same panel, anchored under it.
// `menu`: a row of the phone play ⋯ menu (phone-play.js) instead; the menu closes on the pick, so the panel
// anchors under ⋯.
function BgmChat(props) {
    const h = React.createElement, s = useBgm();
    const [open, setOpen] = React.useState(false), [place, setPlace] = React.useState(null);
    const chip = React.useRef(null), panel = React.useRef(null);
    useBgmPopover(open, () => setOpen(false), chip, panel, false);
    React.useLayoutEffect(function () {
        if (!open || !chip.current) { setPlace(null); return; }
        const anchor = props.menu && chip.current.closest(".dsh-tavern-more-actions")?.querySelector("[data-fork-more]") || chip.current;
        const rect = anchor.getBoundingClientRect(), width = Math.min(340, window.innerWidth - 16);
        setPlace({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: rect.bottom + 6, width, maxHeight: window.innerHeight - rect.bottom - 18 });
    }, [open]);
    if (s.sessionId !== props.sessionId || !s.available) return null;
    const paused = s.paused || !s.enabled || !s.current;
    if (props.menu) return h(React.Fragment, null,
        h("button", { ref: chip, type: "button", role: "menuitem", className: "fork-bgm-menu-row" + (paused ? " is-paused" : ""), "data-fork-phone-item": "bgm",
            "aria-label": "BGM" + (s.current ? "：" + s.current.name : ""), "aria-haspopup": "dialog", "aria-expanded": open, onClick: () => setOpen(!open) },
            h(Icon, { name: "music", size: 18 }), "BGM", s.current ? h("span", { className: "fork-bgm-menu-track" }, s.current.name) : null),
        open && place ? ReactDOM.createPortal(h(BgmPanel, { chat: true, panelRef: panel, style: place }), document.body) : null);
    return h(React.Fragment, null,
        h("button", { ref: chip, type: "button", className: "dsh-tavern-btn fork-bgm fork-bgm-chip is-chat" + (s.paused || !s.enabled || !s.current ? " is-paused" : ""),
            title: "BGM", "aria-label": "BGM" + (s.current ? "：" + s.current.name : ""), "aria-haspopup": "dialog", "aria-expanded": open, onClick: () => setOpen(!open) },
            h(Icon, { name: "music", size: 15 }), s.current ? h("span", null, s.current.name) : null),
        open && place ? ReactDOM.createPortal(h(BgmPanel, { chat: true, panelRef: panel, style: place }), document.body) : null);
}

// the track label with the BGM chip is a registered stage entry (on the HUD line).
if (typeof stageEntries === "object") stageEntries.register({ id: "bgm", priority: 79, group: "scene", hud: true, icon: "music", label: "BGM",
    render: ctx => React.createElement(BgmStage, { sessionId: ctx.sessionId, place: ctx.place, live: ctx.live }) });
