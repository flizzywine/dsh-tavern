// Dormant until a caller explicitly constructs and applies a player. No global mixer ownership.
// apply(v1 plan, {snap}) reconciles place/weather; empty/invalid plans hush owned audio.
// stop() releases immediately; dispose() also makes the instance inert. resume() is for a
// user gesture (wakes the shared mixer and retries blocked playback). The caller owns visibility
// and turn lifecycles. snapshot() returns frozen diagnostics, never media nodes or Error objects.
function createSoundscapePlayer(deps) {
    const { Audio, mixer } = deps;
    const now = deps.now || (() => performance.now());
    // audio fades use a wall-clock scheduler, not visibility-paused RAF.
    const requestFrame = deps.requestFrame || (fn => setTimeout(fn, 16));
    const cancelFrame = deps.cancelFrame || (id => clearTimeout(id));
    // performance: the stage performance's own ambience layer (stage-ambience.cjs), beside the scene's place/weather.
    const slots = { place: { current: null, outgoing: null }, weather: { current: null, outgoing: null }, performance: { current: null, outgoing: null } };
    const duration = 1200, openCutoff = 24000;
    let frame = null, disposed = false, warnings = [];
    const settled = new Set();
    function acknowledge() { for (const resolve of settled) resolve(); settled.clear(); }
    const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512) : '';
    function validUrl(value) {
        if (typeof value !== 'string' || !value || value.length > 4096 || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
        if (/^blob:/.test(value)) return value;
        if (!/^\/(?!\/)/.test(value) && !/^https?:\/\//i.test(value)) return null;
        try {
            const parsed = new URL(value, 'https://soundscape.invalid');
            if (parsed.username || parsed.password || parsed.hash) return null;
            return /^\//.test(value) ? parsed.pathname + parsed.search : parsed.href;
        } catch (_) { return null; }
    }
    function validate(plan) {
        if (!plan || plan.version !== 1) return { error: 'unsupported-plan' };
        if (!Array.isArray(plan.layers) || plan.layers.length > 3) return { error: 'invalid-layers' };
        const seenSlots = new Set(), identities = new Set(), layers = [];
        for (const layer of plan.layers) {
            if (!layer || !Object.hasOwn(slots, layer.slot) || seenSlots.has(layer.slot)) return { error: 'invalid-slot' };
            const url = validUrl(layer.url);
            if (!url) return { error: 'invalid-url' };
            if (identities.has(layer.identity)) return { error: 'duplicate-identity' };
            if (!Number.isFinite(layer.gain) || layer.gain < 0 || layer.gain > 1 ||
                (layer.lowpassHz != null && (!Number.isFinite(layer.lowpassHz) || layer.lowpassHz < 0))) return { error: 'invalid-config' };
            seenSlots.add(layer.slot); identities.add(layer.identity);
            // the entry's authored 音量 (mixer gain; default 1), separate from the fade gain.
            layers.push({ slot: layer.slot, id: text(layer.id), identity:layer.identity, url, gain: layer.gain, volume: Number.isFinite(layer.volume) ? Math.max(0, Math.min(1, layer.volume)) : 1,
                lowpassHz: layer.lowpassHz ? Math.max(20, Math.min(openCutoff, layer.lowpassHz)) : null, ...(layer.loudness ? { loudness: layer.loudness } : {}),
                // The audio trace's source (audio-trace.cjs): the entry and its name.
                ...(layer.ref ? { ref: layer.ref } : {}), ...(layer.name ? { name: text(layer.name) } : {}) });
        }
        return { layers };
    }
    function cleanupAll(tasks) {
        const errors = [];
        for (const task of tasks) {try {task();} catch (error) {errors.push(error);}}
        if (errors.length) throw new AggregateError(errors, 'Soundscape cleanup failed');
    }
    function clearMedia(node) {
        cleanupAll([() => node.pause(), () => node.removeAttribute('src'), () => node.load()]);
    }
    function release(track) {
        if (!track || !track.alive) return;
        track.alive = false; track.ticket++;
        cleanupAll([
            () => track.node.removeEventListener('error', track.onError),
            () => mixer.level(track.node, 0), () => clearMedia(track.node),
            () => {if (typeof mixer.release === 'function') mixer.release(track.node);}
        ]);
    }
    function play(track) {
        if (!track.alive || track.status === 'pending' || track.status === 'playing') return;
        const ticket = ++track.ticket;
        track.status = 'pending'; track.error = null;
        const failed = () => {
            if (!disposed && track.alive && track.ticket === ticket) { track.status = 'error'; track.error = 'play-rejected'; }
        };
        try {
            Promise.resolve(track.node.play()).then(() => {
                if (!track.alive) { clearMedia(track.node); return; }
                if (!disposed && track.ticket === ticket) { track.status = 'playing'; track.error = null; }
            }, failed);
        } catch (_) { failed(); }
    }
    function create(layer) {
        const node = new Audio();
        node.loop = true; node.preload = 'auto'; node.volume = 0;
        const track = { ...layer, node, alive: true, ticket: 0, status: 'idle', error: null,
            cutoff: layer.lowpassHz, transition: null };
        track.onError = () => { if (track.alive) { track.ticket++; track.status = 'error'; track.error = 'media-error'; } };
        node.addEventListener('error', track.onError);
        try {
            node.src = layer.url;
            mixer.bind(node, 'ambience', layer.url, { volume: layer.volume, identity: layer.identity, loudness: layer.loudness,
                trace: { reason: 'ambience:' + layer.slot, ref: layer.ref, label: layer.name || layer.id } }); mixer.level(node, 0);
            if (layer.lowpassHz && typeof mixer.filter === 'function') mixer.filter(node, layer.lowpassHz);
            play(track);
        } catch (_) { release(track); throw new Error('audio-init-failed'); }
        return track;
    }
    function setCutoff(track, value) {
        if (track.cutoff === value) return;
        track.cutoff = value;
        if (typeof mixer.filter === 'function') mixer.filter(track.node, value);
    }
    function target(track, gain, cutoff, snap) {
        if (snap) {
            track.transition = null; mixer.level(track.node, gain); setCutoff(track, cutoff); return;
        }
        track.transition = { at: now(), from: mixer.level(track.node), to: gain, cutoffFrom: track.cutoff, cutoffTo: cutoff };
    }
    function step() {
        frame = null;
        if (disposed) return;
        for (const slot of Object.values(slots)) for (const key of ['current', 'outgoing']) {
            const track = slot[key], fade = track && track.transition;
            if (!fade) continue;
            const t = Math.max(0, Math.min(1, (now() - fade.at) / duration));
            mixer.level(track.node, fade.from + (fade.to - fade.from) * t);
            if (fade.cutoffFrom !== fade.cutoffTo) setCutoff(track, t === 1 ? fade.cutoffTo :
                (fade.cutoffFrom || openCutoff) + ((fade.cutoffTo || openCutoff) - (fade.cutoffFrom || openCutoff)) * t);
            if (t === 1) {
                track.transition = null;
                if (key === 'outgoing') { release(track); slot[key] = null; }
            }
        }
        schedule();
    }
    function schedule() {
        const moving = Object.values(slots).some(slot => slot.current?.transition || slot.outgoing?.transition);
        if (moving && frame === null) frame = requestFrame(step);
        else if (!moving && frame !== null) { cancelFrame(frame); frame = null; }
        if (!moving) acknowledge();
    }
    function apply(plan, { snap = false } = {}) {
        if (disposed) return snapshot();
        const checked = validate(plan), layers = checked.layers || [];
        warnings = checked.error ? [checked.error] : (Array.isArray(plan.warnings) ? plan.warnings.slice(0, 32).map(text).filter(Boolean) : []);
        if (checked.error && plan && typeof mixer.traceFailure === 'function') mixer.traceFailure('ambience', '', { reason: 'ambience-plan' }, checked.error);
        // A content handle moving between slots must not overlap itself during either slot's fade.
        for (const [name, slot] of Object.entries(slots)) for (const key of ['current', 'outgoing']) {
            if (slot[key] && layers.some(layer => layer.slot !== name && layer.identity === slot[key].identity)) {
                release(slot[key]); slot[key] = null;
            }
        }
        for (const [name, slot] of Object.entries(slots)) {
            const layer = layers.find(item => item.slot === name), current = slot.current;
            if (layer && current && current.identity === layer.identity) {
                if (current.gain !== layer.gain || current.lowpassHz !== layer.lowpassHz || snap) target(current, layer.gain, layer.lowpassHz, snap);
                if (current.volume !== layer.volume && typeof mixer.trim === 'function') mixer.trim(current.node, layer.volume);
                current.url = layer.url; current.id = layer.id; current.gain = layer.gain; current.volume = layer.volume; current.lowpassHz = layer.lowpassHz;
                play(current);
                if (snap) { release(slot.outgoing); slot.outgoing = null; }
                continue;
            }
            if (!layer && !current) {
                if (snap) { release(slot.outgoing); slot.outgoing = null; }
                continue;
            }
            release(slot.outgoing); slot.outgoing = current; slot.current = null;
            if (current) {
                if (snap) { release(current); slot.outgoing = null; }
                else target(current, 0, current.cutoff, false);
            }
            if (layer) {
                try { slot.current = create(layer); target(slot.current, layer.gain, layer.lowpassHz, snap); }
                catch (_) { warnings.push('audio-init-failed'); }
            }
        }
        schedule(); return snapshot();
    }
    function stop() {
        const pendingFrame = frame; frame = null;
        const tracks = Object.values(slots).flatMap(slot => {
            const owned = [slot.current, slot.outgoing]; slot.current = slot.outgoing = null; return owned;
        });
        cleanupAll([
            () => {if (pendingFrame !== null) cancelFrame(pendingFrame);},
            ...tracks.map(track => () => release(track)), acknowledge
        ]);
    }
    function snapshot() {
        const describe = track => track && Object.freeze({ slot: track.slot, id: track.id, url: track.url,
            gain: track.gain, level: mixer.level(track.node), lowpassHz: track.lowpassHz,
            status: track.status, error: track.error, transitioning: !!track.transition });
        return Object.freeze({ disposed, warnings: Object.freeze([...warnings]), slots: Object.freeze(
            Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, Object.freeze({ current: describe(slot.current), outgoing: describe(slot.outgoing) })]))) });
    }
    return {
        apply, stop, snapshot,
        whenSettled() { return frame === null ? Promise.resolve() : new Promise(resolve => settled.add(resolve)); },
        dispose() { if (!disposed) { disposed = true; stop(); } },
        resume() {
            if (!disposed) {
                if (typeof mixer.wake === 'function') mixer.wake();
                for (const slot of Object.values(slots)) if (slot.current) play(slot.current);
            }
            return snapshot();
        }
    };
}
if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports = { createSoundscapePlayer };
