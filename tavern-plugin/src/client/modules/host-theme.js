// One observer of DSH theme tokens shared by every message frame and inline fragment.
// DSH emits preferences as CSS variables and stylesheets, so each head/root style
// mutation is re-read once here instead of once per mounted card.
const tavernHostThemeListeners = new Set();
let tavernHostThemeObserver = null, tavernHostTheme = null;
function readTavernHostTheme(win) {
    const value = parseFloat(win.getComputedStyle(win.document.body).getPropertyValue("--dsh-content-font-size"));
    // DSH resolves its theme on <html color-scheme> and marks dark with body[data-ds-dark-theme].
    return { fontSize: Number.isFinite(value) && value >= 8 && value <= 48 ? value : 14, textColorOverrides: tavernTextColorOverrides(win),
        colorScheme: win.document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light" };
}
function currentTavernHostTheme(win) {
    return tavernHostTheme || readTavernHostTheme(win);
}
function subscribeTavernHostTheme(win, listener) {
    if (!tavernHostThemeObserver) {
        tavernHostTheme = readTavernHostTheme(win);
        // Mounting card fragments inserts many <style> nodes, each in its own task. Reading
        // computed style per mutation forced a full-page style recalc every time; read once
        // per frame instead, when the browser recalculates styles anyway.
        let queued = false;
        const schedule = win.requestAnimationFrame ? function (work) { win.requestAnimationFrame(work); } : function (work) { win.setTimeout(work, 16); };
        tavernHostThemeObserver = new win.MutationObserver(function () {
            if (queued) return;
            queued = true;
            schedule(function () {
                queued = false;
                if (!tavernHostThemeObserver) return;
                const next = readTavernHostTheme(win);
                if (next.fontSize === tavernHostTheme.fontSize && next.textColorOverrides.quote === tavernHostTheme.textColorOverrides.quote && next.colorScheme === tavernHostTheme.colorScheme) return;
                tavernHostTheme = next;
                tavernHostThemeListeners.forEach(function (notify) { notify(next); });
            });
        });
        tavernHostThemeObserver.observe(win.document.head, { subtree: true, childList: true, characterData: true });
        [win.document.documentElement, win.document.body].filter(Boolean).forEach(function (node) { tavernHostThemeObserver.observe(node, { attributes: true, attributeFilter: ["style", "class", "data-ds-dark-theme"] }); });
    }
    tavernHostThemeListeners.add(listener);
    return function () {
        tavernHostThemeListeners.delete(listener);
        if (tavernHostThemeListeners.size || !tavernHostThemeObserver) return;
        tavernHostThemeObserver.disconnect();
        tavernHostThemeObserver = null;
        tavernHostTheme = null;
    };
}

// Card iframes keep their own typography (their text is never rewritten). Zoom
// the plugin-owned slot instead: the frame's viewport shrinks by the same factor,
// so the card reflows at a larger scale and viewport units cannot overflow.
function bindTavernFontZoom(node, win) {
    function apply(theme) { node.style.zoom = theme.fontSize === 14 ? "" : String(theme.fontSize / 14); }
    const unsubscribe = subscribeTavernHostTheme(win, apply);
    apply(currentTavernHostTheme(win));
    return function () { unsubscribe(); node.style.zoom = ""; };
}
