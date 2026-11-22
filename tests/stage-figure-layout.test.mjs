// Stage figure layout and camera: default slots, the default framing, the phone cap, shared framing, head
// centring, and the handheld frame rate / resolution.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const scale = require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')
const {createStageSceneMath} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-math.cjs')
const {galResolution} = require('../tavern-plugin/shared/canvas-resolution.cjs')
const {stageSkinFigures} = require('../tavern-plugin/src/client/gal-stage-helpers.cjs')
const {galFigureLayout: layout, galSlots, galCentredAnatomy, galFrameRate, GAL_FIGURE_FIT: FIT, GAL_DEFAULT_FRAMING: DEFAULT} =
  createStageSceneMath({colorMath: require('../tavern-plugin/shared/color-math.cjs'), figureScale: scale})

const CAST = ['madoka', 'homura', 'mami', 'kyoko']

test('portrait draws the speaker alone at the lone size unless the skin declares phoneFigures', () => {
  for (const [W, H] of [[390, 844], [360, 640]]) for (let n = 1; n <= 4; n++) {
    const cast = CAST.slice(0, n), speaker = cast[n - 1], name = `${W}x${H} n=${n}`
    const r = layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast, priority: [speaker]})
    const alone = layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast: [speaker], priority: [speaker]})
    assert.deepEqual(r, alone, name)
    assert.deepEqual(r.x, {[speaker]: 0.5}, name)
    assert.ok(alone.head * FIT.bodyHeads <= W + 1e-6, name + ': fits the width')
    const two = layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast, priority: [speaker], phone: 2})
    assert.equal(two.count, Math.min(n, 2), name)
    assert.deepEqual([two.fit, two.head], [alone.fit, alone.head], name + ': the lone size')
    assert.equal(layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast, priority: [speaker], phone: 3, max: 1}).count, 1, name + ': maxFigures caps it')
  }
  assert.deepEqual(stageSkinFigures(undefined).phone, 1)
  assert.deepEqual(stageSkinFigures({phoneFigures: 2}).phone, 2)
  // A bust-window skin has no bust on a phone: there the speaker stands at the default framing.
  const bust = {figures: {mode: 'none', scale: 2}, art: {portrait: {bust: {}}}}
  assert.deepEqual([stageSkinFigures(bust).shown, stageSkinFigures(bust, true).shown, stageSkinFigures(bust, true).framing], [false, true, undefined])
})
