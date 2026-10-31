// @include-shared canvas-resolution.cjs
// @include spine.js
// @include spine-preview.js


// ---------- Scene helpers (pure; gal-scene-helpers.cjs) ----------
// @include gal-scene-helpers.cjs
// ---------- Scene runtime (pixi) ----------

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
function useStageQuality() { return React.useSyncExternalStore(stageQuality.subscribe, stageQuality.get); }

function GalScene(props) { return React.createElement(stageViews.scene.Scene,props); }
