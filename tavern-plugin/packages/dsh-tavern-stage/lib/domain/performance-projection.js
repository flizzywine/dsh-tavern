import directorCommands from '../../../dsh-presentation-protocol/src/director-commands.cjs'
// verified semantic chain only; no leases, playback clock or canonical writes.
import {compilePerformance, performancePlan, performanceSustained, performanceBoundary} from '../../../dsh-presentation-protocol/src/performance-state.cjs'
import {performanceReferences} from '../../../dsh-presentation-protocol/src/performance-contract.cjs'
import {assetEntryEnabled} from '../../../dsh-presentation-protocol/src/asset-packs.js'
import {stageWidgetSchemaValue} from '../../../dsh-asset-library/lib/index.js'
import {skinOverlayTiming} from '../client/skin-overlay-timing.cjs'

export function performanceWidgetDefaults(document) {
  const command=document?.commands?.find(item=>item.effect === 'state.set')
  if (!command) return null
  const defaults = schema => {
    if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default)
    if (schema.type !== 'object') return undefined
    return Object.fromEntries(Object.entries(schema.properties).flatMap(([key,child]) => {
      const value = defaults(child)
      return value === undefined ? [] : [[key,value]]
    }))
  }
  const value = defaults(command.params)
  return stageWidgetSchemaValue(command.params,value) && stageWidgetSchemaValue(document.stateSchema,value) && new TextEncoder().encode(JSON.stringify(value)).length <= document.caps.bytes ? value : null
}

const clone = value => structuredClone(value)
const kinds = {skin:'skins',bgm:'music',look:'looks',ambience:'ambience',widget:'widgets',sfx:'sfx'}
const sameRef = (a,b) => a?.packId === b?.packId && a?.kind === b?.kind && a?.assetId === b?.assetId
export function performanceReference(document, owner, value, kind) {
  const [alias,assetId] = value.split(':')
  return {packId:alias === 'self' ? owner.packId : document.packs[alias],kind,assetId}
}
function planFor(performance, phase, resolveDocument) {
  const document = resolveDocument(performance.ref)
  if (!document) return null
  const compiled = compilePerformance(document)
  const resolveEvent = event => {
    if (event.do === 'skin-off') {
      const prior=[...(compiled.blocks.entry?.events || []),...(performance.level >= compiled.onLevel ? compiled.blocks.turn?.events || [] : [])].filter(item => item.do === 'skin').at(-1)
      const skinRef=prior && performanceReference(document,performance.ref,prior.ref,'skins')
      const timing=skinOverlayTiming(skinRef && resolveDocument(skinRef)?.overlay,'exit')
      return {...event,skinRef,completionMs:timing.durationMs,overlayTiming:timing}
    }
    if (!event.ref) return event
    const ref = performanceReference(document,performance.ref,event.ref,kinds[event.do])
    const metadata = resolveDocument(ref)
    const timing=event.do === 'skin' ? skinOverlayTiming(metadata?.overlay,event.block === 'turn' ? 'turn' : 'entry') : null
    return {...event, ref,...(timing ? {completionMs:timing.durationMs,overlayTiming:timing} : {}),
      ...(event.do === 'skin' && event.level === undefined ? {level:metadata?.levels?.[performance.level] ? performance.level : metadata?.levels?.default ?? 1} : {}),
      ...(event.do === 'widget' ? {slot:event.slot || metadata?.view?.slot || 'corner-right', state:metadata?.defaults || {}} : {})}
  }
  const plan = performancePlan(compiled,{phase,level:performance.level,resolveEvent})
  plan.sfxMap = Object.fromEntries(Object.entries(compiled.sfxMap).map(([key,value]) => {
    const bind = typeof value === 'string' ? {ref:value} : value
    return [key,{...bind,ref:performanceReference(document,performance.ref,bind.ref,'sfx')}]
  }))
  return plan
}
// signing the final body changes its digest, not the operation's event
// namespace. Array ordinals and the existing key shape stay unchanged.
const eventSource = record => record.binding.stream ? 'stream:' + record.binding.stream.operationId : record.binding.target.sourceKey
export const opKey = (record, entry, op) => [eventSource(record),record.binding.target.branchId,record.binding.generation ?? record.generation ?? 0,entry,op]

export function foldPerformanceAt({checked, page, turn, resolveDocument, predecessor = []}) {
  const chain = [...predecessor,checked]
  let current = null, instanceKey = null, phaseKey = null, restore = null, music = null, retiring = null
  for (const record of chain) {
    const target = record.binding.target, local = record === checked
    if (current?.phase === 'exit' && current.startedAt.turn !== target.turn) {current = null; instanceKey = null; phaseKey = null; restore = null}
    music = record.baseline.music
    for (const [entryOrdinal,entry] of record.entries.entries()) {
      if (local && entry.at > page.para) break
      for (const [opOrdinal,raw] of entry.ops.entries()) {
        const op = directorCommands.recordOperation(raw,record.binding)
      if (!op) continue
        const key = opKey(record,entryOrdinal,opOrdinal)
        if (op.op === 'music.set' || op.op === 'music.stop') {
          music = op.op === 'music.stop' ? null : op.value
          if (current) restore.directorRequest = {key,ref:clone(music),...(restore.directorRequest?.force || op.force === true && typeof op.reason === 'string' && op.reason.trim() ? {force:true} : {})}
          continue
        }
        if (op.op !== 'perform' && op.op !== 'perform.off') continue
        const boundary = entry.state.performance
        if (!boundary) continue
        const start = boundary.startedAt
        // The saved boundary uses the first canonical page of the beat, not para - 1.
        const ref = op.op === 'perform' ? op.id : current?.ref
        const document = ref && resolveDocument(ref)
        const level = op.level ?? document?.levels?.default ?? 1
        const next = performanceBoundary(current,{ref,level,topic:op.topic,off:op.op === 'perform.off'},start,document || {timeline:{}})
        if (next === current) continue
        if (next.phase === 'entry') {
          if (current && current.phase !== 'exit' && local && start.page === page.index) {
            retiring = {instanceKey,phaseKey,ref:clone(current.ref),plan:planFor(current,'exit',resolveDocument),dependencies:[]}
          }
          // Canonical base music is the restore target, never another performance's track.
          restore = {previous:clone(music),directorRequest:null}
          instanceKey = key
        }
        current = next
        phaseKey = [instanceKey,eventSource(record),entryOrdinal,opOrdinal]
      }
      // Media metadata can change later, but the accepted boundary type/level cannot.
      if (current && sameRef(current.ref,entry.state.performance?.ref)) current = clone(entry.state.performance)
    }
  }
  if (!current) return null
  const trigger = current.startedAt.turn === turn && current.startedAt.page === page.index
  if (current.phase === 'exit' && !trigger) return null
  const phase = trigger ? current.phase : 'idle'
  const plan = planFor(current,phase,resolveDocument)
  return {instanceKey,phaseKey,...clone(current),phase,page:clone(page),plan,
    retiring:trigger ? retiring : null, sustained:performanceSustained(plan), restore,
    dependencies:[],unavailable:plan ? null : {code:'PERFORMANCE_DEPENDENCY_UNAVAILABLE',ref:clone(current.ref)}}
}

// Expand metadata before leasing. Candidate recall limits are deliberately irrelevant here.
export function expandPerformanceDependencies({ref, document, snapshots, authorization}) {
  const packs = new Map(snapshots.map(pack => [pack.manifest.id,pack]))
  const refs = [ref,...(document ? performanceReferences(document,ref.packId).map(item => item.ref) : [])]
  const unique = [...new Map(refs.map(item => [JSON.stringify([item.packId,item.kind,item.assetId]),item])).values()]
  const unavailable = dependency => ({refs:unique,unavailable:{code:'PERFORMANCE_DEPENDENCY_UNAVAILABLE',ref:clone(ref),dependency:clone(dependency)}})
  // Even unused declared aliases are part of the author's binding contract.
  for (const packId of [ref.packId,...Object.values(document?.packs || {})]) {
    if (!authorization.boundPackIds.includes(packId)) return unavailable({packId})
  }
  if (!document) return unavailable(ref)
  for (const dependency of unique) {
    const pack = packs.get(dependency.packId)
    const asset = pack?.manifest.assets.find(item => item.kind === dependency.kind && item.id === dependency.assetId)
    if (!assetEntryEnabled(asset) || !authorization.boundPackIds.includes(dependency.packId)) return unavailable(dependency)
    if (dependency.kind === 'widgets' && !authorization.widgetAllowed?.(dependency,asset,pack)) return unavailable(dependency)
  }
  return {refs:unique,unavailable:null}
}

export function performanceProjectionSummary(value, {pageDigest, through}) {
  return value ? {pageVersion:1,pageDigest,through,instanceKey:value.instanceKey,phaseKey:value.phaseKey,sustained:value.sustained,restore:value.restore} : null
}
