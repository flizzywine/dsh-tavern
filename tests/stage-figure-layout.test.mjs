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
const SLOTS = {1: [0.5], 2: [0.25, 0.75], 3: [1 / 6, 0.5, 5 / 6], 4: [0.7 / 4.4, 1.7 / 4.4, 2.7 / 4.4, 3.7 / 4.4]}
const near = (actual, expected, name) => {
  assert.equal(actual.length, expected.length, name)
  actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) < 1e-9, `${name} #${i}: ${x} != ${expected[i]}`))
}

test('default slots spread two to four figures over the width: equal gaps, half a gap to the edges (0.7 for four)', () => {
  for (let n = 1; n <= 6; n++) {
    const slots = galSlots(n), gap = n > 1 ? slots[1] - slots[0] : null, edge = n >= 4 ? 0.7 : 0.5
    if (SLOTS[n]) near(slots, SLOTS[n], 'n=' + n)
    slots.slice(1).forEach((x, i) => assert.ok(Math.abs(x - slots[i] - gap) < 1e-12, 'n=' + n + ': equal gaps'))
    if (n > 1) assert.ok(Math.abs(slots[0] - edge * gap) < 1e-12 && Math.abs(1 - slots.at(-1) - edge * gap) < 1e-12, 'n=' + n)
    assert.deepEqual(galSlots(n, {[n]: [0.42]}), [0.42], 'a skin\'s own slots win')
  }
  for (const [W, H] of [[1920, 1080], [2560, 1440], [2560, 1080]]) for (const n of [2, 3, 4]) {
    const cast = CAST.slice(0, n), name = `${W}x${H} n=${n}`
    const r = layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 1, cast, priority: cast, max: 4})
    assert.equal(r.count, n, name)
    assert.equal(r.fit, DEFAULT.scale, name + ': the default camera, unshrunk')
    near(cast.map(id => r.x[id]), SLOTS[n], name)
    const x = cast.map(id => r.x[id] * W)
    x.slice(1).forEach((v, i) => assert.ok(v - x[i] >= r.head * 1.5, name + ': neighbours a head and a half apart'))
  }
})

test('without a skin framing the stage uses the default close camera', () => {
  const r = layout({W: 1920, H: 1080, boxTop: 820, hMax: 158, groundRatio: 1, cast: ['madoka', 'mami'], priority: ['mami']})
  assert.equal(r.framed, false)
  assert.equal(r.fit, DEFAULT.scale)
  assert.equal(r.top, 1080 * DEFAULT.top)
  const framed = layout({W: 1920, H: 1080, boxTop: 820, hMax: 158, groundRatio: 1, cast: ['madoka', 'mami'], priority: ['mami'], framing: {scale: 1.6, top: 0.09}})
  assert.ok(framed.framed && framed.fit === 1.6 && framed.top === 0.09 * 1080)
})

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

test('a very short figure shares the cast camera instead of changing its own zoom', () => {
  const base = {W: 1920, H: 1080, boxTop: 820, hMax: 158, groundRatio: 1, cast: ['tall', 'tiny'], priority: ['tall']}
  const bodies = {tall: {cm: 158, headRatio: 0.98, chinRatio: 0.82}, tiny: {cm: 60, headRatio: 0.98, chinRatio: 0.55}}
  assert.deepEqual(layout({...base, bodies}), layout(base))
  assert.equal(layout({...base, bodies, framing: {scale: 1.6, top: 0.09}}).fit, 1.6, 'a skin\'s framing is kept')
})

test('a pack figure stands on its head\'s centre', () => {
  const anatomy = {headTop: 0.15, chin: 0.47, feet: 0.94, supportX: 0.512}
  const centred = galCentredAnatomy(anatomy, [2000, 3000], a => { assert.equal(a, anatomy); return 960 })
  assert.equal(centred.supportX, 0.48)
  assert.ok(Math.abs(centred.faceRect[0] + centred.faceRect[2] / 2 - 0.48) < 1e-12 && Math.abs(centred.faceRect[2] * 2000 - 0.32 * 3000) < 1e-9)
  const faced = galCentredAnatomy({...anatomy, faceRect: [0.3, 0.15, 0.3, 0.32]}, [2000, 3000], () => assert.fail('measured'))
  assert.ok(Math.abs(faced.supportX - 0.45) < 1e-12)
  assert.equal(galCentredAnatomy(anatomy, [2000, 3000], () => undefined), anatomy)
  assert.equal(galCentredAnatomy(null, [2000, 3000], () => 960), null)
})

test('a handheld phone caps at 30 fps unless the reader chose a cap, and renders at DPR 2 at most', () => {
  assert.equal(galFrameRate('high', true, 120, null, false), 60)
  assert.equal(galFrameRate('high', true, 120, null, true), 30)
  assert.equal(galFrameRate('high', true, 120, 120, true), 120)
  assert.equal(galFrameRate('high', true, 120, 0, true), 0)
  assert.equal(galFrameRate('low', true, 120, 120, false), 30)
  assert.equal(galResolution('high', 3, true), 2)
  assert.equal(galResolution('high', 3, false), 3)
  assert.equal(galResolution('low', 3, true), 1)
})
