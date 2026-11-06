// on a phone
// (TAVERN_PHONE_PANEL_QUERY, ≤767px) in a play session with the debug view off, the top bar is the title and ⋯ only, and
// the composer is ＋ · input · send. Everything moved keeps its one implementation and is reached from there:
// ⋯ → 酒馆状态 / 舞台 / BGM / 全屏 / 导出… and a last row with the model and context controls (dsh-tavern-ui fills the
// `tavern.play.readout` slot with the composer's own ModelControl and ComposerMetrics);
// ＋ → the composer's round actions (候选项, Guide, 压缩上下文, 停止后台), 附件 (the host composer's file input) and, when
// the latest player input can be edited, 编辑上一条输入 (that bubble's own edit button; the action rows stay hidden).
// While a phone play session is mounted <html> carries `dsh-fork-phone-play`; theme.css 「phone play」 hides the moved
// chrome only under it, so card sessions, the desktop and the debug view look as before.
const PHONE_PLAY_CLASS = "dsh-fork-phone-play";
function phoneModQuery() { return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(TAVERN_PHONE_PANEL_QUERY) : null; }
function usePhoneWidth() {
    return React.useSyncExternalStore(function (listener) {
        const query = phoneModQuery();
        if (!query) return function () {};
        query.addEventListener("change", listener);
        return function () { query.removeEventListener("change", listener); };
    }, function () { const query = phoneModQuery(); return Boolean(query && query.matches); }, function () { return false; });
}
// Play mode with the debug view off (the same test as the play-only host chrome), at phone width.
function usePhonePlay(sessionId, sessions) {
    const owner = sessions && sessions.subagentAddress(sessionId)?.parentSessionId || sessionId;
    const play = isPlayMode(useTavernSessionMode(owner));
    const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
    const phone = usePhoneWidth();
    return play && phone && !(preferences && preferences.hideContextAndReasoning === false);
}
let phoneModPlayHolds = 0;
function holdPhonePlayClass() {
    if (phoneModPlayHolds++ === 0) document.documentElement.classList.add(PHONE_PLAY_CLASS);
    return function () { if (--phoneModPlayHolds === 0) document.documentElement.classList.remove(PHONE_PLAY_CLASS); };
}

const PHONE_ICONS = Object.freeze({
    status: "M4 4h16v16H4zM15 4v16",
    fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    exitFullscreen: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
    export: "M12 4v11M7 10l5 5 5-5M5 20h14",
    back: "M15 6l-6 6 6 6",
    edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
    attach: "M21 11.5 12.6 19.9a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8",
    plus: "M12 5v14M5 12h14"
});
function phoneModIcon(name, size) {
    const h = React.createElement;
    return h("svg", { width: size || 18, height: size || 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, h("path", { d: PHONE_ICONS[name] }));
}
function phoneModFullscreenOn() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.documentElement.classList.contains("dsh-tavern-play-fullscreen"));
}
// Arrow keys move between the items of an open phone menu (Esc is handled by its owner).
function phoneModMenuKeys(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll("button:not(:disabled)")).filter(function (node) { return node.offsetParent !== null; });
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
}

// The ⋯ menu's phone-play page: the moved top-bar entries, then 导出… (its own items), then the readout row.
function PhonePlayMoreItems(props) {
    const h = React.createElement;
    const [view, setView] = React.useState("main");
    React.useEffect(function () { if (!props.open) setView("main"); }, [props.open]);
    if (view === "export") return h(React.Fragment, null,
        h("button", { type: "button", role: "menuitem", className: "fork-phone-menu-back", "data-keep-open": "", onClick: function () { setView("main"); } }, phoneModIcon("back", 16), "导出"),
        props.exportItems);
    const full = phoneModFullscreenOn();
    return h(React.Fragment, null,
        h("button", { type: "button", role: "menuitem", "data-fork-phone-item": "status", onClick: function () { props.openStatus(); } }, phoneModIcon("status"), "酒馆状态"),
        // The stage entries render their own header buttons (one implementation each); here they are menu rows.
        h(GalStageToggle, { sessionId: props.sessionId }),
        h(CardStageToggle, { sessionId: props.sessionId }),
        h(BgmChat, { sessionId: props.sessionId, menu: true }),
        h("button", { type: "button", role: "menuitem", "data-fork-phone-item": "fullscreen", onClick: function () { window.dispatchEvent(new CustomEvent("dsh-tavern-play-chrome", { detail: "toggle" })); } },
            phoneModIcon(full ? "exitFullscreen" : "fullscreen"), full ? "退出全屏" : "全屏"),
        h("button", { type: "button", role: "menuitem", "data-fork-phone-item": "export", "data-keep-open": "", "aria-haspopup": "menu", onClick: function () { setView("export"); } }, phoneModIcon("export"), "导出…"),
        props.extraItems,
        props.renderSlot ? h(React.Fragment, null,
            h("div", { className: "dsh-tavern-header-menu-sep", role: "separator" }),
            h("div", { className: "fork-phone-readout", "data-keep-open": "" }, props.renderSlot("tavern.play.readout", {}))) : null);
}

// ＋ in the phone play composer: the round actions and 附件 in one menu above it.
function PhoneComposerPlus(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const [place, setPlace] = React.useState(null);
    const [editTarget, setEditTarget] = React.useState(null);
    const root = React.useRef(null), trigger = React.useRef(null), menu = React.useRef(null);
    React.useLayoutEffect(function () {
        if (!open) { setPlace(null); setEditTarget(null); return undefined; }
        // assistant-renderer renders 编辑这条输入 only on the latest editable player input of this session.
        const edits = (root.current && root.current.closest("[data-dsh-fork-session]") || document).querySelectorAll(".dsh-tavern-user-edit:not(:disabled)");
        setEditTarget(edits.length ? edits[edits.length - 1] : null);
        // The composer seat scrolls; a fixed menu above the trigger is not clipped by it (TavernMoreActions does the same).
        function layout() {
            const rect = trigger.current && trigger.current.getBoundingClientRect();
            if (rect) setPlace({ left: Math.max(8, rect.left) + "px", bottom: (window.innerHeight - rect.top + 8) + "px", maxHeight: Math.max(120, rect.top - 16) + "px" });
        }
        layout();
        window.addEventListener("resize", layout);
        if (window.visualViewport) window.visualViewport.addEventListener("resize", layout);
        return function () { window.removeEventListener("resize", layout); if (window.visualViewport) window.visualViewport.removeEventListener("resize", layout); };
    }, [open]);
    // The round actions are the composer's own buttons, mounted while the menu is closed too (their busy state and the
    // candidate projection keep running); in this menu they are its items.
    React.useLayoutEffect(function () {
        if (menu.current) menu.current.querySelectorAll("button").forEach(function (node) { node.setAttribute("role", "menuitem"); });
    });
    React.useLayoutEffect(function () {
        if (!open || !menu.current) return;
        const first = Array.from(menu.current.querySelectorAll("button:not(:disabled)")).find(function (node) { return node.offsetParent !== null; });
        if (first) first.focus({ preventScroll: true });
    });
    React.useEffect(function () {
        if (!open) return undefined;
        function outside(event) { if (!root.current || !root.current.contains(event.target)) setOpen(false); }
        function escape(event) { if (event.key === "Escape") { setOpen(false); trigger.current?.focus({ preventScroll: true }); } }
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape);
        return function () { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
    }, [open]);
    function attach() {
        const input = root.current && root.current.closest("[data-composer-card]")?.querySelector('input[type="file"]');
        if (input && !input.disabled) input.click();
    }
    return h("span", { className: "fork-phone-plus", ref: root },
        h("button", { type: "button", ref: trigger, className: "fork-phone-plus-trigger", "aria-label": "更多操作", title: "更多操作", "aria-haspopup": "menu", "aria-expanded": open, onClick: function () { setOpen(function (value) { return !value; }); } }, phoneModIcon("plus")),
        h("div", { ref: menu, className: "dsh-tavern-more-menu fork-phone-plus-menu", role: "menu", "aria-label": "更多操作", hidden: !open, style: place || undefined, onKeyDown: phoneModMenuKeys,
            onClick: function (event) { if (event.target.closest("button:not(:disabled)")) setOpen(false); } },
            props.children,
            h("button", { type: "button", role: "menuitem", "data-fork-phone-item": "attach", onClick: attach }, phoneModIcon("attach"), "附件"),
            editTarget ? h("button", { type: "button", role: "menuitem", "data-fork-phone-item": "edit", onClick: function () { editTarget.click(); } }, phoneModIcon("edit"), "编辑上一条输入") : null));
}
