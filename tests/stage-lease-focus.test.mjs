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


test('the step forward is the lean act at its peak, eased by the focus spring, and none without focus', () => {
  const peak = math.galBodyActAt('lean', 0.5)
  assert.ok(peak.zoom > 1 && peak.dy > 0, 'lean comes nearer: larger and lower')
  assert.deepEqual(stageFocusStep(0, math.galBodyActAt), {zoom:1, dy:0})
  assert.deepEqual(stageFocusStep(1, math.galBodyActAt), {zoom:peak.zoom, dy:peak.dy})
  const half = stageFocusStep(0.5, math.galBodyActAt)
  assert.ok(Math.abs(half.zoom - (1 + (peak.zoom - 1) / 2)) < 1e-12 && Math.abs(half.dy - peak.dy / 2) < 1e-12)
})
