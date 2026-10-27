// The core stage effects. The director names an effect
// (screen.play / screen.set, transition.play, title.play) and never tunes it; each name has one definition here with
// the engine's own default numbers. A skin's `effects` table and a card-local override (P3) merge over it, field by
// field: card/pack-local > skin > engine. One safety policy serves every source of flashes and shakes (scene beats,
// performance timelines, keyframe flash layers, the dice ritual, CG): CONFIG 「减少动态」 and 「光敏保护」 (default on),
// with a stage-wide gate of at most three flash starts per second. Pure; tests/stage-effects.test.mjs.

// The director's names (director-commands.cjs screen.play / screen.set enums; tests keep them equal).
const STAGE_EFFECT_BEATS = Object.freeze(['shake-1', 'shake-2', 'shake-3', 'flash', 'flash-red', 'glitch', 'shock', 'heartbeat', 'blackout']);
const STAGE_EFFECT_LOOKS = Object.freeze(['blur', 'bright', 'contrast', 'memory', 'vignette']);
// Engine defaults. Times are seconds, shake amplitudes a share of the stage height (the same feel in a small window
// and at 3840x2160), colours #rrggbb. A look is the stage look's params plus its own fade [in, out].
const STAGE_EFFECTS = Object.freeze({
    flash: { kind: 'flash', color: '#ffffff', peak: 0.85, in: 0.04, hold: 0.04, out: 0.32, tail: 0, cycles: 1, ease: 'out' },
    'flash-red': { kind: 'flash', color: '#d01030', peak: 0.55, in: 0.04, hold: 0.06, out: 0.42, tail: 0, cycles: 1, ease: 'out' },
    blackout: { kind: 'flash', color: '#000000', peak: 1, in: 0.45, hold: 0.35, out: 0.9, tail: 0, cycles: 1, ease: 'sine' },
    'shake-1': { kind: 'shake', amp: 0.004, ms: 450, target: 'screen' },
    'shake-2': { kind: 'shake', amp: 0.012, ms: 600, target: 'screen' },
    'shake-3': { kind: 'shake', amp: 0.022, ms: 750, target: 'screen' },
    // A white burst that leaves slowly, a wave out from the speaker's head (or the centre) and a small shake.
    shock: { kind: 'shock', flash: { color: '#ffffff', peak: 0.7, in: 0.06, hold: 0, out: 0.9, tail: 0, cycles: 1, ease: 'out' }, wave: true, waveMs: 1000, shake: 'shake-1' },
    glitch: { kind: 'glitch', ms: 420 },
    heartbeat: { kind: 'pulse', color: '#8a0010', vignette: 0.5, zoom: 0.03, ms: 1150 },
    blur: { kind: 'look', fade: [0.4, 0.5], params: { soften: 0.6, bloom: { amount: 0.25, threshold: 0.7, blur: 6 }, ui: 0.25 } },
    bright: { kind: 'look', fade: [0.3, 0.4], params: { lift: 0.1, gain: 1.04, saturation: 0.95, ui: 0.25 } },
    contrast: { kind: 'look', fade: [0.3, 0.4], params: { contrast: 1.35, lift: -0.05, saturation: 0.9, ui: 0.25 } },
    memory: { kind: 'look', fade: [0.6, 0.6], params: { saturation: 0.75, gain: [1.05, 0.92, 0.72], contrast: 0.95, grain: 0.25, vignette: { amount: 0.45, color: '#3a2412', softness: 0.6 }, ui: 0.25 } },
    vignette: { kind: 'look', fade: [0.4, 0.4], params: { vignette: { amount: 0.8, color: '#000000', softness: 0.45 }, ui: 0.25 } },
    // A scene change the director leaves unspecified; black / white covers take out / hold / in (null: the engine's own).
    transition: { kind: 'transition', default: 'fade', out: null, hold: null, in: null },
    // The inner-monologue backdrop while the line on screen is inner monologue: the background dims (an image when a skin
    // gives one, stretched to `over` x the screen), under the figures.
    thinking: { kind: 'thinking', dim: 0.2, vignette: 0.25, image: null, over: 1, fade: [0.15, 0.25] },
    title: { kind: 'title', in: 0.42, step: 0.105, hold: 1.4, out: 0.76 }
});
const stageEffectObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function stageEffectMerge(base, over) {
    if (!stageEffectObject(over)) return base;
    const out = Object.assign({}, base);
    for (const key of Object.keys(over)) out[key] = stageEffectObject(over[key]) && stageEffectObject(base[key]) ? stageEffectMerge(base[key], over[key]) : over[key];
    return out;
}
// The one resolver (rule 10): engine default <- the skin's effects[id] <- the card-local override. skin / local are
// `effects` tables keyed by effect id (already validated where they were written).
function stageEffectResolve(id, skin, local) {
    const base = Object.prototype.hasOwnProperty.call(STAGE_EFFECTS, id) ? STAGE_EFFECTS[id] : null;
    if (!base) return null;
    return stageEffectMerge(stageEffectMerge(base, skin && skin[id]), local && local[id]);
}

// ---- safety (CONFIG is authoritative, R20; the OS preference makes the stage calm: everything plays, flashes as 光敏保护)
function stageSafety(reading, osReduced) {
    const reducedMotion = !!reading && reading.reducedMotion === true, calm = !!osReduced && !reducedMotion;
    return { reducedMotion, calm, photosensitive: !reading || reading.photosensitive !== false || calm };
}
const stageEffectRgb = color => [1, 3, 5].map(i => parseInt(String(color).slice(i, i + 2), 16) / 255);
const stageEffectHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
function stageEffectLuma(color) { const [r, g, b] = stageEffectRgb(color); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
// Saturated red (the photosensitive trigger the guidelines single out), including the dark red 光敏保护 turns it into.
function stageEffectRed(color) { const [r, g, b] = stageEffectRgb(color); return r > 0.4 && r > g * 1.6 && r > b * 1.6; }
// A cover with no bright channel (blackout) dims rather than flashes: never limited, never counted. (Red is dark by
// luminance but not by this test: it still flashes.)
const stageFlashDark = flash => Math.max(...stageEffectRgb(flash.color)) < 0.25;
// 光敏保护: the colour stays, the intensity drops - white at most .5 with fades of at least 80 ms, saturated red turned
// dark at most .4, repeats merged into one.
function stageFlashSafe(flash, policy) {
    if (!policy || !policy.photosensitive || stageFlashDark(flash)) return flash;
    const red = stageEffectRed(flash.color);
    return Object.assign({}, flash, { color: red ? stageEffectHex(stageEffectRgb(flash.color).map(v => v * 0.55)) : flash.color, peak: Math.min(flash.peak == null ? 1 : flash.peak, red ? 0.4 : 0.5),
        in: Math.max(flash.in || 0, 0.08), out: Math.max(flash.out || 0, 0.08), tail: 0, cycles: 1 });
}
// The stage-wide flash gate under 光敏保护: at most three flash starts in any second, whatever plays them; a fourth is
// dropped (its sound still plays). Real time, shared by every caller.
const stageFlashGate = (() => {
    let starts = [];
    return {
        admit(policy, now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
            if (!policy || !policy.photosensitive) return true;
            starts = starts.filter(at => now - at < 1000 && now >= at);
            if (starts.length >= 3) return false;
            starts.push(now);
            return true;
        },
        reset() { starts = []; }
    };
})();
const stageEffectOutCubic = t => 1 - Math.pow(1 - t, 3);
// A flash's alpha at ms: in (linear), hold, out (ease: out = fast then slow, sine, linear), tail, `cycles` times.
// -1 once done.
function stageFlashAt(flash, ms) {
    const fadeIn = 1000 * (flash.in || 0), hold = 1000 * (flash.hold || 0), fadeOut = 1000 * (flash.out || 0), tail = 1000 * (flash.tail || 0);
    const cycle = fadeIn + hold + fadeOut + tail, cycles = Math.max(1, Math.min(3, Math.round(flash.cycles || 1))), peak = flash.peak == null ? 1 : flash.peak;
    if (ms < 0) return 0;
    if (cycle <= 0 || ms >= cycle * cycles - tail) return -1;
    const t = ms % cycle;
    const sine = v => 0.5 - 0.5 * Math.cos(Math.PI * v);
    if (t < fadeIn) return peak * (flash.ease === 'sine' ? sine(t / fadeIn) : t / fadeIn);
    if (t < fadeIn + hold) return peak;
    if (t < fadeIn + hold + fadeOut) {
        const u = (t - fadeIn - hold) / fadeOut;
        return peak * (flash.ease === 'linear' ? 1 - u : flash.ease === 'sine' ? 1 - sine(u) : 1 - stageEffectOutCubic(u));
    }
    return 0;
}
// A shake's offset in px at ms for a stage `H` px tall: a decaying pair of sines (amp x H, ms), or a skin's step path
// ([[x, y], ...] px of a design screen `screen` tall, one linear `step` s per point). done after the last point.
function stageShakeAt(shake, H, seed, ms) {
    if (shake.path) {
        const k = H / (shake.screen || 576), n = 1000 * shake.step, path = shake.path;
        if (!path.length || !(n > 0) || ms >= path.length * n) return { x: 0, y: 0, done: true };
        const t = Math.max(0, ms), i = Math.min(path.length - 1, Math.floor(t / n)), from = i === 0 ? [0, 0] : path[i - 1], to = path[i], f = (t - i * n) / n;
        return { x: k * (from[0] + (to[0] - from[0]) * f), y: k * (from[1] + (to[1] - from[1]) * f), done: false };
    }
    const t = ms / shake.ms;
    if (t >= 1 || t < 0) return { x: 0, y: 0, done: t >= 1 };
    const s = seed || 0, px = shake.amp * H, env = Math.pow(1 - t, 1.6) * Math.min(1, t * 12), sec = ms / 1000;
    return { x: px * env * (0.62 * Math.sin(2 * Math.PI * 17 * sec + s) + 0.38 * Math.sin(2 * Math.PI * 27 * sec + s * 2.3)),
        y: px * 0.6 * env * (0.6 * Math.sin(2 * Math.PI * 21 * sec + s * 1.7) + 0.4 * Math.sin(2 * Math.PI * 31 * sec + s * 3.1)), done: false };
}
// The heartbeat's two pulses at ms: { zoom, vignette } (zoom 0 under 减少动态).
function stagePulseAt(pulse, ms, reduced) {
    if (ms < 0 || ms >= pulse.ms) return { zoom: 0, vignette: 0, done: ms >= pulse.ms };
    const bump = (at, width) => { const u = (ms - at) / width; return u < 0 || u >= 1 ? 0 : u < 0.28 ? stageEffectOutCubic(u / 0.28) : 0.5 + 0.5 * Math.cos(Math.PI * (u - 0.28) / 0.72); };
    return { zoom: reduced ? 0 : pulse.zoom * (bump(0, 300) + 0.8 * bump(340, 300)), vignette: pulse.vignette * Math.max(bump(0, 520), 0.85 * bump(340, 700)), done: false };
}
// The glitch's burst strength at ms (three tears).
function stageGlitchAt(glitch, ms) {
    const t = ms / glitch.ms;
    if (t < 0 || t >= 1) return { strength: 0, done: t >= 1 };
    const hit = [[0, 0.17, 1], [0.27, 0.46, 0.8], [0.6, 0.94, 0.55]].find(([a, b]) => t >= a && t < b);
    return { strength: hit ? hit[2] : 0, done: false };
}
// A persistent screen look's fade (ms) entering (in) or leaving (out): 减少动态 and skipping at most 150 ms; a jump
// in brightness under 光敏保护 never faster than .3 s.
function stageLookFadeMs(look, entering, policy, skipping) {
    let ms = 1000 * (look && look.fade ? look.fade[entering ? 0 : 1] : 0.4);
    if (policy && policy.reducedMotion || skipping) ms = Math.min(ms, 150);
    if (policy && policy.photosensitive && entering && !skipping) ms = Math.max(ms, 300);
    return ms;
}
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = { STAGE_EFFECT_BEATS, STAGE_EFFECT_LOOKS, STAGE_EFFECTS, stageEffectResolve, stageSafety, stageEffectRed, stageEffectLuma, stageEffectRgb, stageEffectHex,
    stageFlashDark, stageFlashSafe, stageFlashGate, stageFlashAt, stageShakeAt, stagePulseAt, stageGlitchAt, stageLookFadeMs };
