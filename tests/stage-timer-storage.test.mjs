import test from 'node:test'
import assert from 'node:assert/strict'
import {STAGE_TIMER_FIELD,stageTimerSaved,stageTimerFacts,stageTimerProgress} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mods/timer/stage-service.js'
test('existing timer checkpoints and facts retain branch and generation boundaries', () => {
  assert.equal(STAGE_TIMER_FIELD,'stageTimerV1')
  const checkpoint = {instanceId:'timer-1',remainingMs:12000}
  const saved = {source:{branchId:'branch-a',generation:2},checkpoint,events:[{turn:1,fact:'time expired'},{turn:2,fact:'unrelated'}]}
  const row = {role:'assistant',turn:1,stageDirectionGeneration:2,[STAGE_TIMER_FIELD]:saved}
  const chat = {timeline:{branchId:'branch-a'},messages:[row]}
  assert.equal(stageTimerSaved(chat,{instanceId:'timer-1'},1),saved)
  assert.equal(stageTimerProgress(chat,2),checkpoint)
  assert.deepEqual(stageTimerFacts(chat,2),['time expired'])
  for (const other of [
    {...chat,timeline:{branchId:'branch-b'}},
    {...chat,messages:[{...row,stageDirectionGeneration:3}]},
  ]) {
    assert.equal(stageTimerSaved(other,{instanceId:'timer-1'},1),null)
    assert.equal(stageTimerProgress(other,2),null)
    assert.deepEqual(stageTimerFacts(other,2),[])
  }
  assert.equal(stageTimerSaved(chat,{instanceId:'different-timer'},1),null)
})
