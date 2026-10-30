// galgame UI cues for the stage — menu / CONFIG / backlog /
// dialogs / choices. Eight Kenney CC0 one-shots (tavern-plugin/lib/client-assets/ui-sfx/CREDITS.md), a few KB each,
// fetched once and decoded once into AudioBuffers. Sources join the page mixer's ui bus, at SFX ducking priority.
// The mixer alone applies normalization, sliders, ducking and foreground volume.

const UI_SFX_BASE = "/api/dsh-tavern/client-assets/ui-sfx/";
// cue -> [relative gain, minimum interval between two plays of this cue in ms]. The files are levelled to the same
// RMS; the relative gain only keeps the frequent cues (hover, toggles) further back.
const UI_SFX_CUES = Object.freeze({
    open: [0.9, 120], close: [0.9, 120], move: [0.4, 70], confirm: [1, 90],
    cancel: [0.9, 90], toggle: [0.7, 60], choice: [0.8, 600]
});
// the stage moments only a skin's sound palette voices (the engine keeps them
// silent and ships no file). They are stage-driven, not gestures: their own interval only, outside the gesture gate.
// A page turn and a speaker change have no cue at all: they would nag over thousands of clicks and
// step on the voice line's start.
const UI_SFX_SKIN_CUES = Object.freeze({ type: [0.35, 30], auto: [0.8, 120], skip: [0.8, 120] });
// Authored cue trim; mute/zero avoids starting inaudible cues. Sliders belong to the mixer. Pure.
function uiSfxGain(prefs, cue) {
    const spec = UI_SFX_CUES[cue];
    if (!spec || !prefs) return 0;
    const level = layer => prefs.muted && prefs.muted[layer] ? 0 : Math.max(0, Math.min(1, Number(prefs[layer]) || 0));
    return level("ui") > 0 && level("master") > 0 ? spec[0] : 0;
}
// Rate limit; mutates gate = { at: {}, last }. A cue repeated inside its own interval is dropped. One gesture often
// reaches two handlers (menu 「设置」 confirms, then CONFIG opens): the first non-hover cue wins for 60 ms. A hover
// right after any other cue (150 ms) is dropped, so moving onto a control never stacks on its click. Pure.
function uiSfxAllow(gate, cue, now) {
    const spec = UI_SFX_CUES[cue];
    if (!spec) return false;
    if (now - (gate.at[cue] ?? -Infinity) < spec[1]) return false;
    if (now - (gate.last ?? -Infinity) < (cue === "move" ? 150 : 60)) return false;
    gate.at[cue] = now;
    if (cue !== "move") gate.last = now;
    return true;
}
// The cue a click on a stage panel control makes, for delegated panels (CONFIG, mixer, BGM player, dialogs).
// An explicit data-ui-sfx wins ("" = none); tabs confirm; radios / switches / pressed toggles toggle (not when
// already on). Native inputs are left to their change event (forkUiSfxBind). Pure apart from the DOM reads.
function uiSfxControlCue(target) {
    const control = target && target.closest ? target.closest("button, input, [role=tab], [role=radio], [role=switch], [data-ui-sfx]") : null;
    if (!control || control.disabled || control.getAttribute("aria-disabled") === "true") return null;
    const explicit = control.getAttribute("data-ui-sfx");
    if (explicit !== null) return Object.hasOwn(UI_SFX_CUES, explicit) ? explicit : null;
    if (control.tagName === "INPUT") return null;
    const role = control.getAttribute("role");
    if (role === "tab") return control.getAttribute("aria-selected") === "true" ? null : "confirm";
    if (role === "radio" || role === "switch") return role === "radio" && control.getAttribute("aria-checked") === "true" ? null : "toggle";
    return control.hasAttribute("aria-pressed") ? "toggle" : null;
}
// the shared Slider (role=slider) fires `change` on release / key step too.
function uiSfxChangeCue(target) {
    const slider = Boolean(target && target.getAttribute && target.getAttribute("role") === "slider");
    if (!target || (target.tagName !== "INPUT" && !slider) || target.disabled || (slider && target.getAttribute("aria-disabled") === "true")) return null;
    const explicit = target.getAttribute("data-ui-sfx");
    if (explicit !== null) return Object.hasOwn(UI_SFX_CUES, explicit) ? explicit : null;
    if (slider) return "toggle";
    // A range's change fires on release (pointer) or per step (keys): the release cue doubles as a level preview.
    return ["range", "radio", "checkbox"].includes(target.type) ? "toggle" : null;
}

function createUiSfx(env) {
    const gate = { at: {}, last: -Infinity }, buffers = new Map(), voices = new Set();
    // The shown skin's palette (stageSkinSfx: cue -> {url, gain, every, pitch}) and the type cue's glyph count.
    let palette = null, typed = 0;
    let context = null, decoder = null;
    const loading = new Map();
    // Each cue is fetched once. A cue played before the preload fetches only its own file: the stage's open cue must
    // not bring the other seven into the entry's six connections (the full preload follows the reveal).
    function load(cues = Object.keys(UI_SFX_CUES)) {
        const Offline = env.OfflineAudioContext;
        if (!Offline || typeof env.fetch !== "function") return Promise.resolve();
        // Decode off the real context: no AudioContext before a gesture; AudioBuffers play in any context.
        decoder ||= new Offline(1, 1, 48000);
        return Promise.all(cues.map(cue => {
            if (!loading.has(cue)) loading.set(cue, env.fetch(cue.includes("/") ? cue : UI_SFX_BASE + cue + ".ogg")
                .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
                .then(bytes => decoder.decodeAudioData(bytes)).then(buffer => { buffers.set(cue, buffer); }, () => {}));
            return loading.get(cue);
        }));
    }
    function ensure() {
        context = env.mixer?.musicContext();
        return context;
    }
    function start(cue, gain, pitch = 0, loudness = { v: 1, lufs: -10, peak: 0 }) {
        const buffer = buffers.get(cue);
        if (!buffer || !context || voices.size >= 4) return false;
        const skin = cue.includes("/");
        const route = env.mixer.bufferInput("ui", { loudness, gainDb: 20 * Math.log10(gain), duration: buffer.duration,
            trace: { reason: skin ? "skin" : "ui", label: skin ? undefined : cue }, url: skin ? cue : "" });
        if (!route) return false;
        const source = context.createBufferSource();
        source.buffer = buffer;
        if (pitch) source.playbackRate.value = 1 + (env.random() * 2 - 1) * pitch;
        source.connect(route.input);
        voices.add(source);
        source.onended = () => { voices.delete(source); source.disconnect(); route.release(); };
        source.start();
        return true;
    }
    const api = {
        preload: () => load(),
        // Plays a cue now (or as soon as the files arrive, if that is within 250 ms). Returns whether it was accepted.
        // The skin's palette while its stage shows (null: the engine's cues only). Its files load at once (no gesture
        // needed to decode); a skin cue replaces the engine's, and only a skin voices the stage cues.
        useSkin(cues) {
            palette = cues || null; typed = 0;
            if (palette) void load(Object.values(palette).map(cue => cue.url));
        },
        play(cue) {
            if (env.foreground && !env.foreground.isAudible()) return false;
            const own = palette && palette[cue], moment = UI_SFX_SKIN_CUES[cue];
            if (moment && !own) return false;
            // type: one cue in every `every` glyph steps
            if (cue === "type" && typed++ % own.every !== 0) return false;
            const gain = (moment ? uiSfxGain(env.prefs(), "confirm") * moment[0] : uiSfxGain(env.prefs(), cue)) * (own ? own.gain : 1);
            if (!(gain > 0)) return false;
            const now = env.now();
            if (moment) { if (now - (gate.at[cue] ?? -Infinity) < moment[1]) return false; gate.at[cue] = now; }
            if (!moment && !uiSfxAllow(gate, cue, now) || !ensure()) return false;
            const key = own ? own.url : cue, pitch = own ? own.pitch : 0;
            if (!start(key, gain, pitch, own?.loudness)) void load([key]).then(() => { if (env.now() - now < 250) start(key, gain, pitch, own?.loudness); });
            return true;
        },
        bind(node) {
            if (!node || !node.addEventListener) return () => {};
            // After the control's own handler: a cue for un-muting 界面音效 is heard, one for muting 总音量 is not,
            // and an explicit cue from that handler (a panel closing) wins the gesture.
            const later = cue => { if (cue) setTimeout(() => api.play(cue), 0); };
            const click = event => later(uiSfxControlCue(event.target));
            const change = event => later(uiSfxChangeCue(event.target));
            node.addEventListener("click", click, true);
            node.addEventListener("change", change, true);
            return () => { node.removeEventListener("click", click, true); node.removeEventListener("change", change, true); };
        }
    };
    return api;
}
const forkUiSfx = createUiSfx({
    foreground: typeof forkForeground !== "undefined" ? forkForeground : null,
    mixer: typeof forkStageAudio !== "undefined" ? forkStageAudio : null,
    OfflineAudioContext: typeof window !== "undefined" ? window.OfflineAudioContext || window.webkitOfflineAudioContext : undefined,
    fetch: typeof fetch === "function" ? (...args) => fetch(...args) : undefined,
    prefs: () => forkStageAudio.get(),
    now: () => typeof performance !== "undefined" ? performance.now() : Date.now(),
    random: Math.random
});
// Delegated cues for a stage panel's controls while it is mounted (uiSfxControlCue / uiSfxChangeCue).
function useForkUiSfxControls(ref, active) {
    React.useEffect(() => active === false ? undefined : forkUiSfx.bind(ref.current), [active]);
}
