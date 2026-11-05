// 舞台借用 focus on the stage: the focus actor takes the speaker's light and steps forward (the 'lean' body act held at its
// peak), the others dim, removing focus restores the directed figures; a phone stands the plan's first priority.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {createStageCastLayout} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/cast-layout.cjs')
const {stageFocusStep} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene.cjs')
const {createStageSceneMath} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-math.cjs')
const math = createStageSceneMath({colorMath:require('../tavern-plugin/shared/color-math.cjs'), figureScale:require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')})

const figure = (alias, extra) => ({key:'k-' + alias, kind:'static', alias, x:0.5, shade:0.94, speaking:false, ...extra})
const layoutOwner = () => createStageCastLayout({calculate:math.galFigureLayout, mix:math.galFrameMix}).create()

test('the focus actor is lit like a speaker and the others dim; without focus the figures are as directed', () => {
  const view = layoutOwner()
  const directed = [figure('char-a', {shade:1, speaking:true}), figure('char-b'), figure('char-c')]
  const leased = [{...directed[0], dim:true}, {...directed[1], focus:true}, {...directed[2], dim:true}]
  const lit = view.project(leased, null)
  assert.deepEqual(lit.map(item => item.shade), [0.8, 1, 0.8], 'focus at the speaker shade, the speaker and listener at the listener shade')
  assert.equal(lit[1].focus, true)
  const restored = view.project(directed, null)
  assert.deepEqual(restored, directed, 'no focus: the directed figures unchanged')
  restored.forEach((item, index) => assert.equal(item, directed[index]))
  view.dispose()
})

test('the step forward is the lean act at its peak, eased by the focus spring, and none without focus', () => {
  const peak = math.galBodyActAt('lean', 0.5)
  assert.ok(peak.zoom > 1 && peak.dy > 0, 'lean comes nearer: larger and lower')
  assert.deepEqual(stageFocusStep(0, math.galBodyActAt), {zoom:1, dy:0})
  assert.deepEqual(stageFocusStep(1, math.galBodyActAt), {zoom:peak.zoom, dy:peak.dy})
  const half = stageFocusStep(0.5, math.galBodyActAt)
  assert.ok(Math.abs(half.zoom - (1 + (peak.zoom - 1) / 2)) < 1e-12 && Math.abs(half.dy - peak.dy / 2) < 1e-12)
})

test('on a phone the standing figure is the focus actor, else the speaker; parked figures lose focus and dim', () => {
  const view = layoutOwner(), cast = ['char-a', 'char-b', 'char-c']
  const figures = [figure('char-a', {speaking:true, dim:true}), figure('char-b', {focus:true}), figure('char-c', {dim:true})]
  const plan = {cast, priority:['char-b', 'char-a', 'char-c']}
  const {layout} = view.update({plan, figures, W:390, H:844, now:0, top:600, ruler:null, loaded:0, crops:{}, bodies:{}, instant:true})
  assert.deepEqual(layout.visible, ['char-b'])
  const shown = view.project(figures, layout)
  assert.equal(shown[1].visible, undefined)
  assert.equal(shown[1].shade, 1)
  for (const parked of [shown[0], shown[2]]) assert.deepEqual([parked.parked, parked.focus, parked.dim, parked.speaking], [true, false, false, false])
  // focus removed: the speaker stands again
  const released = figures.map(({focus, dim, ...rest}) => rest)
  const next = view.update({plan:{cast, priority:['char-a', 'char-b', 'char-c']}, figures:released, W:390, H:844, now:16, top:600, ruler:null, loaded:0, crops:{}, bodies:{}, instant:true})
  assert.deepEqual(next.layout.visible, ['char-a'])
  view.dispose()
})
