import test from 'node:test'
import assert from 'node:assert/strict'
import {createAssetPackSpeech} from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {stageEnabledExtension} from './helpers/stage-enabled-settings.mjs'

const until = async (check, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 25))) if (await check()) return
  assert.fail('timed out')
}

test('a session\'s speech warms every reference voice of the card\'s bound packs, one at a time, before any line', async t => {
  const spec = {name:'clone', language:'ja', defaultSource:'fish', sources:{fish:{kind:'reference-list', provider:'fish-audio', references:[{media:'b'.repeat(64), text:'参考', language:'ja'}]}}}
  const cloud = {name:'cloud', language:'ja', defaultSource:'fish', sources:{fish:{kind:'voice-id', provider:'fish-audio', voiceId:'x'}}}
  const row = (actorKey, packId, voiceSpec) => ({actorKey, ref:{packId, figureId:actorKey}, name:actorKey, enabled:true, figure:{voice:{voice:actorKey}}, voiceSpec})
  const rows = [row('f_ema', 'bound', spec), row('f_hiro', 'bound', spec), row('f_cloud', 'bound', cloud), row('f_global', 'global', spec)]
  const byKey = alias => rows.find(item => item.actorKey === alias)
  const opened = []
  const presentation = {
    extension:{...stageEnabledExtension({schemaVersion:1, assetBindings:{boundPackIds:['bound']}})},
    subscribe:() => () => {},
    figureRows:async () => rows,
    resolveName:async alias => { opened.push(alias); return {status:'resolved', ref:byKey(alias).ref} },
    resolveFigure:async ref => ({value:{enabled:true, voice:{voice:ref.figureId}, emotions:[]}, voiceSpec:byKey(ref.figureId).voiceSpec, revision:'r1'}),
  }
  let active = 0, peak = 0
  const warmed = []
  const tts = {apiVersion:1, subscribe:() => () => {},
    registerVoiceSource:({sourceId}) => ({source:sourceId, dispose() {}}),
    grantConsumer:() => ({grant:{}, dispose() {}}),
    async prewarm({voice}) { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); warmed.push(voice.source); active-- }}
  const speech = createAssetPackSpeech({presentation, getEngine:() => defaultAssetEngineSettings(), getTts:() => tts, getBinding:async () => ({serviceId:'local'}), scope:'dsh-browser'})
  t.after(() => speech.dispose())
  // Created at session start, it warms the cast by itself; prewarmCast() resolves after that run.
  await until(() => warmed.length === 2)
  await speech.prewarmCast()
  assert.deepEqual([...new Set(opened)], ['f_ema', 'f_hiro'], 'only reference voices of bound packs are opened; no other service is probed')
  assert.equal(warmed.length, 2); assert.match(warmed[0], /f_ema/); assert.match(warmed[1], /f_hiro/)
  assert.equal(peak, 1, 'prewarms go out one at a time')
  // Her first line opens the same voice: it is already warm and is not sent again.
  assert.equal((await speech.open('f_ema')).available, true)
  await speech.prewarmCast()
  assert.equal(warmed.length, 2)
})
