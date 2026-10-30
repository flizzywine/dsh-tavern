import directorCommands from '../../packages/dsh-presentation-protocol/src/director-commands.cjs'
// message-adjacent presentation data, never part of the strict director record.
import { assetPackDigest } from './stage-asset-pack-catalogue.js'
import { foldAssetPackEntries } from './stage-asset-pack-director.js'
import { deriveAssetPackFigureScale } from './stage-asset-pack-tools.js'
import { captureStageTarget } from './stage-incremental.js'
import { stripBubbleCodeQuote } from '../../src/client/bubble-line.cjs'
import { assertJson, canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { figureMetrics, FIGURE_ALGORITHM, FIGURE_DISPLAY } from '../../packages/dsh-presentation-protocol/src/figure-scale.cjs'

export const STAGE_PLAYBACK_FIELD = 'stagePlaybackV1'
export const STAGE_PLAYBACK_VERSION = 2
const clone = value => structuredClone(value)
// deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a,b) => canonicalJson(a) === canonicalJson(b)
const fail = () => { throw Object.assign(new Error('Invalid or stale stage playback'), {code:'REVISION_CONFLICT'}) }
// source bubbles, not the director or viewport, own expression changes.
export function stagePlaybackEmotions(direction, at, resolveActor) {
  const emotions = {}
  for (const unit of (direction?.displayUnits || []).slice(0, at)) {
    if (unit.kind !== 'line') continue
    const match = /^\s*@bubble(?:-voice)?\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]/.exec(stripBubbleCodeQuote(unit.text))
    if (match) {
      // optional projection adapter; the default saved-key input stays byte-identical.
      const alias = match[1].trim().toLowerCase(), key = resolveActor ? resolveActor({alias,name:match[2].trim()}) : alias
      if (key !== undefined) emotions[key] = match[3].trim()
    }
  }
  return emotions
}
export function stagePlaybackKey(checked, at, direction, page) {
  const entry = checked.entries.filter(entry => entry.at <= at).at(-1)
  const state = foldAssetPackEntries(checked,at)
  return assetPackDigest({state,...(state.performance && page ? {page,phase:state.performance.phase} : {}),ops:entry?.at === at ? entry.ops : [],timeTransitionMs:entry?.timeTransitionMs || 0,emotions:stagePlaybackEmotions(direction,at)})
}
export function stagePlaybackRuler(checked, at = Infinity) {
  let before = clone(checked.baseline), event = null
  // A baseline is a real carried scene, not a page or a renderer mount.
  before.figureScale ||= deriveAssetPackFigureScale(before,before,0)
  for (const entry of checked.entries) {
    if (entry.at > at) break
    const next = clone(entry.state)
    const cut = entry.ops.map(op => directorCommands.recordOperation(op,checked.binding)).filter(Boolean).some(op => op.op === 'scene.clear' || op.op === 'event' && op.value.op === 'trans' ||
      op.op === 'scene.set' && !same(before.scene?.background || null,op.value.background))
    // Verified snapshot rulers are authority too; filtered historical commands cannot rebuild their scene cuts.
    next.figureScale ||= deriveAssetPackFigureScale(before,next,entry.at,cut)
    if (next.figureScale.event) event = next.figureScale.event
    before = next
  }
  // Keep the last replay transition, as figureDirection does across no-op beats.
  // A late prefix can rescale now even when its entrant was on an earlier page.
  return {...before.figureScale,event}
}
export function stagePlaybackIdentity(direction) {
  return {sourceKey:direction.token.sourceKey,branchId:direction.token.branchId,generation:direction.token.generation,bindingKey:direction.token.bindingKey}
}
export function createStagePlayback(direction) {
  return {version:STAGE_PLAYBACK_VERSION,algorithm:FIGURE_ALGORITHM,displayVersion:FIGURE_DISPLAY.version,source:stagePlaybackIdentity(direction),
    acceptedPrefix:clone(direction.token), reconstructed:direction.complete === true, nodes:[],frames:{},measurements:{}}
}
// Structural deltas: only changed nodes and their ancestor paths are appended.
// All object/array children are references; scalars stay inline, including numbers.
export function stagePlaybackWriter(metadata) {
  const {nodes} = metadata, ids = new Map(nodes.map((node,id) => [JSON.stringify(node),id]))
  const intern = (value, memo) => {
    if (value === null || typeof value !== 'object') return value
    if (memo?.has(value)) return memo.get(value)
    const node = Array.isArray(value) ? value.map(item => intern(item,memo))
      : Object.fromEntries(Object.keys(value).sort().map(key => [key,intern(value[key],memo)]))
    const key = JSON.stringify(node)
    let id = ids.get(key)
    if (id === undefined) { id = nodes.length; nodes.push(node); ids.set(key,id) }
    const ref = [id]
    memo?.set(value,ref)
    return ref
  }
  const append = (key,frame) => { metadata.frames[key] = intern(frame)[0] }
  // Only one reconstruction owns these DTOs. Public append still observes mutable
  // inputs; projection snapshots can share unchanged selected figures and subtrees.
  const cache = {figures:new WeakMap(),clean:new WeakMap()}, memo = new WeakMap()
  append.projection = (key,value) => { metadata.frames[key] = intern(stagePlaybackFrame(value,cache),memo)[0] }
  return append
}
export function stagePlaybackFrames(metadata) {
  const decoded = [], depths = [], sizes = []
  for (const node of metadata.nodes) {
    if (!node || typeof node !== 'object') fail()
    let depth = 0, size = 1
    const resolve = value => {
      if (value !== null && typeof value === 'object') {
        if (!Array.isArray(value) || value.length !== 1 || !Number.isSafeInteger(value[0]) || value[0] < 0 || value[0] >= decoded.length) fail()
        depth = Math.max(depth,depths[value[0]] + 1); size += sizes[value[0]]
        return decoded[value[0]]
      }
      depth = Math.max(depth,1); size++
      return value
    }
    const value = Array.isArray(node) ? node.map(resolve) : Object.fromEntries(Object.entries(node).map(([key,value]) => [key,resolve(value)]))
    // The compact representation must not bypass the existing expanded JSON budget.
    if (depth > 64 || size > 500000) throw Object.assign(new Error('JSON complexity limit'),{code:'LIMIT_EXCEEDED'})
    decoded.push(value); depths.push(depth); sizes.push(size)
  }
  return Object.fromEntries(Object.entries(metadata.frames).map(([key,id]) => {
    if (!Number.isSafeInteger(id) || id < 0 || id >= decoded.length) fail()
    return [key,decoded[id]]
  }))
}
export function validateStagePlayback(raw, direction) {
  assertJson(raw)
  if (!raw || raw.version !== STAGE_PLAYBACK_VERSION || raw.algorithm !== FIGURE_ALGORITHM || raw.displayVersion !== FIGURE_DISPLAY.version || !same(raw.source,stagePlaybackIdentity(direction)) ||
      Object.keys(raw).some(key => !['version','algorithm','displayVersion','source','acceptedPrefix','reconstructed','nodes','frames','measurements'].includes(key)) ||
      typeof raw.reconstructed !== 'boolean' || !Array.isArray(raw.nodes) || !raw.frames || Array.isArray(raw.frames) || !raw.measurements || Array.isArray(raw.measurements) || !raw.acceptedPrefix ||
      !same(stagePlaybackIdentity({token:raw.acceptedPrefix}),raw.source) || !Number.isSafeInteger(raw.acceptedPrefix.prefixRevision) || raw.acceptedPrefix.prefixRevision < 0 || raw.acceptedPrefix.prefixRevision > direction.token.prefixRevision ||
      Object.keys(raw.acceptedPrefix).some(key => !['sourceKey','branchId','generation','bindingKey','prefixRevision','digest'].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(raw.acceptedPrefix.digest) || JSON.stringify(raw).length > 16 * 1024 * 1024) fail()
  const visited = new Set()
  const visit = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    if (value.resource === true) {
      if (!['media','bundle'].includes(value.kind) || !/^[a-f0-9]{64}$/.test(value.hash) || !value.ref?.packId || typeof value.identity !== 'string' ||
          Object.keys(value).some(key => !['resource','kind','hash','ref','identity','revision','alias','bundleKey','crop'].includes(key))) fail()
      // cropped avatar descriptors are frozen media too, not transport URLs.
      if (Object.hasOwn(value,'crop')) {
        const crop = value.crop
        if (value.kind !== 'media' || crop !== null && (!crop || Array.isArray(crop) ||
            Object.keys(crop).length !== 4 || !['x','y','w','h'].every(key => Number.isFinite(crop[key]) && crop[key] >= 0 && crop[key] <= 1) ||
            crop.w <= 0 || crop.h <= 0 || crop.x + crop.w > 1 || crop.y + crop.h > 1)) fail()
      }
      return
    }
    for (const [key,item] of Object.entries(value)) {
      if (['figureScale','ruler','locks','hMax'].includes(key) || typeof item === 'string' && /^(blob:|https?:|file:)/.test(item)) fail()
      visit(item)
    }
  }
  for (const [key,frame] of Object.entries(stagePlaybackFrames(raw))) {
    if (!/^[a-f0-9]{64}$/.test(key) || !frame || Object.keys(frame).some(key => !['characters','avatars','scene','audio','missing'].includes(key))) fail()
    if (frame.missing ? frame.missing !== 'media-unavailable-at-snapshot' || Object.keys(frame).length !== 1 : !Array.isArray(frame.characters) || !Array.isArray(frame.avatars) || !frame.scene || !frame.audio) fail()
    visit(frame)
  }
  for (const [key,value] of Object.entries(raw.measurements)) {
    if (!/^[a-f0-9]{64}$/.test(key) || value.algorithm !== FIGURE_ALGORITHM || value.geometryKey !== key ||
        !/^[a-f0-9]{64}$/.test(value.hash) || value.metrics?.algorithmVersion != null && value.metrics.algorithmVersion !== value.algorithm || !same(value.metrics,figureMetrics(value.metrics))) fail()
  }
  return clone(raw)
}
const FRAME_FIGURE_FIELDS = ['alias','ref','revision','form','appearance','outfitKey','state','avatar','avatarCrop','avatarStateId','avatarOutfitKey','geometry','modelUrl','spriteUrls','avatarUrl']
// Only host-built descriptor DTOs enter frames. Ruler/height are already frozen in the record.
export function stagePlaybackFrame(value, cache) {
  const clean = value => {
    if (!value || typeof value !== 'object') return value
    if (cache?.clean.has(value)) return cache.clean.get(value)
    const result = Array.isArray(value) ? value.map(clean)
      : Object.fromEntries(Object.entries(value).filter(([key]) => !['ruler','figureScale'].includes(key)).map(([key,item]) => [key,clean(item)]))
    cache?.clean.set(value,result)
    return result
  }
  // Playback re-projects today's media for every page;
  // from a frame it reads only that the boundary is frozen and, for a measurement, a figure's
  // geometry key and resource hashes. Frames keep the figure selection, geometry and descriptors,
  // not its authoring documents (outfit, manifest, avatar source), which dominated every turn.
  const figure = item => Object.fromEntries(FRAME_FIGURE_FIELDS.filter(key => Object.hasOwn(item,key)).map(key => [key,item[key]]))
  // Offstage actors have no stage resources; their independently selected portraits
  // remain in avatars. Do not freeze a second authoring copy for every card binding.
  const characters = value.state?.cast ? value.characters.filter(item => value.state.cast.includes(item.alias)) : value.characters
  const selected = item => {
    if (!cache) return figure(item)
    if (!cache.figures.has(item)) cache.figures.set(item,figure(item))
    return cache.figures.get(item)
  }
  return clean({characters:characters.map(selected),avatars:value.avatars.map(selected),scene:value.scene,audio:value.audio})
}
// Runs inside the existing message update queue. No closed background task checkpoint is used.
export function saveStagePlayback(chat, turn, direction, candidate) {
  const index = chat.messages.findIndex(m => m.role === 'assistant' && Number(m.turn || (m.greeting ? 1 : 0)) === turn)
  const message = chat.messages[index], target = index >= 0 && captureStageTarget(chat,index)
  if (!message || target.sourceKey !== direction.token.sourceKey || target.branchId !== direction.token.branchId ||
      (message.stageDirectionGeneration || 0) !== direction.token.generation) fail()
  const record = message.stageDirectionAssetPacks, draft = message.stageDirectionAssetPacksDraft
  if (record ? record.digest !== direction.token.digest : !draft?.state || draft.state.nextSequence - 1 !== direction.token.prefixRevision ||
      !same(draft.state.entries,direction.preview?.entries) || draft.state.through !== direction.through) fail()
  const next = validateStagePlayback(candidate,direction), old = message[STAGE_PLAYBACK_FIELD]
  if (old?.version === STAGE_PLAYBACK_VERSION && same(old.source,next.source)) {
    validateStagePlayback(old,direction)
    const frames = stagePlaybackFrames(next), append = stagePlaybackWriter(next)
    for (const [key,value] of Object.entries(stagePlaybackFrames(old))) {
      if (Object.hasOwn(frames,key) && !same(frames[key],value)) fail()
      if (!Object.hasOwn(frames,key)) append(key,value)
    }
    next.measurements = {...next.measurements,...clone(old.measurements)}
    next.reconstructed = old.reconstructed
  }
  validateStagePlayback(next,direction)
  if (old?.version === STAGE_PLAYBACK_VERSION && same(old,next)) return old
  message[STAGE_PLAYBACK_FIELD] = next
  return next
}
// Presentation is a one-floor derived write, not a rewrite of the conversation archive.
export async function patchStagePlayback(chat, turn, direction, candidate, {patch, assertCurrent}) {
  const index = chat.messages.findIndex(m => m.role === 'assistant' && Number(m.turn || (m.greeting ? 1 : 0)) === turn)
  if (index < 0) fail()
  const messages = chat.messages.slice()
  messages[index] = {...messages[index]}
  const previous = messages[index][STAGE_PLAYBACK_FIELD]
  const saved = saveStagePlayback({...chat,messages},turn,direction,candidate)
  const changes = saved === previous ? [] : [{op:'set',path:['messages',index,STAGE_PLAYBACK_FIELD],value:saved}]
  const result = await patch(chat.id,chat._storageRevision,changes,{source:'stage-playback',touchUpdatedAt:false,returnProjection:[],assertCurrent})
  if (!result) fail()
  return saved
}
export function addStageMeasurement(metadata, direction, input) {
  const next = validateStagePlayback(metadata,direction)
  const {geometryKey,hash,algorithm,metrics} = input || {}
  if (Object.keys(input || {}).some(key => !['geometryKey','hash','algorithm','metrics'].includes(key)) || !same(metrics,figureMetrics(metrics)) || metrics.algorithmVersion != null && metrics.algorithmVersion !== algorithm || algorithm !== FIGURE_ALGORITHM || !/^[a-f0-9]{64}$/.test(geometryKey) || !/^[a-f0-9]{64}$/.test(hash)) fail()
  const figures = Object.values(stagePlaybackFrames(next)).flatMap(frame => [...(frame.characters || []),...(frame.avatars || [])])
  const contains = value => value && typeof value === 'object' && (value.resource === true ? value.hash === hash : Object.values(value).some(contains))
  if (!figures.some(figure => Object.values(figure.geometry || {}).includes(geometryKey) && contains(figure))) fail()
  const measurement = {geometryKey,hash,algorithm,metrics:figureMetrics(metrics)}
  if (next.measurements[geometryKey] && !same(next.measurements[geometryKey],measurement)) fail()
  next.measurements[geometryKey] = measurement
  return next
}
