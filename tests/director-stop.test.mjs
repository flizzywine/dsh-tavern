import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
// existing user stop, real director owner/transactions, no provider or live data.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fixture, answer, deferred} from './helpers/stage-director-harness.mjs'
import {coordinationEventId} from '../tavern-plugin/lib/domain/coordination-event-publisher.js'
import {createSettlementControls} from '../tavern-plugin/lib/domain/settlement-controls.js'

const host = await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
// the stage plugin owns the director: its story observer reports the director's activity, its module wakes coordination
const stagePackage = file => readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/'+file,import.meta.url),'utf8')
const observer = await stagePackage('story-observer.js'), stageModule = await stagePackage('module.js')

function stopAction(f) {
  const cancellations = [], pluginStops = []
  // The production settlement controls (index.js wires the same factory) also own plugin-task cancellation.
  const {stopBackground: stop} = createSettlementControls({chatForSession: async () => f.read(), backgroundTasks: f.tasks, stageDirector: f.director,
    backgroundAgentRunner: {cancel(...args) {cancellations.push(args)}}, cancelSettlement: async () => {}, view: async () => f.read(), readChatCard: async () => ({}),
    pluginApi: {stopTasks(sessionId) {pluginStops.push(sessionId)}}})
  return {stop,cancellations,pluginStops}
}
const waitForAbort = request => new Promise(resolve => request.signal.addEventListener('abort',resolve,{once:true}))
const text = n => Array.from({length:n},(_,i) => 'Synthetic paragraph '+(i+1)+'.').join('\n\n')

test('user stop aborts a correction window, retains committed beats, and requires explicit regeneration', async t => {
  const started = deferred()
  const f = await fixture(async request => {
    await request.onToolCall({name:'submit_direction',arguments:{...answer,through:1,done:false,beats:answer.beats.slice(0,1)}})
    started.resolve()
    await waitForAbort(request)
  })
  t.after(() => f.dispose())
  await f.director.get(f.read(),1)
  await started.promise
  const before = structuredClone(f.read().messages[0].stageDirectionAssetPacksDraft)
  assert.ok(before,'first window is checkpointed before stopping')
  const activity = f.tasks.activity(f.read())
  assert.equal(activity.busy,false,'parallel director does not block core admission')
  assert.equal(activity.director.busy,true)
  const {stop,cancellations,pluginStops} = stopAction(f)
  await stop('session','obsolete-operation')
  assert.deepEqual(pluginStops,[],'stale button cannot stop plugin tasks')
  assert.equal(f.calls[0].signal.aborted,false,'stale button cannot stop a new task')
  // cancellation is session-scoped (callers pass {sessionId}).
  f.director.cancel({...f.read(),sessionId:'another-session'})
  assert.equal(f.calls[0].signal.aborted,false,'session scope is preserved')
  await stop('session',activity.director.operationId)
  await f.director.drain()
  assert.equal(f.calls[0].signal.aborted,true)
  assert.deepEqual(f.read().messages[0].stageDirectionAssetPacksDraft,before)
  // a stopped director reports no activity (stage-director.js activity: null)
  assert.equal(f.tasks.activity(f.read()).director,null)
  assert.deepEqual(cancellations,[['session',{task:'stage-director'}],['session']])
  assert.deepEqual(pluginStops,['session'])
  await f.director.get(f.read(),1)
  assert.equal(f.calls.length,1,'normal reads/generation do not restart a stopped turn')
  const reset = await f.director.retry(f.read(),1,{regenerate:true})
  assert.equal(reset.chat.messages[0].stageDirectionAssetPacksFailure,undefined)
  assert.equal(reset.chat.messages[0].stageDirectionAssetPacksDraft,undefined)
})

test('user stop aborts a streaming window without cancelling the foreground or restarting at body commit',async t => {
  const started = deferred()
  const f = await fixture(async request => {
    const tail = directorPromptData(request)
    await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:tail.reply.length,done:false,beats:answer.beats.slice(0,1)}})
    started.resolve()
    await waitForAbort(request)
  })
  t.after(() => f.dispose())
  const body = f.beginReply(2), stream = await f.director.beginStream(f.read(),2)
  stream.update(text(7)); await started.promise
  const prefix = await f.director.get(f.read(),2,null,{readOnly:true})
  assert.deepEqual(prefix.entries,[],'an unfinished first window is not published')
  stream.update(text(13))
  assert.equal(f.calls.length,1,'the remainder waits for body commit')
  const activity = f.tasks.activity(f.read())
  assert.equal(activity.busy,false)
  const {stop} = stopAction(f)
  await stop('session',activity.director.operationId); await f.director.drain()
  assert.equal(f.calls[0].signal.aborted,true)
  assert.equal(f.read().timeline.operations[body.operationId].status,'running')
  const stopped = await f.director.get(f.read(),2,null,{readOnly:true})
  // a stopped stream reads as missing: nothing of the unfinished window is published.
  assert.equal(stopped.status,'missing'); assert.equal(stopped.entries?.length || 0,0,'stopping does not publish the unfinished window')
  stream.update(text(20)); await f.director.drain()
  f.commitReply(body,2,text(13)); await f.director.get(f.read(),2); await f.director.drain()
  await f.director.get(f.read(),2); await f.director.drain()
  assert.equal(f.calls.length,1,'body commit cannot start a post-stop fallback')
  assert.equal(f.read().messages.at(-1).text,text(13))
})

test('parallel-only activity changes wake coordination without changing core busy state',() => {
  const idle = {activity:{operationId:'old-core',phase:'idle',busy:false}}
  const running = {activity:{...idle.activity,director:{operationId:'director:1',busy:true}}}
  assert.notEqual(coordinationEventId(idle),coordinationEventId(running))
  assert.equal(running.activity.busy,false)
  assert.match(host,/presentationActivity: chat => presentationObservers\.activity\(chat\)/)
  assert.match(observer,/activity:chat => \(\{director:stageDirector\.activity\(chat\)\}\)/)
  assert.match(stageModule,/void coordinationEvents\?\.publish\(event\.sessionId\)/)
})
