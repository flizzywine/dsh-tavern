// 画面效果 (cast-presentation.md 35/N): the director names one of nine screen effects, the skin's `effects` decides how it looks
// over the engine's default, every flash is photosensitive-safe and the system's reduced motion leaves out movement
// (domain/stage-effects.js, modules/stage-effects.js). The submit tool reads a name tolerantly once. The real stage is
// exercised in tests/e2e/stage-screen-effects.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import * as effects from '../tavern-plugin/lib/domain/stage-effects.js'
import { acceptStagePerformances, repairStagePerformances, stagePages } from '../tavern-plugin/lib/domain/stage-performance.js'
import { STAGE_DATA_OWNER, STAGE_UPDATE_TOOL } from '../tavern-plugin/lib/domain/stage-director.js'
import { BUILTIN_STAGE_SKINS, validateStageSkin } from '../tavern-plugin/lib/domain/stage-skin.js'
import { stageDirectorFixture } from './helpers/stage-director-fixture.mjs'

const { STAGE_SCREEN_EFFECTS, stageScreenEffectResolve, stageFlashSafe, createStageFlashGate, stageFlashAt, stageShakeAt } = effects
const tracks = vm.runInNewContext(readFileSync(new URL('../tavern-plugin/src/client/modules/stage-effects.js', import.meta.url), 'utf8') + '; stageScreenEffectTracks', { ...effects })
const tracksOf = (spec, options) => JSON.parse(JSON.stringify(tracks(spec, options)))
const env = (more = {}) => ({ W: 1600, H: 900, reduced: false, flash: true, screen: 576, random: () => 0.5, ...more })
const peak = track => Math.max(...track.frames.map(frame => frame.opacity))
const layers = tracks => tracks.map(track => track.layer)
const chat = () => ({ id: 'story', sessionId: 'game', mode: 'story', timeline: { branchId: 'branch', revision: 2 }, messages: [
  { role: 'assistant', turn: 1, text: 'Opening.' }, { role: 'assistant', turn: 2, text: 'A crash.\nThe lights die.' }] })
const assets = { player: 'Reader', cast: [{ name: 'Nora' }], background: [{ name: 'Hall' }], music: [{ name: 'Theme' }] }

test('the director names one of nine effects, and a skin may restyle every one of them', () => {
  assert.deepEqual(STAGE_SCREEN_EFFECTS, ['shake-1', 'shake-2', 'shake-3', 'flash', 'flash-red', 'glitch', 'shock', 'heartbeat', 'blackout'])
  const screen = STAGE_UPDATE_TOOL.parameters.properties.performances.items.oneOf.find(kind => kind.properties.op.const === 'screen.play')
  assert.deepEqual(screen.properties.effect.enum, STAGE_SCREEN_EFFECTS)
  const pages = stagePages('One.\nTwo.')
  for (const effect of STAGE_SCREEN_EFFECTS) {
    assert.equal(acceptStagePerformances([{ at: 1, op: 'screen.play', effect }], pages, { figures: [] }).length, 1)
    assert.ok(stageScreenEffectResolve(effect, null), effect + ' has an engine default')
  }
  assert.equal(stageScreenEffectResolve('blur', null), null, 'a name outside the catalogue has no definition')
  // The skin's table merges field by field over the default, nested values too; the skin contract already accepts it.
  const table = { flash: { color: '#20c0ff' }, shock: { flash: { out: 0.4 }, shake: 'shake-3' }, 'shake-2': { path: [[4, 0], [-4, 0]], step: 0.05, target: 'background' } }
  validateStageSkin({ ...structuredClone(BUILTIN_STAGE_SKINS.classic), id: 'fx-sample', label: '示例', effects: table })
  assert.deepEqual(stageScreenEffectResolve('flash', table), { ...effects.STAGE_SCREEN_EFFECT_DEFAULTS.flash, color: '#20c0ff' })
  const shock = stageScreenEffectResolve('shock', table)
  assert.equal(shock.flash.out, 0.4); assert.equal(shock.flash.peak, 0.7); assert.equal(shock.shake, 'shake-3')
})

test('every flash is photosensitive-safe and the stage starts at most three in any second', () => {
  const white = stageFlashSafe(stageScreenEffectResolve('flash'))
  assert.equal(white.peak, 0.5); assert.ok(white.in >= 0.08 && white.out >= 0.08)
  const red = stageFlashSafe({ ...stageScreenEffectResolve('flash-red'), peak: 1, cycles: 3, tail: 0.2 })
  assert.equal(red.peak, 0.4); assert.equal(red.cycles, 1); assert.equal(red.tail, 0); assert.equal(red.color, '#72091a', 'saturated red turns dark')
  const black = stageScreenEffectResolve('blackout')
  assert.equal(stageFlashSafe(black), black, 'a dark cover is not a flash')
  const gate = createStageFlashGate()
  assert.deepEqual([0, 100, 200, 300, 999, 1001].map(at => gate.admit(at)), [true, true, true, false, false, true])
  assert.equal(stageFlashAt(white, 60), 0.5 * 60 / 80); assert.equal(stageFlashAt(white, 10000), 0)
})

test('the tracks: a white burst never past .5, reduced motion keeps only what does not move, the skin path on its design screen', () => {
  const flash = tracksOf(stageScreenEffectResolve('flash'), env())
  assert.deepEqual(layers(flash), ['cover']); assert.equal(peak(flash[0]), 0.5); assert.equal(flash[0].frames.at(-1).opacity, 0)
  assert.deepEqual(tracksOf(stageScreenEffectResolve('flash'), env({ flash: false })), [], 'a flash the gate turned away plays nothing')
  const shake = tracksOf(stageScreenEffectResolve('shake-3'), env())
  assert.deepEqual(layers(shake), ['world', 'box'])
  const x = track => Math.max(...track.frames.map(frame => Math.abs(parseFloat(frame.translate))))
  assert.ok(x(shake[0]) > 5 && Math.abs(x(shake[1]) - x(shake[0]) / 2) < 0.02, 'the text box follows at half')
  assert.equal(shake[0].frames.at(-1).translate, '0.00px 0.00px')
  const path = stageScreenEffectResolve('shake-2', { 'shake-2': { path: [[4, 0], [-4, 0]], step: 0.05, target: 'background' } })
  const background = tracksOf(path, env())
  assert.deepEqual(layers(background), ['backdrop']); assert.equal(background[0].ms, 100)
  assert.equal(stageShakeAt({ ...path, screen: 576 }, 900, 0, 50).x, 4 * 900 / 576)
  const shock = stageScreenEffectResolve('shock')
  assert.deepEqual(layers(tracksOf(shock, env({ shake: stageScreenEffectResolve('shake-1') }))), ['cover', 'world', 'box', 'wave'])
  assert.deepEqual(layers(tracksOf(stageScreenEffectResolve('heartbeat'), env())), ['vignette', 'zoom'])
  assert.deepEqual(layers(tracksOf(stageScreenEffectResolve('glitch'), env())), ['tear', 'split'])
  // The system's reduced motion: no shake, zoom, glitch or wave; flashes still show, softened.
  const reduced = env({ reduced: true, shake: stageScreenEffectResolve('shake-1') })
  for (const name of ['shake-1', 'shake-2', 'shake-3', 'glitch']) assert.deepEqual(tracksOf(stageScreenEffectResolve(name), reduced), [], name)
  assert.deepEqual(layers(tracksOf(shock, reduced)), ['cover'])
  assert.deepEqual(layers(tracksOf(stageScreenEffectResolve('heartbeat'), reduced)), ['vignette'])
  assert.deepEqual(layers(tracksOf(stageScreenEffectResolve('blackout'), reduced)), ['cover'])
})

test('the submit tool accepts a name written differently, offers a resendable near name, and otherwise lists the names', async () => {
  const repaired = repairStagePerformances([{ at: 1, op: 'screen.play', effect: 'Shake 3' }, { at: 2, op: 'screen.play', effect: '红闪' }, { at: 2, op: 'screen.play', effect: 'shake' }, { at: 1, op: 'screen.play', effect: 'ＦＬＡＳＨ' }])
  assert.deepEqual(repaired.value.map(event => event.effect), ['shake-3', 'flash-red', 'shake-2', 'flash'])
  assert.deepEqual(repaired.normalized[0], { path: '$.performances[0].effect', received: 'Shake 3', used: 'shake-3' })
  const h = await stageDirectorFixture(chat(), assets)
  const request = await h.prepare()
  assert.match(request.system, /screen\.play 的 effect 从列出的画面效果里选/)
  const near = await request.call({ performances: [{ at: 1, op: 'screen.play', effect: 'red-flash' }] })
  assert.deepEqual(near.didYouMean, { at: 1, op: 'screen.play', effect: 'flash-red' }); assert.equal(near.retryable, true)
  assert.deepEqual((await request.call({ performances: [{ at: 2, op: 'screen.blackout' }] })).didYouMean, { at: 2, op: 'screen.play', effect: 'blackout' })
  const unknown = await request.call({ performances: [{ at: 1, op: 'screen.play', effect: 'sparkle' }] })
  assert.equal(unknown.didYouMean, undefined); assert.match(unknown.error, /screen\.play \+ shake-1\/shake-2\/shake-3\/flash\/flash-red\/glitch\/shock\/heartbeat\/blackout/)
  const accepted = await request.call({ performances: [{ at: 1, op: 'screen.play', effect: 'Flash' }, { at: 2, op: 'screen.play', effect: '眼前一黑' }] })
  assert.deepEqual(accepted, { ok: true, normalized: [{ path: '$.performances[0].effect', received: 'Flash', used: 'flash' }, { path: '$.performances[1].effect', received: '眼前一黑', used: 'blackout' }] })
  const saved = (await h.data.snapshot('story')).owners[STAGE_DATA_OWNER].turns[0].data.performances
  assert.deepEqual(saved.map(event => event.effect), ['flash', 'blackout'], 'the record holds the ids alone')
})
