// pack-projected audio; no catalogue owner.
// One page-wide one-shot player, with at most six concurrent sounds.
// a one-shot rings out across page turns, so a mis-tagged long asset is
// capped here, the single SE authority: it plays at most playMs, then fades out over fadeMs.
const STAGE_SFX_CAP = Object.freeze({playMs: 10000, fadeMs: 500});
const stageSfx = (function () {
    const listeners = new Set(), shots = new Set();
    const emit = () => listeners.forEach(fn => fn());
    const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
    const level = (node, value) => forkStageAudio.level(node, value);
    let thunderUrl = "", lastThunder = 0;
    function oneShot(url, gain, identity, ref, token, authored) {
        // A one-shot that would start while DSH Tavern is not in front is dropped, never queued (foreground.js);
        // one already sounding pauses where it is and resumes on return.
        if (!url || shots.size >= 6 || !forkForeground.isAudible()) return Promise.resolve();
        let finish;
        const completion = new Promise(resolve => { finish = resolve; });
        const node = new Audio(url);
        node.resourceIdentity = identity; node.resourceRef = ref; node.eventToken = token;
        // The audio trace's source (audio-trace.cjs): authored.trace from the caller (a director event's op key,
        // the weather's thunder, a dice beat), else a plain SE.
        const trace = {reason: token != null ? 'event' : 'sfx', ref, label: authored?.name, ...authored?.trace};
        forkStageAudio.bind(node, "sfx", url, {identity, ...authored, trace}); level(node, gain == null ? 1 : gain);
        shots.add(node);
        const base = gain == null ? 1 : gain, steps = 10;
        // The cap counts the sound's own time: a shot paused in the background keeps its remainder.
        let step = 0, timer = forkForeground.setTimeout(function cap() {
            const left = STAGE_SFX_CAP.playMs - node.currentTime * 1000;
            timer = left > 50 ? forkForeground.setTimeout(cap, left) : forkForeground.setTimeout(function fade() {
                if (step >= steps) { done(); return; }
                level(node, base * (1 - ++step / steps));
                timer = forkForeground.setTimeout(fade, STAGE_SFX_CAP.fadeMs / steps);
            }, 0);
        }, STAGE_SFX_CAP.playMs);
        const done = () => {
            if (!shots.delete(node)) return;
            forkForeground.clearTimeout(timer);
            node.removeEventListener("ended", done); node.removeEventListener("error", done);
            forkStageAudio.release(node);
            node.pause(); node.removeAttribute("src"); finish();
        };
        node.releaseShot = done;
        node.addEventListener("ended", done, { once: true }); node.addEventListener("error", done, { once: true });
        node.play().catch(done);
        return completion;
    }
    return {
        subscribe(fn) { listeners.add(fn); const off = forkStageAudio.subscribe(fn); return () => { listeners.delete(fn); off(); }; },
        get: () => { const prefs = forkStageAudio.get(); return { volume: prefs.sfx, muted: !!prefs.muted.sfx }; },
        // media identity is distinct from each legitimate event/play.
        play(url, identity, ref, token, gain = 1, authored) { return oneShot(url, gain, identity, ref, token, authored); },
        stopToken(token) { shots.forEach(node => { if (node.eventToken === token) node.releaseShot(); }); },
        setThunder(url) { thunderUrl = url || ""; },
        thunder(strength) {
            const now = forkForeground.now();
            if (!thunderUrl || now - lastThunder < 2500) return;
            lastThunder = now;
            const url = thunderUrl;
            forkForeground.setTimeout(() => { if (url === thunderUrl) oneShot(url, 0.55 + 0.35 * clamp(strength), undefined, undefined, undefined, {trace: {reason: 'weather-thunder'}}); }, 250 + Math.random() * 900);
        },
        stop(scope) {
            shots.forEach(node => { if (!scope || stageResourceMatches(node.resourceRef,scope)) node.releaseShot(); });
            if (!scope || scope.authority) thunderUrl = ""; emit();
        },
        setVolume(value) { forkStageAudio.setVolume("sfx", value); },
        toggleMute() { forkStageAudio.toggleMute("sfx"); }
    };
})();
// the old top-bar sound control was removed (CONFIG / mixer own it).
