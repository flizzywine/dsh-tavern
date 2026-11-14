// A running background task reports its progress through session reads. The host
// announces status changes as tavern-state signals, so the poll below is only a
// fallback for a missed one — and a hidden page projects nothing at all.

// One coalesced refresh per burst of signals.
function watchTavernState(sessionId, refresh) {
    if (typeof tavernSessionSignals === "undefined" || !tavernSessionSignals || typeof tavernSessionSignals.subscribe !== "function") return function () {};
    const id = String(sessionId || "");
    if (!id) return function () {};
    let timer = 0;
    const stop = tavernSessionSignals.subscribe(id, "tavern-state", function () {
        if (timer) return;
        timer = window.setTimeout(function () { timer = 0; refresh(); }, 120);
    }, function () {}, function () {});
    return function () {
        if (timer) window.clearTimeout(timer);
        timer = 0;
        if (typeof stop === "function") stop();
    };
}

// Fallback polling for one active task: slow while shown, almost nothing hidden.
function pollTaskWhile(run, options) {
    const visibleMs = Number(options && options.visibleMs) || 5000;
    const hiddenMs = Number(options && options.hiddenMs) || 30000;
    let timer = 0, stopped = false;
    const hidden = function () { return typeof document !== "undefined" && document.visibilityState === "hidden"; };
    const schedule = function (delay) {
        window.clearTimeout(timer);
        if (!stopped) timer = window.setTimeout(tick, delay);
    };
    async function tick() {
        if (stopped) return;
        if (!hidden()) { try { await run(); } catch (_) { /* The next tick retries. */ } }
        schedule(hidden() ? hiddenMs : visibleMs);
    }
    schedule(visibleMs);
    return function () { stopped = true; window.clearTimeout(timer); };
}
