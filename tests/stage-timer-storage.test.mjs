import test from 'node:test'
import assert from 'node:assert/strict'
import {STAGE_TIMER_FIELD,stageTimerSaved,stageTimerFacts,stageTimerProgress} from '../tavern-plugin/mods/timer/host/stage-service.js'
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

test('clock disposal drains a queued open before closing leases and refuses new work', async () => {
  const {createStageTimerClock} = await import('../tavern-plugin/mods/timer/host/stage-clock.js')
  let releaseRead, first = true, reads = 0
  const blocked = new Promise(resolve => {releaseRead=resolve})
  const writes = []
  const timer = {instanceId:'t',revision:1,status:'running',durationMs:10000,remainingMs:10000}
  let chat = {id:'chat',_storageRevision:1,timeline:{branchId:'b'},messages:[{
    role:'assistant',turn:1,stageDirectionGeneration:0,stageTimerV1:{
      source:{branchId:'b',generation:0,turn:1},revision:1,at:1,highWater:1,clockTimer:timer,
      checkpoint:{instanceId:'t',remainingMs:10000,durationMs:10000,status:'running'},
      clockEvents:[],frames:{},events:[],
    },
  }]}
  const clock = createStageTimerClock({
    readChat:async () => {reads++;if(first){first=false;await blocked}return chat},
    readDirection:async () => ({token:{generation:0,sourceKey:'k'}}),
    enabled:async () => true,now:() => 100,owner:'owner',savedBudget:() => null,
    patchChat:async (_,revision,patches) => {
      assert.equal(revision,chat._storageRevision)
      const saved = patches[0].value
      writes.push(saved)
      chat = {...chat,_storageRevision:revision+1,messages:[{...chat.messages[0],stageTimerV1:saved}]}
      return true
    },
  })
  const opening = clock.update({sessionId:'s',action:'open',lease:'l'})
  const stopping = clock.dispose()
  assert.equal(clock.dispose(),stopping)
  await assert.rejects(clock.update({sessionId:'s',action:'open',lease:'late'}),{code:'RESOURCE_DISPOSED'})
  releaseRead()
  await opening
  await stopping
  assert.equal(writes[0].checkpoint.clock.open,true)
  assert.equal(writes.at(-1).checkpoint.clock.open,false)
  const before = reads
  await assert.rejects(clock.update({sessionId:'s',action:'sample',lease:'l'}),{code:'RESOURCE_DISPOSED'})
  assert.equal(reads,before)
})

test('the timer joins the stage through its own stage.js: saved field, catalogue fragments and its stage service', async () => {
  await import('../tavern-plugin/lib/mod-builtins.js')
  const {modStageContribution} = await import('../tavern-plugin/lib/domain/mods/stage-contributions.js')
  const {stageReadFloorFields} = await import('../tavern-plugin/lib/domain/stage-read-projection.js')
  const timer = modStageContribution('dsh.timer')
  assert.deepEqual(timer.floorFields, [STAGE_TIMER_FIELD])
  assert.ok(stageReadFloorFields().includes(STAGE_TIMER_FIELD))
  assert.deepEqual(timer.catalogueFragments({packs:[]}), [])
  const extension = timer.hostExtension({stage:{}, chatPersistence:{}, modService:{builtinImages:async id => ({id})}})
  try {
    assert.deepEqual(extension.requests.methods, ['getStageTimer','updateStageTimer','getStageTimerLooks','getStageTimerReaction'])
    assert.deepEqual(await extension.requests.call('getStageTimerLooks', {}), {id:'dsh.timer'})
    assert.equal(typeof extension.deps.stageTimer.read, 'function')
  } finally {extension.dispose()}
})