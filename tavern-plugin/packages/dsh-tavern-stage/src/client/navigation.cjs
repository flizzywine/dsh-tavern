'use strict';

function createStageNavigation({window, document, navigator, playCue, checkSetup, getSessionId, getSettings, uncover}) {
const galStageAvailable = (() => {
    let enabled = false;
    const listeners = new Set();
    return {get: () => enabled, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
        set(value) {if (enabled === value) return; enabled = value; for (const fn of listeners) fn();}};
})();
let galVisitGeneration = 0;
function galStageLifetime() {
    galStageAvailable.set(true);
    let live = true;
    return () => {
        if (!live) return;
        live = false;
        galVisitGeneration++;
        galEntry = null; galEntering.set(""); galLeaveHold = null; galLeavePending = false;
        try { galStageAvailable.set(false); }
        finally {
            try { galLeaveNow(); }
            finally { galEscapeLock(false); uncover(); }
        }
    };
}
const galActive = (function () {
    let session = "";
    const listeners = new Set();
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: () => session,
        set(value) { session = value || ""; listeners.forEach(fn => fn()); }
    };
})();
// The session whose stage entry was asked for and is not mounted yet (the setup check below is a host read). The
// transcript under it starts no new face leases meanwhile: they would take the entry's connections (bubbles.js).
const galEntering = (function () {
    let session = "";
    return { get: () => session, set(value) { session = value || ""; } };
})();
let galEntry = null;
function galEnter(sessionId, target) {
    if (!galStageAvailable.get()) return;
    const generation = ++galVisitGeneration;
    const current = () => galStageAvailable.get() && generation === galVisitGeneration;
    // the first entry on a card without 素材包 opens 舞台设置 › 设置向导 instead
    // (asset-launcher.js stageSetupGate; absent where the stage is loaded on its own). The host check is one
    // local read, well inside the click's activation window, so full screen is still granted afterwards.
    const setup = checkSetup?.(sessionId, current);
    if (setup) {
        galEntering.set(sessionId);
        setup.then(opened => { if (!current()) return; galEntering.set(""); if (!opened) galOpen(sessionId, target); }, () => {if (current()) galEntering.set("");});
        return;
    }
    galOpen(sessionId, target);
}
function galOpen(sessionId, target) {
    if (!galStageAvailable.get()) return;
    playCue("open"); // ui-sfx.js (fetches only this cue; the rest follow the entry)
    galEntry = target && Number.isInteger(target.turn) ? { sessionId, turn: target.turn, para: Math.max(1, Number(target.para) || 1), token: Date.now() } : null;
    galActive.set(sessionId);
    // Called from the click itself, so the browser grants full screen.
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
}
// Requests for the stage's system menu from outside the stage (the host: system full screen was left, which the
// browser does on Esc before the page sees the key). A counter; the mounted stage opens its menu on a change.
const galMenuRequest = (function () {
    let count = 0;
    const listeners = new Set();
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: () => count,
        request() { count++; listeners.forEach(fn => fn()); }
    };
})();
// in full screen the stage holds Esc (Keyboard Lock), so a press reaches the page and opens
// the menu in place - no exit, no window shrink. Holding Esc still leaves full screen (the browser's rule). Without the
// API the host's fullscreen-lost path opens the menu instead.
function galEscapeLock(on) {
    const keyboard = typeof navigator !== "undefined" ? navigator.keyboard : null;
    if (!keyboard || typeof keyboard.lock !== "function") return;
    if (on) keyboard.lock(["Escape"]).catch(() => {}); else keyboard.unlock();
}
// 「返回主页面」(the system menu, the chat button and the top-bar ✕): leave the stage, keep the bookmark.
// a mounted stage whose skin declares transitions.stage.leave plays it first
// (galLeaveHold returns true and calls back when it ends); a second request during it is the same leave.
let galLeaveHold = null, galLeavePending = false;
function galLeave() {
    if (galLeavePending) return;
    playCue("close");
    const leaving = galActive.get();
    if (galLeaveHold && galLeaveHold(() => { galLeavePending = false; if (galActive.get() === leaving) galLeaveNow(); })) { galLeavePending = true; return; }
    galLeaveNow();
}
function galLeaveNow() {
    galVisitGeneration++;
    galEntering.set("");
    galActive.set("");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
// One plugin-owned capture listener also works when an editor or modal has focus.
function galStageShortcut() {
    let composing = false;
    const compositionStart = () => { composing = true; };
    const compositionEnd = () => { composing = false; };
    function onKey(event) {
        if (event.key !== "F12" || composing || event.isComposing || event.keyCode === 229) return;
        const sessionId = getSessionId();
        const data = sessionId && getSettings(sessionId);
        if (!data?.cardPath || !data.config?.enabled) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (galActive.get() === sessionId) galLeave();
        else galEnter(sessionId);
    }
    window.addEventListener("compositionstart", compositionStart, true);
    window.addEventListener("compositionend", compositionEnd, true);
    window.addEventListener("blur", compositionEnd);
    window.addEventListener("keydown", onKey, true);
    return function () {
        window.removeEventListener("compositionstart", compositionStart, true);
        window.removeEventListener("compositionend", compositionEnd, true);
        window.removeEventListener("blur", compositionEnd);
        window.removeEventListener("keydown", onKey, true);
    };
}
return {galStageAvailable, galStageLifetime, galActive, galEntering, galEnter, galOpen, galMenuRequest, galEscapeLock, galLeave, galLeaveNow, galStageShortcut,
    getEntry: () => galEntry,
    holdLeave(hold) {galLeaveHold = hold; return () => {if (galLeaveHold === hold) galLeaveHold = null;};}};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageNavigation};
