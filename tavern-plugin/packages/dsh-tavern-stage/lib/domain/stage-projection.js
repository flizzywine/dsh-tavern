import directorCommands from '../../../dsh-presentation-protocol/src/director-commands.cjs'
import {resolution} from '../../../../lib/domain/figure-catalogue.js'
import { effectiveBubbleMoods } from '../../../../lib/domain/dialogue-bubbles.js'
import { matchBubbleMood } from '../../../../src/client/bubble-line.cjs'
import { stageAssetRefs } from './stage-asset-pack-catalogue.js'
import { foldAssetPackEntries } from './stage-asset-pack-director.js'
import {foldPerformanceAt, performanceWidgetDefaults} from './performance-projection.js'
import { createStagePlayback, validateStagePlayback, stagePlaybackKey, stagePlaybackIdentity, stagePlaybackRuler, stagePlaybackEmotions, stagePlaybackWriter, STAGE_PLAYBACK_VERSION } from './stage-playback.js'

import {isImmutableJson} from '../../../../lib/domain/freeze-json.js'
import {stageNarrationLayout} from '../../../../lib/domain/stage-narration.cjs'

const same = (a,b) => JSON.stringify(a) === JSON.stringify(b)
// Only completed sidecar checks are cached, never current media or authority.
// The chat cache owns these immutable objects and their lifetime across revisions.
const completedPlaybacks = new WeakMap()
// Canonical pages are independent of subtitle-card layout and viewport size.
export function stageProjectionPage(direction, at, page) {
  const pages = direction.pageIndex?.pages
  if (!pages) {
    if (page) throw Object.assign(new Error('Canonical page index unavailable'), {code:'STAGE_PAGE_MISMATCH'})
    return null
  }
  const coordinate = page ? pages[page.index] : pages.find(item => item.para === at)
  if (page && (page.version !== 1 || !Number.isSafeInteger(page.index) || !coordinate || coordinate.para !== page.para || coordinate.offset !== page.offset)) {
    throw Object.assign(new Error('Canonical stage page does not match frozen source'), {code:'STAGE_PAGE_MISMATCH'})
  }
  return coordinate ? {index:coordinate.page,para:coordinate.para,offset:coordinate.offset,version:1} : null
}
// the direction token is checked both before and after async projection.
// A resource failure is never a successful empty presentation.
export async function readStageProjection(options) {
  // Health probes resolve current media without creating historical playback snapshots.
  if (options.readOnly === true || !options.readPlayback) return readCurrentProjection(options)
  try {
    const direction = await options.readDirection()
    if (!same(direction.token,options.expectedDirectionToken)) return {status:'stale',directionToken:direction.token}
    // An opening can have no text (through=0) and still be the complete replay baseline.
    if (!direction.token || !direction.through && !direction.opening) return {status:'pending',directionToken:direction.token}
    // an opening scene is derived from current card settings; it has no frozen playback.
    if (direction.opening || direction.streaming) return readCurrentProjection({...options,direction,at:Math.min(Math.max(1,options.at || 1),direction.through)})
    const checked = direction.record || direction.preview, old = await options.readPlayback()
    const at = Math.min(Math.max(1,options.at || 1),direction.through)
    const coordinate = stageProjectionPage(direction,at,options.page)
    const token = JSON.stringify(direction.token)
    const warm = old && completedPlaybacks.get(old) === token &&
      Object.hasOwn(old.frames,stagePlaybackKey(checked,at,direction,coordinate))
    let saved = old
    if (!warm) {
      // Old playback is derived data: rebuild from the stored director, never decode/migrate old frames.
      const metadata = old?.version === STAGE_PLAYBACK_VERSION && same(old.source,stagePlaybackIdentity(direction)) ? validateStagePlayback(old,direction) : createStagePlayback(direction)
      const snapshotCache = {views:new WeakMap(),moods:new Map(),packs:new Set()}
      let changed = false, assetRevision, appendFrame
      // Freeze every sealed semantic boundary, not the subset visited by this viewport.
      const boundaries = new Set([1,...(direction.displayUnits || []).flatMap((unit,index) => unit.kind === 'line' ? [index + 1] : []),checked.baseline.cameraUntil === undefined ? 0 : checked.baseline.cameraUntil - (checked.baseline.pacing?.paragraph || 0) + 1,...checked.entries.flatMap(entry => [entry.at,entry.at + 1,
        entry.state.cameraUntil === undefined ? 0 : entry.state.cameraUntil - (checked.baseline.pacing?.paragraph || 0) + 1])])
      for (const boundary of new Set([at,...[...boundaries].filter(at => at >= 1 && at <= direction.through).sort((a,b) => a-b)])) {
        const boundaryPage = boundary === at ? options.page : undefined
        const key = stagePlaybackKey(checked,boundary,direction,stageProjectionPage(direction,boundary,boundaryPage))
        if (Object.hasOwn(metadata.frames,key)) continue
        // Fold the already validated prefix throughout this reconstruction. Recheck
        // authority before publishing instead of re-reading/hashing the record per frame.
        const result = await readCurrentProjection({...options,readDirection:() => direction,at:boundary,page:boundaryPage,snap:false,snapshotOnly:true,snapshotCache})
        if (result.status !== 'ready' && (boundary === at || result.status === 'stale' || !same(result.directionToken,direction.token))) return result
        assetRevision ??= options.revision()
        if (assetRevision !== options.revision() || result.status === 'ready' && result.revision !== assetRevision) return {status:'stale',directionToken:direction.token}
        // An unavailable off-page resource must not block the readable current page,
        // nor be silently reconstructed from a different hash on a later history visit.
        appendFrame ||= stagePlaybackWriter(metadata)
        if (result.status === 'ready') appendFrame.projection(key,result.value)
        else appendFrame(key,{missing:'media-unavailable-at-snapshot'})
        changed = true
      }
      metadata.acceptedPrefix = direction.token
      if (changed) {
        const latest = await options.readDirection()
        if (!same(latest.token,direction.token)) return {status:'stale',directionToken:latest.token}
        // Recheck external publications before saving the request-local reconstruction.
        const consumer = await snapshotCache.consumer
        await consumer.presentation.sync([...snapshotCache.packs].map(packId => ({packId})))
      }
      if (assetRevision !== undefined && assetRevision !== options.revision()) return {status:'stale',directionToken:direction.token}
      const written = changed || !same(old?.acceptedPrefix,direction.token)
      saved = written ? await options.writePlayback(direction,metadata,options.revision()) : metadata
      // After CAS, read back the authoritative immutable identity once. A racing
      // edit cannot inherit the completed check unless its full sidecar is equal.
      const stored = written ? await options.readPlayback() : old
      if (isImmutableJson(stored) && same(stored,saved)) completedPlaybacks.set(stored,token)
    }
    // history freezes director semantics, not an installed pack's
    // revision. Resolve the recorded IDs against today's media and anchors.
    // reuse this request's validated initial direction; the final live read still guards async work.
    const result = await readCurrentProjection({...options,direction,at})
    if (result.status === 'ready') {
      result.value.measurements = warm ? structuredClone(saved.measurements) : saved.measurements
      result.value.diagnostics ||= []
    }
    return result
  } catch (error) {
    // The bounded historical sidecar is not authority for today's presentation.
    // Keep its limits; an oversized snapshot must not withhold valid current media.
    if (error.code === 'LIMIT_EXCEEDED') {
      const result = await readCurrentProjection(options)
      if (result.status === 'ready') {
        result.value.diagnostics = [...(result.value.diagnostics || []),'playback-snapshot-limit']
        result.value.notice = '历史画面快照超出预算，当前演出不受影响'
      }
      return result
    }
    return {status:error.code === 'REVISION_CONFLICT' ? 'stale' : 'failed',directionToken:options.expectedDirectionToken,
      error:{code:error.code || 'PLAYBACK_FAILED',message:String(error.message)}}
  }
}
// `live2d` false = no Cubism Core on this machine. Only today's display falls back
// to the outfit's static sprite (selectPackFigure); the playback sidecar keeps the recorded Live2D choice.
// spine false = no Spine runtime; same display-only fallback.
async function readCurrentProjection({trace, expectedDirectionToken, readDirection, readConsumer, readSettings, readModSources, readCountdown, revision, direction, at = 1, page, snap = false, snapshotOnly = false, snapshotCache, live2d = true, spine = true, performanceEnabled = true}) {
  try {
    const measure = (name, operation) => trace ? trace.stage(name, operation) : operation()
    // Sealed boundaries share one consumer; the final live projection reads it anew.
    const consumer = await (snapshotCache ? (snapshotCache.consumer ||= Promise.resolve().then(readConsumer)) : readConsumer())
    if (!consumer || !consumer.presentation.available()) return {status:'revoked', scope:{authority:true}, reason:'unbound-or-unloaded',directionToken:expectedDirectionToken}
    direction ||= await readDirection()
    if (!direction.token) return {status:'pending', directionToken:null}
    if (!same(direction.token,expectedDirectionToken)) return {status:'stale', directionToken:direction.token}
    // readDirection is the validated host reader; fold does not revalidate the entries.
    const checked = direction.record || direction.preview
    const coordinate = stageProjectionPage(direction,at,page)
    if (page && page.para !== at) throw Object.assign(new Error('Stage paragraph and page differ'), {code:'STAGE_PAGE_MISMATCH'})
    at = Math.min(Math.max(1,at),direction.through)
    const state = await measure('projection.persistedState', () => foldAssetPackEntries(checked,at)), entry = checked.entries.filter(entry => entry.at <= at).at(-1)
    const settings = readSettings(), presentation = consumer.presentation, characters = [], avatars = []
    const missing = [], unavailable = new Set()
    const refKey = ref => JSON.stringify([ref.packId,ref.figureId || ref.kind,ref.assetId])
    let ops = entry?.at === at ? entry.ops.map(op => directorCommands.recordOperation(op,checked.binding)).filter(Boolean) : []
    const chain = [...(direction.predecessor || []),checked]
    // Sidecar frames contain scene/audio/figures, not performance execution plans.
    const performanceRefs = snapshotOnly || !performanceEnabled ? [] : [...new Map(chain.flatMap(record => [record.baseline.performance?.ref,...record.entries.map(entry => entry.state.performance?.ref)]).filter(Boolean).map(ref => [JSON.stringify(ref),ref])).values()]
    let metadata = [], performanceFailure = null, performancePlan = null
    const unavailablePerformance = error => {
      performanceFailure = {ref:state.performance?.ref || performanceRefs[0],dependencies:[],executionDependencies:[],
        unavailable:{code:error.code || 'PERFORMANCE_UNAVAILABLE',message:String(error.message)}}
    }
    try { if (performanceRefs.length) metadata = await measure('projection.performanceMetadata', () => presentation.performanceMetadata(performanceRefs)) }
    catch (error) { unavailablePerformance(error) }
    const resolveDocument = ref => {
      const pack = metadata.find(pack => pack.manifest.id === ref.packId)
      // embedded themes keep their timeline identity, including old saved plans.
      if (ref.kind === 'skins') return pack?.skins?.[ref.assetId] || Object.values(pack?.performances || {}).find(document => document.theme?.id === ref.assetId)?.theme
      if (ref.kind !== 'widgets') return pack?.[ref.kind]?.[ref.assetId]
      const asset = pack?.manifest.assets.find(asset => asset.kind === 'widgets' && asset.id === ref.assetId)
      const document=pack?.widgets?.[ref.assetId]
      return asset && document ? {...document,defaults:performanceWidgetDefaults(document)} : null
    }
    try {
      if (!performanceFailure && performanceRefs.length && coordinate) performancePlan = foldPerformanceAt({checked,page:coordinate,turn:direction.target?.turn ?? checked.binding.target.turn,
        predecessor:direction.predecessor || [],resolveDocument})
    } catch (error) { unavailablePerformance(error) }
    const referenced = [...stageAssetRefs(state).filter(ref => !['performances','skins'].includes(ref.kind)), ...Object.values(state.actors).map(actor => actor.figure).filter(Boolean),
      ...ops.filter(op => op.op === 'event' && op.value.op === 'sfx').map(op => op.value.value)]
    // Do not read or lease unbound packs, even when old history names them.
    const syncRefs = [...referenced.filter(ref => consumer.allowedPackIds.includes(ref.packId)),
      ...consumer.allowedPackIds.map(packId => ({packId}))]
    const unchecked = snapshotCache ? syncRefs.filter(ref => !snapshotCache.packs.has(ref.packId)) : syncRefs
    if (unchecked.length) {
      if (trace) await trace.stage('projection.sync', () => presentation.sync(unchecked))
      else await presentation.sync(unchecked)
      for (const ref of unchecked) snapshotCache?.packs.add(ref.packId)
    }
    const version = revision(), extension = presentation.extension
    const figureRows = await measure('projection.figureRows', () => presentation.figureRows(state.actors))
    await measure('projection.resolveFigures', () => presentation.prepareFigures([
      ...figureRows.filter(row => row.enabled).map(row => row.ref),
      ...referenced.filter(ref => ref.figureId && consumer.allowedPackIds.includes(ref.packId))
    ]))
    await measure('projection.referencedAssets', async () => { for (const ref of referenced) {
      const resolved = consumer.allowedPackIds.includes(ref.packId)
        ? await presentation[ref.figureId ? 'resolveFigure' : 'resolveAsset'](ref) : null
      if (!resolved?.value?.enabled || resolved.value.pendingMedia) {missing.push(ref); unavailable.add(refKey(ref))}
    } })
    const available = ref => !ref || !unavailable.has(refKey(ref))
    // revocation removes only the affected projection element, not the
    // whole historical turn. The canonical record and its requested state stay intact.
    for (const [alias,actor] of Object.entries(state.actors)) if (actor.figure &&
      !available(actor.figure)) {
      missing.push(actor.figure); actor.figure = null
    }
    if (state.scene?.background && !available(state.scene.background)) {
      const sceneEntries = checked.entries.filter(entry => entry.ops.some(op => op.op === 'scene.set' || op.op === 'scene.clear'))
      const start = sceneEntries.filter(entry => entry.at <= at).at(-1)?.at || 1
      const end = sceneEntries.find(entry => entry.at > at)?.at || direction.through + 1
      state.scene.background = await presentation.fallbackBackground((direction.displayUnits || direction.units || []).slice(start - 1,end - 1))
    }
    if (state.scene && !available(state.scene.timeLook)) state.scene.timeLook = null
    if (!available(state.lighting?.time?.ref)) state.lighting.time.ref = null
    if (!available(state.lighting?.mood)) state.lighting.mood = null
    if (!available(state.music)) state.music = null
    state.soundscape = Object.fromEntries(Object.entries(state.soundscape || {}).filter(([,ref]) => available(ref)))
    state.widgets = Object.fromEntries(Object.entries(state.widgets || {}).filter(([,widget]) => available(widget.ref)))
    ops = ops.filter(op => op.op !== 'event' || op.value.op !== 'sfx' || available(op.value.value))
    // The sidecar deliberately excludes rulers; only today's displayed projection needs one.
    if (!snapshotOnly) state.figureScale = stagePlaybackRuler(checked,at)
    const materialize = async (character,view) => {
      if (!snapshotCache || !Object.isFrozen(character)) return presentation.materialize(character,{...view,descriptors:true})
      // Character identity is frozen and revision-bound by presentation.character.
      // Sharing lasts only for this reconstruction; no lease or cross-request cache.
      let views = snapshotCache.views.get(character)
      if (!views) snapshotCache.views.set(character,views = new Map())
      const key = Number(view.stage) * 2 + Number(view.portrait)
      if (!views.has(key)) views.set(key,await presentation.materialize(character,{...view,descriptors:true}))
      return views.get(key)
    }
    // derive speaker -> actor without rewriting units, historical ops or playback keys.
    const emotions = {...direction.opening?.emotions, ...stagePlaybackEmotions(direction,at,segment => {
      const result = resolution.resolveFigureName(figureRows,segment,state.actors)
      return result.status === 'resolved' ? result.actorKey : undefined
    })}
    const refs = new Map(figureRows.filter(row => row.enabled).map(row => [row.actorKey,row.ref]))
    for (const [alias,actor] of Object.entries(state.actors)) refs.set(alias,actor.figure)
    await measure('projection.characters', async () => { for (const [alias,ref] of refs) {
      // historical actor refs outrank today's name index; ops stay untouched.
      const figure = ref ? (await presentation.resolveFigure(ref))?.value : null
      const configuredMoods = {emotions:settings.values.dialogue?.emotions,
        characters:[{alias, emotions:figure?.enabled ? figure.emotions : undefined}]}
      const moodKey = JSON.stringify(configuredMoods)
      if (snapshotCache && !snapshotCache.moods.has(moodKey)) snapshotCache.moods.set(moodKey,effectiveBubbleMoods(configuredMoods,alias))
      const moods = snapshotCache ? snapshotCache.moods.get(moodKey) : effectiveBubbleMoods(configuredMoods,alias)
      const emotion = matchBubbleMood(emotions[alias],moods)?.id
      const character = await presentation.character(alias,{actor:state.actors[alias], historical:true, emotion, live2d:snapshotOnly || live2d, spine:snapshotOnly || spine, figureRows})
      characters.push(await materialize(character,{stage:state.cast.includes(alias),portrait:false}))
      // avatar-only/fallback speakers are absent from director actors, not unbound.
      // Only their portraits use today's binding; historical stage selections stay intact.
      const portrait = !state.actors[alias]
        ? await presentation.character(alias,{emotion,figureRows})
        : character
      avatars.push(await materialize(portrait,{stage:false,portrait:true}))
    } })
    const sourceRefs = checked.entries.filter(entry=>entry.at <= at).flatMap(entry=>entry.ops.map(op=>directorCommands.recordOperation(op)).filter(op=>op?.op === 'widget.source').map(op=>op.ref))
    const widgets = snapshotOnly ? [] : await measure('projection.widgets', () => presentation.widgets(state,{sourceRefs,engine:settings.values,isCurrent:() => version === revision() && settings.revision === readSettings().revision}))
    if(!snapshotOnly && readModSources)widgets.push(...await measure('projection.modSources', () => readModSources({direction,at,state})))
    for(const widget of widgets) for(const [entryOrdinal,entry] of checked.entries.entries()) {
      if(entry.at>at)break
      entry.ops.forEach((op,ordinal)=>{if(/^widget\..*\.(set|update)$/.test(op.op) && refKey(op.ref)===refKey(widget.ref)) {
        widget.eventAt=entry.at;widget.eventToken=JSON.stringify([checked.binding.stream?.operationId || checked.binding.target.sourceKey,entryOrdinal,ordinal])
      }})
    }
    let performance = performanceFailure
    try {
      if (!performanceFailure && performancePlan) performance = await presentation.performance(performancePlan,{snapshots:metadata,engine:settings.values,
        isCurrent:() => version === revision() && settings.revision === readSettings().revision,snapshotOnly})
      if (!performanceFailure && metadata.length) await presentation.verifyPerformanceMetadata(metadata)
    } catch (error) { unavailablePerformance(error); performance = performanceFailure }
    if(!snapshotOnly && performance && !performance.unavailable && state.stageControls?.['timer/main'] && readCountdown)
      performance.countdown={...await readCountdown({direction,at}),at,turn:direction.target?.turn ?? checked.binding.target.turn,token:direction.token}
    if (state.dof && !state.cast.includes(state.dof)) state.dof = null
    for (const actor of Object.values(state.actors)) if (!['viewer','away'].includes(actor.gaze) && !state.cast.includes(actor.gaze)) actor.gaze = 'viewer'
    const value = {...(coordinate ? {page:coordinate} : {}),state, characters, avatars, widgets, performance, ...(missing.length ? {notice:'部分素材已移除，已跳过'} : {}), audio:await measure('projection.audio', () => presentation.audio(state,ops,{descriptors:true})),
      scene:await measure('projection.sceneSkin', () => presentation.scene(state,{timeTransitionMs:entry?.timeTransitionMs || 0,snap,descriptors:true,skinAllowed:!state.skin?.ref || consumer.allowedPackIds.includes(state.skin.ref.packId),performanceAllowed:performanceEnabled && (!state.performance?.ref || consumer.allowedPackIds.includes(state.performance.ref.packId))}))}
    // unavailable CG degrades only its overlay; requested state remains canonical.
    if (state.cg) {
      // CG on / off is 舞台模式 › 可用演出 (engine dimensions); no card override.
      try { value.scene.cg = available(state.cg.ref) && settings.values.dimensions.cg !== false ? await presentation.cg(state.cg,{descriptors:true}) : null }
      catch (error) { if (error.code === 'ASSET_STALE') throw error; value.scene.cg = null; value.scene.diagnostics.push('cg-unavailable') }
    }
    // Transient presenters use the same domain selector with their active layers.
    // Do not freeze a derived layout into historical playback frames.
    if (!snapshotOnly) value.scene.narrationLayout = stageNarrationLayout({cg:value.scene.cg})
    // the scene change the director chose, or null - the client's effect
    // resolver then picks the default (card-local > skin effects.transition > engine).
    let transition = null
    for (const entry of checked.entries) {
      if (entry.at > at) break
      for (const raw of entry.ops) {
        const op = directorCommands.recordOperation(raw,checked.binding)
        if (!op) continue
        if (op.op === 'scene.set' || op.op === 'scene.clear') transition = null
        if (op.op === 'event' && op.value.op === 'trans') transition = op.value.value
      }
    }
    if(direction.modPerformances) value.modPerformances=direction.modPerformances.filter(row=>row.at<=at)
    value.scene.transition = transition
    value.scene.figureScale = state.figureScale
    value.audio.musicRequest = state.musicRequest ?? null
    const latest = await measure('projection.authorityCheck', () => readDirection())
    if (version !== revision() || settings.revision !== readSettings().revision || !same(latest.token,direction.token) || latest.modCorrectionRevision!==direction.modCorrectionRevision) return {status:'stale', directionToken:latest.token}
    // transport-only canonical page receipt; excluded from playback frames.
    const cgReceipt = !snapshotOnly && value.scene.cg && coordinate && coordinate.para <= direction.through
      ? {expectedDirectionToken:direction.token,page:coordinate,through:direction.through,binding:direction.binding} : null
    const cgTransition = ops.some(op => op.op === 'cg.show' && op.transition === 'white') && !ops.some(op => op.op === 'scene.set' || op.op === 'scene.clear') ? 'white' : 'fade'
    return {status:'ready', directionToken:direction.token, revision:version, value, ...(cgReceipt ? {cgReceipt,cgTransition} : {})}
  } catch (error) {
    return {status:error.code === 'ASSET_STALE' || error.code === 'REVISION_CONFLICT' ? 'pending' : 'failed',
      directionToken:expectedDirectionToken, error:{code:error.code || 'PROJECTION_FAILED', message:String(error.message)}}
  }
}
