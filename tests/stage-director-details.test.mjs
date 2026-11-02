// Director details: one round's streaming windows continue one background conversation, and the
// entrance reads the card's stage switch in effect (effectiveCardStage).
import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture, answer} from './helpers/stage-director-harness.mjs'
import {modelCall} from './helpers/director-model-call.mjs'
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
import {createBackgroundNativeRuntime} from './fixtures/background-native-runtime.mjs'
import {selectStageEntrance} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-entrance.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {entranceDoc} from './fixtures/stage-entrance.mjs'

const text = Array.from({length:7}, (_, i) => `Synthetic paragraph ${i + 1}.`).join('\n\n')

test('the windows of one round share one conversation, closed once the round settles; the next round opens its own', async t => {
  const tokens = []
  const f = await fixture(async request => {
    const tail = directorPromptData(request), first = tail.first ?? 1
    return modelCall(request, {name:'stage_update', arguments:{sequence:1, through:first + tail.reply.length - 1, done:true,
      beats:first === 1 ? [{at:1, ops:[answer.beats[0].ops[0]]}] : []}})
  }, {openConversation:() => {
    const token = {closed:false, close() {token.closed = true}}
    tokens.push(token)
    return token
  }})
  t.after(() => f.dispose())
  async function streamRound(turn) {
    const op = f.beginReply(turn), stream = await f.director.beginStream(f.read(), turn)
    stream.update(text); await f.director.drain()
    f.commitReply(op, turn, text); await f.director.get(f.read(), turn); await f.director.drain()
    const done = await f.director.get(f.read(), turn, null, {readOnly:true})
    assert.equal(done.phase, 'done', done.error)
  }
  await streamRound(2)
  assert.equal(f.calls.length, 2, 'two windows')
  assert.equal(tokens.length, 1, 'both windows of the round share one conversation')
  assert.ok(f.calls.every(call => call.persistent === false && call.conversation === tokens[0]))
  assert.equal(tokens[0].closed, true, 'the settled round closed its conversation')
  await streamRound(3)
  assert.equal(tokens.length, 2, 'the next round opens its own conversation')
  assert.ok(f.calls.slice(2).every(call => call.conversation === tokens[1]))
  assert.equal(tokens[1].closed, true)
})

test('native: one-shot runs of one conversation continue its session; a closed conversation refuses and a new one starts fresh', {skip:!process.env.DSH_BOOT_MODULE, timeout:30000}, async t => {
  const runtime = await createBackgroundNativeRuntime(process.env.DSH_BOOT_MODULE)
  t.after(() => runtime.dispose())
  const run = (marker, conversation) => runtime.runBackground({sessionId:'scene-parent', task:'stage-director', persistent:false,
    selection:{provider:'scene-fixture', model:'fixture-text'}, system:'Fixture director.', tools:[], conversation,
    messages:[{role:'user', content:[{type:'text', text:marker}]}]})
  const token = runtime.conversation()
  const first = await run('Window one marker', token)
  const second = await run('Window two marker', token)
  assert.equal(second.traceSessionId, first.traceSessionId)
  const continued = JSON.stringify(runtime.requests.at(-1).messages)
  assert.match(continued, /Window one marker/, 'window 2 continues after window 1')
  assert.match(continued, /Window two marker/)
  await token.close()
  assert.deepEqual(runtime.backgroundLoaded(first.traceSessionId), {agent:false, session:false}, 'closing releases the session')
  await assert.rejects(run('After close', token), /后台对话已结束/)
  const fresh = await run('Fresh round', runtime.conversation())
  assert.notEqual(fresh.traceSessionId, first.traceSessionId)
  assert.doesNotMatch(JSON.stringify(runtime.requests.at(-1).messages), /Window one marker/)
})

test('the entrance follows the stage switch in effect for the card', () => {
  const PACK = '11111111-1111-4111-8111-111111111111', engine = defaultAssetEngineSettings()
  const entry = {kind:'entrances', id:'dive', name:'Dive', enabled:true, recall:{mode:'constant', keywords:[]}, directorNote:'', entrance:entranceDoc()}
  const packs = [{revision:'r', manifest:{id:PACK, name:'Pack', contentHash:'0'.repeat(64), assets:[entry], figures:[]}}]
  const extension = {schemaVersion:1, assetBindings:{boundPackIds:[PACK]}}
  assert.equal(selectStageEntrance(extension, packs, engine).ref.assetId, 'dive')
  assert.equal(selectStageEntrance(extension, packs, {...engine, stageToggles:{...engine.stageToggles, entrance:false}}), null)
})
