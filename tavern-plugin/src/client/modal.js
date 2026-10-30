// the large centered settings modal (about 80vw × 80vh,
// at most 1200px wide) with an optional left nav. Opaque on translucent skins, Esc and a backdrop click
// close it, focus moves in on open, stays inside (Tab wraps) and returns to the opener on close.
// Rendered into <body> so the sidebar's width and scroll never clip it.

const LARGE_MODAL_FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// props: open, title, icon, subtitle, help (nodes for the 「?」), tools (head nodes), onClose,
// nav [{ id, label, icon, badge, dim, title, separator }], navValue, onNav(id), navLabel, navHead, navFoot,
// className, children.
function LargeModal(props) {
    if (!props.open) return null;
    return React.createElement(LargeModalFrame, props);
}
function LargeModalFrame(props) {
    const h = React.createElement;
    const panel = React.useRef(null);
    const pressed = React.useRef(false);
    const close = React.useRef(props.onClose);
    close.current = props.onClose;
    const titleId = React.useId();
    // outside press / Esc through the shared popup stack (inline-field.js) when it is
    // bundled — only the topmost popup closes; standalone harnesses keep the backdrop click below.
    const stacked = typeof useOverlay === "function";
    if (stacked) useOverlay(true, () => [panel.current], () => close.current());
    // Narrow modals (under LARGE_MODAL_COMPACT px) shrink the nav to an icon / avatar column (names in tooltips).
    const [compact, setCompact] = React.useState(false);
    React.useEffect(function () {
        const node = panel.current;
        if (!node || typeof ResizeObserver === "undefined") return undefined;
        const measure = () => setCompact(largeModalCompact(node.getBoundingClientRect().width));
        const observer = new ResizeObserver(measure);
        observer.observe(node); measure();
        return () => observer.disconnect();
    }, []);
    React.useEffect(function () {
        if (typeof document === "undefined") return undefined;
        const opener = document.activeElement;
        const node = panel.current;
        const first = node && (node.querySelector("[data-autofocus]") || node.querySelector(".fork-modal-nav [aria-current='true']") || node.querySelector(".fork-modal-body " + LARGE_MODAL_FOCUSABLE.split(", ").join(", .fork-modal-body ")));
        const target = first || node;
        if (target && target.focus) target.focus({ preventScroll: true });
        return function () { if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true }); };
    }, []);
    function onKeyDown(event) {
        if (event.key === "Escape") {
            // An open menu / tooltip inside handles its own Escape first.
            if (event.defaultPrevented) return;
            if (event.target && event.target.closest && event.target.closest(".fork-help-tip.is-open, .fork-voice-picker.is-open, .fork-popover")) return;
            if (stacked && overlayEscape(event)) return;
            event.preventDefault(); event.stopPropagation();
            close.current();
            return;
        }
        if (event.key === "Tab" && panel.current && typeof document !== "undefined") {
            const items = Array.from(panel.current.querySelectorAll(LARGE_MODAL_FOCUSABLE)).filter(node => node.getClientRects().length > 0);
            if (!items.length) return;
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    }
    const navItems = Array.isArray(props.nav) ? props.nav : [];
    const nav = navItems.length ? h("nav", { className: "fork-modal-nav", "aria-label": props.navLabel || props.title },
        props.navHead || null,
        h("div", { className: "fork-modal-nav-list" }, navItems.map(function (item) {
            if (item.separator) return h("div", { key: item.id, className: "fork-modal-nav-sep", role: "presentation" }, item.label || null);
            const current = item.id === props.navValue;
            return h("button", { key: item.id, type: "button", className: "fork-modal-nav-item" + (current ? " is-current" : "") + (item.dim ? " is-dim" : ""), "aria-current": current ? "true" : undefined,
                title: [typeof item.label === "string" ? item.label : "", item.title || (item.badge != null && item.badge !== "" ? String(item.badge) : "")].filter(Boolean).join(" · ") || undefined,
                onClick: () => props.onNav && props.onNav(item.id) },
                item.media || (item.icon ? h(Icon, { name: item.icon, size: 16 }) : null),
                h("span", { className: "fork-modal-nav-label" }, item.label),
                item.badge != null && item.badge !== "" ? h("span", { className: "fork-modal-nav-badge" }, item.badge) : null);
        })),
        props.navFoot || null) : null;
    const node = h("div", { className: "fork-modal-backdrop",
        onMouseDown: event => { pressed.current = event.target === event.currentTarget; },
        onClick: event => { if (!stacked && pressed.current && event.target === event.currentTarget) close.current(); pressed.current = false; },
        onKeyDown },
        h("div", { ref: panel, className: "fork-modal" + (nav ? " has-nav" : "") + (compact ? " is-compact" : "") + (props.className ? " " + props.className : ""), role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabIndex: -1 },
            h("header", { className: "fork-modal-head" },
                props.icon ? h("span", { className: "fork-modal-icon", "aria-hidden": true }, h(Icon, { name: props.icon, size: 18 })) : null,
                h("strong", { id: titleId }, props.title),
                props.help ? h(HelpTip, { label: props.title + "说明" }, props.help) : null,
                props.subtitle ? h("span", { className: "fork-modal-subtitle", title: typeof props.subtitle === "string" ? props.subtitle : undefined }, props.subtitle) : null,
                h("span", { className: "fork-modal-tools" }, props.tools || null),
                h("button", { type: "button", className: "fork-modal-close", "aria-label": "关闭", title: "关闭（Esc）", onClick: () => close.current() }, h(Icon, { name: "close", size: 18 }))),
            h("div", { className: "fork-modal-main" },
                nav,
                h("div", { className: "fork-modal-body fork-bubble-settings" }, props.children))));
    return typeof ReactDOM !== "undefined" && ReactDOM && typeof ReactDOM.createPortal === "function" && typeof document !== "undefined" && document.body ? ReactDOM.createPortal(node, document.body) : node;
}
const LARGE_MODAL_COMPACT = 900;
function largeModalCompact(width) { return width > 0 && width < LARGE_MODAL_COMPACT; }
// A foldable section inside a modal: icon-first head, the 「?」 right after the title, optional tools.
// No gray caption under the title: what the section is for goes in its 「?」.
function LargeModalSection(props) {
    const h = React.createElement;
    const [open, head, chevron] = useFold("modal:" + props.id, props.defaultOpen);
    return h("section", { className: "fork-bubble-section fork-modal-section" + (open ? "" : " is-folded") + (props.className ? " " + props.className : ""), "data-section": props.id },
        h("div", head, chevron,
            h("strong", null, props.icon ? h(Icon, { name: props.icon, size: 15 }) : null, props.title,
                props.help ? h(HelpTip, { label: props.title + "说明" }, props.help) : null),
            props.tools || null),
        open ? props.children : null);
}
