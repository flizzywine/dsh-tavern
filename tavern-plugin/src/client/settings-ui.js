// small shared pieces for settings panels.

// Stroke icons on a 24-unit grid; label goes on the surrounding button.
const ICON_PATHS = {
    plus: "M12 5v14M5 12h14",
    upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14.5v4A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-4",
    download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 14.5v4A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-4",
    package: "M4.5 7.5 12 4l7.5 3.5v9L12 20l-7.5-3.5zM4.5 7.5 12 11l7.5-3.5M12 11v9",
    pencil: "M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10v4zM13.5 7.5l3 3",
    trash: "M5 7h14M10 7V5h4v2M7 7l.9 12.1a1 1 0 0 0 1 .9h6.2a1 1 0 0 0 1-.9L17 7",
    speaker: "M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11",
    "speaker-off": "M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4zM16 9.5l5 5M21 9.5l-5 5",
    chevron: "M7 10l5 5 5-5",
    "chevron-left": "M14 6l-6 6 6 6", // stage page back
    close: "M6 6l12 12M18 6L6 18",
    music: "M9 17.5V6l10-2v11.5M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
    zoom: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.2 15.2l4.8 4.8M10.5 8v5M8 10.5h5",
    sparkle: "M12 3.5l1.9 5.2 5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2-5.2-1.9 5.2-1.9zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
    replay: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4",
    send: "M12 19V5.5M6 11.5l6-6 6 6", // the stage choice field's one send control
    auto: "M9 8.2v7.6l6-3.8-6-3.8zM12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17z",
    skip: "M4.5 6.5v11l7-5.5-7-5.5zM12.5 6.5v11l7-5.5-7-5.5z",
    "eye-off": "M3.5 12s3.2-6 8.5-6c1.6 0 3 .5 4.2 1.2M20.5 12s-3.2 6-8.5 6c-1.6 0-3-.5-4.2-1.2M4 4l16 16",
    backlog: "M9 6.5h10.5M9 12h10.5M9 17.5h6.5M4.8 6.5h.01M4.8 12h.01M4.8 17.5h.01",
    menu: "M4.5 7h15M4.5 12h15M4.5 17h15", // stage system menu (≡)
    chat: "M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z",
    expand: "M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15",
    shrink: "M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5",
    face: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9.2 10.2h.01M14.8 10.2h.01M8.8 14.2c1.7 1.9 4.7 1.9 6.4 0",
    figure: "M12 10.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM5.5 20.5c.6-4.2 3.2-6.8 6.5-6.8s5.9 2.6 6.5 6.8",
    "figure-off": "M12 10.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM5.5 20.5c.6-4.2 3.2-6.8 6.5-6.8s5.9 2.6 6.5 6.8M4 4l16 16",
    stage: "M3.5 4.5h17M5 4.5c0 4 1.8 6.5 4.5 7.5M19 4.5c0 4-1.8 6.5-4.5 7.5M3.5 19.5h17M7 19.5v-3.5h10v3.5",
    play: "M8.5 5.8v12.4a.6.6 0 0 0 .9.5l9.6-6.2a.6.6 0 0 0 0-1L9.4 5.3a.6.6 0 0 0-.9.5z",
    pause: "M8.5 5.5v13M15.5 5.5v13",
    prev: "M6.5 6v12M18 6.6v10.8a.6.6 0 0 1-.9.5L9.4 12.5a.6.6 0 0 1 0-1l7.7-5.4a.6.6 0 0 1 .9.5z", // BGM player
    next: "M17.5 6v12M6 6.6v10.8a.6.6 0 0 0 .9.5l7.7-5.4a.6.6 0 0 0 0-1L6.9 6.1a.6.6 0 0 0-.9.5z",
    search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.2 15.2l4.8 4.8",
    wave: "M3.5 12h1.5M7.5 8.5v7M11 5.5v13M14.5 8v8M18 10v4M20.5 12h0",
    check: "M5 12.5l4.5 4.5L19 7.5",
    eye: "M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z",
    globe: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z",
    card: "M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5zM9 15.5h6M12 12.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z",
    headphones: "M4.5 17v-4a7.5 7.5 0 0 1 15 0v4M4.5 14h3v6h-1.5a1.5 1.5 0 0 1-1.5-1.5zM19.5 14h-3v6h1.5a1.5 1.5 0 0 0 1.5-1.5z",
    gear: "M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM10.3 3.5h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.8 1.6v1.8l1.8 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.8-1.6v-1.8L4.3 8.8 6 5.9l2.2.8 1.6-.9z",
    image: "M4.8 5h14.4a1.3 1.3 0 0 1 1.3 1.3v11.4a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3V6.3A1.3 1.3 0 0 1 4.8 5zM3.5 16l5-4.5 4 3.5 3-2.5 5 4.2M15.5 10.2a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z",
    sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
    users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 19.5c.5-3.4 2.6-5.5 5.5-5.5s5 2.1 5.5 5.5M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.2c1.8.7 2.8 2.5 3 5.3",
    die: "M6 3.5h12A2.5 2.5 0 0 1 20.5 6v12a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01", // dice-roll.js
    // 履历 clip export (clip-export.js)
    clip: "M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4",
    folder: "M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z",
    clock: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2",
    turn: "M7 4.5H5.5v15H7M17 4.5h1.5v15H17M9.5 9h5M9.5 12h5M9.5 15h3",
    recent: "M4.5 6.5h9M4.5 11h9M4.5 15.5h6M18 5.5v12.5M15 15l3 3 3-3",
    "to-end": "M12 4.5v11M8 11.5l4 4 4-4M6 19.5h12",
    // the stage entries' glyphs, one shared set (menu tiles draw these names).
    "film-mode": "M3.5 5.5h17v13h-17zM3.5 8.5h17M3.5 15.5h17M10.5 10.2v3.6l3.2-1.8z",
    phone: "M8.5 2.5h7A1.5 1.5 0 0 1 17 4v16a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20V4a1.5 1.5 0 0 1 1.5-1.5zM10.5 18.5h3",
    message: "M3 4h18v13H9l-6 4V4z",
    widget: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    danmaku: "M5.5 4.5h13A2.5 2.5 0 0 1 21 7v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V7a2.5 2.5 0 0 1 2.5-2.5zM6.8 8.6h5.4M14.6 8.6h2.8M9.2 11.8h8M6.8 15h4.2",
    "die-covered": "M6 3.5h12A2.5 2.5 0 0 1 20.5 6v12a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5zM9.8 9.6a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2 1-1.2 1.9M12 16.4h.01"
};
function Icon(props) {
    const h = React.createElement;
    const size = props.size || 16;
    return h("svg", { className: "fork-icon", viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" },
        h("path", { d: ICON_PATHS[props.name] || "" }));
}

// Foldable settings sections: the whole header toggles (except its buttons / switches / inputs);
// the choice is remembered per section. Folded sections keep only their header (CSS).
const FOLD_PREF = "fork-settings-fold";
function useFold(key, initialOpen) {
    const [open, setOpen] = React.useState(function () {
        try { const saved = JSON.parse(localStorage.getItem(FOLD_PREF) || "{}")[key]; return typeof saved === "boolean" ? saved : initialOpen !== false; } catch (_) { return initialOpen !== false; }
    });
    function set(next) {
        setOpen(next);
        try { const all = JSON.parse(localStorage.getItem(FOLD_PREF) || "{}"); all[key] = next; localStorage.setItem(FOLD_PREF, JSON.stringify(all)); } catch (_) {}
    }
    const head = {
        className: "fork-bubble-section-head is-foldable", tabIndex: 0, "aria-expanded": open, title: open ? "点击收起" : "点击展开",
        onClick: event => { if (event.target.closest("button, input, select, textarea, label, a, [role='tooltip'], .fork-help-tip")) return; set(!open); },
        onKeyDown: event => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); set(!open); } }
    };
    return [open, head, React.createElement("span", { className: "fork-fold-chevron", "aria-hidden": true }, React.createElement(Icon, { name: "chevron", size: 14 }))];
}

// Floating panels (menus, tooltips) are placed in viewport coordinates from the trigger's rect: below it
// (above when there is more room there), starting at its left edge (or its right edge with align "end"),
// flipped and then clamped so they never leave the viewport or, inside a modal, its content area (the
// left nav would clip them otherwise). Pure; tests/fork-bubble-modes.test.mjs.
// anchor { left, top, right, bottom }, size { width, height } (natural), viewport { width, height },
// options { bounds { left, right }, gap, margin, minWidth, align } → { left, top, width, maxHeight, up }.
function floatingPanelPlace(anchor, size, viewport, options) {
    const o = options || {};
    const gap = o.gap == null ? 6 : o.gap, margin = o.margin == null ? 8 : o.margin;
    const want = Math.max(size.width || 0, o.minWidth || 0);
    let lo = margin, hi = viewport.width - margin;
    // Stay inside the content area when it is wide enough; otherwise float over it within the viewport.
    if (o.bounds) {
        const l = Math.max(lo, o.bounds.left + margin), r = Math.min(hi, o.bounds.right - margin);
        if (r - l >= want) { lo = l; hi = r; }
    }
    const width = Math.max(0, Math.min(want, hi - lo));
    const start = anchor.left, end = anchor.right - width;
    let left = o.align === "end" ? end : start;
    if (left < lo || left + width > hi) { const flipped = o.align === "end" ? start : end; if (flipped >= lo && flipped + width <= hi) left = flipped; }
    left = Math.min(Math.max(left, lo), hi - width);
    const below = viewport.height - margin - (anchor.bottom + gap), above = anchor.top - gap - margin;
    const up = size.height > below && above > below;
    const maxHeight = Math.max(0, up ? above : below);
    const height = Math.min(size.height || 0, maxHeight);
    return { left: Math.round(left), top: Math.round(up ? anchor.top - gap - height : anchor.bottom + gap), width: Math.round(width), maxHeight: Math.floor(maxHeight), up };
}
// A floating panel rendered into <body> (above modals and their nav) with fixed positioning from
// `anchor` (a ref to the trigger). Re-placed after every render and on scroll / resize.
// props: anchor, className, style, align, minWidth, gap, popRef, children, and any DOM attributes.
function FloatingPanel(props) {
    const h = React.createElement;
    const { anchor, className, style, align, minWidth, gap, popRef, children, ...rest } = props;
    const node = React.useRef(null);
    const useLayout = React.useLayoutEffect || React.useEffect;
    function place() {
        const menu = node.current, trigger = anchor && anchor.current;
        if (!menu || !trigger || typeof window === "undefined") return;
        // Natural size first (no inline constraints), then the placement.
        menu.style.width = ""; menu.style.maxHeight = "";
        const natural = menu.getBoundingClientRect();
        const area = trigger.closest ? trigger.closest(".fork-modal-body") : null;
        const at = floatingPanelPlace(trigger.getBoundingClientRect(), { width: Math.ceil(natural.width), height: Math.ceil(natural.height) },
            { width: window.innerWidth, height: window.innerHeight }, { bounds: area ? area.getBoundingClientRect() : null, align, minWidth, gap });
        Object.assign(menu.style, { left: at.left + "px", top: at.top + "px", width: at.width + "px", maxHeight: at.maxHeight + "px" });
        menu.setAttribute("data-placed", at.up ? "up" : "down");
    }
    useLayout(function () { place(); });
    React.useEffect(function () {
        if (typeof window === "undefined") return undefined;
        const again = () => place();
        window.addEventListener("resize", again);
        window.addEventListener("scroll", again, true);
        return () => { window.removeEventListener("resize", again); window.removeEventListener("scroll", again, true); };
    }, []);
    const element = h("div", { ...rest, ref: value => { node.current = value; if (popRef) popRef.current = value; }, className: "fork-popover" + (className ? " " + className : ""), style }, children);
    return typeof ReactDOM !== "undefined" && ReactDOM && typeof ReactDOM.createPortal === "function" && typeof document !== "undefined" && document.body ? ReactDOM.createPortal(element, document.body) : element;
}

// "?" badge whose help text shows on hover / keyboard focus / tap, instead of inline paragraphs. The
// visible text floats (FloatingPanel); a hidden copy stays in place for aria-describedby.
// `interactive` lets the text hold links (a licence page) — the body takes the
// pointer and stays while the pointer crosses to it, Tab from「?」enters it and leaves it again, Esc closes it first.
function HelpTip(props) {
    const h = React.createElement;
    const id = React.useId();
    const [open, setOpen] = React.useState(false);
    const button = React.useRef(null), pop = React.useRef(null), wrap = React.useRef(null), timer = React.useRef(0), quiet = React.useRef(false);
    const interactive = !!props.interactive;
    React.useEffect(() => () => clearTimeout(timer.current), []);
    const show = () => { clearTimeout(timer.current); setOpen(true); };
    const hide = () => { clearTimeout(timer.current); if (interactive) timer.current = setTimeout(() => setOpen(false), 200); else setOpen(false); };
    const inside = node => !!node && !!(wrap.current?.contains(node) || pop.current?.contains(node));
    const links = () => pop.current ? [...pop.current.querySelectorAll("a[href],button")] : [];
    const keyboard = target => { try { return target.matches(":focus-visible"); } catch (_) { return false; } };
    // Focus handed back to 「?」 (Esc, Tab past the last link) does not reopen it.
    const back = () => { quiet.current = true; button.current?.focus(); quiet.current = false; };
    const keys = event => {
        if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); if (event.target !== button.current) back(); return; }
        if (!interactive || !open || event.key !== "Tab") return;
        const list = links();
        if (event.target === button.current && !event.shiftKey && list.length) { event.preventDefault(); list[0].focus(); }
        else if (event.target === list[0] && event.shiftKey) { event.preventDefault(); button.current?.focus(); }
        else if (event.target === list[list.length - 1] && !event.shiftKey) { setOpen(false); back(); }
    };
    return h("span", { ref: wrap, className: "fork-help-tip" + (open ? " is-open" : ""), onMouseEnter: show, onMouseLeave: hide, onKeyDown: keys,
            onBlur: interactive ? event => { if (!inside(event.relatedTarget)) setOpen(false); } : undefined },
        h("button", { ref: button, type: "button", className: "fork-help-tip-button", "aria-label": props.label || "说明", "aria-describedby": id, "aria-expanded": open,
            onClick: event => { event.preventDefault(); event.stopPropagation(); setOpen(!open); },
            onFocus: event => { if (!quiet.current && keyboard(event.target)) setOpen(true); },
            onBlur: interactive ? undefined : () => setOpen(false) }, "?"),
        h("span", { id: id, className: "fork-help-tip-text", inert: interactive || undefined }, props.children),
        open ? h(FloatingPanel, { anchor: button, popRef: pop, className: "fork-help-tip-body" + (interactive ? " is-interactive" : ""), gap: 6,
            ...(interactive ? { role: "group", "aria-label": props.label || "说明" } : { role: "tooltip", "aria-hidden": true }) }, props.children) : null);
}
