import test from 'node:test'
import assert from 'node:assert/strict'
import {figureDirection, figureCarry, figureSceneUpdate, figureSceneFrame, resolveFigureSizing, figureDisplayCm} from '../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs'

const catalog = Object.fromEntries([['short',156],['peer',158],['tall',178]].map(([id,heightCm]) => [id, {'':[{heightCm,headRatio:1,elevationCm:0}]}]))
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`)
const source = 'a'.repeat(64)

test('accepted cast changes grow and shrink the ruler, with continuous eased frames', () => {
  const baseline = figureDirection({cast:['short','peer']},[],catalog)
  const entered = figureDirection({cast:['short','peer'],figureScale:figureCarry(baseline)},[{at:1,commands:[{op:'enter',id:'tall'}]}],catalog)
  const left = figureDirection({cast:['short','peer','tall'],figureScale:figureCarry(entered)},[{at:2,commands:[{op:'exit',id:'tall'}]}],catalog)
  assert.equal(baseline.hMax,158); assert.equal(entered.hMax,178); assert.equal(left.hMax,158)
  assert.equal(left.event.at,2); assert.equal(left.event.kind,'rescale')
  const resting = figureSceneUpdate(null,entered,0)
  const moving = figureSceneUpdate(resting,left,2000)
  near(figureSceneFrame(moving,2000).hMax,178)
  near(figureSceneFrame(moving,2600).hMax,168)
  near(figureSceneFrame(moving,3200).hMax,158)
  const noOp = figureDirection({cast:['short','peer'],figureScale:figureCarry(left)},[{at:3}],catalog)
  assert.equal(noOp.rescales,left.rescales); assert.equal(noOp.event,null)
})

// Two full-body sprite measurements from a real framing regression. No artwork or pack identity is required.
test('near-height sprites with different head proportions keep the same body framing', async () => {
  const {packFigureRecord} = await import('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')
  const {createStageSceneMath} = await import('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-math.cjs')
  const scale = await import('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')
  const colorMath = await import('../tavern-plugin/shared/color-math.cjs')
  const {galFigureLayout} = createStageSceneMath({figureScale:scale,colorMath})
  const rows = [
    {id:'a',heightCm:156,top:0.09895833333333333,chin:0.21744791666666666,feet:0.9420572916666666},
    {id:'b',heightCm:158,top:0.14192708333333334,chin:0.279296875,feet:0.9407552083333334},
  ]
  const bodies = Object.fromEntries(rows.map(r => [r.id,{cm:r.heightCm,headRatio:1,chinRatio:(r.feet-r.chin)/(r.feet-r.top)}]))
  for (const hMax of [178,158]) {
    const view = galFigureLayout({W:1920,H:1080,boxTop:820,hMax,groundRatio:1,cast:['a','b'],bodies})
    const results = rows.map(r => {
      const canvas=[1440,2160], anatomy={source:'estimated',assetScale:1,posture:'standing',crop:'full',poseHeightRatio:1,
        figureTop:r.top,headTop:r.top,chin:r.chin,feet:r.feet,visibleBottom:r.feet,supportX:0.5,headRatio:1}
      const input={heightCm:r.heightCm,source,anatomy}
      // Exercise the old per-figure override too: this fails on the previous layout (only b was rescued).
      const rescued=view.small?.includes(r.id)
      return resolveFigureSizing({...input,version:1,canvas,metrics:packFigureRecord(input,canvas),W:1920,H:1080,
        sceneHMax:hMax,sceneGroundRatio:1,occluderTop:820,fit:rescued?1:view.fit,
        fitTop:rescued?1080*scale.FIGURE_DISPLAY.HEAD_TOP:view.top,fitDrop:rescued?0:view.drop})
    })
    for (const r of results) assert.equal(r.mode,'physical')
    near(results[1].poseSpan/results[0].poseSpan,figureDisplayCm(158,hMax)/figureDisplayCm(156,hMax))
    const cuts=results.map(r => (820-r.restBounds.top)/r.poseSpan)
    assert.ok(Math.abs(cuts[0]-cuts[1])<0.02, `body cuts differ: ${cuts}`)
  }
})