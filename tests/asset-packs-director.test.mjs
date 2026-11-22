// tagged English defaults; retain protocol, payload, cache and budget assertions.
// assert the model handle DTO, while saved state stays canonical.
import { modelCall, modelHandle } from './helpers/director-model-call.mjs'
// tool receipts use the CLI v1 envelope; saved record diagnostics are unchanged.
import { directorPromptData } from './fixtures/asset-packs/prompt.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { syntheticPack, distinctMedia, cardExtension, PACK_ID, OTHER_PACK_ID, FIGURE_ID, OTHER_FIGURE_ID } from './fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { recallAssetPacks } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'
import { initialAssetPackStage } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-tools.js'
import { prepareAssetPackDirector, buildAssetPackRequest, nameModSections, nameModCommands, createAssetPackTransaction, runAssetPackDirector, validateAssetPackRecord, readAssetPackRecord, assetPackStateAt } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-director.js'
import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'

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
const transact = (prepared, extra = {}) => createAssetPackTransaction({ prepared, getCurrentBinding: () => prepared.binding, ...extra })

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
