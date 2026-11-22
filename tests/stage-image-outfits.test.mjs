import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture, answer} from './helpers/stage-director-harness.mjs'
import {modelCall} from './helpers/director-model-call.mjs'

const figure = {packId:'11111111-1111-4111-8111-111111111111',figureId:'22222222-2222-4222-8222-222222222222'}
const outfits = outfitKey => [{...figure,outfitKey}]

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
