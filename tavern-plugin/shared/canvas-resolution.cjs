// the one render resolution of every stage canvas - the
// Pixi scene with its Live2D / Spine figures, keyframe performances, the dice throw and the Live2D / Spine editor previews.
// It is the device's own pixel ratio, so a 4K screen at Windows 225% (2.25) or a DPR 3 phone draws 1:1 device pixels; the
// old cap at 2 stretched every 4K frame by 1.125. The low quality
// setting renders at 1; a ratio below 1 (zoomed out) still renders at 1. The stage scene on a handheld phone
// (galDeviceHandheld) renders at most at 2: a DPR 3 iPhone draws 56% fewer pixels a frame; its text and UI stay DOM.
function galResolution(quality, dpr = globalThis.devicePixelRatio, handheld = false) {
    return quality === "low" ? 1 : Math.min(handheld ? 2 : Infinity, Math.max(1, dpr || 1));
}
// Calls changed() whenever the pixel ratio changes (the window moved to another monitor, the browser zoom) and returns the
// unsubscribe. A resolution query matches one ratio only, so it is re-armed at the new ratio after each change.
function galResolutionSubscribe(changed) {
    if (typeof matchMedia !== "function") return () => {};
    let list = null, active = true;
    const arm = () => { list?.removeEventListener("change", fire); list = matchMedia("(resolution: " + (globalThis.devicePixelRatio || 1) + "dppx)"); list.addEventListener("change", fire); };
    function fire() { if (!active) return; arm(); changed(); }
    arm();
    return () => { if (!active) return; active = false; list.removeEventListener("change", fire); };
}
// A Pixi application (resizeTo, autoDensity) kept at the ratio, for the editor previews; returns the unsubscribe. The scene
// also retunes its filters on a change, so it subscribes itself (galCreateScene applyQuality).
function galFollowResolution(app) {
    return galResolutionSubscribe(() => { app.renderer.resolution = galResolution("high"); app.resize(); });
}

if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {galResolution, galResolutionSubscribe, galFollowResolution};
