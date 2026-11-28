// A reply that ends before the stage's stream observer is ready (a slow chat read on a long game, a fast reply) still gets
// its round directed: the late observer receives the whole reply and its finish, instead of stopping the round's director.
// (bug:stage-voice-no-play, live 2026-11-28: every such round stayed undirected, so its lines never spoke on their own.)
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture, deferred} from './helpers/stage-director-harness.mjs'
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
import {modelCall} from './helpers/director-model-call.mjs'
import {createPresentationObservers} from '../tavern-plugin/lib/domain/presentation-observers.js'
import {createStageStoryObserver} from '../tavern-plugin/packages/dsh-tavern-stage/lib/story-observer.js'
import {stageAutoVoiceAllowed} from '../tavern-plugin/src/client/source-beat.cjs'

const text = 'Synthetic fixture.\n\nSynthetic dusk.'

async function lateObserverRound(t, end) {
  const ready = deferred(), entered = deferred()
  const f = await fixture(async request => {
    const tail = directorPromptData(request), first = tail.first ?? 1
    return modelCall(request, {name:'stage_update', arguments:{sequence:1, through:first + tail.reply.length - 1, done:true, beats:[]}})
  // the round's stream is registered, its preparation (mods, assets of a long game) is still running when the reply ends
  }, {mods:{async prepare() { entered.resolve(); await ready.promise; return undefined }, applied() {}, recover() {}, observe() {}}})
  t.after(() => f.dispose())
  const stage = createStageStoryObserver({stageDirector:f.director, modService:{invalidate() {}},
    chatHeaderForSession:async () => ({cardPath:'cards/a.json'}),
    dialogueBubbles:{read:async () => ({enabled:true, stage:{director:true}})},
    readStageChat:async () => f.read(),
    readReplyPrefix:() => '', activeRoundBodies:new Map()})
  const observers = createPresentationObservers()
  observers.register('stage', stage)
  t.after(() => observers.dispose())
  const operation = f.beginReply(2)
  const reply = observers.openReply({sessionId:'session', turn:2})
  reply.append(text)
  await entered.promise
  end(reply)
  ready.resolve()
  await new Promise(resolve => setTimeout(resolve, 20))
  f.commitReply(operation, 2, text)
  await f.director.get(f.read(), 2)
  await f.director.drain()
  return f.director.get(f.read(), 2, null, {readOnly:true})
}

test('a reply that stopped before the stage observer was ready is still directed', async t => {
  const round = await lateObserverRound(t, reply => reply.finish(true, true))
  assert.equal(round.phase, 'done', JSON.stringify({phase:round.phase, error:round.error}))
  assert.equal(round.complete, true)
  // with the director on, a page's line speaks on its own only once the round's direction reaches it
  for (const para of [1, 2]) assert.equal(stageAutoVoiceAllowed({phase:round.phase, through:round.through}, para, true, false, () => null), true)
})

test('a tool-call step that ended before the stage observer was ready leaves the round to be directed', async t => {
  const round = await lateObserverRound(t, reply => reply.finish(true, false))
  assert.equal(round.phase, 'done', JSON.stringify({phase:round.phase, error:round.error}))
})
