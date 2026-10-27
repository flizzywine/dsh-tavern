// The core stage effects - one definition per id, one resolver
// (card-local > skin > engine, merged field by field), one safety policy and the stage-wide flash gate, and the timing
// functions every player shares (scene beats, performance timelines, keyframe flash layers, dice, CG).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fx = require('../tavern-plugin/src/client/stage-effects.cjs')
const commands = require('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs')
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('catalogue: the director enums are exactly the core ids; every id has one engine definition', () => {
  const field = (id, name) => commands.byName[id].schema({ actors: {}, dimensions: {}, catalogue: { candidates: {} } }).properties[name]
  assert.deepEqual([...field('screen.play', 'effect').enum].sort(), [...fx.STAGE_EFFECT_BEATS].sort())
  assert.deepEqual([...field('screen.set', 'look').enum].sort(), [...fx.STAGE_EFFECT_LOOKS].sort())
  assert.ok(commands.byName['screen.clear'])
  for (const id of [...fx.STAGE_EFFECT_BEATS, ...fx.STAGE_EFFECT_LOOKS, 'transition', 'thinking', 'title']) assert.ok(fx.STAGE_EFFECTS[id]?.kind, id)
  assert.equal(fx.STAGE_EFFECTS.blur.kind, 'look', 'blur is a screen state, not a one-shot')
  assert.equal(fx.stageEffectResolve('fade-in', null, null), null, 'retired prototype ids have no definition')
  assert.equal(fx.stageEffectResolve('skin-memory', null, null), null)
})

test('resolver: engine <- skin <- card-local, field by field; arrays and images replace whole', () => {
  const skin = { flash: { in: 0.05, hold: 0.05, out: 0.05, ease: 'linear' }, shock: { flash: { out: 1.3 } }, memory: { fade: [1, 1], params: { saturation: 0.5 } } }
  const local = { flash: { color: '#ffe0a0' }, shock: { shake: null }, memory: { params: { grain: 0 } } }
  const flash = fx.stageEffectResolve('flash', skin, local)
  assert.deepEqual([flash.color, flash.in, flash.out, flash.peak, flash.ease], ['#ffe0a0', 0.05, 0.05, fx.STAGE_EFFECTS.flash.peak, 'linear'])
  const shock = fx.stageEffectResolve('shock', skin, local)
  assert.equal(shock.flash.out, 1.3); assert.equal(shock.flash.in, fx.STAGE_EFFECTS.shock.flash.in); assert.equal(shock.shake, null)
  const memory = fx.stageEffectResolve('memory', skin, local)
  assert.deepEqual(memory.fade, [1, 1]); assert.equal(memory.params.saturation, 0.5); assert.equal(memory.params.grain, 0)
  assert.deepEqual(memory.params.gain, fx.STAGE_EFFECTS.memory.params.gain)
  assert.equal(fx.STAGE_EFFECTS.flash.in, 0.04, 'resolving never mutates the engine table')
  assert.deepEqual(fx.stageEffectResolve('heartbeat', null, null), fx.STAGE_EFFECTS.heartbeat)
})

test('safety: CONFIG is authoritative; the OS preference makes the stage calm (it plays, flashes as 光敏保护)', () => {
  assert.deepEqual(fx.stageSafety({ reducedMotion: false, photosensitive: true }, false), { reducedMotion: false, calm: false, photosensitive: true })
  assert.deepEqual(fx.stageSafety({ reducedMotion: false, photosensitive: false }, false), { reducedMotion: false, calm: false, photosensitive: false })
  assert.deepEqual(fx.stageSafety({ reducedMotion: false, photosensitive: false }, true), { reducedMotion: false, calm: true, photosensitive: true })
  assert.deepEqual(fx.stageSafety({ reducedMotion: true, photosensitive: false }, true), { reducedMotion: true, calm: false, photosensitive: false })
  assert.deepEqual(fx.stageSafety(null, false), { reducedMotion: false, calm: false, photosensitive: true }, 'default on')
})

test('光敏保护: a flash keeps its colour at a lower peak; saturated red goes dark; a dark cover is untouched', () => {
  const on = { photosensitive: true }
  const white = fx.stageFlashSafe(fx.STAGE_EFFECTS.flash, on)
  assert.equal(white.color, '#ffffff'); assert.equal(white.peak, 0.5); assert.ok(white.in >= 0.08 && white.out >= 0.08); assert.equal(white.cycles, 1)
  const red = fx.stageFlashSafe(fx.STAGE_EFFECTS['flash-red'], on)
  assert.ok(red.peak <= 0.4); assert.ok(fx.stageEffectLuma(red.color) < fx.stageEffectLuma(fx.STAGE_EFFECTS['flash-red'].color))
  assert.equal(fx.stageEffectRed('#d01030'), true); assert.equal(fx.stageEffectRed(red.color), true); assert.equal(fx.stageEffectRed('#ffffff'), false); assert.equal(fx.stageEffectRed('#ffe0a0'), false)
  assert.equal(fx.stageFlashDark(fx.STAGE_EFFECTS['flash-red']), false, 'a red flash is a flash, not a dark cover')
  assert.equal(fx.stageFlashDark(red), false)
  const burst = { color: '#ffffff', peak: 1, in: 0.05, hold: 0.05, out: 0.05, tail: 0, cycles: 2 }
  const merged = fx.stageFlashSafe(burst, on)
  assert.equal(merged.cycles, 1, 'repeats merge into one'); assert.equal(merged.in, 0.08)
  assert.equal(fx.stageFlashDark(fx.STAGE_EFFECTS.blackout), true)
  assert.equal(fx.stageFlashSafe(fx.STAGE_EFFECTS.blackout, on), fx.STAGE_EFFECTS.blackout)
  assert.equal(fx.stageFlashSafe(fx.STAGE_EFFECTS.flash, { photosensitive: false }), fx.STAGE_EFFECTS.flash)
})

test('gate: at most three flash starts in any second under 光敏保护, stage-wide; off admits all', () => {
  fx.stageFlashGate.reset()
  const on = { photosensitive: true }
  assert.deepEqual([0, 100, 200, 300, 999].map(t => fx.stageFlashGate.admit(on, t)), [true, true, true, false, false])
  assert.equal(fx.stageFlashGate.admit(on, 1001), true, 'the first start has left the window')
  fx.stageFlashGate.reset()
  assert.deepEqual([0, 1, 2, 3, 4].map(t => fx.stageFlashGate.admit({ photosensitive: false }, t)), [true, true, true, true, true])
  fx.stageFlashGate.reset()
})

test('flash timing: linear in, hold, eased out, tail, cycles; -1 once done', () => {
  const burst = { color: '#ffffff', peak: 1, in: 0.05, hold: 0.05, out: 0.05, tail: 0, cycles: 2, ease: 'linear' }
  close(fx.stageFlashAt(burst, 25), 0.5); close(fx.stageFlashAt(burst, 75), 1); close(fx.stageFlashAt(burst, 125), 0.5); close(fx.stageFlashAt(burst, 175), 0.5)
  assert.equal(fx.stageFlashAt(burst, 300), -1)
  const explosion = { color: '#ffffff', peak: 1, in: 0.1, out: 1.3, ease: 'linear' }
  close(fx.stageFlashAt(explosion, 100), 1); close(fx.stageFlashAt(explosion, 750), 0.5); assert.equal(fx.stageFlashAt(explosion, 1400), -1)
  const engine = fx.STAGE_EFFECTS.flash
  close(fx.stageFlashAt(engine, 60), engine.peak)
  assert.ok(fx.stageFlashAt(engine, 120) > 0.5 * engine.peak * 0.1 && fx.stageFlashAt(engine, 120) < engine.peak)
  assert.equal(fx.stageFlashAt(engine, 1000 * (engine.in + engine.hold + engine.out) + 1), -1)
  const black = fx.STAGE_EFFECTS.blackout
  close(fx.stageFlashAt(black, 1000 * black.in / 2), 0.5); close(fx.stageFlashAt(black, 1000 * (black.in + black.hold / 2)), 1)
})

test('shake: a share of the stage height (same feel at 720p and 4K) or a skin path on its design screen; ends at rest', () => {
  const spec = fx.STAGE_EFFECTS['shake-2']
  const peak = H => Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(fx.stageShakeAt(spec, H, 1, i * 10).x)))
  close(peak(2160) / peak(720), 3, 1e-9)
  assert.ok(peak(720) <= spec.amp * 720)
  assert.equal(fx.stageShakeAt(spec, 720, 1, spec.ms).done, true)
  const path = { path: [[2, 3], [-5, -9], [3, 6], [-3, -6], [0, 0]], step: 0.06, screen: 576 }
  const a = fx.stageShakeAt(path, 576, 0, 30); close(a.x, 1); close(a.y, 1.5)
  const b = fx.stageShakeAt(path, 1152, 0, 90); close(b.x, -3); close(b.y, -6)
  const end = fx.stageShakeAt(path, 576, 0, 300); assert.equal(end.done, true); assert.equal(end.x, 0)
})

test('heartbeat, glitch and look fades follow the policy', () => {
  const pulse = fx.STAGE_EFFECTS.heartbeat
  assert.ok(fx.stagePulseAt(pulse, 80, false).zoom > 0)
  assert.equal(fx.stagePulseAt(pulse, 80, true).zoom, 0, '减少动态 keeps the vignette, drops the zoom')
  assert.ok(fx.stagePulseAt(pulse, 80, true).vignette > 0)
  assert.equal(fx.stagePulseAt(pulse, pulse.ms, false).done, true)
  assert.equal(fx.stageGlitchAt(fx.STAGE_EFFECTS.glitch, 10).strength, 1)
  assert.equal(fx.stageGlitchAt(fx.STAGE_EFFECTS.glitch, 420).done, true)
  const memory = fx.STAGE_EFFECTS.memory
  assert.equal(fx.stageLookFadeMs(memory, true, { photosensitive: false }, false), 600)
  assert.equal(fx.stageLookFadeMs(memory, false, { reducedMotion: true }, false), 150)
  assert.equal(fx.stageLookFadeMs(memory, true, { photosensitive: false }, true), 150, 'skipping')
  assert.equal(fx.stageLookFadeMs({ fade: [0.1, 0.1] }, true, { photosensitive: true }, false), 300, 'a brightness jump never faster than .3 s')
})
