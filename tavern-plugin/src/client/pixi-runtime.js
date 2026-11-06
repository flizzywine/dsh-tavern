// Shared Pixi and static-sprite runtime, independent of model SDKs.
// @include layered-sprite.cjs
// @include layered-sprite-render.js
let pixiRuntime = null;
const PIXI_VENDOR = '/api/dsh-tavern/vendor/runtime-assets/pixi/';
function forkLoadScript(src) {
    return new Promise(function (resolve, reject) {
        const node = document.createElement("script");
        node.src = src; node.async = false;
        node.onload = resolve; node.onerror = () => reject(new Error("加载失败：" + src));
        document.head.appendChild(node);
    });
}
function loadPixiRuntime() {
    if (window.PIXI) return Promise.resolve(window.PIXI);
    if (pixiRuntime) return pixiRuntime;
    pixiRuntime = forkLoadScript(PIXI_VENDOR + "pixi.min.js")
        .then(() => { if (!window.PIXI) throw new Error("pixi 运行库不可用"); return window.PIXI; })
        .catch(error => { pixiRuntime = null; throw error; });
    return pixiRuntime;
}
const forkLipSync = (function () {
    const taps = new WeakMap();
    function tap(audio) {
        if (!audio) return null;
        if (taps.has(audio)) return taps.get(audio);
        try {
            // Reuse the mixer's source: a media element can only be connected once.
            const analyser = forkStageAudio.analyser(audio);
            if (!analyser) return null;
            const entry = { analyser, data: new Float32Array(analyser.fftSize), level: 0, peak: 0.06 };
            taps.set(audio, entry);
            return entry;
        } catch (_) { taps.set(audio, null); return null; }
    }
    return {
        wake() { forkStageAudio.wake(); },
        level(audio) {
            if (audio?.browserSpeech) return browserSpeechMouth(audio);
            const entry = audio && !audio.paused ? tap(audio) : null;
            if (!entry) return 0;
            entry.analyser.getFloatTimeDomainData(entry.data);
            let sum = 0; for (let i = 0; i < entry.data.length; i++) sum += entry.data[i] * entry.data[i];
            const rms = Math.sqrt(sum / entry.data.length);
            // Automatic gain: loudness relative to this clip's recent peak, so quiet synthesized
            // voices still open the mouth fully on stressed syllables and close it in pauses.
            entry.peak = Math.max(rms, entry.peak * 0.995, 0.02);
            const relative = rms / entry.peak;
            const target = relative < 0.12 ? 0 : Math.min(1, Math.pow((relative - 0.12) / 0.7, 0.75));
            entry.level += (target - entry.level) * (target > entry.level ? 0.7 : 0.35);
            return entry.level < 0.05 ? 0 : entry.level;
        }
    };
})();

