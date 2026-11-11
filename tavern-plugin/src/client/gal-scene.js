// @include-shared canvas-resolution.cjs
// @include spine.js
// @include spine-preview.js
// @include-shared color-math.cjs

// Machine preference: stage effects quality, "high" (default) or "low".
const stageQuality = (function () {
    const KEY = "fork-stage-quality";
    const listeners = new Set();
    function get() { try { return localStorage.getItem(KEY) === "low" ? "low" : "high"; } catch (_) { return "high"; } }
    return {
        get,
        set(value) { try { localStorage.setItem(KEY, value === "low" ? "low" : "high"); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
