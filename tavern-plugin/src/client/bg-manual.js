// the manual stage background. The BGM player's design for the
// picture: the HUD place label is the chip; its panel lists the card's bound-pack backgrounds as thumbnails with the
// 「导演布景」 switch. State: bgManual (bg-manual.cjs); the stage shows bgManualScene(accepted.scene, shown).
// Styles: the BGM panel's .fork-bgm-* rules on --bgm-* tokens, plus .fork-bg-* for the thumbnail grid (theme.css).
// @include bg-manual.cjs
const bgManual = createBgManual({
    session: id => stageSessions.get(id),
    owner: () => stageSessions.resourceOwner,
    read: id => rpc("getStageBackgrounds", {}, id),
    storage: (() => { try { return localStorage; } catch (_) { return null; } })(),
    authority: source => stageResourceAuthority(source)
});
function useBgManual() { return React.useSyncExternalStore(bgManual.subscribe, bgManual.get); }
// The stage's scene as shown (bgManualScene); the accepted director projection itself while following.
function useBgManualScene(sessionId, scene) {
    const s = useBgManual(), calm = useStageReading().reducedMotion === true, mine = s.sessionId === sessionId;
    const shown = mine ? s.shown : null, userIdentity = mine ? s.userIdentity : null;
    return React.useMemo(() => bgManualScene(scene, shown, userIdentity, calm), [scene, shown, userIdentity, calm]);
}
const BG_COLUMNS = 3;
// The picker: what shows + 导演布景, prev / search / next, the thumbnail grid (bound packs, in order).
function BgManualPanel(props) {
    const h = React.createElement, s = useBgManual();
    const [query, setQuery] = React.useState("");
    const rows = bgSearch(s.rows, query);
    const stop = event => event.stopPropagation();
    const control = (icon, label, action, disabled) => h("button", { type: "button", className: "fork-bgm-button", title: label, "aria-label": label, disabled: Boolean(disabled), onClick: action },
        h(Icon, { name: icon, size: 18 }));
    // Arrow keys move through the grid: ←→ one tile, ↑↓ one row.
    function arrows(event) {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -BG_COLUMNS, ArrowDown: BG_COLUMNS }[event.key];
        if (!step) return;
        const tiles = Array.from(event.currentTarget.querySelectorAll("button")), at = tiles.indexOf(document.activeElement);
        const next = tiles[Math.max(0, Math.min(tiles.length - 1, at + step))];
        if (next) { event.preventDefault(); next.focus(); }
    }
    return h("div", { ref: props.panelRef, "data-level": "popover", className: "fk-surface fork-bgm fork-bgm-panel fork-bg-panel", role: "dialog", "aria-label": "背景",
        onClick: stop, onWheel: stop, onContextMenu: stop, onKeyDown: stop },
        h("div", { className: "fork-bgm-head" },
            h("i", { className: "fork-bgm-gem", "aria-hidden": true }),
            h("b", { className: "fork-bgm-title", title: s.current ? s.current.name : "" }, s.current ? s.current.name : "背景"),
            h("label", { className: "fork-bgm-follow", title: "导演布景" },
                h(Switch, { bare: true, checked: s.follow, onChange: on => bgManual.follow(on) }),
                h(Icon, { name: "stage", size: 15 }), h("span", null, "导演布景"))),
        h("div", { className: "fork-bgm-controls" },
            control("prev", "上一张", () => bgManual.step(-1), !s.rows.length),
            h(SearchBox, { className: "fork-bgm-search", icon: h(Icon, { name: "search", size: 15 }), value: query, placeholder: "搜索", label: "搜索背景", onChange: setQuery }),
            control("next", "下一张", () => bgManual.step(1), !s.rows.length)),
        s.error ? h("p", { className: "fork-bgm-error", role: "alert" }, "⚠ 载入失败") : null,
        rows.length ? h("ul", { className: "fork-bg-grid", "aria-label": "背景", onKeyDown: arrows },
            rows.map(row => h("li", { key: row.key },
                h("button", { type: "button", className: "fork-bg-tile", "aria-current": s.current && s.current.key === row.key ? "true" : undefined,
                    title: row.pack ? row.pack + " · " + row.name : row.name, onClick: () => bgManual.pick(row.key) },
                    h("span", { className: "fork-bg-thumb" }, h("img", { src: row.thumb, alt: "", decoding: "async", loading: "lazy",
                        onLoad: event => { event.currentTarget.dataset.apMedia = "in"; }, onError: event => { event.currentTarget.dataset.failed = "true"; } })),
                    h("span", { className: "fork-bg-name" }, row.name),
                    s.cue && s.cue.key === row.key ? h("span", { className: "fork-bgm-cue fork-bg-cue", role: "img", title: "导演布景", "aria-label": "导演布景" }, h(Icon, { name: "stage", size: 13 })) : null))))
            : s.loading ? h("div", { className: "fork-bg-loading" }, h(Spinner, { label: "正在载入…" }))
            : h(EmptyState, { compact: true, query, onClear: () => setQuery(""), noun: "背景", icon: "empty" }));
}
// Stage placement (the BGM chip's twin): the HUD place label is the chip; the panel drops below the HUD. Same UI cues
// as the BGM panel (open / close, the switch's toggle through useForkUiSfxControls).
function useBgManualStage(sessionId) {
    const h = React.createElement, s = useBgManual();
    const [open, setOpen] = React.useState(false);
    const chip = React.useRef(null), panel = React.useRef(null);
    useBgmPopover(open, () => { forkUiSfx.play("close"); setOpen(false); }, chip, panel, true);
    useForkUiSfxControls(panel, open);
    if (s.sessionId !== sessionId) return { chip: null, node: null };
    return { chip: { ref: chip, open, toggle: () => { forkUiSfx.play(open ? "close" : "open"); setOpen(!open); } },
        node: open ? h(BgManualPanel, { panelRef: panel }) : null };
}
// the place label with the background chip is its own stage entry - on
// the HUD line before the BGM where the skin has room, else a tile in the skin's menu. Without the manual background for
// this session the label is the place alone (no entry: nowhere when the skin caps its entries).
function BgManualStage(props) {
    const scenes = useBgManualStage(props.sessionId);
    useStageEntryState("background", { available: Boolean(scenes.chip), detail: props.place || "" });
    return React.createElement(React.Fragment, null,
        React.createElement(GalHudLabels, { only: "place", place: props.place, scope: props.sessionId, live: props.live, scene: scenes.chip }), scenes.node);
}
if (typeof stageEntries === "object") stageEntries.register({ id: "background", priority: 80, group: "scene", hud: true, icon: "image", label: "背景",
    render: ctx => React.createElement(BgManualStage, { sessionId: ctx.sessionId, place: ctx.place, live: ctx.live }) });
