// shell helpers.
// Debug view: developer chrome (trajectory tabs, token stats, reasoning,
// version/update block) is hidden in play sessions unless this is on.
const DEBUG_KEY = "dsh-tavern-fork-debug";
// retain the legacy key only until its server write succeeds.
function createDebugMigration(win) {
    let pending;
    return function migrate(save) {
        if (!pending) pending = (async function () {
            let legacy;
            try { legacy = win.localStorage.getItem(DEBUG_KEY); } catch (_) { return; }
            if (legacy === "1") await save(true);
            try { win.localStorage.removeItem(DEBUG_KEY); } catch (_) {}
        })().catch(function (error) { pending = null; throw error; });
        return pending;
    };
}
// Developer diagnostics (provider English, ids, raw failures) render only while this is on.
function debugViewOn() {
    return typeof document !== "undefined" && !!document.body && document.body.classList.contains("dsh-fork-debug");
}
function applyDebug(doc, enabled) {
    if (doc && doc.body) doc.body.classList.toggle("dsh-fork-debug", Boolean(enabled));
}
// Feature-owned dialogs use the host portal without depending on the shell plugin.
function bodyPortal(node) { return ReactDOM && document.body ? ReactDOM.createPortal(node, document.body) : node; }
