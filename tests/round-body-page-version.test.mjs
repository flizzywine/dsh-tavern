import test from 'node:test'
import assert from 'node:assert/strict'
import {roundBody} from '../tavern-plugin/lib/domain/round-body.js'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'

// A committed new round has the same director units as its stream; older rounds keep version 1.
test('reply bodies follow the stored stage page version', async () => {
  const text = '雨水敲着窗。\n\n她推门进来。'
  const chat = {id:'chat',timeline:{branchId:'branch'},messages:[
    {role:'assistant',turn:1,text},
    {role:'assistant',turn:2,text,stagePageVersion:2}]}
  const view = await createIncrementalReplyView().project(structuredClone(chat))
  const [old, current] = view.projections.map(row => row.body)
  assert.equal(old.displayUnits.some(unit => unit.pageVersion), false)
  assert.deepEqual(current.displayUnits, roundBody([{kind:'markdown',text}], {streaming:true}).displayUnits)
})
