// both pack tool paths share a closed schema and semantic reducer.
import { ASSET_PACK_FORMAT, TIMES_OF_DAY, assetRefKey, validateAssetRef, validateAssetPackState, validateSceneSelection } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import { assertJson, check, object, canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { reduceAssetPackScene, applyAssetPackLight } from '../../packages/dsh-presentation-protocol/src/asset-pack-stage.js'
import { recalledAsset } from './stage-asset-pack-catalogue.js'
import { validateStateImageSelection } from '../../packages/dsh-asset-library/lib/asset-packs/state-image-pools.js'
import { STATE_IMAGE_FIELDS } from './state-image-selection.js'
// deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a, b) => canonicalJson(a) === canonicalJson(b)
import { STAGE_WIDGET_SLOTS } from '../../src/client/stage-widgets.cjs'
import { validateSoundTags } from './stage-soundscape-protocol.js'
import directorCommands from '../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import { validateStageCg, hideStageCg, applyStageCg } from './stage-cg.js'
import { validateStageItem } from './stage-items.js'
import { modStageContribution } from './mods/stage-contributions.js'
import { applyModStageState } from './mods/stage-state.js'
import { assertModCommandAdmission } from './mods/commands.js'
import {assertCommandControl,applyPerformanceInterop} from './mods/interop.js'

import {performanceBoundary} from '../../packages/dsh-presentation-protocol/src/performance-state.cjs'
import {assetContent} from '../../packages/dsh-presentation-protocol/src/asset-variant-content.js'
import {selectAssetVariant,variantTarget} from '../../packages/dsh-presentation-protocol/src/asset-variants.js'
import {reducePerformanceCommand} from '../../packages/dsh-presentation-protocol/src/performance-commands.cjs'
import {opKey} from '../../packages/dsh-tavern-stage/lib/domain/performance-projection.js'
import { figureDirection } from '../../packages/dsh-presentation-protocol/src/figure-scale.cjs'

const clone = value => structuredClone(value)
const en = values => ({ enum: values })
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] })
const shape = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false })
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const rulerSchema = shape({heightCm:{type:'number',minimum:1,maximum:1000},headRatio:{type:'number',minimum:0.001,maximum:4},elevationCm:{type:'number',minimum:0,maximum:500}})
const WEATHER = ['none', 'rain', 'storm', 'snow', 'sakura', 'leaves', 'sparkle']
// the persistent screen look (screen.set / screen.clear); absent or null = none.
const SCREEN_LOOKS = directorCommands.byName['screen.set'].schema({actors:{},dimensions:{},catalogue:{candidates:{}}}).properties.look.enum
export const assetPackDimensions = input => {
  const value = Object.fromEntries([...Object.keys(directorCommands.dimensions), 'items', 'skin', 'performance', 'actors', 'lighting', 'sound', 'events'].map(key => [key, input?.[key] !== false]))
  value.actors &&= value.cast
  value.sound &&= value.soundscape
  value.lighting &&= value['lighting.time'] || value['lighting.mood']
  return value
}
export function assetPackOperationSchema(context) {
  const variants = directorCommands.schemas(context)
  return variants.length ? {oneOf:variants} : {not:{}}
}
export function buildAssetPackTool(context, { incremental = true } = {}) {
  // Actual ranges and budgets belong to the transaction, not the provider cache prefix.
  const positive = {type:'integer',minimum:1}, variants = directorCommands.grammar(context)
  const beats = { type: 'array',
    items: shape({ at: {...positive,description:'Copy reply.at (1-based, absolute).'}, ops: { type: 'array', items: variants.length ? {oneOf:variants} : {not:{}} } }) }
  return { name: incremental ? 'stage_update' : 'submit_direction', description: 'Stage the completed reply with asset-packs-v1 references. No asset creation.', parameters: incremental
    ? {...shape({ sequence: positive, through: {...positive,description:'Last reply.at this call covers.'}, done: { type: 'boolean' }, beats }), $defs:directorCommands.grammarDefs()} : {...shape({ beats }), $defs:directorCommands.grammarDefs()} }
}

// Closed subset used by the generated tools and verified pack widget props schemas.
export function validateAssetPackToolValue(value, schema, path = '$', root = schema) {
  if (schema.$ref) return validateAssetPackToolValue(value, root.$defs[schema.$ref.split('/').at(-1)], path, root)
  if (schema.not) check(false, path, 'No candidates available')
  if (schema.oneOf || schema.anyOf) {
    let variants = schema.oneOf || schema.anyOf
    if (variants.some(item => item.properties?.op?.const)) {
      check(object(value), path, 'Expected command object', 'ARG_INVALID')
      check(typeof value.op === 'string', path + '.op', 'Expected command name', 'ARG_INVALID')
      variants = variants.filter(item => item.properties.op.const === value.op || item.properties.op.pattern && new RegExp(item.properties.op.pattern).test(value.op))
      check(variants.length, path + '.op', directorCommands.byName[value.op] ? 'Command disabled or no candidates; choose a listed command' : 'Unknown command; choose a listed op', directorCommands.byName[value.op] ? 'DISABLED' : 'ARG_INVALID')
      if (variants.length > 1 && value.ref) variants = variants.filter(item => same(item.properties.ref.const, value.ref))
      check(variants.length, path + '.ref', 'Choose a recalled widget reference', 'REF_UNAVAILABLE')
      return validateAssetPackToolValue(value, variants[0], path, root)
    }
    const count = variants.filter(variant => { try { validateAssetPackToolValue(value, variant, path, root); return true } catch { return false } }).length
    check(schema.oneOf ? count === 1 : count > 0, path, 'Value does not match an allowed tool variant'); return value
  }
  if (Object.hasOwn(schema, 'const')) check(same(value, schema.const), path, 'Reference or operation not allowed')
  if (schema.enum) check(schema.enum.includes(value), path, 'Choose one of: ' + schema.enum.join(', '))
  if (schema.type === 'object') {
    check(object(value), path, 'Expected object')
    for (const key of schema.required || []) check(Object.hasOwn(value, key), path + '.' + key, 'Required field')
    for (const [key, item] of Object.entries(value)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(key), path + '.' + key, 'Unsafe key')
      if (schema.properties?.[key]) validateAssetPackToolValue(item, schema.properties[key], path + '.' + key, root)
      else check(schema.additionalProperties !== false, path + '.' + key, 'Remove unknown field; allowed: ' + Object.keys(schema.properties || {}).join(', '))
    }
  }
  if (schema.type === 'array') {
    check(Array.isArray(value), path, 'Expected array')
    check(value.length >= (schema.minItems || 0) && value.length <= (schema.maxItems ?? Infinity), path, `Provide ${schema.minItems || 0}-${schema.maxItems ?? 'unbounded'} array entries`)
    if (schema.uniqueItems) check(new Set(value.map(item => canonicalJson(item))).size === value.length, path, 'Duplicate item')
    value.forEach((item, index) => validateAssetPackToolValue(item, schema.items, `${path}[${index}]`, root))
  }
  if (schema.type === 'string') {
    check(typeof value === 'string', path, 'Expected string')
    check([...value].length >= (schema.minLength || 0) && [...value].length <= (schema.maxLength ?? Infinity), path, `Use ${schema.minLength || 0}-${schema.maxLength ?? 'unbounded'} characters`)
    if (schema.pattern) check(new RegExp(schema.pattern).test(value), path, 'String pattern')
  }
  if (schema.type === 'integer' || schema.type === 'number') check(typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity), path, 'Number bound')
  if (schema.type === 'boolean') check(typeof value === 'boolean', path, 'Expected boolean')
  if (schema.type === 'null') check(value === null, path, 'Expected null')
  return value
}
const presentation = () => ({ gaze: 'viewer', figureLight: 'lit' })
// Cast order is the placement authority. An entry slot is consumed once, never replayed as an x coordinate.
function enterCast(cast, alias, position = 'right') {
  check(['left', 'right', 'center'].includes(position) || typeof position === 'string' && position.startsWith('after '), '$.position', 'Invalid insertion slot')
  if (cast.includes(alias)) return cast
  let index = position === 'left' ? 0 : position === 'center' ? Math.ceil(cast.length / 2) : cast.length
  if (position.startsWith('after ')) {
    const anchor = cast.indexOf(position.slice(6))
    check(anchor >= 0, '$.position', 'Insertion anchor must be on stage')
    index = anchor + 1
  }
  const next = [...cast]; next.splice(index, 0, alias); return next
}
export function initialAssetPackStage(actors) {
  return { format: ASSET_PACK_FORMAT, scene: null, music: null, lighting: { time: { mode: 'auto', ref: null }, mood: null }, soundscape: {}, widgets: {}, cast: [], weather: 'none', sound: [], camera: { mode: 'reset', actor: null }, dof: null, widgetTime: 0,
    actors: Object.fromEntries(Object.entries(actors).map(([id, actor]) => [id, { figure: clone(actor.figure), outfitKey: actor.outfits[0]?.key ?? null, ruler: clone(actor.ruler || null), ...presentation() }])) }
}
function shapeSkin(value) {
  validateAssetPackToolValue(value, shape({ref:{},level:int(1,3)},['ref']), '$.skin')
  check(value.ref !== null || value.level === undefined,'$.skin.level')
  if (value.ref !== null) validateAssetRef(value.ref, '$.skin.ref', 'skins')
}
// Saved snapshots are authoritative. Projection ignores fields the current renderer does not know.
export function projectAssetPackSnapshot(raw) {
  const keys = ['format','scene','music','musicRequest','lighting','soundscape','widgets','cast','weather','screen','sound','camera','dof','widgetTime','actors','pacing','cameraUntil','figureScale','skin','performance','cg','modState','stageControls','interopNotices']
  const state = Object.fromEntries(Object.entries(raw).filter(([key]) => keys.includes(key)).map(([key,value]) => [key,clone(value)]))
  state.widgets = Object.fromEntries(Object.entries(raw.widgets || {}).filter(([,widget]) => object(widget?.ref) && object(widget?.state)).map(([key,widget]) => [key,clone(widget)]))
  // normalization never changes the authenticated stored snapshot.
  if (state.scene?.timeOfDay === 'morning') {
    state.scene.timeOfDay = 'day'
  }
  if(state.scene)state.scene.timeLook=null
  state.lighting.time={mode:'auto',ref:null}
  // a retired weather (dust) projects to no weather.
  if (Object.hasOwn(state, 'weather') && !WEATHER.includes(state.weather)) state.weather = 'none'
  return state
}
export function recordedAssetPackOperation(raw, binding, path = '$.record.ops') {
  if (raw?.op === 'actor.image.select') {
    check(Object.keys(raw).every(key => ['op','actor','value','ruler'].includes(key)) && typeof raw.actor === 'string', path)
    check(object(raw.value) && Object.keys(raw.value).every(key => STATE_IMAGE_FIELDS.includes(key)), path + '.value')
    validateStateImageSelection(raw.value, path + '.value')
    if (raw.ruler !== undefined && raw.ruler !== null) validateAssetPackToolValue(raw.ruler,rulerSchema,path+'.ruler')
    return true
  }
  if(raw?.op==='mod.command') {
    check(Object.keys(raw).every(key=>['op','modId','commandId','params'].includes(key)) && binding.mods?.commands.some(row=>row.modId===raw.modId && row.commandId===raw.commandId),'$.record.mod','Unbound mod command')
    check(raw.params && typeof raw.params==='object' && !Array.isArray(raw.params),'$.record.mod.params')
    return true
  }
  // only explicitly retired widget/phone operations are ignored.
  // Validate the saved normalized vocabulary, never today's model-facing grammar.
  if (directorCommands.retiredOperation(raw)) return false
  if (/^widget\.[a-z][a-z0-9-]{0,31}\.(set|update|clear|mark)$/.test(raw?.op)) {
    validateAssetRef(raw.ref,'$.record.widget','widgets')
    if (raw.op.endsWith('.mark')) check(Object.keys(raw).every(key => ['op','ref','contact','side'].includes(key)) && typeof raw.contact === 'string' && ['in','out'].includes(raw.side),'$.record.source')
    return true
  }
  const op = directorCommands.recordOperation(raw, binding)
  // commands renamed by a later command spec are not replayed; each entry's saved state still stands.
  if (!op && binding?.commandSpecVersion < directorCommands.version && typeof raw?.op === 'string') return false
  check(op && directorCommands.recordedOps.has(op.op), '$.record.ops', 'Unknown recorded operation')
  if (op.op === 'scene.set') validateSceneSelection(op.value, path + '.value')
  if (op.op === 'music.set') validateAssetRef(op.value, '$.record.music', 'music')
  if (op.op === 'soundscape.set') {
    check(Array.isArray(op.refs) && op.refs.length >= 1 && op.refs.length <= 2, '$.record.soundscape')
    for (const ref of op.refs) validateAssetRef(ref, '$.record.soundscape', 'ambience')
  }
  if (op.op === 'skin.set') { validateAssetRef(op.value, '$.record.skin', 'skins'); if (op.level !== undefined) check([1,2,3].includes(op.level),'$.record.skin.level') }
  if (op.op === 'perform') { validateAssetRef(op.id, '$.record.perform', 'performances'); check([1,2,3].includes(op.level),'$.record.perform.level') }
  if (op.op === 'event' && op.value?.op === 'sfx') validateAssetRef(op.value.value, '$.record.sfx', 'sfx')
  if (op.op === 'time.set') validateAssetRef(op.ref, '$.record.time', 'looks')
  if (op.op === 'light') {
    check(['auto','mood'].includes(op.value?.mode), '$.record.light')
    if (op.value.mode === 'mood' && op.value.ref !== null) validateAssetRef(op.value.ref, '$.record.light.ref', 'looks')
  }
  if (op.op === 'stage.patch' && op.value.lighting) {
    validateAssetPackToolValue(op.value.lighting, shape({mood:{}}), '$.record.lighting')
    if (op.value.lighting.mood !== null) validateAssetRef(op.value.lighting.mood, '$.record.lighting.mood', 'looks')
  }
  return true
}
export function validateAssetPackStage(state) {
  assertJson(state)
  const required = ['format', 'scene', 'music', 'lighting', 'soundscape', 'widgets', 'cast', 'weather', 'sound', 'camera', 'dof', 'widgetTime', 'actors']
  check(object(state) && required.every(key => Object.hasOwn(state, key)) && Object.keys(state).every(key => [...required, 'musicRequest', 'screen', 'pacing', 'cameraUntil', 'figureScale', 'skin', 'performance', 'cg', 'modState', 'stageControls', 'interopNotices'].includes(key)), '$.state', 'Invalid stage state fields')
  check(state.screen === undefined || state.screen === null || SCREEN_LOOKS.includes(state.screen), '$.screen')
  if (state.musicRequest !== undefined && state.musicRequest !== null) {
    const request = state.musicRequest
    check(object(request) && Object.keys(request).every(key => ['key','ref','force'].includes(key)) && Array.isArray(request.key) && request.key.length === 5 && [undefined,true].includes(request.force), '$.musicRequest')
    if (request.ref !== null) validateAssetRef(request.ref, '$.musicRequest.ref', 'music')
  }
  if (state.modState !== undefined) check(object(state.modState) && Object.values(state.modState).every(object), '$.state.modState', 'Expected mod-owned state objects')
  if (state.cg !== undefined) validateStageCg(state.cg, state.actors)
  if (state.skin !== undefined) {
    shapeSkin(state.skin)
  }
  if (state.performance !== undefined && state.performance !== null) {
    validateAssetPackToolValue(state.performance,shape({ref:{},level:int(1,3),topic:{type:'string',minLength:1,maxLength:160},startedAt:shape({turn:int(1,Number.MAX_SAFE_INTEGER),page:int(0,Number.MAX_SAFE_INTEGER)}),phase:en(['entry','idle','turn','exit'])},['ref','level','startedAt','phase']),'$.performance')
    validateAssetRef(state.performance.ref,'$.performance.ref','performances')
  }
  const { format, scene, music, lighting, soundscape } = state
  validateAssetPackState({ format, scene, music, lighting, soundscape,
    actors: Object.fromEntries(Object.entries(state.actors).map(([alias, { figure, outfitKey }]) => [alias, { figure, outfitKey }])),
    widgets: {} })
  check(Array.isArray(state.cast) && new Set(state.cast).size === state.cast.length && state.cast.every(id => Object.hasOwn(state.actors, id)), '$.cast')
  check(WEATHER.includes(state.weather), '$.weather'); check(!validateSoundTags(state.sound).errors.length, '$.sound')
  check(Number.isSafeInteger(state.widgetTime) && state.widgetTime >= 0, '$.widgetTime')
  validateAssetPackToolValue(state.camera, shape({ mode: en(['reset', 'wide', 'push', 'close', 'pan-left', 'pan-right', 'dutch']), actor: nullable(en(Object.keys(state.actors))) }), '$.camera')
  check(state.dof === null || Object.hasOwn(state.actors, state.dof), '$.dof')
  for (const [alias, actor] of Object.entries(state.actors)) {
    const fields = ['figure', 'outfitKey', 'gaze', 'figureLight', 'ruler']
    check(Object.keys(actor).every(key => fields.includes(key) || STATE_IMAGE_FIELDS.includes(key)) && fields.every(key => Object.hasOwn(actor, key)), '$.actors.' + alias)
    if (STATE_IMAGE_FIELDS.some(key => Object.hasOwn(actor,key))) validateStateImageSelection(actor, '$.actors.' + alias)
    if (actor.ruler !== null) validateAssetPackToolValue(actor.ruler, rulerSchema, '$.actors.' + alias + '.ruler')
    check(['lit', 'glow', 'shadow'].includes(actor.figureLight), '$.actors.' + alias)
    check(['viewer', 'away'].includes(actor.gaze) || Object.hasOwn(state.actors, actor.gaze), '$.actors.' + alias + '.gaze')
  }
  for (const [id, widget] of Object.entries(state.widgets)) {
    validateAssetRef(widget.ref, '$.widgets.' + id + '.ref', 'widgets')
    check(id === assetRefKey(widget.ref) && object(widget.state), '$.widgets.' + id)
    check(Object.keys(widget).every(key => ['ref', 'state', 'slot', 'lifetime', 'bornStoryTime'].includes(key)), '$.widgets.' + id)
    check(STAGE_WIDGET_SLOTS.includes(widget.slot), '$.widgets.' + id + '.slot')
    validateAssetPackToolValue(widget.lifetime, shape({ until: en(['explicit', 'scene-change', 'turn-end']), durationSeconds: int(1, 86400) }, ['until']), '$.widgets.' + id + '.lifetime')
    check(Number.isSafeInteger(widget.bornStoryTime) && widget.bornStoryTime >= 0, '$.widgets.' + id + '.bornStoryTime')
  }
  if (state.figureScale !== undefined) {
    const scale = state.figureScale
    validateAssetPackToolValue(scale, shape({version:{const:6},scene:int(0,Number.MAX_SAFE_INTEGER),hMax:{type:'number',minimum:1,maximum:1000},groundRatio:{type:'number',minimum:0.001,maximum:1000},rescales:int(0,Number.MAX_SAFE_INTEGER),event:nullable(shape({kind:en(['cut','rescale']),at:int(0,Number.MAX_SAFE_INTEGER),from:{type:'number',minimum:1,maximum:1000},warning:{const:'mid-scene rescale'}},['kind','at']))},['version','scene','hMax','rescales']), '$.figureScale')
  }
  if (state.cameraUntil !== undefined) check(Number.isSafeInteger(state.cameraUntil) && state.cameraUntil >= 0, '$.cameraUntil')
  if (state.pacing) {
    const p = state.pacing
    const counters = ['paragraph', 'moodChanges'], optional = ['moodSetAt', 'musicSetAt', 'sceneAt', 'moodAt', 'openingAt']
    check(object(p) && Object.keys(p).every(key => [...counters, ...optional, 'previousMood', 'recentTracks'].includes(key)), '$.pacing')
    for (const key of counters) check(Number.isSafeInteger(p[key]) && p[key] >= 0, '$.pacing.' + key)
    for (const key of optional) check(p[key] === null || Number.isSafeInteger(p[key]) && p[key] >= 0, '$.pacing.' + key)
    if (p.previousMood !== null) validateAssetRef(p.previousMood, '$.pacing.previousMood', 'looks')
    check(Array.isArray(p.recentTracks) && p.recentTracks.length <= 2, '$.pacing.recentTracks')
    for (const ref of p.recentTracks) if (ref !== null) validateAssetRef(ref, '$.pacing.recentTracks', 'music')
  }
  return state
}
// the BGM player treats a new key as a new director music request.
// The key is the event identity of the last music op, so every sealed snapshot persists it, seeded from the carried
// baseline: a round restores it from its own record, without reading the chain. Stamp once the record's binding and
// entry order are final (image admission appends entries; a stream signs its own event namespace).
export function stampAssetPackMusicRequests({ binding, baseline, entries }, end) {
  let request = baseline.musicRequest ?? null
  for (const [entryOrdinal, entry] of entries.entries()) {
    for (const [opOrdinal, raw] of entry.ops.entries()) {
      const op = directorCommands.recordOperation(raw, binding)
      if (op?.op !== 'music.set' && op?.op !== 'music.stop') continue
      request = { key: opKey({ binding }, entryOrdinal, opOrdinal), ref: op.op === 'music.stop' ? null : clone(op.value), ...(op.force === true && typeof op.reason === 'string' && op.reason.trim() ? { force: true } : {}) }
    }
    entry.state.musicRequest = clone(request)
  }
  end.musicRequest = clone(request)
}
export function expireAssetPackWidgets(state, boundary) {
  for (const [id, widget] of Object.entries(state.widgets)) if (widget.lifetime.until === boundary || widget.lifetime.durationSeconds !== undefined && state.widgetTime >= widget.bornStoryTime + widget.lifetime.durationSeconds) delete state.widgets[id]
}
function mergeProps(base, patch) {
  const next = clone(base)
  for (const [key, value] of Object.entries(patch)) {
    check(!['__proto__', 'prototype', 'constructor'].includes(key), '$.props')
    next[key] = object(value) && object(next[key]) ? mergeProps(next[key], value) : clone(value)
  }
  return next
}
export function assetPackCommandDefinition(op,context) {
  // removed close-up commands fail in the current tool run, never alias.
  if (typeof op?.op === 'string' && op.op.startsWith('actor.focus.')) check(false, '$.op',
    `Unknown op ${op.op}; use closeup.play {actor} for a four-paragraph close-up. It expires automatically; omit focus reset.`, 'UNKNOWN_OP')
  const definition = directorCommands.resolve(op,context)
  assertModCommandAdmission(op,context)
  // reject retired ambience fields before reporting missing refs.
  if (definition?.toggle === 'soundscape') for (const key of Object.keys(op)) check(Object.hasOwn(definition.schema(context).properties,key),'$.'+key,'Unknown field','UNKNOWN_FIELD')
  if (!definition && typeof op?.op === 'string' && /^widget\.[a-z][a-z0-9-]{0,31}\.(set|update|clear|mark)$/.test(op.op)) {
    check(context.dimensions.widgets !== false,'$.op','Widget module disabled','DISABLED')
    validateAssetRef(op.ref,'$.ref','widgets')
    recalledAsset(context.catalogue,op.ref,'widgets')
  }
  return definition
}
export function reduceAssetPackOperation(state, op, context, metadata = {}) {
  const definition = assetPackCommandDefinition(op, context)
  check(definition, '$.op', 'Choose a registered command', 'ARG_INVALID')
  check(definition.enabled(context), '$.op', 'Command disabled or no recalled candidates', 'DISABLED')
  definition.validate(op, context, state, {
    schema:(value,schema) => validateAssetPackToolValue(value, schema, '$', {$defs:directorCommands.defs(context)}),
    check,
    content:(ref,variant)=>assetContent(recalledAsset(context.catalogue,ref,ref.kind).asset,variant),
    recalled:(ref,kind,path) => { try { return recalledAsset(context.catalogue,ref,kind) } catch { check(false,path,'Choose a full reference from the recalled '+kind+' catalogue','REF_UNAVAILABLE') } }
  })
  const consumed = directorCommands.consume(op, context)
  if(consumed.op==='mod.command') {
    const contribution=modStageContribution(definition.command.modId)
    if(contribution?.admitParams)consumed.params=contribution.admitParams(definition.command,consumed.params,state,context,metadata,check)
    assertCommandControl(state,definition.command,context)
    const next=applyModStageState(clone(state),definition.command,consumed.params,metadata)
    if(definition.command.admission?.state)validateAssetPackStage(next)
    return {state:next,operation:consumed,diagnostics:[],transitionMs:0,locationChanged:false}
  }
  if (definition.toggle === 'performance') {
    const {op:ignored,...params}=op, document=params.ref && context.performanceDocuments[assetRefKey(params.ref)]
    const next=reducePerformanceCommand(clone(state),op.op,params,metadata,document,context.catalogue.candidates.performances,performanceBoundary,check)
    const linked=applyPerformanceInterop(state,next,{id:op.op.split('.')[1]},params,document,context,metadata)
    validateAssetPackStage(linked)
    return {state:linked,diagnostics:[],transitionMs:0,locationChanged:false}
  }
  if (consumed.op === 'item.play') {
    validateStageItem(op,context,metadata.at)
    return {state:clone(state),diagnostics:[],transitionMs:0,locationChanged:false}
  }
  return reduceInternalAssetPackOperation(state, consumed, context, metadata)
}
function reduceInternalAssetPackOperation(state, op, context, metadata = {}) {
  let next = clone(state), diagnostics = [], transitionMs = 0, locationChanged = false
  const looks = context.dimensions.lighting ? context.catalogue.candidates.looks.map(row => ({ ...row.asset, ref: row.ref })) : []
  const actor = op.actor && context.actors[op.actor]
  // candidates are not roster members. Initialize only a persistent
  // operation's dependencies on this speculative clone; rejection discards them.
  const used = []
  if (['actor.enter','actor.variant','actor.reset','actor.patch'].includes(op.op)) used.push(op.actor)
  if (op.op === 'actor.patch' && !['viewer','away',undefined].includes(op.value.gaze)) used.push(op.value.gaze)
  if (op.op === 'stage.patch') used.push(...(op.value.cast || []))
  for (const id of used) if (!Object.hasOwn(next.actors,id)) {
    check(Object.hasOwn(context.actors,id),'$.actor','Actor unavailable','REF_UNAVAILABLE')
    next.actors[id] = initialAssetPackStage({[id]:context.actors[id]}).actors[id]
  }
  if(op.op==='scene.variant') {
    const ref=variantTarget(state.scene?[state.scene.background]:[],op.ref)
    const asset=recalledAsset(context.catalogue,ref,'backgrounds').asset
    next.scene.variant=selectAssetVariant(asset,op.variant).id
  }
  else if (op.op === 'scene.set' || op.op === 'scene.clear') {
    if (op.op === 'scene.set') selectAssetVariant(recalledAsset(context.catalogue, op.value.background, 'backgrounds').asset,op.value.variant)
    if (op.op === 'scene.clear' || !same(next.scene?.background || null, op.value.background)) hideStageCg(next)
    const result = reduceAssetPackScene(next, op.op === 'scene.clear' ? null : op.value, looks)
    ;({ state: next, diagnostics, transitionMs, locationChanged } = result)
  } else if (op.op.startsWith('cg.')) applyStageCg(next, op, context.catalogue, diagnostics)
  else if (op.op === 'light') ({ state: next, diagnostics } = applyAssetPackLight(next, op.value, looks))
  else if (op.op === 'music.set') { recalledAsset(context.catalogue, op.value, 'music'); next.music = clone(op.value) }
  else if (op.op === 'music.stop') next.music = null
  else if (op.op === 'soundscape.set') {
    op.refs.forEach(ref => recalledAsset(context.catalogue, ref, 'ambience'))
    next.soundscape = Object.fromEntries(op.refs.map((ref,index) => ['layer' + (index + 1),clone(ref)]))
  }
  else if (op.op === 'soundscape.clear') next.soundscape = {}
  else if (op.op === 'skin.set') {
    const row=recalledAsset(context.catalogue, op.value, 'skins'), level=op.level ?? row.skinDefault
    check(level === undefined || row.skinLevels?.includes(level),'$.skin.level','Skin level is not declared')
    next.skin = {ref:clone(op.value),...(level === undefined ? {} : {level})}
  }
  else if (op.op === 'skin.off') { if (next.skin?.ref) next.skin = {ref:null} }
  else if (op.op === 'actor.enter') {
    if (next.cg) { next.cg.resumeCast = enterCast(next.cg.resumeCast, op.actor, op.position); diagnostics.push({code:'CG_ENTRANCE_DEFERRED',actor:op.actor}) }
    else next.cast = enterCast(next.cast, op.actor, op.position)
  }
  else if (op.op === 'actor.move') {
    const holder = next.cg || next, key = next.cg ? 'resumeCast' : 'cast';
    holder[key] = enterCast(holder[key].filter(id => id !== op.actor), op.actor, op.position)
  }
  else if (op.op === 'actor.exit') {
    next.cast = next.cast.filter(id => id !== op.actor)
    if (next.cg) next.cg.resumeCast = next.cg.resumeCast.filter(id => id !== op.actor)
    if (next.camera.mode === 'close' && next.camera.actor === op.actor) {next.camera = {mode:'reset',actor:null}; delete next.cameraUntil}
  }
  else if (op.op === 'actor.variant' || op.op === 'actor.reset') {
    // A changed binding is captured when preparing, never when replaying a historical record.
    check(same(next.actors[op.actor].figure, actor.figure), '$.actor', 'Actor binding changed')
    next.actors[op.actor].outfitKey = op.op === 'actor.reset' ? actor.outfits[0]?.key ?? null : op.value
    next.actors[op.actor].ruler = clone(actor.outfits.find(outfit => outfit.key === next.actors[op.actor].outfitKey)?.ruler ?? actor.ruler ?? null)
  } else if (op.op === 'cast.clear') { next.cast = []; if (next.cg) next.cg.resumeCast = [] }
  else if (op.op === 'actor.patch') Object.assign(next.actors[op.actor], clone(op.value))
  else if (op.op === 'stage.patch') {
    if (op.value.lighting) ({ state: next, diagnostics } = applyAssetPackLight(next, { mode: 'mood', ref: op.value.lighting.mood }, looks))
    for (const [key, value] of Object.entries(op.value)) if (key !== 'lighting' && key !== 'cast') next[key] = clone(value)
    if (op.value.cast) {
      const requested = op.value.cast
      next.cast = next.cast.filter(id => requested.includes(id))
      if (next.cg) next.cg.resumeCast = [...requested]
      else for (const id of requested) next.cast = enterCast(next.cast, id)
    }
    if (op.value.camera?.mode === 'close') check(next.cast.includes(next.camera.actor), '$.camera', 'Close camera requires on-stage actor')
    if (op.value.dof) check(next.cast.includes(next.dof), '$.dof', 'DOF requires on-stage actor')
    check(!validateSoundTags(next.sound).errors.length, '$.sound', 'Invalid sound tags')
  } else if (op.op === 'event') {
    if (op.value.id) check(next.cast.includes(op.value.id), '$.event.id', 'Event actor must be on stage')
    if (op.value.op === 'sfx') recalledAsset(context.catalogue, op.value.value, 'sfx')
    if (op.value.op === 'trans') check(metadata.sceneSet === true, '$.event', 'transition.play needs an accepted scene.set or scene.clear earlier in this beat; repair that scene operation first, then retry the transition.', 'PRECONDITION')
  } else if (op.op === 'widget.source') {
    const unit = context.phone?.units[metadata.at - 1], aliases = context.phone?.aliases || []
    check(unit?.kind === 'line' && aliases.includes(unit.alias) && aliases.includes(op.contact) && ['in','out'].includes(op.side) && (op.side === 'in' ? unit.alias === op.contact : unit.alias !== op.contact), '$.contact', 'Mark an existing source dialogue with its actual contact and side', 'ARG_INVALID')
  } else if (op.op === 'clock.advance') { next.widgetTime += op.value; check(Number.isSafeInteger(next.widgetTime), '$.widgetTime'); expireAssetPackWidgets(next, 'story-time') }
  else if (op.op === 'widget.state') {
    const id = assetRefKey(op.ref), old = next.widgets[id], row = recalledAsset(context.catalogue,op.ref,'widgets'), document = row.widget
    check(document, '$.ref', 'Widget command document unavailable', 'REF_UNAVAILABLE')
    if (op.effect === 'state.clear') delete next.widgets[id]
    else {
      check(op.effect !== 'state.patch' || old, '$.ref', 'Set this widget before patching it', 'PRECONDITION')
      const value = op.effect === 'state.patch' ? mergeProps(old.state,op.params) : clone(op.params)
      validateAssetPackToolValue(value,document.stateSchema,'$.state')
      check(new TextEncoder().encode(JSON.stringify(value)).length <= document.caps.bytes,'$.state','Widget byte cap','CAP_EXCEEDED')
      next.widgets[id] = old ? {...old,state:value} : {ref:clone(op.ref),state:value,slot:document.presentation.open.anchor || 'corner-right',lifetime:clone(document.lifetime || {until:'explicit'}),bornStoryTime:next.widgetTime}
      check(new TextEncoder().encode(JSON.stringify(next.widgets)).length <= 12288,'$.widgets','Widget state byte cap','CAP_EXCEEDED')
    }
  } else check(false, '$.op', 'Unknown operation')
  if (context.performanceEnabled !== false && state.performance && state.performance.phase !== 'exit') {
    const document = context.performanceDocuments[assetRefKey(state.performance.ref)]
    const musicLocked = document?.bgm?.lock !== false && (document?.bgm || Object.values(document?.timeline || {}).some(block => block.events.some(event => event.do === 'bgm')))
    if (op.op.startsWith('skin.') || musicLocked && ['music.set','music.stop'].includes(op.op) && !(op.force === true && typeof op.reason === 'string' && op.reason.trim())) diagnostics.push({code:'PERFORMANCE_DEFERRED',op:op.op})
  }
  if (next.camera.mode === 'close' && !next.cast.includes(next.camera.actor)) {next.camera = {mode:'reset',actor:null};delete next.cameraUntil}
  validateAssetPackStage(next)
  return { state: next, diagnostics, transitionMs, locationChanged }
}

// only frozen record inputs participate in replay, never current pack heights.
export function deriveAssetPackFigureScale(before, state, at, cut = false) {
  const catalog = Object.fromEntries(Object.entries(state.actors).map(([alias, actor]) => [alias, {'':actor.ruler ? [actor.ruler] : []}]))
  return figureDirection({cast:before.cast,figureScale:before.figureScale}, [{at,cast:state.cast,...(cut ? {scene:'cut'} : {})}], catalog, at)
}
