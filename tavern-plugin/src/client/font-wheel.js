// Ctrl+vertical wheel changes the host reading size, not page zoom.
function fontWheelStep(event) {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.defaultPrevented || !event.cancelable) return 0;
    if (!Number.isFinite(event.deltaY) || !Number.isFinite(event.deltaX) || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return 0;
    return event.deltaY < 0 ? 1 : -1;
}

// Serialized into Tavern frames; sandboxed documents relay through their existing
// source/token-authenticated lifecycle channel rather than reaching into the host.
function installFrameFontWheel(token, wheelStep, seed) {
    // only the authenticated parent chooses the card zoom.
    const root = document.documentElement;
    let hidden = false;
    function apply(value) {
        if (!Number.isFinite(value) || value < 0.6 || value > 2) return;
        root.style.zoom = String(value);
        if (hidden) { root.style.removeProperty("visibility"); hidden = false; }
    }
    if (seed) {
        apply(seed.value);
        if (!seed.ready) { root.style.setProperty("visibility", "hidden", "important"); hidden = true; }
    }
    function onMessage(event) {
        const data = event.data;
        if (event.source === parent && data && data.token === token && data.type === "dsh-fork-frame-zoom") apply(data.zoom);
    }
    function onKey(event) {
        if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key !== "0" || event.defaultPrevented || !event.cancelable) return;
        event.preventDefault(); event.stopPropagation();
        parent.postMessage({ type: "dsh-fork-font-wheel", token: token, reset: true }, "*");
    }
    window.addEventListener("message", onMessage);
    document.addEventListener("keydown", onKey, true);
    function onWheel(event) {
        const step = wheelStep(event);
        if (!step) return;
        event.preventDefault();
        event.stopPropagation();
        parent.postMessage({ type: "dsh-fork-font-wheel", token: token, step: step }, "*");
    }
    const options = { capture: true, passive: false };
    document.addEventListener("wheel", onWheel, options);
    window.addEventListener("pagehide", function () {
        document.removeEventListener("wheel", onWheel, options);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("message", onMessage);
    }, { once: true });
}
