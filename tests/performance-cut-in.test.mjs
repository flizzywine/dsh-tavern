// A once cut-in (an objection, a time-up card) set during a held performance (a debate) plays over it and the debate
// carries on: the canonical state keeps the debate (its skin mode, shot and countdown), `cutIn` marks the one page the
// cut-in plays on, and the stage rests on the debate again once the cut-in ends.
import test from 'node:test'
import assert from 'node:assert/strict'
import {foldPerformanceAt} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/performance-projection.js'

const debateRef = {packId:'pack', kind:'performances', assetId:'debate'}
const objectionRef = {packId:'pack', kind:'performances', assetId:'objection'}
const skinRef = {packId:'pack', kind:'skins', assetId:'trial'}
const debate = {packs:{}, skinMode:'debate', timeline:{entry:{events:[{at:0, do:'skin', ref:'self:trial'}]}, exit:{events:[{at:0, do:'skin-off'}]}},
  keyframes:{playback:'persistent', entry:{durationMs:1000}, exit:{durationMs:1000}, layers:[]}}
const objection = {packs:{}, timeline:{entry:{events:[{at:0, do:'sfx', ref:'self:bang'}]}, exit:{events:[]}},
  keyframes:{playback:'once', entry:{durationMs:3300}, layers:[]}}
const documents = {debate, objection, trial:{overlay:null, levels:{1:{}}}, bang:{}}
const resolveDocument = ref => documents[ref.assetId] || null
const at = (turn, page) => ({turn, page})

// Mirrors the live turn 24: debate set on page 0, Ema's objection on page 8, the debate ended on page 71.
function record() {
  const held = {ref:debateRef, level:1, startedAt:at(24, 0), phase:'entry'}
  const cut = {...held, cutIn:{ref:objectionRef, level:1, startedAt:at(24, 8)}}
  const entries = [
    {at:1, ops:[{op:'performance.set', ref:debateRef, level:1}], state:{performance:held}},
    {at:9, ops:[{op:'performance.set', ref:objectionRef, level:1}], state:{performance:cut}},
    {at:72, ops:[{op:'performance.off'}], state:{performance:{...held, startedAt:at(24, 71), phase:'exit'}}}]
  return {binding:{commandSpecVersion:4, target:{turn:24, sourceKey:'turn-24', branchId:'branch'}, generation:0}, baseline:{music:null}, entries}
}
const fold = index => foldPerformanceAt({checked:record(), turn:24, resolveDocument, page:{index, para:index + 1, offset:0, version:1}})

test('projection: the cut-in page plays the objection over the debate, every other page rests on the debate', () => {
  const opening = fold(0)
  assert.deepEqual([opening.ref, opening.phase], [debateRef, 'entry'])
  const cut = fold(8)
  assert.deepEqual([cut.ref, cut.phase, cut.retiring], [objectionRef, 'entry', null], 'the objection plays and the debate does not exit')
  assert.deepEqual(cut.instanceKey, opening.instanceKey, 'the same debate instance: its music and widgets stay')
  assert.notDeepEqual(cut.phaseKey, opening.phaseKey, 'the cut-in has its own phase')
  assert.deepEqual([cut.resume.ref, cut.resume.phase, cut.resume.phaseKey], [debateRef, 'idle', opening.phaseKey])
  assert.deepEqual(cut.sustained.skin.ref, skinRef, 'the debate skin stays on during the cut-in')
  assert.deepEqual(performanceSustainedSkin(cut.plan), skinRef, 'the cut-in phase ends on the debate layer')
  assert.equal(cut.plan.events.length, 1, 'only the objection entry plays')
  for (const index of [9, 40, 70]) {
    const value = fold(index)
    assert.deepEqual([value.ref, value.phase, value.resume], [debateRef, 'idle', undefined], 'page ' + index + ' is back in the debate')
    assert.deepEqual(value.sustained.skin.ref, skinRef)
  }
  assert.deepEqual([fold(71).ref, fold(71).phase], [debateRef, 'exit'])
  assert.equal(fold(72), null)
})
const performanceSustainedSkin = plan => plan.sustainedEvents.filter(event => event.do === 'skin').at(-1)?.ref
