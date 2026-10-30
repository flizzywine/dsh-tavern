import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture, answer, deferred} from './helpers/stage-director-harness.mjs'
import {modelCall} from './helpers/director-model-call.mjs'
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
import {createCandidateGenerator} from '../tavern-plugin/lib/domain/candidate-generation.js'
import {createStageDirector} from '../tavern-plugin/lib/domain/stage-director.js'
import {createStoryTimeline} from '../tavern-plugin/lib/domain/story-timeline.js'

const text = Array.from({length:7}, (_, i) => `Synthetic paragraph ${i + 1}.`).join('\n\n')
const music = {...answer.beats[0].ops[0].background, kind:'music'}
async function commitCandidates(f) {
  const candidates = createCandidateGenerator({tasks:f.tasks, store:{...f.store,
    chatForSession:async () => f.read(), readCard:async () => ({name:'Fixture'}), readScript:async () => undefined},
    prompt:() => '', scripts:{}, planner:{plan:async () => ({taskText:'Choices',stableText:'',dynamicText:''})},
    model:{selection:() => ({provider:'fake',model:'fake'}), runCandidate:async options => {
      await options.onToolCall({name:'candidate_submit_choices',arguments:{actions:['One','Two','Three','Four'],scene:'Next scene'}})
      return {text:'',traceSessionId:'candidate-session'}
    }}})
  await candidates.generate({sessionId:'session',messageId:'2'})
}
// 手动记账 / 人物设计: an unrelated background commit that changes game state and moves the revision.
async function commitStateChange(f, role) {
  const task = await f.tasks.begin(f.read(),role)
  const revision = f.read().timeline.revision
  assert.equal((await task.commit({stateChanged:true,apply(chat) {chat.ledger = {...chat.ledger, [role]:true}}})).status,'committed')
  assert.equal(f.read().timeline.revision,revision + 1)
}
for (const skin of ['classic', 'aero']) test(`candidate commit preserves streamed scene and music across rounds and owner remount (${skin})`, async t => {
  const started = deferred(), release = deferred()
  const f = await fixture(async request => {
    const tail = directorPromptData(request), first = tail.first ?? 1
    if (f.calls.length === 2) { started.resolve(); await release.promise }
    const receipt = await modelCall(request, {name:'stage_update', arguments:{sequence:1, through:first + tail.reply.length - 1, done:true,
      beats:f.calls.length === 1 ? [{at:first, ops:[answer.beats[0].ops[0], {op:'music.set', ref:music}]}] : []}})
    assert.equal(JSON.parse(receipt).ok,true,receipt)
    return receipt
  })
  f.workspace.raw.extensions.dsh_tavern.stage = {skinChoice:skin}
  t.after(async () => {release.resolve(); await f.dispose()})
  const op = f.beginReply(2), stream = await f.director.beginStream(f.read(),2)
  stream.update(text); await f.director.drain()
  const prefix = await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(prefix.preview.entries[0]?.state.scene.background.assetId,'classroom',JSON.stringify(prefix))
  f.commitReply(op,2,text); await f.director.get(f.read(),2); await started.promise
  const settlement = await f.tasks.begin(f.read(),'settlement')
  await settlement.commit({stateChanged:false})
  await commitCandidates(f)
  release.resolve(); await f.director.drain()
  const done = await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(done.phase,'done',done.error)
  assert.deepEqual(done.record.end.music,music)
  // Two windows, each a one-shot request of its own (no shared conversation).
  assert.equal(f.calls.length,2)
  assert.ok(f.calls.every(call => call.persistent === false && call.conversation === undefined))
  const scene = done.record.end.scene
  f.appendReply(3); await f.director.get(f.read(),3); await f.director.drain()
  const next = await f.director.get(f.read(),3,null,{readOnly:true})
  assert.deepEqual(next.record.end.scene,scene)
  assert.deepEqual(next.record.end.music,music)
  // A fresh owner reads only canonical records, with no retained streaming/UI state.
  const restored = createStageDirector({assets:f.assets,readChat:f.store.readChat})
  t.after(() => restored.dispose())
  const remount = await restored.get(f.read(),3,null,{readOnly:true})
  assert.deepEqual(remount.record.end.scene,scene)
  assert.deepEqual(remount.record.end.music,music)
  const consumer = await f.assets.consumer(f.read(),'http://localhost')
  const shown = await consumer.presentation.scene(remount.record.end)
  assert.deepEqual(shown.background,scene.background)
  assert.ok(shown.backgroundUrl)
  assert.equal(shown.skin.document.id,skin)
})

for (const change of ['candidates','ledger','character-design']) test(`post-body director commits after an unrelated ${change} commit`, async t => {
  const started = deferred(), release = deferred()
  const f = await fixture(async request => {started.resolve(); await release.promise; return modelCall(request,{name:'stage_update',arguments:answer})})
  t.after(async () => {release.resolve(); await f.dispose()})
  const settlement = await f.tasks.begin(f.read(),'settlement'); await settlement.commit({stateChanged:false})
  await f.director.get(f.read(),1); await started.promise
  if (change === 'candidates') await commitCandidates(f); else await commitStateChange(f,change)
  release.resolve(); await f.director.drain()
  const done = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.equal(done.phase,'done',done.error)
  assert.equal(done.record.end.scene.background.assetId,'classroom')
})

for (const change of ['ledger','character-design']) test(`streamed director commits after an unrelated ${change} commit`, async t => {
  const started = deferred(), release = deferred()
  const f = await fixture(async request => {
    const tail = directorPromptData(request), first = tail.first ?? 1
    if (f.calls.length === 2) {started.resolve(); await release.promise}
    return modelCall(request,{name:'stage_update',arguments:{sequence:1,through:first + tail.reply.length - 1,done:true,
      beats:f.calls.length === 1 ? [{at:first,ops:[answer.beats[0].ops[0],{op:'music.set',ref:music}]}] : []}})
  })
  t.after(async () => {release.resolve(); await f.dispose()})
  const op = f.beginReply(2), stream = await f.director.beginStream(f.read(),2)
  stream.update(text); await f.director.drain()
  f.commitReply(op,2,text); await f.director.get(f.read(),2); await started.promise
  const settlement = await f.tasks.begin(f.read(),'settlement'); await settlement.commit({stateChanged:false})
  await commitStateChange(f,change)
  release.resolve(); await f.director.drain()
  const done = await f.director.get(f.read(),2,null,{readOnly:true})
  assert.equal(done.phase,'done',done.error)
  assert.deepEqual(done.record.end.music,music)
})

for (const change of ['edit','regenerate','rollback']) test(`candidate rebind does not admit a real ${change}`, async t => {
  const started = deferred(), release = deferred()
  const f = await fixture(async request => {
    if (f.calls.length === 2) {started.resolve(); await release.promise}
    const tail = directorPromptData(request), first = tail.first ?? 1
    return modelCall(request,{name:'stage_update',arguments:{sequence:1,through:first + tail.reply.length - 1,done:true,
      beats:[{at:first,ops:[answer.beats[0].ops[0]]}]}})
  })
  t.after(async () => {release.resolve(); await f.dispose()})
  const op = f.beginReply(2), stream = await f.director.beginStream(f.read(),2)
  stream.update(text); await f.director.drain()
  f.commitReply(op,2,text); await f.director.get(f.read(),2); await started.promise
  const settlement = await f.tasks.begin(f.read(),'settlement'); await settlement.commit({stateChanged:false})
  await commitCandidates(f)
  if (change === 'edit') {
    const timeline = createStoryTimeline()
    await f.store.updateChat('chat',chat => timeline.apply({chat,intent:{kind:'body.edit',turn:2,patch:{text:'Edited body.'}}}).chat)
  } else if (change === 'regenerate') {
    // A new body operation must invalidate even byte-identical replacement prose.
    const replacement = f.beginReply(2)
    await f.store.updateChat('chat',chat => {chat.messages = chat.messages.filter(m => m.turn !== 2); return chat})
    f.commitReply(replacement,2,text)
  } else f.branch()
  release.resolve(); await f.director.drain()
  assert.ok(f.read().messages.every(m => !m.stageDirectionAssetPacks),'obsolete director must not write canonical state')
})

test('post-body director stopped by a regenerate logs that the prose changed', async t => {
  const started = deferred(), release = deferred(), logs = []
  const f = await fixture(async request => {started.resolve(); await release.promise; return modelCall(request,{name:'stage_update',arguments:answer})},{log:row => logs.push(row)})
  t.after(async () => {release.resolve(); await f.dispose()})
  await f.director.get(f.read(),1); await started.promise
  const replacement = f.beginReply(1)
  await f.store.updateChat('chat',chat => {chat.messages = chat.messages.filter(m => m.turn !== 1); return chat})
  f.commitReply(replacement,1,'Regenerated body.')
  release.resolve(); await f.director.drain()
  assert.ok(f.read().messages.every(m => !m.stageDirectionAssetPacks))
  assert.equal(logs.find(row => row.kind === 'director-stopped')?.error,'舞台导演已停止：本轮正文已变化')
  assert.equal(logs.some(row => row.kind === 'director-failure'),false)
})

// The next turn stops the unfinished director without a failure or notice (as upstream); the round stays undirected.
test('the next turn stops the unfinished director silently', async t => {
  const started = deferred(), release = deferred(), logs = []
  const f = await fixture(async request => {started.resolve(); await release.promise; return modelCall(request,{name:'stage_update',arguments:answer})},{log:row => logs.push(row)})
  t.after(async () => {release.resolve(); await f.dispose()})
  await f.director.get(f.read(),1); await started.promise
  f.director.cancel({sessionId:'session'})
  release.resolve(); await f.director.drain()
  const message = f.read().messages.find(m => m.turn === 1)
  assert.equal(message.stageDirectionAssetPacks,undefined)
  assert.equal(message.stageDirectionAssetPacksFailure,undefined)
  const shown = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.notEqual(shown.phase,'error',shown.error)
  assert.equal(shown.error,undefined)
  assert.ok(logs.some(row => row.kind === 'director-stopped'))
})

// An interrupted or discarded turn stops its own director only.
test('stopping one turn leaves another turn\'s director running', async t => {
  const started = deferred(), release = deferred()
  const f = await fixture(async request => {started.resolve(); await release.promise; return modelCall(request,{name:'stage_update',arguments:answer})})
  t.after(async () => {release.resolve(); await f.dispose()})
  await f.director.get(f.read(),1); await started.promise
  f.director.cancel({sessionId:'session'},2)
  release.resolve(); await f.director.drain()
  const done = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.equal(done.phase,'done',done.error)
})

// The director writes beside the background tasks: a running mark while it works, cleared with
// its record; a mark an earlier run of Tavern left behind reads as cut off by the restart.
test('a director marks its round while it works and a mark from before a restart reads as interrupted', async t => {
  const started = deferred(), release = deferred()
  const f = await fixture(async request => {started.resolve(); await release.promise; return modelCall(request,{name:'stage_update',arguments:answer})})
  t.after(async () => {release.resolve(); await f.dispose()})
  await f.director.get(f.read(),1); await started.promise
  assert.ok(f.read().messages[0].stageDirectionRunning, 'marked while it works')
  assert.equal(f.director.activity(f.read()).busy, true)
  release.resolve(); await f.director.drain()
  assert.equal(f.read().messages[0].stageDirectionRunning, undefined, 'cleared with its record')
  assert.equal((await f.director.get(f.read(),1,null,{readOnly:true})).phase,'done')

  await f.store.updateChat('chat', chat => {
    delete chat.messages[0].stageDirectionAssetPacks
    chat.messages[0].stageDirectionRunning = {boot:'an-earlier-run', at:1}
    return chat
  })
  const cut = await f.director.get(f.read(),1,null,{readOnly:true})
  assert.equal(cut.code,'DIRECTOR_INTERRUPTED')
})
