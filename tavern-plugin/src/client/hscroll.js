// every scrollbar is hidden, so a mouse
// without a sideways wheel could not reach a box that only scrolls sideways (tab strips, chip rows, galleries, wide
// tables, code). This one helper turns a plain vertical wheel into sideways scrolling for the nearest such box, and only
// while that box can still move that way: at its end, or under a box that scrolls vertically, the wheel is left alone so
// the page (or the next scroller) scrolls as usual. Shift / Ctrl / Alt / Meta wheels and trackpad sideways swipes stay
// native. Self-contained: frame-document.js serialises it into card frames (`phase` "bubble": a card's own wheel
// handler that claims the event wins); the host page uses "capture" because overlays stop React wheel propagation.
function installHScroll(view, phase) {
    if (!view || !view.document || typeof view.addEventListener !== "function") return function () {};
    const key = "__forkHScroll";
    if (view[key]) { view[key].count += 1; return view[key].release; }
    const capture = phase !== "bubble", pending = new WeakMap(), doc = view.document;
    const scrolls = value => value === "auto" || value === "scroll" || value === "overlay";
    function parentOf(el) {
        if (el.parentElement) return el.parentElement;
        const root = el.parentNode;
        return root && root.host && root.host.nodeType === 1 ? root.host : null;
    }
    // The nearest box that only scrolls sideways and still has room in the wheel's direction, or null. A few pixels of
    // vertical overflow (a focus ring, a badge) do not make a strip a vertical scroller.
    function target(start, delta) {
        for (let el = start; el && el.nodeType === 1 && el !== doc.body && el !== doc.documentElement; el = parentOf(el)) {
            const wide = el.scrollWidth - el.clientWidth > 1, tall = el.scrollHeight - el.clientHeight > 8;
            if (!wide && !tall) continue;
            if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return null;
            const style = view.getComputedStyle(el);
            if (tall && scrolls(style.overflowY)) return null;
            if (!wide || !scrolls(style.overflowX)) continue;
            const rtl = style.direction === "rtl", max = el.scrollWidth - el.clientWidth, last = pending.get(el);
            const base = last && Date.now() - last.at < 250 ? last.left : el.scrollLeft;
            const step = rtl ? -delta : delta, lo = rtl ? -max : 0, hi = rtl ? 0 : max;
            const next = Math.max(lo, Math.min(hi, base + step));
            if (Math.abs(next - base) >= 1) return { el, next };
        }
        return null;
    }
    function onWheel(event) {
        if (event.defaultPrevented || !event.cancelable || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
        const dy = Number(event.deltaY), dx = Number(event.deltaX) || 0;
        if (!Number.isFinite(dy) || !dy || Math.abs(dx) >= Math.abs(dy)) return;
        const path = typeof event.composedPath === "function" ? event.composedPath() : [];
        const start = path.find(node => node && node.nodeType === 1) || event.target;
        const width = start && start.clientWidth || view.innerWidth || 800;
        const delta = event.deltaMode === 1 ? dy * 40 : event.deltaMode === 2 ? dy * width : dy;
        const hit = target(start, delta);
        if (!hit) return;
        event.preventDefault();
        event.stopPropagation();
        pending.set(hit.el, { left: hit.next, at: Date.now() });
        if (typeof hit.el.scrollTo === "function") hit.el.scrollTo({ left: hit.next, behavior: "smooth" });
        else hit.el.scrollLeft = hit.next;
    }
    const options = { capture, passive: false };
    view.addEventListener("wheel", onWheel, options);
    const state = view[key] = { count: 1, release: function () {
        if (!view[key] || --view[key].count > 0) return;
        view.removeEventListener("wheel", onWheel, options);
        delete view[key];
    } };
    return state.release;
}
