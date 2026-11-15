import test from 'node:test'
import assert from 'node:assert/strict'
import {stageImageOutfits} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-image-outfits.js'
import {initialAssetPackStage} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-tools.js'
import {fixture, answer} from './helpers/stage-director-harness.mjs'
import {modelCall} from './helpers/director-model-call.mjs'

const figure = {packId:'11111111-1111-4111-8111-111111111111',figureId:'22222222-2222-4222-8222-222222222222'}
const state = outfitKey => {
  const value = initialAssetPackStage({actor:{figure, outfits:[{key:outfitKey}]}})
  return value
}
const outfits = outfitKey => [{...figure,outfitKey}]

test('pictures use the outfit at their anchor paragraph in recorded and preview stages', () => {
  const checked = {baseline:state('casual'),entries:[{at:2,state:state('kimono')}]}
  const paragraphs = [{para:1,text:'林月坐在桥边。'},{para:2,text:'林月换上和服。'}]
  for (const kind of ['record','preview']) {
    const direction = {[kind]:checked,body:{paragraphs}}
    assert.deepEqual(stageImageOutfits(direction, '**林月坐在桥边。**'), outfits('casual'))
    assert.deepEqual(stageImageOutfits(direction, '林月换上和服。'), outfits('kimono'))
    assert.deepEqual(stageImageOutfits(direction), outfits('kimono'), 'unanchored picture closes the round')
  }
  assert.deepEqual(stageImageOutfits({preview:checked,displayUnits:paragraphs}, '林月坐在桥边。'), outfits('casual'), 'streaming envelopes carry displayUnits')
  assert.deepEqual(stageImageOutfits({baseline:state('kimono'),body:{paragraphs}}, paragraphs[0].text), outfits('kimono'))
})

test('read-only direction retains the previous accepted stage before this round has a director record', async t => {
  const f = await fixture(async request => modelCall(request,{name:'stage_update',arguments:answer}))
  t.after(() => f.dispose())
  await f.director.get(f.read(),1)
  await f.director.drain()
  const first = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.ok(first.record, first.error)
  f.appendReply(2)
  const direction = await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(direction.record,undefined)
  assert.equal(direction.preview,undefined)
  assert.deepEqual(direction.baseline,first.record.end)
  assert.equal(f.calls.length,1,'reading outfits does not start the next director')
})
