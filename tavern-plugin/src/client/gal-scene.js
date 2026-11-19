// @include-shared canvas-resolution.cjs
// @include spine.js
// @include spine-preview.js
// @include-shared color-math.cjs

// Machine preference (kept per device): the stage's 画质, "auto" (default; the stage's device module resolves it,
// device.cjs galDeviceQuality) or "high" | "medium" | "saver". The old "low" reads as saver; nothing stored is auto.
const stageQuality = (function () {
    const KEY = "fork-stage-quality", VALUES = ["auto", "high", "medium", "saver"];
    const listeners = new Set();
    function get() { try { const value = localStorage.getItem(KEY); return value === "low" ? "saver" : VALUES.includes(value) ? value : "auto"; } catch (_) { return "auto"; } }
    return {
        get,
        set(value) { try { if (value === "auto" || !VALUES.includes(value)) localStorage.removeItem(KEY); else localStorage.setItem(KEY, value); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
