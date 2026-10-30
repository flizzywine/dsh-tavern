// tagged English defaults; retain protocol, payload, cache and budget assertions.
// assert the model handle DTO, while saved state stays canonical.
import {modelCall,modelHandle,modelArguments} from './helpers/director-model-call.mjs'
// tool receipts use the CLI v1 envelope; saved record diagnostics are unchanged.
import { directorPromptData } from './fixtures/asset-packs/prompt.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { syntheticPack, distinctMedia, cardExtension, PACK_ID, OTHER_PACK_ID, FIGURE_ID, OTHER_FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { reduceAssetPackScene, applyAssetPackLight, assetPackBackgroundVariant, assetPackLookLayer } from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-pack-stage.js'
import { recallAssetPacks, assetPackDigest } from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import { initialAssetPackStage } from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import { defaultAssetEngineSettings, validateAssetEngineSettings } from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import { estimateDirectorTokens } from '../tavern-plugin/lib/domain/stage-director-tokens.js'
import { prepareAssetPackDirector, buildAssetPackRequest, nameModSections, nameModCommands, createAssetPackTransaction, runAssetPackDirector, validateAssetPackRecord, readAssetPackRecord, assetPackStateAt } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import { captureStageTarget } from '../tavern-plugin/lib/domain/stage-incremental.js'
import { sceneSourceDigest } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { stageReadIdentityFields, stageReadChainFields } from '../tavern-plugin/lib/domain/stage-read-projection.js'

test('automatic polish preserves the director target in full and projected stage reads', () => {
  const message = { role:'assistant', turn:1, text:'Original prose.' }
  const chat = { id:'chat', sessionId:'session', timeline:{branchId:'branch',revision:1}, messages:[message] }
  const before = captureStageTarget(chat,0)
  assert.equal(before.sourceDigest,sceneSourceDigest(message.text))
  message.polishedFrom = before.sourceDigest
  message.text = 'Polished prose.'
  assert.equal(captureStageTarget(chat,0).sourceKey,before.sourceKey)
  for (const fields of [stageReadIdentityFields,stageReadChainFields]) {
    const projected = Object.fromEntries(Object.entries(message).filter(([key]) => fields.includes(key)))
    assert.equal(captureStageTarget({...chat,messages:[projected]},0).sourceKey,before.sourceKey)
  }
  delete message.polishedFrom
  assert.notEqual(captureStageTarget(chat,0).sourceKey,before.sourceKey)
})

const ACTOR = figureActorKey({packId:PACK_ID,figureId:FIGURE_ID})
const TALL = figureActorKey({packId:PACK_ID,figureId:OTHER_FIGURE_ID})
const FRIEND = figureActorKey({packId:OTHER_PACK_ID,figureId:OTHER_FIGURE_ID})
const ref = (kind, assetId, packId = PACK_ID) => ({ packId, kind, assetId })
const clone = value => structuredClone(value)
async function fixture() {
  const first = await syntheticPack(), second = distinctMedia(first,'second-pack')
  second.manifest.id = OTHER_PACK_ID
  second.figures = {[OTHER_FIGURE_ID]:{...second.figures[FIGURE_ID], id:OTHER_FIGURE_ID}}
  second.manifest.figures = [OTHER_FIGURE_ID]
  const snapshots = [first, second].map((p, i) => ({ manifest: p.manifest, figures: p.figures, widgets:p.widgets, revision: 'r' + i }))
  const assetStatus = {}, widgetAuthorizations = {}
  for (const p of snapshots) for (const asset of p.manifest.assets) {
    const key = assetRefKey(ref(asset.kind, asset.id, p.manifest.id))
    assetStatus[key] = { available: true, executableDigest: 'a'.repeat(64) }
    widgetAuthorizations[key] = 'a'.repeat(64)
  }
  const input = { snapshots, assetStatus, raw: { extensions: { dsh_tavern: cardExtension() } }, cardRevision: 'card-1', engine: { widgetAuthorizations, widgetsEnabled: true },
    target: { sourceKey: 'reply-1', branchId: 'branch-1', revision: 1 }, units: ['Synthetic fixture.', 'Later at night.', 'An unchanged paragraph.'] }
  // protocol/replay fixtures use the canonical figure key; copies never inherit a roster key.
  input.baseline = initialAssetPackStage({[ACTOR]:{figure:{packId:PACK_ID,figureId:FIGURE_ID},outfits:[]}})
  const prepare = () => prepareAssetPackDirector(input)
  const recall = extra => recallAssetPacks({ snapshots, assetStatus, boundPackIds: [PACK_ID, OTHER_PACK_ID], widgetsEnabled: true, widgetAuthorizations, units: input.units, ...extra })
  return { input, prepare, recall }
}
const batch = (ops, options = {}) => ({ sequence: 1, through: 3, done: true, beats: [{ at: 1, ops }], ...options })
const scene = (timeOfDay = null, background = ref('backgrounds', 'classroom'), timeLook) => ({op:"scene.set",background,time:timeOfDay,...(timeLook ? {timeLook} : {})})
const selection = (...args) => {const {background,time,timeLook}=scene(...args);return {background,timeOfDay:time,...(timeLook ? {timeLook} : {})}}
const transact = (prepared, extra = {}) => createAssetPackTransaction({ prepared, getCurrentBinding: () => prepared.binding, ...extra })

test('owned catalogue sharing preserves input mutability and checkpoint identities', async () => {
  const f = await fixture(), asset = f.input.snapshots[0].manifest.assets[0]
  const origin = {packId:OTHER_PACK_ID,kind:asset.kind,assetId:'source-copy'}
  asset.extensions = {dsh_tavern:{copiedFrom:origin}}
  const prepared = f.prepare(), catalogue = prepared.context.catalogue, before = clone(catalogue)
  assert.ok(Object.isFrozen(catalogue))
  for (const rows of Object.values(catalogue.candidates)) for (const row of rows) {
    assert.ok(catalogue.rows.includes(row))
    assert.ok(Object.isFrozen(row.asset))
  }
  assert.equal(Object.isFrozen(origin),false)
  asset.name = 'Edited after preparation'
  origin.assetId = 'edited-copy'
  assert.deepEqual(catalogue,before)
  assert.equal(prepared.binding.catalogueDigest,assetPackDigest(catalogue))
  const tx = transact(prepared)
  assert.equal(tx.submit(batch([scene()])).ok,true)
  const saved = tx.savepoint()
  assert.equal(saved.bindingDigest,assetPackDigest(prepared))
  assert.deepEqual(transact(prepared,{checkpoint:saved}).effect(),tx.effect())
})

test('music loop metadata adds zero director section and tool-schema bytes', async () => {
  const f = await fixture(), before = buildAssetPackRequest(f.prepare(),true,undefined,'',true)
  for (const snapshot of f.input.snapshots) for (const asset of snapshot.manifest.assets) {
    if (asset.kind === 'music') Object.assign(asset,{loopStart:0.125,loopEnd:87.75})
  }
  const after = buildAssetPackRequest(f.prepare(),true,undefined,'',true)
  assert.deepEqual(after.tools,before.tools)
  assert.deepEqual(after.messages,before.messages)
  assert.equal(after.system,before.system)
  assert.deepEqual(after.sections.map(row => [row.key,Buffer.byteLength(row.text,'utf8')]),before.sections.map(row => [row.key,Buffer.byteLength(row.text,'utf8')]))
  assert.equal(after.inputBytes,before.inputBytes)
})

// Character declarations stay fixed even if the selected outfit has no corresponding art.
test('director freezes one character set without per-outfit emotion annotations',async()=>{
  const f=await fixture(),pack=await syntheticPack(),first=f.input.snapshots[0]
  first.sprites=pack.sprites;first.figures[FIGURE_ID].emotions=[{id:'proud',label:'得意',guidance:'轻轻挑眉'}]
  first.sprites.school.emotions.proud=clone(first.sprites.school.emotions.calm)
  const prepared=f.prepare(),actor=prepared.context.actors[ACTOR]
  assert.equal(actor.emotions[0].id,'proud')
  assert.ok(actor.outfits.every(o=>o.emotions===undefined))
  first.figures[FIGURE_ID].emotions=[];delete first.sprites.school.emotions.proud
  assert.equal(actor.emotions[0].label,'得意')
  const request=buildAssetPackRequest(prepared,true,undefined,'',true)
  const choices=JSON.parse(request.sections.find(row=>row.key==='actors.constant').text)
  assert.ok(Object.values(choices).every(row=>row.outfits?.every(o=>o.differences===undefined)))
})

// missing art calls for approximation, not an empty stage.
test('scene transition guidance keeps a background beneath a title and subsequent narration', async () => {
  const f = await fixture(), prepared = f.prepare()
  for (const incremental of [true, false]) {
    const request = buildAssetPackRequest(prepared, incremental, undefined, '', true)
    const protocol = request.sections.find(section => section.key === 'command-guidance').text
    assert.ok(request.system.includes(protocol))
    assert.ok(!request.messages[0].content.some(part => part.text === protocol))
    // schema is the terse command index; full usage is disclosed on error/preview.
    assert.match(protocol, /change the background when the location changes; choose by kind of space, use and indoors or outdoors before mood/)
    assert.match(protocol, /Overlays such as a CG or title card keep it/)
    assert.match(protocol, /when an actor enters, pick the outfit matching the described clothing; the initial one is only a fallback/)
    assert.match(protocol, /choose by label and guidance, not key/)
    assert.match(protocol, /deliberately empty stage, not because nothing fits/)
    assert.match(protocol, /scene\.set in the same or next beat; a title card covers the scene without clearing it/)
    assert.ok(request.commands.find(row => row.name === 'scene.set').examples.length)
    assert.ok(request.commands.find(row => row.name === 'scene.clear').summary.includes('empty'))

  }
  const disabled = structuredClone(prepared)
  disabled.context.dimensions.scene = false
  assert.deepEqual(buildAssetPackRequest(disabled).tools,buildAssetPackRequest(prepared).tools)
  assert.ok(!directorPromptData(buildAssetPackRequest(disabled)).allowedCommands.includes('scene.clear'))
  const tx = transact(prepared)
  assert.equal(tx.submit(batch([scene('day'), {op:'title.play',text:'Next noon'}])).ok, true)
  const record = tx.effect(), expectedScene = {...selection('day'),timeLook:null}
  for (const at of [1,2,3]) assert.deepEqual(assetPackStateAt(record,at).scene, expectedScene)
  const next = transact(prepareAssetPackDirector({...f.input,record}))
  assert.equal(next.submit(batch([])).ok,true)
  assert.deepEqual(next.effect().end.scene,expectedScene,'title completion and unchanged narration do not clear the background')
})

// guidance changes one request, never the prepared settings, tool protocol or checkpoint.
test('director prompt guidance is labeled, trimmed, budgeted and absent from the next run', async () => {
  const f = await fixture(), prepared = f.prepare(), before = clone(prepared)
  const plain = buildAssetPackRequest(prepared)
  const guided = buildAssetPackRequest(prepared, true, undefined, '  Keep this quiet.  ')
  assert.deepEqual(guided.tools, plain.tools)
  assert.equal(guided.system, plain.system)
  assert.deepEqual(guided.messages[0].content.at(-1), {type:'text',text:'<temporary_requirements>\nRequests for this run only:\nKeep this quiet.\n</temporary_requirements>'})
  assert.ok(guided.inputBytes > plain.inputBytes)
  assert.deepEqual(prepared, before)
  assert.deepEqual(buildAssetPackRequest(prepared), plain)
  assert.deepEqual(buildAssetPackRequest(prepared, true, undefined, '  '), plain)
  const tx = transact(prepared, {guidance:'Keep this quiet.'})
  assert.doesNotMatch(JSON.stringify(tx.savepoint()), /Keep this quiet/)
  // guidance is counted against model context, never an independent Engine cap.
  const bounded = {...prepared, modelInfo:{context:{contextWindow:plain.estimatedTokens},defaultMaxTokens:0}}
  assert.throws(() => buildAssetPackRequest(bounded, true, undefined, 'x'.repeat(1000)), /context exceeded/)
})

test('pack identity is never display name or short ID, and rename preserves the wire reference', async () => {
  const f = await fixture(), a = f.recall()
  const backgrounds = a.candidates.backgrounds.filter(row => row.ref.assetId === 'classroom')
  assert.equal(backgrounds.length, 2); assert.notEqual(backgrounds[0].label, backgrounds[1].label)
  const original = backgrounds.map(row => row.ref)
  for (const pack of f.input.snapshots) pack.manifest.assets[0].name = 'Renamed'
  assert.deepEqual(f.recall().candidates.backgrounds.filter(row => row.ref.assetId === 'classroom').map(row => row.ref), original)
  const p = f.prepare(), tx = transact(p)
  assert.equal(tx.submit(batch([scene(null, original[1]), {op:"music.set", ref:ref('music', 'classroom')}])).ok, true)
  assert.deepEqual(tx.effect().end.scene.background, original[1])
  assert.deepEqual(tx.effect().end.music, ref('music', 'classroom'))
})

// catalogues include all blue and trigger-hit entries without top-up.
test('all kinds are trigger-only; hard triggers are not ranked or capped', async () => {
  const f = await fixture(), pack = f.input.snapshots[0]
  const music = pack.manifest.assets.find(a => a.kind === 'music')
  for (let i = 0; i < 50; i++) {
    pack.manifest.assets.push({...distinctMedia(music,'track-' + i),id:'track-' + i})
    f.input.assetStatus[assetRefKey(ref('music','track-' + i))] = {available:true}
  }
  const hit = f.recall()
  assert.equal(hit.candidates.music.length,52)
  assert.ok(hit.candidates.music.every(row => row.reasons.includes('hard-trigger')))
  const empty = f.recall({units:['unrelated']})
  assert.equal(empty.candidates.music.length,0)
  assert.equal(empty.candidates.backgrounds.length,0)
  assert.equal(empty.candidates.looks.length,2) // these are blue
  const target = pack.manifest.assets.find(a => a.id === 'track-49')
  target.recall = {mode:'keyword',keywords:['unique']}
  const input = {units:['unique']}
  const filled = f.recall(input)
  assert.equal(filled.candidates.music.length,1)
  assert.ok(filled.candidates.music.some(row => row.ref.assetId === 'track-49' && row.reasons.includes('hard-trigger')))
  assert.deepEqual(filled,f.recall(input))
})

test('NFKC, traditional conversion, Latin boundaries, synonyms and deduplicated evidence are retained', async () => {
  const f = await fixture(), asset = f.input.snapshots[0].manifest.assets[0]
  asset.name = 'Hospital'; asset.recall = { mode: 'keyword', keywords: ['医院'], synonyms: { '医院': ['clinic'] } }
  const recalled = f.recall({ units: ['ＨＯＳＰＩＴＡＬ 醫院 clinic'] }).candidates.backgrounds.find(row => row.ref.packId === PACK_ID && row.ref.assetId === 'classroom')
  assert.equal(recalled.evidence.length, 2)
  assert.equal(f.recall({ units: ['hospitalized'], thresholds:{backgrounds:0} }).candidates.backgrounds.length, 0)
  asset.name = 'night'; asset.recall.keywords = ['morning']; asset.recall.synonyms = {}
  assert.equal(f.recall({ units: ['night morning'], thresholds:{backgrounds:0} }).candidates.backgrounds.length, 0)
})

test('disabled, missing media, unavailable packs and unauthorized widgets cannot be forced by carry or blue', async () => {
  const f = await fixture(), state = initialAssetPackStage({})
  state.music = ref('music', 'classroom'); state.widgets.clock = { type: ref('widgets', 'clock'), props: { label: 'x' } }
  f.input.snapshots[0].manifest.assets.find(a => a.kind === 'music').enabled = false
  const c = f.recall({ state, units: ['unrelated'], widgetsEnabled: false })
  assert.ok(c.candidates.music.every(row => row.ref.packId !== PACK_ID)); assert.equal(c.candidates.widgets.length, 0)
  assert.equal(c.rows.find(row => row.ref.kind === 'music' && row.ref.packId === PACK_ID).excluded, 'disabled')
  delete f.input.assetStatus[assetRefKey(ref('looks', 'dusk'))]
  assert.equal(f.recall().candidates.looks.length, 1)
  assert.equal(f.recall({ snapshots: [] }).diagnostics.filter(d => d.code === 'pack-missing').length, 2)
})

test('carry and opening do not add untriggered catalogue choices', async () => {
  const f = await fixture(), state = initialAssetPackStage({})
  state.music = ref('music', 'classroom')
  const opening = initialAssetPackStage({}); opening.music = ref('music', 'classroom', OTHER_PACK_ID)
  const c = f.recall({ units: ['unrelated'], state, opening, thresholds: { music: 1, looks: 1 } })
  assert.equal(c.candidates.music.length, 0)
  assert.deepEqual(c.diagnostics, [])
  assert.equal(c.candidates.widgets.length, 0)
})

// only resolved model context constrains input; retired settings are not accepted.
test('model context rejects before a call with model and sizes, without dropping forced refs', async () => {
  const f = await fixture()
  f.input.engine.directorModel = {provider:'test-provider',model:'small-model'}
  const request = buildAssetPackRequest(f.prepare())
  f.input.modelInfo = {context:{contextWindow:request.estimatedTokens + 100},defaultMaxTokens:101}
  const p = f.prepare(); let calls = 0
  await assert.rejects(runAssetPackDirector({prepared:p,getCurrentBinding:()=>p.binding,runAgent:async()=>calls++}), error => {
    assert.equal(error.code, 'MODEL_CONTEXT_EXCEEDED')
    assert.match(error.message, /test-provider\/small-model.*estimated input \d+ tokens \(\d+ UTF-8 bytes\).*output allowance 101.*context \d+/)
    return true
  })
  assert.equal(calls,0); assert.equal(p.context.catalogue.candidates.looks.length,2)
  f.input.modelInfo.defaultMaxTokens = 100
  assert.equal(buildAssetPackRequest(f.prepare()).estimatedTokens,request.estimatedTokens)
  for (const key of ['maxInputBytes','maxInputTokens']) {
    const engine = defaultAssetEngineSettings()
    assert.equal(Object.hasOwn(engine,'limits'),false)
    assert.deepEqual(validateAssetEngineSettings({...engine,limits:{[key]:999999}}),engine)
  }
})

// reserve and actual request share a director ceiling, not the provider maximum.
test('256k-output models use a bounded director allowance without changing prompt or tools', async () => {
  const f = await fixture(), plain = buildAssetPackRequest(f.prepare(), true, undefined, '', true)
  f.input.engine.directorModel = {provider:'deepseek-official',model:'deepseek-flash'}
  f.input.modelInfo = {context:{contextWindow:258000},defaultMaxTokens:256000}
  const p = f.prepare(), request = buildAssetPackRequest(p, true, undefined, '', true)
  assert.ok(request.estimatedTokens + 256000 > 258000, 'uncapped model allowance reproduces the rejection')
  assert.equal(request.maxTokens,32768)
  assert.equal(request.modelContext.outputTokens,request.maxTokens)
  for (const key of ['system','messages','tools','sections','inputBytes','estimatedTokens']) assert.deepEqual(request[key],plain[key])
  let calls = 0
  await runAssetPackDirector({prepared:p,getCurrentBinding:()=>p.binding,runAgent:async input=>{
    calls++
    assert.equal(input.maxTokens,32768)
    await modelCall(input,{name:input.tools[0].name,arguments:batch([])})
  }})
  assert.equal(calls,1)
  for (const limit of [8192,undefined]) {
    f.input.modelInfo.defaultMaxTokens = limit
    assert.equal(buildAssetPackRequest(f.prepare()).maxTokens,limit ?? 32768)
  }
  f.input.modelInfo = {context:{contextWindow:request.estimatedTokens + 32767},defaultMaxTokens:256000}
  assert.throws(()=>buildAssetPackRequest(f.prepare()),{code:'MODEL_CONTEXT_EXCEEDED'})
  f.input.modelInfo.context.contextWindow++
  assert.equal(buildAssetPackRequest(f.prepare()).maxTokens,32768)
})

// a long multilingual turn fits a 128k model without byte-as-token inflation or media lists.
test('long CJK reply estimates tokens and sends only compact recalled catalogue metadata', async () => {
  const f = await fixture()
  f.input.units = Array.from({length:187},(_,i)=>({at:i+1,text:'Synthetic fixture. '+ '\u4f60\u597d\u4e16\u754c'.repeat(12)}))
  f.input.modelInfo = {context:{contextWindow:131072},defaultMaxTokens:32768}
  const request = buildAssetPackRequest(f.prepare())
  const {inputBytes,estimatedTokens,tokenEstimate,modelContext,maxTokens,...wire} = request
  assert.equal(inputBytes,Buffer.byteLength(JSON.stringify(wire)))
  assert.equal(estimatedTokens,estimateDirectorTokens(JSON.stringify(wire)))
  assert.ok(estimatedTokens < inputBytes)
  assert.ok(estimatedTokens + modelContext.outputTokens < modelContext.contextWindow)
  assert.equal(tokenEstimate.approximate,true)
  const catalogue = directorPromptData(request).catalogue
  for (const [kind, rows] of Object.entries(catalogue)) for (const row of rows) {
    // contextual widget arguments move out of the static tools grammar.
    const keys = ['ref','label','directorNote','layer','variants',...(kind === 'widgets' ? ['namespace','commands','stateSchema','caps'] : [])]
    assert.ok(Object.keys(row).every(key=>keys.includes(key)))
  }
})

for (const incremental of [false, true]) test(`${incremental ? 'stage_update' : 'submit_direction'} validates complete refs and rejects all scene creation with zero asset writes`, async () => {
  const f = await fixture(), p = f.prepare(); let saves = 0
  const wrap = ops => incremental ? batch(ops) : { beats: [{ at: 1, ops }] }
  for (const op of [{ op: 'scene.propose', value: { name: 'new', description: 'room' } }, { op: 'newScene', value: {} }, { op: 'scene.set', value: 'classroom' }, scene(null, ref('backgrounds', 'missing')), {op:"music.set", ref:ref('sfx', 'bell')}]) {
    const tx = transact(p, { incremental, assets: { backgrounds: { save: () => saves++ } } })
    assert.equal(tx.submit(wrap([op])).ok, false)
    assert.equal(tx.savepoint().state.entries.length, 0)
  }
  const tx = transact(p, { incremental })
  assert.equal(tx.submit({ ...wrap([]), newScene: { name: 'room' } }).ok, false)
  assert.equal(tx.submit(wrap([scene('dusk', ref('backgrounds', 'classroom'))])).ok, true)
  const result = tx.effect()
  assert.equal(result.format, 'asset-packs-v1'); assert.equal(result.end.lighting.time.ref,null)
  assert.equal(saves, 0)
  const wire = JSON.stringify(tx.request.tools)
  assert.doesNotMatch(wire, /scene.propose|newScene/); assert.match(wire, /oneOf/); assert.doesNotMatch(wire, /packId/); assert.doesNotMatch(wire, /~[a-z0-9]+/)
})

test('unknown/recalled-out full scene cannot bypass the incremental catalogue', async () => {
  const f = await fixture(); f.input.units = ['Unrelated', 'text', 'only']
  const p = f.prepare(), tx = transact(p)
  assert.equal(p.context.catalogue.candidates.backgrounds.length, 0)
  assert.equal(tx.submit(batch([scene()])).ok, false)
})

test('task expiry covers pack revisions, pack set, card, Engine and Story Timeline; no commit or asset save', async () => {
  for (const change of [f => f.input.snapshots[0].revision = 'changed', f => f.input.globalEnabledPackIds = ['55555555-5555-4555-8555-555555555555'], f => f.input.cardRevision = 'card-2', f => f.input.engine.actionCaps = {beat:2} /* current engine mutation */, f => f.input.target.revision++]) {
    const f = await fixture(), p = f.prepare(); let saves = 0
    await assert.rejects(runAssetPackDirector({ prepared: p, getCurrentBinding: () => f.prepare().binding, assets: { backgrounds: { save: () => saves++ } }, runAgent: async input => {
      const accepted = JSON.parse(await modelCall(input,{ name: 'stage_update', arguments: batch([scene()]) }))
      assert.equal(accepted.ok, true); change(f)
    } }), /expired/)
    assert.equal(saves, 0)
  }
})

test('format gate is strict and replay uses captured figure/outfit/time rather than current aliases', async () => {
  const f = await fixture(), p = f.prepare(), tx = transact(p)
  assert.equal(tx.submit(batch([scene('dusk'), { op: 'cast.add', actor: ACTOR }, {op:"actor.outfit.set", outfit:'casual', actor: ACTOR}])).ok, true)
  const record = tx.effect(), frozen = JSON.stringify(record)
  assert.equal(record.end.lighting.time.ref, null, 'global time never chooses a pack look')
  f.input.snapshots[0].figures[FIGURE_ID].aliases = []
  f.input.snapshots[1].figures[OTHER_FIGURE_ID].aliases = [ACTOR]
  assert.deepEqual(assetPackStateAt(record, 1).actors[ACTOR].figure, { packId: PACK_ID, figureId: FIGURE_ID })
  assert.equal(assetPackStateAt(record, 1).actors[ACTOR].outfitKey, 'casual')
  assert.equal(JSON.stringify(record), frozen)
  for (const format of ['stageDirectionV1', 'incremental-v1', undefined]) {
    assert.throws(() => validateAssetPackRecord({ ...record, format }))
    assert.throws(() => prepareAssetPackDirector({ ...f.input, baseline: { ...p.baseline, format } }))
    assert.throws(() => transact(p, { checkpoint: { ...tx.savepoint(), format } }))
  }
  assert.equal(prepareAssetPackDirector({ raw: { name: 'old' } }), null)
})

// durable prefixes remain sealed while bad ops are dropped.
test('incremental partial acceptance, durable prefix resume and stale draft rejection', async () => {
  const f = await fixture(), p = f.prepare(), tx = transact(p)
  const first = batch([scene()], { through: 1, done: false })
  assert.equal(tx.submit(first).ok, true); assert.equal(tx.submit(first).duplicate, true)
  const saved = tx.savepoint()
  const resumed = transact(p, { checkpoint: saved })
  assert.equal(resumed.submit(batch([], { sequence: 2, beats: [{ at: 2, ops: [{ op: 'scene.propose' }] }] })).ok, false)
  // unknown names get a correction round; voluntary model stop seals the surviving prefix.
  assert.equal(resumed.savepoint().state.through, 1)
  resumed.finish()
  assert.equal(resumed.savepoint().state.through, 3)
  assert.equal(resumed.effect().entries.length, 1)
  f.input.snapshots[0].revision = 'changed'
  assert.throws(() => transact(f.prepare(), { checkpoint: saved }), /stale draft/)
})

test('time reducer day to night and same-background changes do not reset location state', () => {
  const looks = ['day', 'night'].map(timeOfDay => ({ ref: ref('looks', timeOfDay), layer: 'time', timeOfDay }))
  let state = initialAssetPackStage({})
  state = reduceAssetPackScene(state, selection('day'), looks).state
  state.camera = { mode: 'close', actor: ACTOR }; state.sound = ['empty']; state.widgets.w = { type: ref('widgets', 'clock'), props: {}, lifetime: { until: 'scene-change' } }
  const result = reduceAssetPackScene(state, selection('night'), looks)
  assert.equal(result.locationChanged, false); assert.equal(result.transitionMs, 2500)
  assert.deepEqual(result.state.camera, state.camera); assert.deepEqual(result.state.sound, ['empty']); assert.ok(result.state.widgets.w)
  assert.equal(result.state.lighting.time.ref,null)
  assert.equal(reduceAssetPackScene(state, selection('night'), looks, { snap: true }).transitionMs, 0)
  const changed = reduceAssetPackScene(state, selection('night', ref('backgrounds', 'classroom', OTHER_PACK_ID)), looks)
  assert.equal(changed.locationChanged, true); assert.deepEqual(changed.state.sound, ['empty']) /* scene changes preserve independent sound */; assert.deepEqual(changed.state.widgets, {})
})

test('global time ignores pack look count, rejects time refs, and keeps typed mood and flat background selection', () => {
  const state = initialAssetPackStage({}), first = { ref: ref('looks', 'night'), layer: 'time', timeOfDay: 'night' }
  const looks = [first, { ...first, ref: ref('looks', 'night', OTHER_PACK_ID) }, { ref: ref('looks', 'calm'), layer: 'mood' }]
  for(const time of ['day','dusk','night',null]) {
    const result=reduceAssetPackScene(state,selection(time),looks)
    assert.deepEqual(result.diagnostics,[])
    assert.equal(result.state.lighting.time.ref,null)
    assert.equal(result.state.scene.timeLook,null)
    assert.equal(result.state.scene.timeOfDay,time)
    assert.deepEqual(result,reduceAssetPackScene(state,selection(time),[]))
  }
  const night=reduceAssetPackScene(state,selection('night'),looks).state
  assert.throws(() => applyAssetPackLight(night, { mode: 'auto' }, looks))
  assert.throws(() => reduceAssetPackScene(state, selection(null, ref('backgrounds', 'classroom'), first.ref), looks))
  assert.throws(() => reduceAssetPackScene(state, selection('night', ref('backgrounds', 'classroom'), first.ref), looks))
  const mood = applyAssetPackLight(night, { mode: 'mood', ref: ref('looks', 'calm') }, looks).state
  assert.deepEqual(reduceAssetPackScene(mood, null, looks).state.lighting.mood, ref('looks', 'calm'))
  assert.throws(() => applyAssetPackLight(state, 'night', looks))
  assert.equal(assetPackLookLayer({ name: 'night' }), null)
  const background={variants:{default:'base',entries:[{id:'base',name:'Base',content:{media:'base'}},{id:'night',name:'Night',content:{media:'night-image'}}]}}
  assert.equal(assetPackBackgroundVariant(background,night.scene).media,'night-image')
  assert.equal(assetPackBackgroundVariant({media:'night-name'},night.scene).media,'night-name')
  assert.equal(assetPackBackgroundVariant({media:'night-name'},night.scene).compensateBackground,true)
})

test('widget full refs, named state validation and item disable revoke carry without rewriting history', async () => {
  const f = await fixture(), p = f.prepare(), tx = transact(p)
  const set = {op:'widget.clock.set',ref:ref('widgets','clock'),label:'Hello'}, id=assetRefKey(set.ref)
  assert.equal(tx.submit(batch([set])).ok, true)
  const record=tx.effect();assert.deepEqual(record.end.widgets[id].ref,set.ref)
  assert.equal(transact(p).submit(batch([{...set,label:42}])).ok,false)
  f.input.snapshots[0].manifest.assets.find(asset=>asset.kind==='widgets').enabled=false
  const next=prepareAssetPackDirector({...f.input,record})
  assert.deepEqual(next.baseline.widgets,{})
  assert.ok(next.diagnostics.some(d=>d.code==='carry-unavailable'))
  assert.ok(record.end.widgets[id],'history is never rewritten')
})

test('disabled dimensions remove admission, catalogue and carried state but not frozen schema', async () => {
  const f = await fixture()
  f.input.engine.dimensions = { music: false, lighting: false, widgets: false, actors: false, sfx: false }
  const p = f.prepare(), request = buildAssetPackRequest(p)
  // the fixed ref-kind vocabulary is grammar, not an enabled command or asset.
  assert.doesNotMatch(JSON.stringify(request.messages), /MUSIC_RULE_SECRET|"music"|"lighting"|widget.show|actor.enter|"sfx"/)
  assert.match(JSON.stringify(request.tools), /music\.clear/)
  assert.ok(!directorPromptData(request).allowedCommands.includes('music.clear'))
  assert.doesNotMatch(request.system, /MUSIC_RULE_SECRET|"music"|"lighting"|"sfx"/)
  assert.equal(transact(p).submit(batch([{ op: 'music.clear' }])).ok, false)
})

// ambience is explicitly directed, never derived from scene/weather.
test('ambience is director-selected, retains full refs and uses handles', async () => {
  const f = await fixture(), p = f.prepare(), tx = transact(p)
  assert.equal(tx.submit(batch([scene(), {op:'ambience.set', refs:[ref('ambience','rain')]}])).ok, true)
  assert.deepEqual(tx.effect().end.soundscape.layer1, ref('ambience', 'rain'))
  assert.ok(directorPromptData(tx.request).catalogue.ambience.length)
  assert.equal(p.context.catalogue.candidates.ambience[0].consumer, 'director')
  // ambience belongs to a place: any beat where the carried loop no longer fits must re-check it, not only a location change.
  const guidance = buildAssetPackRequest(p, true, undefined, '', true).sections.find(row => row.key === 'command-guidance').text
  assert.match(guidance, /ambience\.clear: ambience belongs to a place\. On any beat where the carried layers no longer fit where the story is now/)
  assert.doesNotMatch(guidance, /even across scene/)
})

// retain the first six events and drop only the over-cap event.
test('caps drop only excess ops, preserving accepted events', async () => {
  const f = await fixture(), p = f.prepare(), tx = transact(p)
  const ops = Array.from({ length: 7 }, () => ({op:"screen.play", effect:'flash'}))
  assert.equal(tx.submit(batch(ops)).errors.length, 1)
  assert.equal(tx.effect().entries[0].ops.length, 6)
  assert.equal(tx.effect().end.scene, null)
  assert.equal(assetPackDigest(p), assetPackDigest(clone(p)))
})


test('full-reference control-word IDs remain real assets rather than stop/auto tokens', async () => {
  const f = await fixture(), pack = f.input.snapshots[0]
  const music = pack.manifest.assets.find(a => a.kind === 'music')
  music.id = 'none'; f.input.assetStatus[assetRefKey(ref('music', 'none'))] = { available: true }
  const p = f.prepare(), tx = transact(p)
  assert.equal(tx.submit(batch([scene(), {op:"music.set", ref:ref('music', 'none')}])).ok, true)
  assert.deepEqual(tx.effect().end.music, ref('music', 'none'))
})

test('avatar-only aliases and outfits of other figures are not selectable', async () => {
  const f = await fixture()
  // appearance lives on the figure, not a card alias.
  Object.assign(f.input.snapshots[1].figures[OTHER_FIGURE_ID],{name:'Hidden',aliases:['hidden'],appearance:'avatar'})
  const p = f.prepare()
  assert.equal(p.context.actors.hidden, undefined)
  assert.equal(transact(p).submit(batch([{ op: 'cast.add', actor: 'hidden' }])).ok, false)
  assert.equal(transact(p).submit(batch([{op:"actor.outfit.set", outfit:'not-an-outfit', actor: ACTOR}])).ok, false)
  assert.deepEqual(p.baseline.actors[ACTOR].figure, { packId: PACK_ID, figureId: FIGURE_ID })
  assert.equal(p.baseline.actors[ACTOR].outfitKey, 'school')
})

// figure outfit order supplies defaults, never a per-turn override of the story.
test('figure outfit order initializes and explicitly resets, but preserves the next turn and history', async () => {
  const f = await fixture(), figure = f.input.snapshots[0].figures[FIGURE_ID]
  // Unbound: the director's variant carries into the next turn.
  const free = transact(f.prepare())
  assert.equal(free.submit(batch([{ op: 'cast.add', actor: ACTOR }, {op:"actor.outfit.set", outfit:'casual', actor: ACTOR}])).ok, true)
  assert.equal(prepareAssetPackDirector({ ...f.input, record: free.effect() }).baseline.actors[ACTOR].outfitKey, 'casual')
  figure.outfits.reverse()
  const p = f.prepare()
  assert.equal(p.baseline.actors[ACTOR].outfitKey, 'casual')
  assert.equal(p.context.actors[ACTOR].outfits[0].key, 'casual')
  const tx = transact(p)
  assert.equal(tx.submit(batch([{ op: 'cast.add', actor: ACTOR }, {op:"actor.outfit.set", outfit:'school', actor: ACTOR}])).ok, true, 'the director may still change outfit within a turn')
  const record = tx.effect()
  assert.equal(record.end.actors[ACTOR].outfitKey, 'school')
  assert.equal(assetPackStateAt(record, 1).actors[ACTOR].outfitKey, 'school', 'recorded history is unchanged')
  assert.equal(prepareAssetPackDirector({ ...f.input, record }).baseline.actors[ACTOR].outfitKey, 'school', 'next turn preserves the story outfit')
  const reset = transact(prepareAssetPackDirector({ ...f.input, record }))
  assert.equal(reset.submit(batch([{op:"actor.outfit.set", outfit:'school', actor: ACTOR}, {op:"actor.outfit.reset", actor: ACTOR}])).ok, true)
  assert.equal(reset.effect().end.actors[ACTOR].outfitKey, 'casual')
  // Disabling the opening outfit selects the next enabled figure outfit.
  figure.outfits[0].enabled = false
  assert.equal(f.prepare().baseline.actors[ACTOR].outfitKey, 'school')
  assert.equal(f.prepare().context.actors[ACTOR].boundOutfit, undefined)
})

// Starting from carried silence needs no fabricated scene operation.
for (const incremental of [false, true]) for (const at of [1, 3]) test(`first BGM starts from carried silence at paragraph ${at} (${incremental ? 'incremental' : 'single'})`, async () => {
  const f = await fixture(), silent = transact(f.prepare())
  assert.equal(silent.submit(batch([scene()])).ok, true)
  const prepared = prepareAssetPackDirector({ ...f.input, record: silent.effect() })
  assert.ok(prepared.baseline.scene)
  assert.equal(prepared.baseline.music, null)
  const before = clone(prepared.baseline), tx = transact(prepared, { incremental })
  const beats = [{ at, ops: [{op:"music.set", ref:ref('music', 'classroom')}] }]
  assert.equal(tx.submit(incremental ? batch([], { beats }) : { beats }).ok, true)
  const end = tx.effect().end
  assert.deepEqual(end.scene, before.scene)
  assert.deepEqual(end.music, ref('music', 'classroom'))
  assert.equal(end.pacing.moodChanges, before.pacing.moodChanges)
  assert.deepEqual(prepared.baseline, before)
})

// Music frequency is local to the transaction, including streamed/repaired windows.
for (const incremental of [false,true]) test('music frequency has retryable force override and same-track no-ops ('+incremental+')', async () => {
  const f=await fixture(), p=f.prepare(), tx=transact(p,{incremental})
  const set={op:'music.set',ref:ref('music','classroom')}, stop={op:'music.clear'}
  const submit=beats=>tx.submit(incremental?batch([],{beats}):{beats})
  const beats=[{at:1,ops:[set,set]},{at:2,ops:[stop]}]
  const rejected=submit(beats)
  assert.equal(rejected.ok,false)
  assert.equal(rejected.errors[0].code,'CONFLICT')
  assert.equal(rejected.errors[0].retryable,true)
  assert.ok(rejected.errors[0].choices.some(choice=>choice.force===true))
  assert.match(rejected.errors[0].next_action,/第1段/)
  for (const override of [{force:true}, {reason:'sudden danger'}, {force:true,reason:'   '}]) {
    const error = submit([{at:2,ops:[{...stop,...override}]}]).errors[0]
    assert.equal(error.retryable,true)
    assert.match(error.next_action,/force:true.*reason/)
  }
  assert.equal(submit([{at:2,ops:[{...stop,force:true,reason:'sudden danger'}]}]).ok,true)
  const record=tx.effect()
  assert.equal(record.end.music,null)
  assert.equal(record.entries.flatMap(e=>e.ops).filter(op=>op.op==='music.set').length,1)
  assert.equal(readAssetPackRecord(record).entries.at(-1).ops[0].force,true)
})

// a round restores the BGM player's request key from its own record.
test('every snapshot persists the last director music request; carry keeps it with its music and out of the prompt',async()=>{
  const f=await fixture(),set={op:'music.set',ref:ref('music','classroom')},tx=transact(f.prepare())
  assert.equal(tx.submit(batch([],{beats:[{at:1,ops:[scene(),set]},{at:3,ops:[{op:'music.clear',force:true,reason:'sudden silence'}]}]})).ok,true)
  const record=validateAssetPackRecord(tx.effect()),key=(entry,op)=>[record.binding.target.sourceKey,record.binding.target.branchId,record.binding.generation ?? 0,entry,op]
  assert.equal(record.baseline.musicRequest ?? null,null)
  assert.deepEqual(assetPackStateAt(record,2).musicRequest,{key:key(0,1),ref:set.ref})
  assert.deepEqual(record.end.musicRequest,{key:key(1,0),ref:null,force:true})
  const next=prepareAssetPackDirector({...f.input,record})
  assert.deepEqual(next.baseline.musicRequest,record.end.musicRequest,'an unchanged request keeps its key across rounds')
  assert.doesNotMatch(JSON.stringify(buildAssetPackRequest(next)),/musicRequest/)
  const playing=transact(next)
  assert.equal(playing.submit(batch([set])).ok,true)
  const later=playing.effect()
  assert.deepEqual(later.end.musicRequest.ref,set.ref)
  f.input.snapshots[0].manifest.assets.find(asset=>asset.kind==='music' && asset.id==='classroom').enabled=false
  const carried=prepareAssetPackDirector({...f.input,record:later}).baseline
  assert.deepEqual([carried.music,carried.musicRequest],[null,null])
  assert.deepEqual(later.end.musicRequest.ref,set.ref,'history is never rewritten')
})

test('music frequency survives checkpoints but resets each turn; silence and darkness persist',async()=>{
  const f=await fixture(),p=f.prepare(),tx=transact(p),set={op:'music.set',ref:ref('music','classroom')}
  assert.equal(tx.submit(batch([scene(),set],{through:1,done:false})).ok,true)
  const resumed=transact(p,{checkpoint:tx.savepoint()})
  const later=ops=>batch([],{sequence:2,through:2,done:false,beats:[{at:2,ops}]})
  assert.equal(resumed.submit(later([{op:'music.clear'}])).retryable,true)
  assert.equal(resumed.submit(later([{op:'music.clear',force:true,reason:'another turn'}])).ok,true)
  const third=ops=>batch([],{sequence:3,beats:[{at:3,ops}]})
  assert.equal(resumed.submit(third([set])).ok,true,'restoring the just-cleared track is not churn')
  const restart=transact(prepareAssetPackDirector({...f.input,record:resumed.effect()}))
  assert.equal(restart.submit(batch([set])).ok,true,'next turn may replay the same track without hold')
  const changed=transact(prepareAssetPackDirector({...f.input,record:restart.effect()}))
  assert.equal(changed.submit(batch([{...set,ref:ref('music','classroom',OTHER_PACK_ID)}])).ok,true)
  const stopped=transact(prepareAssetPackDirector({...f.input,record:changed.effect()}))
  assert.equal(stopped.submit(batch([{op:'music.clear'},{op:'scene.clear'}])).ok,true)
  const next=prepareAssetPackDirector({...f.input,record:stopped.effect()}),empty=transact(next)
  assert.equal(empty.submit(batch([])).ok,true)
  assert.equal(empty.effect().end.music,null);assert.equal(empty.effect().end.scene,null)
  const silent = prepareAssetPackDirector({...f.input,record:empty.effect()})
  const request = buildAssetPackRequest(silent,true,undefined,'',true)
  assert.match(request.sections.find(row=>row.key==='music-state').text,/BGM: none \(silence\)/)
  const moved = transact(silent)
  assert.equal(moved.submit(batch([scene('night')])).ok,true)
  assert.equal(moved.effect().end.music,null,'a scene change does not restart music')
  const invalid=transact(next)
  assert.equal(invalid.submit(batch([{...set,ref:ref('music','missing'),force:true,reason:'not an admission bypass'}])).ok,false)
  assert.equal(invalid.savepoint().state.state.music,null)
})

// A foreign identity suffix stays invalid; feedback repairs the dependent beat as a unit.
test('unknown handles and same-beat scene dependencies are retryable through the model envelope', async () => {
  const f=await fixture()
  for (const pack of f.input.snapshots) for (const asset of pack.manifest.assets) {
    if (asset.kind === 'backgrounds') asset.name = '住宅-玄关'
  }
  const prepared=f.prepare(),tx=transact(prepared),request=buildAssetPackRequest(prepared)
  const handle=modelHandle(request,ref('backgrounds','classroom'))
  const wrong=handle+'x'
  assert.notEqual(wrong,handle)
  const transition={op:'transition.play',transition:'fade'}
  const result=tx.submitModel(batch([{op:'scene.set',background:wrong,time:'night'},transition]))
  assert.equal(result.schema_version,1)
  assert.equal(result.outcome,'not_applied')
  assert.equal(result.errors.length,2)
  assert.equal(result.errors[0].received,wrong)
  assert.ok(result.errors[0].choices.includes(handle))
  assert.match(result.errors[0].message,/Unknown backgrounds handle.*copy the full listed handle/)
  assert.equal(result.errors[1].code,'CONFLICT')
  assert.equal(result.errors[1].retryable,true)
  assert.ok(result.errors[1].next_action.includes('Repair $.beats[0].ops[0] first'))
  assert.equal(tx.submitModel(batch([{op:'scene.set',background:handle,time:'night'},transition])).ok,true)
  assert.deepEqual(tx.effect().end.scene.background,ref('backgrounds','classroom'))
  assert.equal(tx.effect().entries[0].ops.length,2)
})

test('music performance guidance stays outside the frozen tool syntax', async () => {
  const f=await fixture(), request=buildAssetPackRequest(f.prepare(),true,undefined,'',true)
  const grammar=JSON.stringify(request.tools), music=request.sections.find(row=>row.key==='music-state').text
  assert.match(grammar,/With reason for further music changes; not same-track resume/)
  assert.doesNotMatch(grammar,/scene change|mood turn|finisher|narrated stop|clue found/)
  for(const cue of ['already set; omit to keep','keep the current track across replies','scene or mood turn','not a new reply or candidate','where the story explicitly resumes it','honor stopped music in player_input or the reply','ambience-only silence','Further music changes in this reply need force:true and reason','except restoring the just-cleared track'])assert.ok(music.includes(cue),cue)
  assert.equal((music.match(/BGM:/g)||[]).length,1)
  assert.equal(directorPromptData(request).carried.music,undefined)
})

test('carried BGM and background remain stoppable without recalled replacement assets', async () => {
  const f = await fixture(), first = transact(f.prepare())
  assert.equal(first.submit(batch([scene(),{op:'music.set',ref:ref('music','classroom')}])).ok,true)
  for (const pack of f.input.snapshots) for (const asset of pack.manifest.assets) {
    if (['music','backgrounds'].includes(asset.kind)) asset.recall = {mode:'keyword',keywords:['unique-trigger']}
  }
  f.input.units = ['The music stops.', 'The lights go out; pitch darkness.', 'Still silent.']
  const p = prepareAssetPackDirector({...f.input,record:first.effect()})
  assert.equal(p.context.catalogue.candidates.music.length,0)
  assert.equal(p.context.catalogue.candidates.backgrounds.length,0)
  const request = buildAssetPackRequest(p,true,undefined,'',true), allowed = directorPromptData(request).allowedCommands
  assert.ok(allowed.includes('music.clear') && allowed.includes('scene.clear'))
  assert.ok(!allowed.includes('music.set') && !allowed.includes('scene.set'))
  const hints = request.sections.find(row => row.key === 'cue-guidance').text
  const musicState=request.sections.find(row=>row.key==='music-state').text
  assert.match(musicState,/BGM: [\s\S]+music.clear/)
  assert.doesNotMatch(musicState,/music.set|force:/)
  assert.equal(directorPromptData(request).carried.music,undefined,'state is not repeated')
  assert.match(hints,/otherwise it stays visible/)
  assert.match(hints,/lights go out and the scene turns pitch dark/)
  assert.doesNotMatch(hints,/music.set/)
  const empty = structuredClone(p)
  empty.baseline.music = null; empty.baseline.scene = null
  const emptyRequest = buildAssetPackRequest(empty,true,undefined,'',true)
  assert.ok(!emptyRequest.sections.some(row => row.key === 'cue-guidance'))
  assert.equal(emptyRequest.system,request.system,'lifecycle hints do not churn the fixed prefix')
  assert.deepEqual(emptyRequest.tools,request.tools,'persistent state does not change the grammar')
  const tx = transact(p)
  assert.equal(tx.submit(batch([{op:'music.clear'},{op:'scene.clear'}])).ok,true)
  assert.equal(tx.effect().end.music,null)
  assert.equal(tx.effect().end.scene,null)
})

test('same-place time changes preserve mood dwell and do not reset quotas', async () => {
  const f = await fixture(), pack = f.input.snapshots[0]
  for (const id of ['warm', 'cold']) {
    pack.manifest.assets.push({ kind: 'looks', id, name: id, enabled: true, recall: { mode: 'constant', keywords: [] }, directorNote: '', layer: 'mood', params: {} })
    f.input.assetStatus[assetRefKey(ref('looks', id))] = { available: true }
  }
  f.input.units = Array(14).fill('Synthetic')
  const p = f.prepare(), first = transact(p)
  const mood = id => ({op:"lighting.mood.set", ref:ref('looks', id)})
  const tx = transact(p)
  assert.equal(tx.submit({ sequence: 1, through: 14, done: true, beats: [
    { at: 1, ops: [scene('day'), mood('warm'), {op:"music.set", ref:ref('music', 'classroom')}] },
    { at: 2, ops: [scene('night'), mood('cold')] }
  ] }).ok, false)
  assert.equal(first.submit({ sequence: 1, through: 14, done: true, beats: [
    { at: 1, ops: [scene('day'), mood('warm'), {op:"music.set", ref:ref('music', 'classroom')}] },
    { at: 9, ops: [scene('night'), mood('cold')] }
  ] }).ok, true)
  const record = first.effect()
  assert.equal(record.entries[1].timeTransitionMs, 2500)
  assert.equal(record.end.pacing.moodChanges, 1)
  const next = prepareAssetPackDirector({ ...f.input, record })
  assert.equal(transact(next).submit({ sequence: 1, through: 14, done: true, beats: [{ at: 1, ops: [scene('day'), mood('warm')] }] }).ok, false)
})

test('camera duration is paragraph based and historical projection is immutable', async () => {
  const f = await fixture(); f.input.units = Array(8).fill('Synthetic')
  const p = f.prepare(), tx = transact(p)
  assert.equal(tx.submit({ sequence: 1, through: 8, done: true, beats: [{ at: 1, ops: [{ op: 'cast.add', actor: ACTOR }, {op:"closeup.play", actor:ACTOR}] }] }).ok, true)
  const record = tx.effect(), bytes = JSON.stringify(record)
  assert.equal(assetPackStateAt(record, 4).camera.mode, 'close')
  assert.equal(assetPackStateAt(record, 5).camera.mode, 'reset')
  assert.equal(record.end.camera.mode, 'reset')
  assert.equal(JSON.stringify(record), bytes)
})

test('resume request reports durable nextSequence and through, without replaying accepted prefix', async () => {
  const f = await fixture(), p = f.prepare(), tx = transact(p)
  assert.equal(tx.submit(batch([scene()], { through: 1, done: false })).ok, true)
  const checkpoint = tx.savepoint()
  // restored sealed prefixes publish before the resumed model request.
  let saved = 0
  const previews = []
  const result = await runAssetPackDirector({ prepared: p, checkpoint, publishPreview:value => previews.push(value), getCurrentBinding: () => p.binding, saveCheckpoint: async draft => { saved++; assert.equal(draft.format, 'asset-packs-v1') }, runAgent: async input => {
    assert.equal(previews.length,1); assert.equal(previews[0].through,1); assert.equal(saved,0)
    const data = directorPromptData(input)
    assert.equal(data.progress.nextSequence, 2); assert.equal(data.progress.through, 1)
    assert.deepEqual(data.carried.scene.background, modelHandle(input,ref('backgrounds', 'classroom')))
    assert.equal(JSON.parse(await modelCall(input,{ name: 'stage_update', arguments: { sequence: 2, through: 3, done: true, beats: [] } })).ok, true)
  } })
  assert.equal(saved, 1); assert.equal(result.effect.entries.length, 1)
  assert.equal(previews.length,2); assert.equal(previews[1].through,3); assert.equal(previews[1].complete,false)
})

test('malformed calls remain repairable regardless of retired Engine limits; cancellation and unsafe props are atomic', async () => {
  const f = await fixture(); f.input.engine.limits = { maxToolCalls: 2 }
  const p = f.prepare(), tx = transact(p)
  assert.equal(tx.submit(null).ok, false); assert.equal(tx.submit(undefined).ok, false)
  assert.equal(tx.terminal(), false); assert.equal(tx.savepoint().state.calls, 2)
  const controller = new AbortController(); controller.abort()
  assert.equal(transact(p, { signal: controller.signal }).submit(batch([])).ok, false)
  const unsafe = JSON.parse('{"__proto__":{"x":1}}')
  assert.equal(transact(p).submit(batch([{op:"widget.show", ref:ref('widgets', 'clock'), widgetId: 'clock', props: unsafe}])).ok, false)
  assert.equal({}.x, undefined)
})


// Global time is not a recalled asset; special mood looks still use authored lamps.
test('retired time looks never enter recall while mood lamps remain authoritative', async () => {
  const f = await fixture(), pack = f.input.snapshots[0]
  const template = pack.manifest.assets.find(a => a.kind === 'looks')
  pack.manifest.assets = pack.manifest.assets.filter(a => a.kind !== 'looks')
  for (const id of ['day', 'dusk', 'night', 'mood']) {
    const asset = { ...distinctMedia(template,'look-' + id), id, name: 'Unrelated preset', layer: id === 'mood' ? 'mood' : 'time',
      timeOfDay: id, recall: { mode: id === 'mood' ? 'keyword' : 'constant', keywords: [] } }
    if (id === 'mood') delete asset.timeOfDay
    pack.manifest.assets.push(asset)
    f.input.assetStatus[assetRefKey(ref('looks', id))] = { available: true }
  }
  const options = { units: ['No matching words'], thresholds: { looks: 1 } }
  const catalogue = f.recall(options)
  const own = catalogue.candidates.looks.filter(row => row.ref.packId === PACK_ID)
  assert.deepEqual(own,[])
  assert.deepEqual(catalogue.diagnostics,[])
  assert.equal(catalogue.rows.find(row => row.ref.assetId === 'mood').excluded, 'no-trigger')
  assert.deepEqual(catalogue, f.recall(options))
  const prepared = f.prepare(), request = buildAssetPackRequest(prepared)
  const sent = directorPromptData(request).catalogue.looks
  for (const id of ['day', 'dusk', 'night']) {
    assert.equal(prepared.context.catalogue.candidates.looks.some(row => row.ref.packId===PACK_ID && row.ref.assetId === id),false)
    assert.equal(sent?.some(row => row.layer === 'time') || false,false)
  }
  pack.manifest.assets.find(a => a.id === 'day').enabled = false
  delete f.input.assetStatus[assetRefKey(ref('looks', 'night'))]
  assert.deepEqual(f.recall(options).candidates.looks.filter(row => row.ref.packId === PACK_ID),[])
  pack.manifest.assets.find(a=>a.id==='mood').recall.mode='constant'
  assert.deepEqual(f.recall(options).candidates.looks.filter(row=>row.ref.packId===PACK_ID).map(row=>row.ref.assetId),['mood'])
  assert.equal(f.recall({ ...options, boundPackIds: [] }).candidates.looks.length, 0)
})


test('source-linked phone markers keep avatar-only contacts but cannot invent dialogue', async () => {
  const f = await fixture()
  // contacts require an exact figure identity; unknown names cannot borrow one.
  Object.assign(f.input.snapshots[1].figures[OTHER_FIGURE_ID],{name:'Contact',aliases:['contact'],appearance:'avatar'})
  f.input.units = [{ kind: 'line', alias: 'contact', text: 'Synthetic source bubble' }, { kind: 'narration', text: 'Later' }, { kind: 'narration', text: 'End' }]
  // use an enabled source command, not the retired phone.mark alias (old ok:true hid its rejection).
  f.input.snapshots[0].widgets.clock.commands.push({name:'mark',summary:'Mark source dialogue.',effect:'source.mark',params:{type:'object',properties:{contact:{type:'string'},side:{enum:['in','out']}},required:['contact','side'],additionalProperties:false}})
  const p = f.prepare(), marker = {op:'widget.clock.mark',ref:ref('widgets','clock'),contact:p.context.speakerActors.contact,side:'in'}
  assert.equal(p.context.actors.contact, undefined)
  assert.equal(transact(p).submit(batch([marker])).ok, true)
  assert.equal(transact(p).submit(batch([{ ...marker, text: 'invented' }])).ok, false)
  assert.equal(transact(p).submit(batch([marker, marker])).ok, false)
  assert.equal(transact(p).submit(batch([], { beats: [{ at: 2, ops: [marker] }] })).ok, false)
})


test('a swallowed checkpoint failure still prevents a publishable effect', async () => {
  const f = await fixture(), p = f.prepare()
  let published = 0 // failed durable writes never expose the draft prefix.
  await assert.rejects(runAssetPackDirector({ prepared: p, getCurrentBinding: () => p.binding, publishPreview:() => published++, saveCheckpoint: async () => { throw new Error('checkpoint disk failure') }, runAgent: async input => {
    try { await modelCall(input,{ name: 'stage_update', arguments: batch([scene()]) }) } catch {}
  } }), /checkpoint disk failure/)
  assert.equal(published,0)
})

// reset uses the first stored outfit, not a parallel selector.
test('director baseline and reset use stored outfit order', async () => {
  const f=await fixture()
  f.input.snapshots[0].figures[FIGURE_ID].outfits.reverse()
  const prepared=f.prepare(), tx=transact(prepared)
  assert.equal(tx.submit(batch([{op:"actor.outfit.set", outfit:'school', actor:ACTOR},{op:"actor.outfit.reset", actor:ACTOR}])).ok,true)
  assert.equal(tx.effect().end.actors[ACTOR].outfitKey,'casual')
})
// frozen pack ruler inputs replace display-lock sidecars.
test('pack ruler freezes heights, replays only prefixes, carries across turns and resets only at a director cut', async () => {
  const f=await fixture(), extension=f.input.raw.extensions.dsh_tavern
  const first=f.input.snapshots[0].figures[FIGURE_ID];first.heightCm=160
  const second=distinctMedia(first,'tall-figure');second.id=OTHER_FIGURE_ID;second.heightCm=220
  f.input.snapshots[0].figures[OTHER_FIGURE_ID]=second
  f.input.snapshots[0].manifest.figures.push(OTHER_FIGURE_ID)
  Object.assign(f.input.baseline.actors,initialAssetPackStage({[TALL]:{figure:{packId:PACK_ID,figureId:OTHER_FIGURE_ID},outfits:[]}}).actors)
  const p=f.prepare(), tx=transact(p)
  assert.equal(p.baseline.actors[ACTOR].ruler.heightCm,160)
  assert.equal(tx.submit(batch([], {sequence:1,through:1,done:false,beats:[{at:1,ops:[scene(),{op:'cast.add',actor:ACTOR}]}]})).ok,true)
  const prefix=clone(tx.savepoint().state.entries[0].state.figureScale)
  assert.equal(prefix.hMax,160)
  assert.equal(tx.submit(batch([], {sequence:2,through:3,done:true,beats:[{at:2,ops:[{op:'cast.add',actor:TALL}]},{at:3,ops:[{op:'cast.remove',actor:TALL}]}]})).ok,true)
  const saved=tx.effect()
  assert.deepEqual(assetPackStateAt(saved,1).figureScale,prefix)
  const entrance=assetPackStateAt(saved,2).figureScale
  assert.equal(entrance.hMax,220);assert.equal(entrance.rescales,1)
  assert.deepEqual(entrance.event,{kind:'rescale',at:2,from:160,warning:'mid-scene rescale'})
  assert.equal(assetPackStateAt(saved,3).figureScale.hMax,220)
  assert.equal(saved.end.figureScale.hMax,220);assert.equal(saved.end.figureScale.event,undefined)
  first.heightCm=900;second.heightCm=20
  assert.deepEqual(assetPackStateAt(JSON.parse(JSON.stringify(saved)),1).figureScale,prefix)
  assert.equal(assetPackStateAt(saved,2).actors[TALL].ruler.heightCm,220)
  f.input.record=saved;f.input.target={...f.input.target,sourceKey:'reply-2'}
  const carried=f.prepare(), continued=transact(carried)
  assert.equal(carried.baseline.figureScale.hMax,220)
  assert.equal(continued.submit(batch([])).ok,true)
  assert.equal(continued.effect().end.figureScale.hMax,220)
  const cut=transact(carried)
  assert.equal(cut.submit(batch([scene(),{op:"transition.play", transition:'cut'}])).ok,true)
  assert.equal(cut.effect().end.figureScale.hMax,900) // a new cut uses this turn's newly frozen inputs
  assert.equal(cut.effect().end.figureScale.scene,saved.end.figureScale.scene+1)
})
test('strict pack record rejects unknown ruler fields and invalid frozen inputs',async()=>{
  const f=await fixture(),tx=transact(f.prepare());assert.equal(tx.submit(batch([scene(),{op:'cast.add',actor:ACTOR}])).ok,true)
  const saved=tx.effect()
  for(const mutate of [r=>r.baseline.actors[ACTOR].ruler.heightCm=0,r=>r.entries[0].state.figureScale.locked=true,r=>r.end.figureScale.hMax=Infinity]) {
    const bad=clone(saved);mutate(bad);assert.throws(()=>validateAssetPackRecord(bad))
  }
})
// the wire contract has three times; only saved snapshots normalize the retired value.
test('three time choices reject retired live commands but parse saved morning as day', async () => {
  const f = await fixture(), prepared = f.prepare()
  const { TIMES_OF_DAY } = await import('../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js')
  assert.deepEqual(TIMES_OF_DAY, ['day', 'dusk', 'night'])
  assert.equal(transact(prepared).submit(batch([scene('morning')])).ok, false)
  const tx = transact(prepared)
  assert.equal(tx.submit(batch([scene('day')])).ok, true)
  const saved = tx.effect()
  // This fixture is explicitly a pre-registry record, not a legacy write alias.
  delete saved.binding.commandSpecVersion; delete saved.binding.registryDigest
  saved.entries[0].ops[0] = {op:'scene.set',value:{background:saved.entries[0].ops[0].background,timeOfDay:'morning'}}
  saved.entries[0].state.scene.timeOfDay = saved.end.scene.timeOfDay = 'morning'
  saved.digest = assetPackDigest({ binding:saved.binding, baseline:saved.baseline, entries:saved.entries, end:saved.end })
  const before = clone(saved), parsed = readAssetPackRecord(saved)
  // preserve authenticated history; normalize only its render projection.
  assert.equal(parsed.end.scene.timeOfDay, 'morning')
  assert.equal(parsed.digest, saved.digest)
  assert.deepEqual(parsed.entries[0].ops, saved.entries[0].ops)
  assert.equal(assetPackStateAt(parsed, 1).scene.timeOfDay, 'day')
  assert.deepEqual(saved, before)
  assert.throws(() => validateAssetPackRecord({...saved,digest:'bad'}), /digest/)
})
// 扬尘 is retired — no longer a command; saved history with it projects to no weather.
test('retired dust weather is rejected live and saved dust projects to no weather', async () => {
  const f = await fixture(), prepared = f.prepare()
  assert.equal(transact(prepared).submit(batch([{op:'weather.set',weather:'dust'}])).ok, false)
  const tx = transact(prepared)
  assert.equal(tx.submit(batch([{op:'weather.set',weather:'rain'}])).ok, true)
  const saved = tx.effect()
  saved.entries[0].ops = saved.entries[0].ops.map(op => op.op === 'stage.patch' ? {...op,value:{weather:'dust'}} : op)
  saved.entries[0].state.weather = saved.end.weather = 'dust'
  saved.digest = assetPackDigest({ binding:saved.binding, baseline:saved.baseline, entries:saved.entries, end:saved.end })
  const parsed = readAssetPackRecord(saved)
  assert.equal(parsed.end.weather, 'dust')
  assert.equal(assetPackStateAt(parsed, 1).weather, 'none')
})


test('frozen rulers use outfit anatomy and explicit elevation, including variant changes', async () => {
  const f = await fixture(), figure = f.input.snapshots[0].figures[FIGURE_ID]
  figure.elevationCm = 14
  figure.outfits[0].sprite.anatomy = {calm:{headRatio:1.15}}
  figure.outfits[1].live2d.anatomy = {headRatio:1.3}
  const prepared = f.prepare(), tx = transact(prepared)
  assert.equal(prepared.context.actors[ACTOR].ruler.headRatio,1.15)
  assert.equal(prepared.context.actors[ACTOR].ruler.elevationCm,14)
  const result = tx.submit(batch([{op:"actor.outfit.set", outfit:figure.outfits[1].key, actor:ACTOR}]))
  assert.equal(result.ok,true)
  assert.equal(tx.effect().end.actors[ACTOR].ruler.headRatio,1.3)
})

// canonical persistence invariant; no-op turns must not reapply card defaults.
test('pajamas and all persistent stage channels survive no-op turns, re-entry and partial updates', async () => {
  const f = await fixture(), ext = f.input.raw.extensions.dsh_tavern
  Object.assign(f.input.snapshots[0].figures[FIGURE_ID].outfits[1], {key:'pajamas',label:'睡衣',recall:{mode:'keyword',keywords:[]}})
  f.input.units[0] = 'Synthetic fixture. 换上睡衣。'
  // Independent actors use distinct figure references.
  f.input.baseline.actors[FRIEND] = {...clone(f.input.baseline.actors[ACTOR]),figure:{packId:OTHER_PACK_ID,figureId:OTHER_FIGURE_ID}}
  const first = transact(f.prepare())
  assert.equal(first.submit(batch([scene('night'),
    {op:'cast.add', actor:FRIEND, position:'right'},
    {op:'cast.add', actor:ACTOR, position:'left'},
    {op:"actor.outfit.set", outfit:'pajamas', actor:ACTOR},
    {op:"actor.gaze.set", actor:ACTOR, target:'away'}, {op:"actor.light.set", actor:ACTOR, light:'shadow'},
    {op:"music.set", ref:ref('music','classroom')},
    {op:"weather.set", weather:'rain'}, {op:'ambience.set', refs:[ref('ambience','rain')]} , {op:"camera.set", mode:'wide'}
  ])).ok, true)
  const original = first.effect(), saved = clone(original)
  assert.deepEqual(original.end.cast, [ACTOR,FRIEND], 'ordered cast is persistent positioning')
  let record = original
  f.input.units[0] = 'Unchanged story.' // yesterday's keyword is absent, but the outfit persists.
  for (let turn = 2; turn <= 4; turn++) {
    const prepared = prepareAssetPackDirector({...f.input, record, target:{...f.input.target, sourceKey:'reply-' + turn, revision:turn}})
    for (const key of ['actors','cast','scene','music','lighting','weather','sound','soundscape','camera','widgets','widgetTime']) {
      assert.deepEqual(prepared.baseline[key], original.end[key], key + ' persists at turn start')
    }
    const request = buildAssetPackRequest(prepared)
    const prompt = directorPromptData(request)
    assert.equal(prompt.carried.actors[modelHandle(request,ACTOR)].outfit, 'pajamas')
    assert.deepEqual(prompt.actors[modelHandle(request,ACTOR)].outfits.map(outfit => outfit.key), ['school','pajamas'])
    const tx = transact(prepared)
    assert.equal(tx.submit(batch([], {beats:[]})).ok, true, 'unchanged outfits/state require no output')
    record = tx.effect()
    for (const key of ['actors','cast','scene','music','lighting','weather','sound','soundscape','camera','widgets','widgetTime']) assert.deepEqual(record.end[key], original.end[key])
  }
  const tx = transact(prepareAssetPackDirector({...f.input, record}))
  assert.equal(tx.submit(batch([{op:'cast.remove',actor:ACTOR}, {op:'cast.add',actor:ACTOR,position:'right'}, {op:"actor.gaze.set", actor:ACTOR, target:'viewer'}])).ok, true)
  assert.equal(tx.effect().end.actors[ACTOR].outfitKey, 'pajamas', 're-entry does not reset outfit')
  assert.equal(tx.effect().end.actors[ACTOR].figureLight, 'shadow', 'partial actor patch preserves omitted fields')
  assert.deepEqual(tx.effect().end.scene, original.end.scene)
  const reset = transact(prepareAssetPackDirector({...f.input, record:tx.effect()}))
  assert.equal(reset.submit(batch([{op:"actor.outfit.reset", actor:ACTOR}, {op:'scene.clear'}, {op:'music.clear'}])).ok, true)
  assert.equal(reset.effect().end.actors[ACTOR].outfitKey, 'school')
  assert.equal(reset.effect().end.music, null)
  assert.equal(reset.effect().end.scene, null)
  assert.deepEqual(original, saved, 'carry/reset never rewrite recorded history')
})

test('temporary outfit guidance and carried state let the director restore default only at the story change',async t=>{
  const f=await fixture(),figure=f.input.snapshots[0].figures[FIGURE_ID]
  Object.assign(figure.outfits[1],{key:'basin',label:'头顶脸盆',guidance:'临时搞笑道具；摘下或笑点结束时恢复原服装。'})
  f.input.units[0]='她顶上脸盆。'
  const first=transact(f.prepare())
  assert.equal(first.submit(batch([{op:'actor.outfit.set',actor:ACTOR,outfit:'basin'}])).ok,true)
  f.input.units[0]='她摘下脸盆，恢复平常衣着。'
  const prepared=prepareAssetPackDirector({...f.input,record:first.effect()})
  const request=buildAssetPackRequest(prepared,true,undefined,'',true),data=directorPromptData(request)
  assert.equal(data.carried.actors[modelHandle(request,ACTOR)].outfit,'basin')
  assert.match(request.system,/putting away a temporary prop or ending its gag/)
  assert.match(request.system,/actor\.outfit\.reset returns to the default/)
  assert.match(request.system,/Keep the outfit across scenes and re-entries unless it changes/)
  assert.match(request.system,/shadow silhouettes only strong backlight \(sunset\/spotlight\/glare\) or deliberately hidden identity/)
  assert.match(request.system,/keep lit for ordinary backlight, night or emotion \(including sadness\)/)
  assert.match(JSON.stringify(request),/临时搞笑道具/)
  const tx=transact(prepared)
  assert.equal(tx.submit(batch([{op:'actor.outfit.reset',actor:ACTOR}])).ok,true)
  assert.equal(tx.effect().end.actors[ACTOR].outfitKey,'school')
  assert.equal(first.effect().end.actors[ACTOR].outfitKey,'basin','No automatic expiration or history rewrite')
  t.diagnostic(JSON.stringify({commandGuidanceBytes:request.sections.find(row=>row.key==='command-guidance').bytes,toolSchemaBytes:Buffer.byteLength(JSON.stringify(request.tools[0].parameters))}))
})

// editing opening order is not a reset of an already worn outfit.
test('adding an empty opening outfit preserves an existing stage outfit until explicit reset', async () => {
  const f = await fixture(), tx = transact(f.prepare())
  assert.equal(tx.submit(batch([{op:'cast.add',actor:ACTOR},{op:'actor.outfit.set',actor:ACTOR,outfit:'casual'}])).ok,true)
  const record=tx.effect(), saved=clone(record)
  f.input.snapshots[0].figures[FIGURE_ID].outfits.unshift({key:'empty',label:'Empty',enabled:true})
  const next=prepareAssetPackDirector({...f.input,record}), noop=transact(next)
  assert.equal(next.baseline.actors[ACTOR].outfitKey,'casual')
  assert.equal(noop.submit(batch([],{beats:[]})).ok,true)
  assert.equal(noop.effect().end.actors[ACTOR].outfitKey,'casual')
  const reset=transact(next)
  assert.equal(reset.submit(batch([{op:'actor.outfit.reset',actor:ACTOR}])).ok,true)
  assert.equal(reset.effect().end.actors[ACTOR].outfitKey,'empty')
  assert.deepEqual(record,saved)
})

// unavailable outfits fall back only for future state, never historical replay.
for (const unavailable of ['removed', 'disabled']) test('persisted outfit ' + unavailable + ' falls back to first enabled figure outfit', async () => {
  const f = await fixture(), figure = f.input.snapshots[0].figures[FIGURE_ID]
  figure.outfits.reverse()
  const pajamas = clone(figure.outfits[0]); pajamas.key = 'pajamas'; figure.outfits.push(pajamas)
  assert.equal(f.prepare().baseline.actors[ACTOR].outfitKey, 'casual', 'new chat initializes from figure order')
  const tx = transact(f.prepare())
  assert.equal(tx.submit(batch([{op:"actor.outfit.set", outfit:'pajamas', actor:ACTOR}])).ok, true)
  const record = tx.effect(), saved = clone(record)
  if (unavailable === 'removed') figure.outfits.pop()
  else pajamas.enabled = false
  const carry = () => prepareAssetPackDirector({...f.input, record}).baseline.actors[ACTOR]?.outfitKey
  assert.equal(carry(), 'casual')
  figure.outfits[0].enabled = false
  assert.equal(carry(), 'school')
  assert.equal(f.prepare().baseline.actors[ACTOR].outfitKey, 'school')
  figure.outfits[1].enabled = false
  assert.equal(carry(), undefined, 'no stage-capable outfit means no director actor')
  assert.equal(f.prepare().baseline.actors[ACTOR], undefined)
  assert.equal(assetPackStateAt(record, 1).actors[ACTOR].outfitKey, 'pajamas')
  assert.deepEqual(record, saved)
})

// default outfit selection adds no duplicate prompt metadata or schema/output burden.
test('outfit default uses existing choices with zero prompt/schema byte growth and supports empty deltas', async () => {
  const f = await fixture()
  const before = buildAssetPackRequest(f.prepare(), true, undefined, '', true)
  f.input.snapshots[0].figures[FIGURE_ID].outfits.reverse()
  const prepared = f.prepare(), after = buildAssetPackRequest(prepared, true, undefined, '', true)
  const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
  assert.equal(bytes(after.tools[0].parameters), bytes(before.tools[0].parameters))
  for (const section of after.sections) {
    const previous = before.sections.find(item => item.key === section.key)
    assert.ok(bytes(section.text) <= bytes(previous.text), section.key + ' adds zero bytes for equal-length outfit keys')
  }
  assert.ok(after.inputBytes <= before.inputBytes)
  assert.match(after.system, /anything you don't change stays as it is/)
  for (const incremental of [true, false]) {
    const tx = transact(prepared, {incremental})
    assert.equal(tx.submit(incremental ? batch([], {beats:[]}) : {beats:[]}).ok, true)
    assert.equal(tx.effect().end.actors[ACTOR].outfitKey, 'casual')
  }
})

// retired camera quotas cannot reject ordinary framing changes, including after resume.
test('camera changes have no count quota across batches and resumed checkpoints', async () => {
  const f = await fixture()
  f.input.engine = {...defaultAssetEngineSettings(), ...f.input.engine, actionCaps:{...defaultAssetEngineSettings().actionCaps,cam:1}}
  const p = f.prepare(), tx = transact(p)
  assert.equal(p.context.actionCaps.cam,undefined)
  assert.equal(p.context.actionCaps.camera,undefined)
  const camera = mode => ({op:"camera.set", mode:mode})
  const first = batch([camera('wide')],{through:1,done:false})
  assert.equal(tx.submit(first).ok,true)
  assert.equal(tx.submit(first).duplicate,true)
  const checkpoint = tx.savepoint(), resumed = transact(p,{checkpoint})
  const rejected = resumed.submit(batch([camera('push')],{sequence:2,beats:[{at:2,ops:[camera('push')]}]}))
  assert.equal(rejected.ok,true)
  assert.equal(rejected.progress.through,3)
  assert.deepEqual(resumed.preview().entries.slice(0,1),tx.preview().entries)
  assert.equal(resumed.effect().end.camera.mode,'push')
  const atomic = transact(p)
  assert.equal(atomic.submit(batch([camera('wide'),camera('push')])).errors.length,0)
  assert.equal(atomic.preview().entries[0].ops.length,2)
  const full = createAssetPackTransaction({prepared:p,incremental:false,getCurrentBinding:()=>p.binding})
  assert.equal(full.submit({beats:[{at:1,ops:[camera('wide'),camera('push')]}]}).errors.length,0)
  assert.equal(full.preview().entries[0].ops.length,2)
})

// retired emote settings cannot silently reinstate a whole-turn quota.
test('emote cap is removed from Engine configuration and command accounting',async()=>{
  const old=defaultAssetEngineSettings();old.actionCaps.emote=8
  const clean=validateAssetEngineSettings(old)
  assert.equal(clean.actionCaps.emote,undefined)
  assert.equal(old.actionCaps.emote,8,'normalization must not mutate caller data')
  const f=await fixture();f.input.engine=old
  const prepared=f.prepare(),tx=transact(prepared)
  const result=tx.submit(batch([{op:'cast.add',actor:ACTOR},...Array.from({length:20},()=>({op:'actor.emote.play',actor:ACTOR,symbol:'note'}))]))
  assert.equal(result.ok,true,JSON.stringify(result))
  assert.equal(result.errors.length,0)
  assert.equal(tx.effect().entries.flatMap(e=>e.ops).filter(op=>op.op==='actor.emote.play').length,20)
})


test('production director prefixes gated framework rules and previews exact ordered mod bytes',async()=>{
  const f=await fixture(),plain=buildAssetPackRequest(f.prepare(),true,undefined,'',true)
  assert.deepEqual(buildAssetPackRequest(prepareAssetPackDirector({...f.input,modPrompts:[]}),true,undefined,'',true),plain)
  const fragment=(id,section,order,text)=>({modId:'dsh.demo',id,type:'prompt',source:'prompts/'+id+'.txt',placement:{section,order},text})
  const modPrompts=[fragment('later','director.rules.presentation',20,'Later rule'),fragment('early','director.rules.presentation',10,'Early rule'),fragment('command','director.commands.presentation',5,'demo mark label=<text>'),fragment('catalogue','director.catalogue',0,'Demo catalogue')]
  const prepared=prepareAssetPackDirector({...f.input,modPrompts})
  modPrompts[0].text='Caller changed input'
  const sent=buildAssetPackRequest(prepared),preview=buildAssetPackRequest(prepared,true,undefined,'',true)
  for(const key of ['system','messages','tools'])assert.deepEqual(preview[key],sent[key])
  const rows=preview.sections.filter(row=>row.source.kind==='mod')
  assert.deepEqual(rows.map(row=>row.source.id),['early','later','command','catalogue'])
  // each mod section says what it is; the preview adds the mod's display name.
  assert.deepEqual(rows.map(row=>row.source.role),['rules','rules','rules','context'])
  const roleOf=fragment=>buildAssetPackRequest(prepareAssetPackDirector({...f.input,modPrompts:[fragment]}),true,undefined,'',true).sections.find(row=>row.source.kind==='mod').source.role
  assert.deepEqual([{type:'command',source:'manifest.commands.mark'},{type:'catalogue',source:'library',placement:{section:'director.catalogue',order:0}},{type:'prompt',source:'stage.modState'}].map(row=>roleOf({...fragment('x','director.commands.presentation',0,'x'),...row})),['commands','candidates','state'])
  const named=nameModSections(preview.sections,{'dsh.demo':'演示模组'})
  assert.deepEqual(named.filter(row=>row.source.kind==='mod').map(row=>row.source.name),Array(4).fill('演示模组'))
  assert.deepEqual(named.map(({source,...row})=>row),preview.sections.map(({source,...row})=>row))
  assert.equal(nameModSections(preview.sections,{}).find(row=>row.source.kind==='mod').source.name,undefined)
  // The command reference names each mod-owned command's mod; other rows are untouched.
  const commands=[{name:'mod.dsh.demo',source:'mod',mod:{id:'dsh.demo',commandId:'mark'}},{name:'scene.set'}]
  assert.deepEqual(nameModCommands(commands,{'dsh.demo':'演示模组'}),[{...commands[0],mod:{id:'dsh.demo',commandId:'mark',name:'演示模组'}},commands[1]])
  assert.deepEqual(nameModCommands(commands,{}),commands)
  // An installed mod command the tool grammar offers but this turn did not admit still states its owner (not admitted: enabled:false).
  {
    const item={modId:'dsh.items',id:'item',op:'mod.dsh.items.item',mode:'adds',dsl:{syntax:'item show name=<name>'},params:{type:'object',properties:{},required:[]},caps:{bytes:256},persistence:'event'}
    const p=structuredClone(f.prepare());p.context.modCommands=[];p.context.schemaModCommands=[item]
    const row=buildAssetPackRequest(p,true,undefined,'',true).commands.filter(row=>row.name===item.op)
    assert.deepEqual(row.map(row=>[row.source,row.mod,row.enabled]),[['mod',{id:'dsh.items',commandId:'item'},false]])
    assert.equal(buildAssetPackRequest(p).commands,undefined,'the sent request carries no describe() rows')
  }
  const parts=sent.messages[0].content,framework=parts[0].text,turnMods=parts[2].text
  assert.equal(sent.system,plain.system)
  assert.ok(framework.indexOf('Early rule')<framework.indexOf('Later rule'))
  // The offsets are local to each real text part, before or after volatile data.
  for(const [text,sections] of [[framework,rows.slice(0,2)],[turnMods,rows.slice(2)]]) {
    let bytes=Buffer.from(text)
    for(const row of sections)assert.equal(bytes.subarray(row.offset,row.offset+row.bytes).toString('utf8'),row.text)
    for(const row of [...sections].reverse())bytes=Buffer.concat([bytes.subarray(0,row.offset-1),bytes.subarray(row.offset+row.bytes)])
    assert.equal(bytes.toString('utf8'),'')
  }
  assert.deepEqual(parts.filter(part=>![framework,turnMods].includes(part.text)),plain.messages[0].content);assert.deepEqual(sent.tools,plain.tools)
  assert.throws(()=>buildAssetPackRequest({...prepared,modPrompts:[fragment('bad','director.unknown',0,'Never appended')]}),{code:'MOD_API_UNSUPPORTED'})
})


test('first-party mod commands share JSON/DSL schemas, caps and read-only historical records',async()=>{
  const f=await fixture(),command={modId:'dsh.demo',id:'mark',op:'mod.dsh.demo.mark',dsl:{verb:'demo',syntax:'demo mark label=<text>'},params:{type:'object',properties:{label:{type:'string',maxLength:80}},required:['label'],additionalProperties:false},persistence:'marker',caps:{perTurn:1,bytes:1024}}
  const prepared=prepareAssetPackDirector({...f.input,mods:{revision:'mod-v1',commands:[command]}}),tx=transact(prepared)
  const result=tx.submitModel(batch(['demo mark label="Frozen marker"',{op:command.op,params:{label:'Excess'}}]))
  assert.equal(result.accepted,1,JSON.stringify(result));assert.equal(result.errors[0].code,'CONFLICT')
  tx.finish()
  const record=tx.effect(),operation=record.entries.flatMap(entry=>entry.ops).find(op=>op.op==='mod.command')
  assert.deepEqual(operation,{op:'mod.command',modId:'dsh.demo',commandId:'mark',params:{label:'Frozen marker'}})
  assert.deepEqual(readAssetPackRecord(structuredClone(record)),record)
  const preview=buildAssetPackRequest(prepared,true,undefined,'',true)
  assert.ok(JSON.stringify(preview.tools).includes(command.op));assert.ok(preview.commands.some(row=>row.name===command.op))
  const stale=prepareAssetPackDirector({...f.input,mods:{revision:'mod-v2',commands:[command]}})
  assert.throws(()=>createAssetPackTransaction({prepared:stale,incremental:true,getCurrentBinding:()=>stale.binding,checkpoint:tx.savepoint()}))
})


test('read-only source hints add measured UTF-8 tail bytes only; tools, stable prefix and zero-delta stage are unchanged',async()=>{
  const f=await fixture(),plain=f.prepare(),base=buildAssetPackRequest(plain,true,undefined,'',true)
  const name=f.input.snapshots[0].figures[FIGURE_ID].name
  f.input.stateSource={source:'ledger',available:true,value:{location:'图书馆',locationPath:['城镇','图书馆'],consolidatedTurn:4,npcs:[{name,important:true,location:'图书馆',outfit:'DO_NOT_RESET'}],items:[{name:'SECRET_INVENTORY'}]}}
  const hinted=f.prepare(),request=buildAssetPackRequest(hinted,true,undefined,'',true)
  assert.equal(request.system,base.system)
  assert.deepEqual(request.tools,base.tools)
  const toolSchemaBytes=Buffer.byteLength(JSON.stringify(request.tools),'utf8')
  assert.equal(toolSchemaBytes,Buffer.byteLength(JSON.stringify(base.tools),'utf8'))
  const section=request.sections.find(row=>row.key==='state-hints')
  assert.equal(section.bytes,Buffer.byteLength(section.text,'utf8'))
  assert.ok(request.messages[0].content.some(row=>row.text===section.text))
  assert.doesNotMatch(section.text,/SECRET_INVENTORY|DO_NOT_RESET|items|npcs/)
  assert.match(section.text,/the reply wins over them; something they leave out is no reason to change the stage/)
  assert.deepEqual(hinted.baseline,plain.baseline)
  assert.deepEqual(hinted.binding,plain.binding)
  assert.deepEqual(request.sections.filter(row=>row.key!=='state-hints'),base.sections)
  const bytes=Object.fromEntries(request.sections.map(row=>[row.key,Buffer.byteLength(row.text,'utf8')]))
  console.log('ledger hint UTF-8 bytes',JSON.stringify({sections:bytes,toolSchemaBytes,added:section.bytes}))
  f.input.stateSource.value={items:[],npcs:[]}
  assert.deepEqual(buildAssetPackRequest(f.prepare()),buildAssetPackRequest(plain))
})

// Recorded correction loops kept retrying even after the model explicitly submitted beats:[].
test('empty correction seals accepted changes once, preserves dropped diagnostics across resume', async () => {
  const f = await fixture(), prepared = f.prepare(), first = transact(prepared)
  const args = batch([scene('day'),{op:'actor.emote.play'}])
  const rejected = first.submitModel(modelArguments(first.request,args))
  assert.equal(rejected.retryable,true)
  assert.equal(rejected.errors[0].at,1)
  assert.equal(rejected.errors[0].example.op,'actor.emote.play')
  assert.ok(rejected.errors[0].example.actor)
  assert.equal(first.completed(),false)
  const resumed = transact(prepared,{checkpoint:first.savepoint()})
  const repair = batch([],{beats:[]}), receipt = resumed.submitModel(repair)
  assert.equal(receipt.sealed,true)
  assert.equal(receipt.retryable,false)
  assert.equal(resumed.terminal(),true)
  const record = resumed.effect()
  assert.equal(record.stats.calls,2)
  assert.equal(record.partial,true)
  assert.equal(record.stats.droppedOps,1)
  assert.equal(record.end.scene.background.assetId,'classroom')
  assert.equal(record.entries.length,1)
  assert.equal(resumed.submitModel(repair).duplicate,true)
  assert.deepEqual(resumed.effect(),record)
})

test('missing clothing can be omitted without resetting outfits or hiding a sleeping actor', async () => {
  const f = await fixture(), figure = f.input.snapshots[0].figures[FIGURE_ID]
  figure.outfits.push({...clone(figure.outfits[0]),key:'pajamas',label:'Pajamas'})
  const dressed = transact(f.prepare())
  assert.equal(dressed.submit(batch([{op:'cast.add',actor:ACTOR},{op:'actor.outfit.set',actor:ACTOR,outfit:'pajamas'}])).ok,true)
  const prepared = prepareAssetPackDirector({...f.input,record:dressed.effect(),playerInput:'Wear an unavailable outfit, then lie down and sleep.'})
  const request = buildAssetPackRequest(prepared,true,undefined,'',true)
  assert.doesNotMatch(request.system,/explicit clothing change with no matching asset|Clothes are not pose support|cast.remove at onset|cast.add on recovery/)
  assert.match(request.sections.find(row=>row.key==='messages').text,/lie down and sleep/)
  const tx = transact(prepared)
  const rejected=tx.submitModel(batch([{op:'actor.outfit.set',actor:modelHandle(request,ACTOR),outfit:'missing-yellow-dress'},{op:'weather.set',weather:'rain'}]))
  assert.equal(rejected.ok,false);assert.equal(rejected.accepted,1)
  assert.match(rejected.errors[0].message,/Unknown outfit handle/)
  assert.match(rejected.errors[0].next_action,/Pick one that fits the described clothing, or omit the outfit change if none fits/)
  assert.ok(rejected.errors[0].choice_details.some(row=>row.value==='pajamas' && row.label==='Pajamas'))
  const resumed=transact(prepared,{checkpoint:tx.savepoint()})
  const sealed=resumed.submitModel(batch([],{beats:[]}))
  assert.equal(sealed.sealed,true);assert.equal(sealed.outcome,'partial')
  const record=resumed.effect()
  assert.equal(record.end.actors[ACTOR].outfitKey,'pajamas')
  assert.deepEqual(record.end.cast,[ACTOR])
  assert.equal(record.end.weather,'rain')
  const next=transact(prepareAssetPackDirector({...f.input,record}))
  assert.equal(next.submit(batch([],{beats:[]})).ok,true)
  assert.equal(next.effect().end.actors[ACTOR].outfitKey,'pajamas')
  assert.deepEqual(next.effect().end.cast,[ACTOR])
})

for (const repair of [true,false]) test(`invalid beat anchors are repairable without losing accepted commands: ${repair}`,async()=>{
  const f=await fixture(), prepared=f.prepare(), tx=transact(prepared)
  const first=tx.submit(batch([],{beats:[{at:1,ops:[{op:'weather.set',weather:'rain'}]},
    {at:4,ops:[{op:'weather.set',weather:'snow'}]}]}))
  assert.equal(first.accepted,1)
  assert.equal(first.retryable,true)
  assert.equal(first.sealed,false)
  assert.deepEqual(first.errors[0].schema,{type:'integer',minimum:1,maximum:3})
  const resumed=transact(prepared,{checkpoint:tx.savepoint()})
  if(repair) assert.equal(resumed.submit(batch([],{beats:[{at:2,ops:[{op:'weather.set',weather:'snow'}]}]})).ok,true)
  else resumed.finish()
  const record=resumed.effect()
  assert.equal(record.end.weather,repair?'snow':'rain')
  assert.equal(record.entries.filter(entry=>entry.at===1).length,1)
  assert.equal(record.diagnostics.some(drop=>drop.dropped && drop.entry),!repair)
  assert.deepEqual(readAssetPackRecord(record),record)
})

// Owner authoring metadata must not alter any model-facing bytes.
test('remarks add zero director section, tool schema and smart-judge request bytes',async t=>{
  const {judgeRequests,validateJudgeConfig}=await import('../tavern-plugin/lib/domain/engine-judge.js')
  const f=await fixture()
  f.input.engine.judge=validateJudgeConfig({provider:'jev'})
  f.input.units=['Synthetic fixture.','Another passage.','End.']
  for(const pack of f.input.snapshots){
    const asset=pack.manifest.assets.find(row=>row.kind==='music')
    asset.name='Quiet';asset.recall={mode:'keyword',keywords:['unmatched']}
  }
  const before=f.prepare(), request=buildAssetPackRequest(before,true,undefined,'',true)
  const judge=judgeRequests(f.input.engine.judge,{material:f.input.units.join('\n'),questions:before.judgeQuestions})
  assert.ok(judge.length)
  for(const pack of f.input.snapshots){
    for(const asset of pack.manifest.assets)asset.remark='OWNER_ONLY_SOURCE_ID\nTODO provenance '.repeat(300)
    for(const figure of Object.values(pack.figures)){
      figure.remark='OWNER_ONLY_FIGURE'
      for(const emotion of figure.emotions || [])emotion.remark='OWNER_ONLY_EXPRESSION_SOURCE Arms3 Pensive1'
      for(const outfit of figure.outfits)outfit.remark='OWNER_ONLY_OUTFIT'
    }
  }
  const after=f.prepare(), next=buildAssetPackRequest(after,true,undefined,'',true)
  assert.deepEqual(next.system,request.system)
  assert.deepEqual(next.messages,request.messages)
  assert.deepEqual(next.tools,request.tools)
  const sectionBytes=value=>Object.fromEntries(value.sections.map(row=>[row.key,Buffer.byteLength(row.text,'utf8')]))
  assert.deepEqual(next.sections,request.sections)
  assert.deepEqual(sectionBytes(next),sectionBytes(request))
  const toolSchemaBytes=Buffer.byteLength(JSON.stringify(next.tools),'utf8')
  assert.equal(toolSchemaBytes-Buffer.byteLength(JSON.stringify(request.tools),'utf8'),0)
  assert.deepEqual(judgeRequests(f.input.engine.judge,{material:f.input.units.join('\n'),questions:after.judgeQuestions}),judge)
  t.diagnostic(JSON.stringify({sections:sectionBytes(next),toolSchemaBytes,delta:0,judgeBytes:judge.reduce((n,r)=>n+r.bytes,0),judgeDelta:0}))
})
