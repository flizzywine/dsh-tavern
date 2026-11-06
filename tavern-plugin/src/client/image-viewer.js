// the one large-picture view. 查看大图 and
// every click-to-enlarge in the library and stage settings open it. The picture covers the window on a dark backdrop —
// no title bar, frame or footer, no caption. It opens fitted to the window; the wheel zooms around the cursor (fit … 8×
// native device pixels), a drag (mouse or one finger) pans a zoomed picture on both axes (viewerClamp), a double click / double tap toggles fit ↔ 100 % at that point, two fingers pinch.
// + / − / 0 zoom in, out and back to fit. Esc, ✕ in the corner, or a click on the backdrop (not after a drag) closes.
// Past 2× native pixels the picture is drawn pixel for pixel (image-rendering: pixelated); below that it stays smooth,
// because nearest-neighbour at 1.3× makes uneven pixel rows.
// The actions the caller had in its old sheet (上传替换, 采用 …) are small icon buttons beside the ✕, named by their
// tooltip only.
//   <ImageViewer src alt actions onClose failed? onKeyDown? /> — React callers (the caller keeps the picture's lease
//   alive; `failed`: the picture cannot be had; `onKeyDown` runs first, e.g. ←→ stepping through a list).
//   openImageViewer({src, alt, actions, onClose}) → {close, update(next)} — anything else.
//   actions: [{key?, icon: node, label, onClick, disabled?, busy?, pressed?}]
// Pure geometry below is tested in tests/fork-image-viewer.test.mjs; the real gestures in fork-image-viewer-browser.
var VIEWER_MAX = 8;
var VIEWER_CRISP = 2;
var VIEWER_DRAG = 4;
var VIEWER_TAP_MS = 320;
// image {width, height} in image pixels; view {width, height, dpr}. A transform is {s, x, y}: the picture at its natural
// size, scaled by s around its top-left corner, then moved to (x, y) in view pixels.
function viewerLimits(image, view) {
    const fit = Math.min(view.width / image.width, view.height / image.height), native = 1 / (view.dpr || 1);
    return { fit, native, min: fit, max: Math.max(fit, VIEWER_MAX * native) };
}
// Fitted, the picture is centred (a drag does nothing). Zoomed, a drag moves it on both axes, clamped so it is never lost:
// an axis larger than the window never shows a gap at its edges; a smaller one stays wholly inside the window (it is not
// pinned to the centre —: a tall 立绘 zoomed in a wide window could only move up
// and down, so a sideways drag did nothing).
function viewerClamp(t, image, view) {
    const w = image.width * t.s, h = image.height * t.s;
    if (t.s <= viewerLimits(image, view).fit * 1.001) return { s: t.s, x: (view.width - w) / 2, y: (view.height - h) / 2 };
    const axis = (at, size, room) => Math.min(Math.max(0, room - size), Math.max(Math.min(0, room - size), at));
    return { s: t.s, x: axis(t.x, w, view.width), y: axis(t.y, h, view.height) };
}
function viewerFitted(image, view) { return viewerClamp({ s: viewerLimits(image, view).fit, x: 0, y: 0 }, image, view); }
// Zoom to `scale` keeping the picture point under `at` (view pixels) where it is.
function viewerZoomAt(t, scale, at, image, view) {
    const lim = viewerLimits(image, view), s = Math.min(lim.max, Math.max(lim.min, scale)), k = s / t.s;
    return viewerClamp({ s, x: at.x - (at.x - t.x) * k, y: at.y - (at.y - t.y) * k }, image, view);
}
function viewerAtFit(t, image, view) { return t.s <= viewerLimits(image, view).fit * 1.001; }
// Double click: fitted → 100 % (one image pixel per device pixel) at the point; anything else → fitted. A picture that
// fits only above 100 % (a small avatar) goes to twice its fitted size instead.
function viewerToggle(t, at, image, view) {
    const lim = viewerLimits(image, view);
    if (!viewerAtFit(t, image, view)) return viewerFitted(image, view);
    return viewerZoomAt(t, lim.fit < lim.native * 0.999 ? lim.native : lim.fit * 2, at, image, view);
}
function viewerCrisp(t, view) { return t.s * (view.dpr || 1) >= VIEWER_CRISP - 1e-6; }
var VIEWER_GLYPHS = { close: "M4 4l8 8M12 4l-8 8", prev: "M10 3.5 5.5 8l4.5 4.5", next: "M6 3.5 10.5 8 6 12.5",
    edit: "M10.6 2.9a1.4 1.4 0 0 1 2 2L5.5 12 2.8 12.7l.7-2.7zM9.4 4.1l2 2" };
function viewerGlyph(name) {
    const h = React.createElement;
    return h("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        h("path", { d: VIEWER_GLYPHS[name], stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }));
}
function ImageViewer(props) {
    const h = React.createElement, p = props || {}, actions = (p.actions || []).filter(Boolean);
    const root = React.useRef(null), stage = React.useRef(null);
    // The picture's size, its transform and a load failure belong to one src: a new picture (上传替换, ‹ ›) starts again
    // from fitted. (Kept with the src rather than reset in an effect: a data URL can load before effects run.)
    const [loaded, setLoaded] = React.useState(null), [view, setView] = React.useState(null), [placed, setPlaced] = React.useState(null);
    const [broken, setBroken] = React.useState(null), [glide, setGlide] = React.useState(false), [dragging, setDragging] = React.useState(false);
    const image = loaded && loaded.src === p.src ? loaded : null, t = image && placed && placed.src === p.src ? placed : null, failed = !!p.src && broken === p.src;
    const live = React.useRef({}), gesture = React.useRef({ pointers: new Map() }), latest = React.useRef(null);
    live.current = { image, view, t, src: p.src, onClose: p.onClose };
    // The transform as last applied, before React has rendered it: wheel notches and a press that come faster than the
    // renders build on it instead of on a stale one (a fast wheel lost notches; a press right after it started from there).
    const placedNow = () => { const now = live.current, mine = latest.current; return mine && mine.src === now.src && now.image ? mine : now.t; };
    const close = () => live.current.onClose && live.current.onClose();
    useOverlay(true, () => [root.current], close);
    const apply = (next, smooth) => { const value = { s: next.s, x: next.x, y: next.y, src: live.current.src }; latest.current = value; setGlide(!!smooth); setPlaced(value); };
    React.useEffect(function () {
        const previous = typeof document === "undefined" ? null : document.activeElement;
        if (root.current && root.current.focus) root.current.focus({ preventScroll: true });
        return () => { if (previous && previous.focus) previous.focus({ preventScroll: true }); };
    }, []);
    // The window: fitted stays fitted on a resize; a zoomed picture keeps its scale, clamped to the new edges.
    React.useEffect(function () {
        const node = stage.current;
        if (!node || typeof window === "undefined") return undefined;
        const measure = () => {
            const next = { width: node.clientWidth, height: node.clientHeight, dpr: window.devicePixelRatio || 1 }, now = live.current;
            if (!next.width || !next.height) return;
            setView(next);
            const at = placedNow();
            if (now.image && at) apply(now.view && viewerAtFit(at, now.image, now.view) ? viewerFitted(now.image, next) : viewerZoomAt(at, at.s, { x: 0, y: 0 }, now.image, next), false);
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, []);
    const zoomBy = (factor, at, smooth) => { const now = live.current, from = placedNow(); if (from && now.view) apply(viewerZoomAt(from, from.s * factor, at || { x: now.view.width / 2, y: now.view.height / 2 }, now.image, now.view), smooth); };
    const local = event => { const r = stage.current.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
    // The wheel is a listener of our own: React's wheel listeners are passive (no preventDefault).
    React.useEffect(function () {
        const node = stage.current;
        if (!node || !node.addEventListener) return undefined;
        const wheel = event => {
            event.preventDefault();
            const lines = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 400 : 1;
            zoomBy(Math.exp(-event.deltaY * lines * 0.0015), local(event), false);
        };
        node.addEventListener("wheel", wheel, { passive: false });
        return () => node.removeEventListener("wheel", wheel);
    }, []);
    const onLoad = event => {
        const img = event.currentTarget, src = live.current.src;
        if (!img.naturalWidth || !img.naturalHeight) { setBroken(src); return; }
        setLoaded({ src, width: img.naturalWidth, height: img.naturalHeight });
    };
    // Fitted once both the picture and the window are known.
    React.useEffect(function () { if (image && view && !t) apply(viewerFitted(image, view), false); }, [image, view, t]);
    // Pointers: one drags, two pinch (scale by their distance, about their midpoint, which also pans). A press that never
    // moved is a click: on the backdrop it closes; two on the picture within a moment toggle fit ↔ 100 %.
    // (twice): in the desktop app a real mouse drag never moved the picture while every
    // injected (CDP / harness) drag did. The press reached the stage, the moves did not: the stage took pointer capture and
    // listened through React's delegated onPointerMove, so the moves only counted when the captured, React-dispatched
    // event made it back to the stage — the wheel, a plain listener of its own, always zoomed. Now the press is a native
    // listener on the stage and, from that press until the last pointer lifts, moves and lifts are read on the window in
    // the capture phase (the 素材库 row drag that works in the app does the same): no pointer capture, no React dispatch,
    // nothing above the window can take them first. The press is preventDefault-ed (no text selection, no native drag).
    const g = gesture.current;
    const pair = () => { const [a, b] = [...g.pointers.values()]; return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
    const begin = () => { g.start = placedNow(); g.anchor = g.pointers.size > 1 ? pair() : { mid: [...g.pointers.values()][0], dist: 1 }; };
    const onPointerDown = event => {
        if (event.button !== undefined && event.button !== 0 || !placedNow()) return;
        event.preventDefault();
        if (!g.pointers.size) { g.moved = false; g.onImage = event.target !== stage.current; g.origin = local(event); }
        g.pointers.set(event.pointerId, local(event));
        if (g.pointers.size > 1) g.moved = true;
        begin();
        g.track();
    };
    const onPointerMove = event => {
        if (!g.pointers.has(event.pointerId)) return;
        const at = local(event);
        g.pointers.set(event.pointerId, at);
        if (!g.moved && Math.hypot(at.x - g.origin.x, at.y - g.origin.y) < VIEWER_DRAG) return;
        if (!g.moved) { g.moved = true; setDragging(true); }
        const now = live.current, start = g.start;
        if (g.pointers.size > 1) {
            const { mid, dist } = pair(), scaled = viewerZoomAt(start, start.s * dist / g.anchor.dist, g.anchor.mid, now.image, now.view);
            apply(viewerClamp({ s: scaled.s, x: scaled.x + mid.x - g.anchor.mid.x, y: scaled.y + mid.y - g.anchor.mid.y }, now.image, now.view), false);
        } else apply(viewerClamp({ s: start.s, x: start.x + at.x - g.anchor.mid.x, y: start.y + at.y - g.anchor.mid.y }, now.image, now.view), false);
    };
    const onPointerUp = event => {
        if (!g.pointers.has(event.pointerId)) return;
        g.pointers.delete(event.pointerId);
        if (g.pointers.size) { begin(); return; }
        g.untrack();
        setDragging(false);
        if (g.moved || event.type === "pointercancel") return;
        const at = local(event), stamp = Date.now();
        if (!g.onImage) { close(); return; }
        const last = g.tap;
        if (last && stamp - last.stamp < VIEWER_TAP_MS && Math.hypot(at.x - last.x, at.y - last.y) < 24) {
            g.tap = null;
            const now = live.current;
            apply(viewerToggle(placedNow(), at, now.image, now.view), true);
        } else g.tap = { x: at.x, y: at.y, stamp };
    };
    const hands = React.useRef(null);
    hands.current = { down: onPointerDown, move: onPointerMove, up: onPointerUp };
    React.useEffect(function () {
        const node = stage.current;
        if (!node || !node.addEventListener || typeof window === "undefined") return undefined;
        const down = event => hands.current.down(event), move = event => hands.current.move(event), up = event => hands.current.up(event);
        // Leaving the window mid-gesture (alt-tab) ends it: no pointerup will come.
        const lost = () => { if (!g.pointers.size) return; g.pointers.clear(); g.untrack(); setDragging(false); };
        let tracking = false;
        g.track = () => { if (tracking) return; tracking = true; window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true); window.addEventListener("blur", lost); };
        g.untrack = () => { if (!tracking) return; tracking = false; window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); window.removeEventListener("blur", lost); };
        node.addEventListener("pointerdown", down);
        return () => { node.removeEventListener("pointerdown", down); g.pointers.clear(); g.untrack(); };
    }, []);
    // A portalled view is still inside its opener's React tree: its presses, clicks and keys must not reach the opener's
    // handlers (the 素材库 modal's keys, the sidebar pane's click, a tile's menu).
    const keep = event => event.stopPropagation();
    const onKeyDown = event => {
        if (p.onKeyDown) p.onKeyDown(event);
        if (event.defaultPrevented) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const now = live.current;
        if (["+", "="].includes(event.key)) zoomBy(1.25, null, true);
        else if (["-", "_"].includes(event.key)) zoomBy(0.8, null, true);
        else if (event.key === "0" && now.image && now.view) apply(viewerFitted(now.image, now.view), true);
        else if (event.key === "Tab") {
            const nodes = [...(root.current ? root.current.querySelectorAll("button:not(:disabled)") : [])];
            if (!nodes.length) return;
            const first = nodes[0], last = nodes[nodes.length - 1], active = document.activeElement;
            if (event.shiftKey && (active === first || active === root.current)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
            return;
        } else return;
        event.preventDefault(); event.stopPropagation();
    };
    const lost = failed || !!p.failed, shown = !lost && !!(image && t && view);
    const style = shown ? { width: image.width + "px", height: image.height + "px", transform: "translate(" + t.x + "px, " + t.y + "px) scale(" + t.s + ")" } : undefined;
    const button = (a, i) => h("button", { key: a.key || a.label || i, type: "button", className: "fork-viewer-button", "aria-label": a.label, title: a.label,
        "aria-pressed": a.pressed === undefined ? undefined : !!a.pressed, disabled: !!(a.disabled || a.busy), "aria-busy": a.busy || undefined, onClick: a.onClick },
        a.busy ? h(Spinner, { delay: 0 }) : a.icon);
    const body = h("div", { ref: root, className: "fork-viewer", role: "dialog", "aria-modal": true, "aria-label": p.alt || "查看大图", tabIndex: -1,
        onKeyDown: event => { onKeyDown(event); event.stopPropagation(); }, onPointerDown: keep, onPointerUp: keep, onMouseDown: keep, onMouseUp: keep, onClick: keep,
        onDoubleClick: keep, onContextMenu: keep, onTouchStart: keep, onTouchEnd: keep, onDragStart: event => { event.preventDefault(); event.stopPropagation(); } },
        h("div", { ref: stage, className: "fork-viewer-stage" + (dragging ? " is-dragging" : "") },
            p.src && !lost ? h("img", { key: p.src, src: p.src, alt: p.alt || "", draggable: false, decoding: "async", className: "fork-viewer-img" + (glide ? " is-gliding" : ""),
                "data-shown": shown || undefined, "data-crisp": shown && viewerCrisp(t, view) || undefined, "data-scale": shown ? t.s.toFixed(4) : undefined,
                style, onLoad, onError: () => setBroken(p.src) }) : null,
            !shown && !lost ? h(Spinner, { key: p.src || "", fill: true }) : null,
            lost ? h("p", { className: "fork-viewer-error", role: "alert" }, "⚠ 图片没能载入") : null),
        h("div", { className: "fork-viewer-tools" }, actions.map(button),
            button({ key: "close", label: "关闭", onClick: close, icon: viewerGlyph("close") })));
    const portal = typeof ReactDOM !== "undefined" && ReactDOM && typeof ReactDOM.createPortal === "function" && typeof document !== "undefined" && document.body;
    return portal ? ReactDOM.createPortal(body, document.body) : body;
}
function openImageViewer(options) {
    // React 19: createRoot lives in react-dom/client (the host's module loader provides it; harnesses pass a merged ReactDOM).
    const roots = ReactDOM && typeof ReactDOM.createRoot === "function" ? ReactDOM : require("react-dom/client");
    const host = document.createElement("div"), mount = roots.createRoot(host);
    let current = options || {}, open = true;
    document.body.appendChild(host);
    const close = () => { if (!open) return; open = false; mount.unmount(); host.remove(); if (current.onClose) current.onClose(); };
    const render = () => mount.render(React.createElement(ImageViewer, Object.assign({}, current, { onClose: close })));
    render();
    return { close, update(next) { if (!open) return; current = Object.assign({}, current, next); render(); } };
}
// Scene illustrations (the chat's upstream openSceneImagePreview call sites, same arguments): a gallery {urls, index} steps
// with ‹ › and ←→ (no wrap); 改提示词重画 (onEditPrompt) closes the view and opens the prompt editor. Focus returns to the
// opener when it closes. `label` (upstream 3.0: an avatar, 「X的头像」) names the picture instead of 场景插画.
function openSceneImage(url, opener, version, onEditPrompt, gallery, label) {
    const urls = gallery && gallery.urls && gallery.urls.length > 1 ? gallery.urls : [url];
    let at = urls.length > 1 ? Math.max(0, Math.min(urls.length - 1, Number(gallery.index) || 0)) : 0, viewer = null;
    const step = delta => { if (urls[at + delta]) { at += delta; viewer.update(view()); } };
    const view = () => ({
        src: urls[at], alt: label || "场景插画",
        onKeyDown: event => { if (urls.length > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1); } },
        actions: [
            urls.length > 1 && { key: "prev", label: "上一张", icon: viewerGlyph("prev"), disabled: at === 0, onClick: () => step(-1) },
            urls.length > 1 && { key: "next", label: "下一张", icon: viewerGlyph("next"), disabled: at === urls.length - 1, onClick: () => step(1) },
            onEditPrompt && version && version.planPrompt && { key: "edit", label: "改提示词重画", icon: viewerGlyph("edit"), onClick: () => { viewer.close(); onEditPrompt(); } }]
    });
    viewer = openImageViewer(Object.assign(view(), { onClose: () => { if (opener && opener.isConnected && opener.focus) opener.focus(); } }));
    return viewer;
}