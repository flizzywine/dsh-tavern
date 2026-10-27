// 画面效果 (cast-presentation.md 35/N): the director names an effect (screen.play `effect`) and never tunes it. Each name has
// one definition here, the engine's own numbers; a skin's `effects[id]` (stage-skin.js, validated when it was written) merges
// over it field by field. Times are seconds, shake amplitudes a share of the stage height (the same feel in a small window
// and at 4K), colours #rrggbb. Flashes are always photosensitive-safe (there is no switch to turn that off).
// Shared by the host and the browser (@include-domain): no imports, no host or DOM access.

const STAGE_SCREEN_EFFECT_DEFAULTS = Object.freeze({
  flash: { kind: 'flash', color: '#ffffff', peak: 0.85, in: 0.04, hold: 0.04, out: 0.32, tail: 0, cycles: 1, ease: 'out' },
  'flash-red': { kind: 'flash', color: '#d01030', peak: 0.55, in: 0.04, hold: 0.06, out: 0.42, tail: 0, cycles: 1, ease: 'out' },
  blackout: { kind: 'flash', color: '#000000', peak: 1, in: 0.45, hold: 0.35, out: 0.9, tail: 0, cycles: 1, ease: 'sine' },
  'shake-1': { kind: 'shake', amp: 0.004, ms: 450, target: 'screen' },
  'shake-2': { kind: 'shake', amp: 0.012, ms: 600, target: 'screen' },
  'shake-3': { kind: 'shake', amp: 0.022, ms: 750, target: 'screen' },
  // A white burst that leaves slowly, a wave out from the centre and a small shake.
  shock: { kind: 'shock', flash: { color: '#ffffff', peak: 0.7, in: 0.06, hold: 0, out: 0.9, tail: 0, cycles: 1, ease: 'out' }, wave: true, waveMs: 1000, shake: 'shake-1' },
  glitch: { kind: 'glitch', ms: 420 },
  heartbeat: { kind: 'pulse', color: '#8a0010', vignette: 0.5, zoom: 0.03, ms: 1150 }
})
const stageEffectObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function stageEffectMerge(base, over) {
  if (!stageEffectObject(over)) return base
  const out = { ...base }
  for (const key of Object.keys(over)) out[key] = stageEffectObject(over[key]) && stageEffectObject(base[key]) ? stageEffectMerge(base[key], over[key]) : over[key]
  return out
}
// The one resolver: the engine's default <- the skin's effects[id]; null for a name that is not in the catalogue.
function stageScreenEffectResolve(id, skinEffects) {
  return Object.hasOwn(STAGE_SCREEN_EFFECT_DEFAULTS, id) ? stageEffectMerge(STAGE_SCREEN_EFFECT_DEFAULTS[id], skinEffects && skinEffects[id]) : null
}

const stageEffectRgb = color => [1, 3, 5].map(i => parseInt(String(color).slice(i, i + 2), 16) / 255)
const stageEffectHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
// Saturated red, the photosensitive trigger the guidelines single out.
function stageEffectRed(color) { const [r, g, b] = stageEffectRgb(color); return r > 0.4 && r > g * 1.6 && r > b * 1.6 }
// A cover with no bright channel (blackout) dims rather than flashes: never softened, never counted.
const stageFlashDark = flash => Math.max(...stageEffectRgb(flash.color)) < 0.25
// Photosensitive-safe: the colour stays, the intensity drops - white at most .5 with fades of at least 80 ms, saturated red
// turned dark at most .4, repeats merged into one.
function stageFlashSafe(flash) {
  if (stageFlashDark(flash)) return flash
  const red = stageEffectRed(flash.color)
  return { ...flash, color: red ? stageEffectHex(stageEffectRgb(flash.color).map(v => v * 0.55)) : flash.color, peak: Math.min(flash.peak ?? 1, red ? 0.4 : 0.5),
    in: Math.max(flash.in || 0, 0.08), out: Math.max(flash.out || 0, 0.08), tail: 0, cycles: 1 }
}
// The stage-wide gate: at most three flash starts in any second, whatever plays them; a fourth is dropped.
function createStageFlashGate() {
  let starts = []
  return {
    admit(now) {
      starts = starts.filter(at => now - at < 1000 && now >= at)
      if (starts.length >= 3) return false
      starts.push(now)
      return true
    }
  }
}
const stageEffectOutCubic = t => 1 - Math.pow(1 - t, 3)
// How long a flash shows, in ms (its last tail is not waited for).
function stageFlashMs(flash) {
  const cycle = 1000 * ((flash.in || 0) + (flash.hold || 0) + (flash.out || 0) + (flash.tail || 0))
  return cycle * Math.max(1, Math.min(3, Math.round(flash.cycles || 1))) - 1000 * (flash.tail || 0)
}
// A flash's alpha at ms: in (linear, or sine), hold, out (ease: out = fast then slow, sine, linear), tail, `cycles` times.
function stageFlashAt(flash, ms) {
  const fadeIn = 1000 * (flash.in || 0), hold = 1000 * (flash.hold || 0), fadeOut = 1000 * (flash.out || 0), cycle = fadeIn + hold + fadeOut + 1000 * (flash.tail || 0), peak = flash.peak ?? 1
  if (ms < 0 || cycle <= 0 || ms >= stageFlashMs(flash)) return 0
  const t = ms % cycle, sine = v => 0.5 - 0.5 * Math.cos(Math.PI * v)
  if (t < fadeIn) return peak * (flash.ease === 'sine' ? sine(t / fadeIn) : t / fadeIn)
  if (t < fadeIn + hold) return peak
  if (t < fadeIn + hold + fadeOut) {
    const u = (t - fadeIn - hold) / fadeOut
    return peak * (flash.ease === 'linear' ? 1 - u : flash.ease === 'sine' ? 1 - sine(u) : 1 - stageEffectOutCubic(u))
  }
  return 0
}
// A shake's offset in px at ms for a stage `H` px tall: a decaying pair of sines (amp x H over ms), or a skin's step path
// ([[x, y], ...] px of a design screen `screen` px tall, one linear `step` s per point).
const stageShakeMs = shake => shake.path ? 1000 * shake.step * shake.path.length : shake.ms
function stageShakeAt(shake, H, seed, ms) {
  if (ms < 0 || ms >= stageShakeMs(shake)) return { x: 0, y: 0 }
  if (shake.path) {
    const k = H / (shake.screen || 576), n = 1000 * shake.step, i = Math.floor(ms / n), from = i === 0 ? [0, 0] : shake.path[i - 1], to = shake.path[i], f = (ms - i * n) / n
    return { x: k * (from[0] + (to[0] - from[0]) * f), y: k * (from[1] + (to[1] - from[1]) * f) }
  }
  const t = ms / shake.ms, s = seed || 0, px = shake.amp * H, env = Math.pow(1 - t, 1.6) * Math.min(1, t * 12), sec = ms / 1000
  return { x: px * env * (0.62 * Math.sin(2 * Math.PI * 17 * sec + s) + 0.38 * Math.sin(2 * Math.PI * 27 * sec + s * 2.3)),
    y: px * 0.6 * env * (0.6 * Math.sin(2 * Math.PI * 21 * sec + s * 1.7) + 0.4 * Math.sin(2 * Math.PI * 31 * sec + s * 3.1)) }
}
// The heartbeat's two pulses at ms: { zoom, vignette }.
function stagePulseAt(pulse, ms) {
  if (ms < 0 || ms >= pulse.ms) return { zoom: 0, vignette: 0 }
  const bump = (at, width) => { const u = (ms - at) / width; return u < 0 || u >= 1 ? 0 : u < 0.28 ? stageEffectOutCubic(u / 0.28) : 0.5 + 0.5 * Math.cos(Math.PI * (u - 0.28) / 0.72) }
  return { zoom: pulse.zoom * (bump(0, 300) + 0.8 * bump(340, 300)), vignette: pulse.vignette * Math.max(bump(0, 520), 0.85 * bump(340, 700)) }
}
// The glitch's burst strength at ms (three tears).
function stageGlitchAt(glitch, ms) {
  const t = ms / glitch.ms
  return [[0, 0.17, 1], [0.27, 0.46, 0.8], [0.6, 0.94, 0.55]].find(([a, b]) => t >= a && t < b)?.[2] || 0
}

export { STAGE_SCREEN_EFFECT_DEFAULTS, stageScreenEffectResolve, stageEffectRed, stageFlashDark, stageFlashSafe, createStageFlashGate,
  stageFlashMs, stageFlashAt, stageShakeMs, stageShakeAt, stagePulseAt, stageGlitchAt }
