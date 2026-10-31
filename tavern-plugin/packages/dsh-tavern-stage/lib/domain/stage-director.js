import {stageReadScope, stageReadIdentityOnly} from '../../../../lib/domain/stage-read-projection.js'
import {judgeEnabled} from '../../../../lib/domain/engine-judge.js'
import {hasStateImagePools, initializeStateImages, stateImageReplay} from '../../../../lib/domain/state-image-admission.js'
import {frozenActors} from './stage-asset-pack-director.js'
import {readCardAssetExtension} from '../../../../lib/domain/card-asset-bindings.js'
import {modStageTurn} from '../../../../lib/domain/mods/stage-contributions.js'
import {judgeMaterial,selectJudgeRecall} from './stage-judge-recall.js'
import { assetPackDigest } from './stage-asset-pack-catalogue.js'
import { canonicalJson } from '../../../dsh-presentation-protocol/src/asset-pack-json.js'
import { captureStageTarget } from '../../../../lib/domain/stage-incremental.js'
import { createStageHistoryCache, isPerformanceChainBoundary } from './stage-history-cache.js'
import { isImmutableJson } from '../../../../lib/domain/freeze-json.js'
import { sceneTarget } from '../../../../lib/domain/scene-illustration.js'
import { stageParagraphs } from '../../../../lib/domain/stage-paragraphs.js'
import { roundBody } from '../../../../lib/domain/round-body.js'
import { cleanDirectorUnits } from './stage-director-text.js'
import { projectAgentMessageText } from '../../../../lib/domain/runtime-content-projection.js'
import { stagePageIndex } from '../../../../src/client/stage-page-index.cjs'
import { prepareStageItems, finalizeStageItems, coreItemIntents } from './stage-items.js'
import { prepareAssetPackDirector, assetPackDirectorCatalogue, buildAssetPackRequest, nameModSections, nameModCommands, runAssetPackDirector, readAssetPackRecord, readAssetPackPreview, ASSET_PACK_RECORD_FIELD as RECORD, ASSET_PACK_DRAFT_FIELD as DRAFT } from './stage-asset-pack-director.js'
import { createStreamingPackDirector } from './stage-streaming-pack.js'
import { randomUUID } from 'node:crypto'
import { cardGreetings, messageOpeningId, resolveOpeningScene } from './stage-opening-scene.js'
import { ASSET_PACK_FORMAT } from '../../../dsh-presentation-protocol/src/asset-packs.js'
import {modCorrectionSourceMatches} from '../../../../lib/domain/mods/stage-corrections.js'
import modProjection from '../../../../src/client/mod-projection.cjs'
export { stageParagraphs } from '../../../../lib/domain/stage-paragraphs.js'

const latestTurn = chat => Math.max(0, ...chat.messages.filter(m => m.role === 'assistant').map(m => Number(m.turn || (m.greeting ? 1 : 0))))
const messageIndex = (chat, turn) => chat.messages.findIndex(m => m.role === 'assistant' && Number(m.turn || (m.greeting ? 1 : 0)) === turn)
const expired = () => Object.assign(new Error('Director task expired; retry explicitly'), {code:'REVISION_CONFLICT'})
// The log names why a director stopped; the player UI shows only debug text for it.
const sourceChanged = () => Object.assign(new Error('舞台导演已停止：本轮正文已变化'), {code:'REVISION_CONFLICT'})
const FAILURE = 'stageDirectionAssetPacksFailure'
// A director at work on its round: written when it starts, cleared with its record or failure.
// One left by an earlier run of Tavern means a restart cut it off (DIRECTOR_INTERRUPTED).
const RUNNING = 'stageDirectionRunning'
const BOOT = randomUUID()
// The director depends on its round's prose (proseFence), never on the whole-game revision:
// choices, bookkeeping, character design or settlement must not void it.
const withoutRevision = ({revision, ...target}) => target

function playerInputBefore(chat, index, raw) {
  const previous = chat.messages.slice(0, index).findLast(message => ['user','assistant'].includes(message.role))
  return previous?.role === 'user' ? projectAgentMessageText(previous, {charName:raw?.name || raw?.data?.name, macroState:chat.macroState}) : ''
}

// Directors write their round into the save beside the game's other work (writer below).
export function createStageDirector(deps) {
  const jobs = new Map(), failures = new Map(), tasks = new Set(), versions = new Map(), listeners = new Set(), openingAssets = new Map()
  const streams = new Map(), streamStarts = new Map(), judgeResults = new Map(), retryPreparations = new Map(), openingCommits = new Map()
  const historyCache = createStageHistoryCache({readChanges:deps.readChanges,readRecords:deps.readRecords})
  let revision = Date.now()
  let disposed = false
  const key = (chat, turn) => JSON.stringify([chat.id, turn])
  function publish(job) {
    const event = {kind:'stage-direction', sessionId:job.sessionId, turn:job.turn, version:String(++revision)}
    for (const fn of listeners) fn(event)
    deps.publish?.(event)
  }
  // observation versions identify existing sealed content; they do not authenticate it again.
  function observation(chat, turn, body, displayDigest, unitsDigest, pageDigest, options) {
    const {record, preview, binding, baseline, entries, units, displayUnits, body:round, pageIndex, ...identity} = body
    const signature = JSON.stringify([identity, record?.digest, record?.diagnostics, record?.stats, record?.partial,
      preview?.prefixDigest, displayDigest, unitsDigest, pageDigest])
    const id = key(chat,turn)
    let version = versions.get(id)
    if (version?.signature !== signature) {version = {signature,revision:++revision};versions.set(id,version)}
    return options.sinceRevision === version.revision ? {unchanged:true,revision:version.revision} : {...body,revision:version.revision}
  }
  function invalidate(cardPath) {
    if (cardPath) openingAssets.delete(cardPath); else openingAssets.clear()
    for (const job of [...jobs.values(), ...streams.values()]) if (!cardPath || job.cardPath === cardPath) stop(job)
  }
  // A running director, for the deploy gate's view; never the game's busy state.
  function activity(chat) {
    const job = [...jobs.values(), ...streams.values()].find(job => job.chatId === chat.id && job.sessionId === chat.sessionId
      && (job.controller ? !job.controller.signal.aborted : job.pack && !['cancelled','failed','settled'].includes(job.pack.kernel.snapshot().phase)))
    return job ? {operationId:job.stopId, busy:true, phase:'running', role:'stage-director'} : null
  }
  // A stopped director is silent (as upstream): the round keeps what was saved, records no
  // failure, and is not started again by itself. Only a director's own error is recorded.
  function stop(job, reason) {
    if (job.stopped) return
    job.stopped = true
    job.controller?.abort(reason)
    job.pack?.kernel.cancel()
    publish(job)
  }
  // The next turn (no turn) or an interrupted or discarded turn stops its directors.
  function cancel(chat, turn) {
    for (const job of [...jobs.values(), ...streams.values()]) if (job.sessionId === chat.sessionId && (turn === undefined || job.turn === Number(turn))) stop(job)
  }
  const off = deps.assets.subscribe(invalidate)
  function observe(chat, {metadataOnly = false} = {}) {
    deps.mods?.observe(chat,{metadataOnly})
    for (const job of streams.values()) if (job.sessionId === chat.sessionId) {
      const op = chat.timeline?.operations?.[job.operationId]
      const index = metadataOnly ? -1 : messageIndex(chat, job.turn)
      if (chat.id !== job.chatId || chat.cardPath !== job.cardPath || chat.timeline?.branchId !== job.branchId || !op || ['cancelled','failed','stale','interrupted'].includes(op.status) || index >= 0 && recordAt(chat,index)) {
        stop(job); streams.delete(key({id:job.chatId},job.turn))
        if (job.pack) {const stopped=job.pack.kernel.drain();tasks.add(stopped);stopped.finally(() => tasks.delete(stopped))}
      }
    }
    for (const job of jobs.values()) if (job.sessionId === chat.sessionId) {
      try {
        const target = metadataOnly ? {...job.target, branchId:chat.timeline.branchId, revision:chat.timeline.revision} : targetAt(chat, messageIndex(chat, job.turn))
        if (chat.id !== job.chatId || chat.cardPath !== job.cardPath || chat.regenInProgress
          || canonicalJson(withoutRevision(target)) !== canonicalJson(withoutRevision(job.target))
          || !metadataOnly && job.fence && proseFence(chat,job.turn) !== job.fence) stop(job,sourceChanged())
      } catch { stop(job,sourceChanged()) }
    }
  }
  // records: the accepted chain from its last performance boundary, the only part a performance fold reads.
  function recordsThrough(chat, index, history) {
    if (history) return history.at(index)
    let previous = null, current = null
    let records = []
    for (let i = 0; i <= index; i++) {
      current = null
      const raw = chat.messages[i]?.[RECORD]
      if (!raw) continue
      const record = readAssetPackRecord(raw), target = record.binding.target
      if (target.sourceKey !== captureStageTarget(chat,i).sourceKey || target.predecessorDigest !== (previous?.digest || null)) continue
      previous = current = record
      if (isPerformanceChainBoundary(record)) records = []
      records.push(record)
    }
    return {previous, current, records}
  }
  const recordAt = (chat, index, history) => recordsThrough(chat,index,history).current
  const predecessor = (chat, index, history) => recordsThrough(chat,index - 1,history).previous
  const targetAt = (chat, index) => ({...captureStageTarget(chat,index), predecessorDigest:predecessor(chat,index)?.digest || null})
  // The round's prose fence (upstream 666519157): its body operation finished and unchanged, on
  // the same branch, the round still the latest, and its scene (this reply, its swipe, the story
  // before it and the stage it continues from) as directed. Not the timeline revision: choices,
  // the ledger or a character design move it without touching the text.
  function proseFence(chat, turn) {
    const index = messageIndex(chat,turn)
    if (index < 0 || chat.regenInProgress || latestTurn(chat) !== turn) return null
    const operation = Object.values(chat.timeline?.operations || {}).findLast(op => op.kind === 'body' && Number(op.turn) === turn)
    if (operation && !['foreground-completed','completed'].includes(operation.status)) return null
    return canonicalJson({cardPath:chat.cardPath,target:withoutRevision(targetAt(chat,index)),
      generation:chat.messages[index].stageDirectionGeneration || 0,operation:operation?.id || null})
  }
  // The director's writes, beside settlement and every other task: no background task, no story
  // revision. A write queues only for the save itself (milliseconds). The prose fence is the one
  // proof the final record needs: this round's prose finished, unchanged, still the latest.
  async function directedWriter(chat, turn) {
    const basis = await deps.readTaskChat(chat.id)
    if (!basis) throw expired()
    const fence = proseFence(basis,turn)
    const assertSource = value => { if (!fence || proseFence(value,turn) !== fence) throw sourceChanged() }
    return {chat:basis,
      // Marks the round as being directed, so a restart can tell it was cut off.
      markRunning(index) { return deps.writeMessage(basis.id, index, message => { message[RUNNING] = {boot:BOOT, at:Date.now()} }) },
      checkpointMessage(index, apply, options = {}) {
        return deps.writeMessage(basis.id, index, message => { options.assertCurrent?.(); apply(null, message) })
      },
      async commit(input) {
        let committed = false
        await deps.updateChat(basis.id, draft => {
          assertSource(draft)
          input.apply(draft)
          delete draft.messages[messageIndex(draft,turn)]?.[RUNNING]
          committed = true
          return draft
        })
        return {status:committed ? 'committed' : 'missing'}
      }}
  }
  const frozenDisplay = async (chat, turn) => {
    const source = sceneTarget(chat, turn)
    const body = deps.bodyForTurn ? await deps.bodyForTurn(chat,source)
      : roundBody(await deps.paragraphParts?.(chat,source) || [{kind:'markdown',text:source.source}], {chatId:chat.id,branchId:chat.timeline?.branchId,turn})
    const displayUnits = body.displayUnits
    return {body, displayUnits, units:cleanDirectorUnits(displayUnits), pageIndex:stagePageIndex(displayUnits)}
  }
  // Greetings never call a model. Pooled openings persist their image once at initialization;
  // read-only observations project the saved record and never select an image.
  function openingSnapshot(cardPath) {
    const revision = deps.assets.revision, hit = openingAssets.get(cardPath)
    if (hit?.revision === revision) return hit.value
    const value = deps.assets.snapshot(cardPath)
    openingAssets.set(cardPath, {revision, value})
    value.catch(() => { if (openingAssets.get(cardPath)?.value === value) openingAssets.delete(cardPath) })
    return value
  }
  const openingOf = (assets, message) => resolveOpeningScene(assets, messageOpeningId(message, cardGreetings(assets.raw)))
  async function openingRecord(chat, turn, index, round, persist = false) {
    const assets = await openingSnapshot(chat.cardPath)
    if (!assets) return {status:'off'}
    const opening = openingOf(assets, chat.messages[index])
    // Timeline revision is excluded: later turns must not re-key (and re-project) the greeting.
    const {revision:_timeline, ...target} = targetAt(chat, index)
    // A read-only observation already projected this exact round. Reuse it
    // instead of projecting the whole chat a second time without its cache.
    const frozen = round ? {units:cleanDirectorUnits(round.displayUnits),pageIndex:stagePageIndex(round.displayUnits)} : await frozenDisplay(chat, turn)
    const binding = {target, unitsDigest:assetPackDigest(frozen.units), pageDigest:assetPackDigest(frozen.pageIndex),
      opening:{id:opening.id, digest:assetPackDigest({state:opening.state, emotions:opening.emotions})}}
    const makeRecord = state => {
      const value = {format:ASSET_PACK_FORMAT, complete:true, binding, baseline:state, entries:[], end:state, diagnostics:[]}
      return readAssetPackRecord({...value, digest:assetPackDigest({binding, baseline:value.baseline, entries:value.entries, end:value.end})})
    }
    let record = makeRecord(opening.state)
    const context = {actors:frozenActors(readCardAssetExtension(assets.raw),assets.snapshots,undefined,assets.globalEnabledPackIds)}
    if (persist && hasStateImagePools(context)) {
      const id = key(chat,turn)
      if (!openingCommits.has(id)) {
        const pending = (async () => {
          // A greeting has no prose fence: its own source key guards the write.
          const basis = await deps.readTaskChat(chat.id)
          if (!basis || disposed || !assets.current() || targetAt(basis,index).sourceKey !== target.sourceKey) throw expired()
          const existing = recordAt(basis,index)
          if (existing) return existing
          const candidate = basis.messages[index][DRAFT]?.imageReplay
          const replay = candidate?.target.sourceKey === target.sourceKey && candidate.unitsDigest === binding.unitsDigest ? candidate : undefined
          const saved = makeRecord(initializeStateImages(opening.state,context,Math.random,replay,opening.emotions))
          let committed = false
          await deps.updateChat(basis.id, draft => {
            if (disposed || !assets.current() || targetAt(draft,index).sourceKey !== target.sourceKey) throw expired()
            draft.messages[index][RECORD] = saved
            delete draft.messages[index][DRAFT]
            delete draft.messages[index][FAILURE]
            committed = true
            return draft
          })
          if (!committed) throw expired()
          publish({sessionId:chat.sessionId,turn})
          return saved
        })()
        openingCommits.set(id,pending)
      }
      try {record = await openingCommits.get(id)} finally {openingCommits.delete(id)}
    }
    return {status:'done', record, ...record, opening:{emotions:opening.emotions}}
  }
  // The host owns model-slot resolution; isolated domain fixtures can inject a foreground choice.
  async function directorSelection(choice, chat) {
    return deps.selection ? deps.selection(chat) : choice && typeof choice === 'object' ? choice : await deps.foreground(chat)
  }
  async function prepare(chat, turn, {signal, preview = true, authorityOnly = false, retryPreparation, capturePreparation, streamingBaseline, hostOnly = false, display} = {}) {
    const assets = await deps.assets.snapshot(chat.cardPath)
    if (!assets) return null
    const index = messageIndex(chat, turn), target = targetAt(chat, index)
    const {units, displayUnits, pageIndex} = display || await frozenDisplay(chat, turn)
    const record = predecessor(chat, index), greeting = !record && chat.messages.slice(0, index).findLast(m => m.role === 'assistant' && m.greeting === true)
    const engine = structuredClone(assets.engine)
    engine.directorModel = hostOnly ? null : await directorSelection(engine.directorModel, chat)
    if (!hostOnly && deps.judgeConfig) engine.judge = await deps.judgeConfig(chat)
    if (!hostOnly && !engine.directorModel) throw new Error('No director model selected')
    const info = hostOnly ? null : await deps.modelInfo?.(engine.directorModel)
    const judgeConfigured = !hostOnly && judgeEnabled(engine.judge)
    let mods=hostOnly ? undefined : await deps.mods?.prepare(chat,turn,{target,preview:true,isCurrent:assets.current})
    const input = {...assets, modTurn:modStageTurn(chat,turn), playerName:chat.macroState?.userName, playerInput:playerInputBefore(chat,index,assets.raw), stateSource:await deps.stateSource?.(chat,assets.raw), ...(mods ? {mods,modPrompts:mods.fragments} : {}), items:prepareStageItems(assets.raw,chat,index), engine, target, units, imageUnits:displayUnits, pageIndex, generation:chat.messages[index].stageDirectionGeneration || 0, predecessor:recordsThrough(chat,index - 1).records, modelInfo:info, record:streamingBaseline ? undefined : record, ...(streamingBaseline ? {baseline:streamingBaseline,continuation:true} : {}), opening:greeting ? openingOf(assets, greeting).state : undefined}
    let prepared = prepareAssetPackDirector(input), judge, judgeResult, judgeRecall
    // Retry keeps decisions, not authority: rebuild bindings/proofs against the current source and assets.
    const scope = JSON.stringify([chat.cardPath,target.branchId,target.sourceKey,prepared.binding.unitsDigest,engine.judge])
    const reused = retryPreparation?.scope === scope ? retryPreparation : null
    if (!authorityOnly && prepared && deps.judge && judgeConfigured) {
      const questions = [...prepared.judgeQuestions,...(mods?.judgeQuestions || [])]
      const request = {material:judgeMaterial(engine.judge.preamble,units),questions:questions.map(({id,text}) => ({id,text}))}
      judge = deps.judge.preview(request,engine.judge)
      const inputKey = assetPackDigest({request,config:engine.judge,target:target.sourceKey,revision:assets.engine.judge,generation:input.generation})
      const saved = chat.messages[index][RECORD]?.stats?.judge
      let hit = judgeResults.get(chat.id)
      if (saved?.inputKey === inputKey) hit = saved
      if (reused?.judgeResult) hit = {...reused.judgeResult,inputKey}
      else if (!preview) {
        const probabilities = await deps.judge.judge({...request,sessionId:chat.sessionId})
        hit = {inputKey,probabilities:probabilities ? [...probabilities] : null}
        judgeResults.set(chat.id,hit)
      }
      if (hit?.inputKey === inputKey) {
        judgeResult = hit
        judgeRecall = selectJudgeRecall(questions,hit.probabilities ? new Map(hit.probabilities) : null,engine.judge)
      }
    }
    if (reused) judgeRecall = new Set(reused.judgeRecall)
    const preparation = {scope,...(judgeResult ? {judgeResult} : {}),judgeRecall:[...(judgeRecall || [])]}
    capturePreparation?.(preparation)
    // The mods read only the recalled catalogue here; the full preparation follows with their result.
    if (mods) mods=await deps.mods.prepare(chat,turn,{target,preview:preview || authorityOnly,isCurrent:assets.current,judgeRecall,
      assetCatalogue:judgeRecall ? assetPackDirectorCatalogue({...input,judgeRecall}) : prepared.context.catalogue,stageState:prepared.baseline.modState})
    if (mods?.selection) preparation.modSelection = mods.selection
    capturePreparation?.(preparation)
    if (mods || judgeRecall) prepared=prepareAssetPackDirector({...input,mods,modPrompts:mods?.fragments || [],judgeRecall})
    return {prepared, mods, judge, judgeResult, current:assets.current, index, target, hostOnly}
  }
  // stream identity is admitted only from a running host body operation.
  async function beginStream(chat, turn) {
    if (disposed || !chat?.cardPath || !['story','script'].includes(chat.mode)) return null
    const id = key(chat,turn)
    // Admission awaits assets/model selection. Do not let two hooks create owners
    // from the same pre-await snapshot and overwrite each other's native flight.
    const pending = (streamStarts.get(id) || Promise.resolve()).catch(() => {}).then(() => startStream(chat,turn))
    streamStarts.set(id,pending)
    try { return await pending }
    finally { if (streamStarts.get(id) === pending) streamStarts.delete(id) }
  }
  async function startStream(chat, turn) {
    if (disposed) return null
    const operation = Object.values(chat.timeline?.operations || {}).find(op => op.kind === 'body' && op.status === 'running' && Number(op.turn) === turn)
    if (!operation || !await deps.assets.hasBindings(chat.cardPath)) return null
    const id = key(chat,turn)
    let job = streams.get(id)
    if (job?.operationId !== operation.id) {
      if (job) stop(job)
      const assets = await deps.assets.snapshot(chat.cardPath)
      if (!assets) return null
      const engine = structuredClone(assets.engine)
      engine.directorModel = await directorSelection(engine.directorModel, chat)
      if (deps.judgeConfig) engine.judge = await deps.judgeConfig(chat)
      if (!engine.directorModel) return null
      // the host stream hook supplies the same immutable persisted read as observers.
      const history = isImmutableJson(chat) ? await historyCache.read(chat) : undefined
      // The carried predecessor and its bounded chain are full records, whatever view the hook read.
      await history?.load(chat,chat.messages.length - 1,{chain:true})
      const record = predecessor(chat,chat.messages.length,history), greeting = !record && chat.messages.findLast(m => m.role === 'assistant' && m.greeting)
      const target = {sessionId:chat.sessionId,chatId:chat.id,turn,branchId:chat.timeline.branchId,revision:chat.timeline.revision,
        sourceKey:assetPackDigest([chat.id,operation.id]),sourceDigest:assetPackDigest([]),predecessorDigest:record?.digest || null}
      job = {chatId:chat.id,sessionId:chat.sessionId,cardPath:chat.cardPath,branchId:chat.timeline.branchId,operationId:operation.id,turn,target, stopId:'director:' + (++revision), serial:0,current:assets.current}
      if (disposed) return null
      streams.set(id,job)
      const streamSource = text => ({operationId:operation.id,text})
      const current = () => !disposed && streams.get(id) === job && assets.current() && !['cancelled','failed'].includes(job.pack?.kernel.snapshot().phase)
      // Mod settings and variable bindings read this same pre-stream chat in every window; read them once.
      const modMemo = new Map()
      try {
        const mods = await deps.mods?.prepare(chat,turn,{target,preview:true,isCurrent:current,streamSource:streamSource(''),memo:modMemo})
        const input = {...assets,playerInput:playerInputBefore(chat,chat.messages.length,assets.raw),stateSource:await deps.stateSource?.(chat,assets.raw),...(mods ? {mods} : {}),items:prepareStageItems(assets.raw,chat,chat.messages.length),engine,target,record,predecessor:recordsThrough(chat,chat.messages.length - 1,history).records,
          opening:greeting ? openingOf(assets,greeting).state : undefined,modelInfo:await deps.modelInfo?.(engine.directorModel)}
        job.pack = createStreamingPackDirector({input,twoChunks:true,identity:{sessionId:chat.sessionId,branchId:job.branchId,bodyOperationId:operation.id,nativeTurn:turn},
          current,
          async prepareWindow({source,carried,signal,committed}) {
            if (committed && job.finalInput) {
              const prepared = job.finalInput.prepared
              return {prepared:{...prepared,baseline:carried,units:source.units,imageUnits:source.imageUnits,pageIndex:source.pageIndex,
                binding:{...prepared.binding,unitsDigest:assetPackDigest(source.units),pageDigest:assetPackDigest(source.pageIndex),generation:source.generation}},mods:job.finalInput.mods}
            }
            const windowTarget = {...target,sourceKey:assetPackDigest([operation.id,source.generation,source.units]),sourceDigest:assetPackDigest(source.units)}
            const options = {target:windowTarget,preview:true,isCurrent:current,streamSource:streamSource(source.units.map(unit => unit.text || '').join('\n\n')),stageState:carried.modState,memo:modMemo}
            let windowMods = await deps.mods?.prepare(chat,turn,options)
            // Only the judge questions need a full preparation before the final one; the mods read the catalogue.
            let judgeRecall, catalogue
            if (deps.judge && judgeEnabled(engine.judge)) {
              const prepared = prepareAssetPackDirector({...source,mods:windowMods,modPrompts:windowMods?.fragments || []})
              const questions = [...prepared.judgeQuestions,...(windowMods?.judgeQuestions || [])]
              const probabilities = await deps.judge.judge({sessionId:chat.sessionId,material:judgeMaterial(engine.judge.preamble,source.units),questions:questions.map(({id,text}) => ({id,text}))})
              judgeRecall = selectJudgeRecall(questions,probabilities,engine.judge)
            }
            if (!current() || signal.aborted) throw expired()
            if (deps.mods) catalogue = assetPackDirectorCatalogue({...source,mods:windowMods,judgeRecall})
            windowMods = await deps.mods?.prepare(chat,turn,{...options,judgeRecall,assetCatalogue:catalogue})
            const prepared = prepareAssetPackDirector({...source,mods:windowMods,modPrompts:windowMods?.fragments || [],judgeRecall})
            return {prepared,mods:windowMods}
          },
          runAgent:({preparation,...request}) => {
            job.modelCalls = (job.modelCalls || 0) + 1
            const bytes = value => new TextEncoder().encode(value).length
            deps.log?.({kind:'streaming-director-request',sessionId:job.sessionId,turn,operationId:job.operationId,modelCalls:job.modelCalls,window:request.window,preparation,
              systemBytes:bytes(request.system),toolSchemaBytes:bytes(JSON.stringify(request.tools)),tailBytes:bytes(JSON.stringify(request.messages))})
            return deps.runAgent({...request,sessionId:chat.sessionId,turn})
          },
          onChange:value => {
            if (value.calls !== job.loggedCalls) {
              job.loggedCalls = value.calls
              deps.log?.({kind:'streaming-director-cost',sessionId:job.sessionId,turn,operationId:operation.id,calls:value.calls,budget:value.budget,paragraphs:value.highWater,phase:value.phase})
            }
            const stamp = JSON.stringify([value.epoch,value.through,value.calls,value.phase])
            if (stamp !== job.published) {job.published=stamp;publish(job)}
          }})
      } catch (error) {
        if (streams.get(id) === job) streams.delete(id)
        throw error
      }
    }
    const serial = ++job.serial
    // closed: the last unit's text is final (its paragraph break arrived) though no next unit exists yet.
    return {update(body, closed = false) {if (job.serial === serial) job.pack.update(typeof body === 'string' ? stageParagraphs(body) : body, closed)},
      discard() {if (job.serial === serial) job.pack.kernel.update([])},
      cancel() {if (job.serial === serial) stop(job)}}
  }
  function streamEnvelope(chat, turn, job) {
    const snapshot = job.pack.kernel.snapshot(), displayUnits = snapshot.paragraphs.slice(0,snapshot.through).map(item => item.unit)
    const units = cleanDirectorUnits(displayUnits), pageIndex = stagePageIndex(displayUnits)
    const generation = snapshot.epoch, target = {...job.target,sourceKey:assetPackDigest([job.operationId,generation]),sourceDigest:assetPackDigest(displayUnits)}
    const binding = {...job.pack.binding,target,stream:{version:1,operationId:job.operationId,epoch:generation},generation,unitsDigest:assetPackDigest(units),pageDigest:assetPackDigest(pageIndex)}
    const body = {binding,sourceKey:target.sourceKey,generation,prefixRevision:snapshot.through,through:snapshot.through,units,baseline:job.pack.baseline,entries:snapshot.entries,complete:false}
    const preview = readAssetPackPreview({...body,prefixDigest:assetPackDigest(body)}), bindingKey = assetPackDigest(binding)
    const failed = (job.error ? {message:job.error} : snapshot.failure) || (snapshot.phase === 'cancelled' ? {message:'Generation stopped'} : null)
    return {streaming:true,status:failed ? 'error' : snapshot.through ? 'partial' : 'running',phase:failed ? 'error' : snapshot.through ? 'partial' : 'running',
      target,generation,token:{sourceKey:target.sourceKey,branchId:target.branchId,generation,bindingKey,prefixRevision:snapshot.through,digest:preview.prefixDigest},
      units,displayUnits,pageIndex,assetRevision:deps.assets.revision || 0,complete:false,through:snapshot.through,
      binding,bindingKey,prefixRevision:snapshot.through,
      baseline:job.pack.baseline,entries:snapshot.entries,preview,...(failed ? {error:failed.message,retryable:true} : {})}
  }
  async function finishStream(chat, turn, job) {
    if (job.finishing) return job.finishing
    job.committedSourceKey = captureStageTarget(chat,messageIndex(chat,turn)).sourceKey
    job.generation = chat.messages[messageIndex(chat,turn)].stageDirectionGeneration || 0
    job.finishing = (async () => {
      let task, admission
      try {
        const bodyOperation = Object.values(chat.timeline?.operations || {}).findLast(op => op.kind === 'body' && Number(op.turn) === turn)
        if (bodyOperation?.id !== job.operationId) throw expired()
        // Reading the writer's basis must not hold up the remainder window.
        admission = directedWriter(chat,turn).then(async writer => { await writer.markRunning(messageIndex(writer.chat,turn)); return writer })
        admission.catch(() => {})
        const frozen = await frozenDisplay(chat,turn)
        // Final-body hooks and judge run under the ordinary persisted source proof.
        await job.pack.kernel.drain()
        job.finalInput = await prepare(chat,turn,{preview:false,streamingBaseline:job.pack.kernel.snapshot().state,display:frozen})
        job.pack.kernel.commit(frozen.displayUnits)
        await job.pack.kernel.drain()
        task = await admission
        const snapshot = job.pack.kernel.snapshot()
        if (snapshot.phase !== 'settled') throw new Error(snapshot.failure?.message || 'Streaming director cancelled')
        const prepared = job.finalInput, index = messageIndex(task.chat,turn)
        if (!prepared || prepared.target.predecessorDigest !== job.target.predecessorDigest || !job.current()) throw expired()
        // The final binding must describe the display actually reconciled, not a later template projection.
        const finalDisplay = await frozenDisplay(task.chat,turn)
        if (prepared.prepared.binding.unitsDigest !== assetPackDigest(frozen.units) || prepared.prepared.binding.pageDigest !== assetPackDigest(frozen.pageIndex) ||
          canonicalJson(finalDisplay.units) !== canonicalJson(frozen.units) || canonicalJson(finalDisplay.pageIndex) !== canonicalJson(frozen.pageIndex)) throw expired()
        const binding = {...prepared.prepared.binding,...(job.pack.binding.items ? {items:job.pack.binding.items} : {}),generation:snapshot.epoch,stream:{version:1,operationId:job.operationId,epoch:snapshot.epoch,committed:true}}
        const effect = job.pack.complete(binding,frozen.units.length)
        const result = await task.commit({apply(draft) {
          if (disposed || streams.get(key(chat,turn)) !== job || job.pack.kernel.snapshot().phase !== 'settled' || !job.current() || canonicalJson(withoutRevision(targetAt(draft,index))) !== canonicalJson(withoutRevision(prepared.target))) throw expired()
          draft.messages[index][RECORD] = effect
          if (prepared.judgeResult) draft.messages[index][RECORD].stats.judge = prepared.judgeResult
          if (prepared.mods?.selection) draft.messages[index][RECORD].stats.modSelection = prepared.mods.selection
          finalizeStageItems(draft,index)
          draft.messages[index].stageDirectionGeneration = snapshot.epoch
          delete draft.messages[index][DRAFT]; delete draft.messages[index][FAILURE]
        }})
        if (result.status !== 'committed') throw expired()
        deps.mods?.applied(prepared.mods,effect)
        streams.delete(key(chat,turn))
      } catch (error) {
        // A failure before admission settled still records through its writer.
        task ||= await admission?.catch(() => undefined)
        const failure = {status:'error',sourceKey:captureStageTarget(chat,messageIndex(chat,turn)).sourceKey,error:String(error.message),retryable:true}
        const snapshot = job.pack.kernel.snapshot(), prepared = job.finalInput?.prepared
        if (snapshot.through && prepared && snapshot.committed && snapshot.phase === 'failed' && error.code !== 'REVISION_CONFLICT' && !job.stopped) {
          const binding = {...prepared.binding,generation:snapshot.epoch,stream:{version:1,operationId:job.operationId,epoch:snapshot.epoch,committed:true}}
          const body = {binding,sourceKey:binding.target.sourceKey,generation:snapshot.epoch,prefixRevision:snapshot.through,through:snapshot.through,
            units:prepared.units,baseline:job.pack.baseline,entries:snapshot.entries,complete:false}
          failure.preview = readAssetPackPreview({...body,prefixDigest:assetPackDigest(body)})
        }
        const current = () => !disposed && streams.get(key(chat,turn)) === job
        if (current() && !job.stopped) failures.set(key(chat,turn),failure)
        job.error = String(error.message)
        job.pack.kernel.fail(error)
        const saved = await saveFailure(task,job,failure,message => {
          if (!current()) throw expired()
          message.stageDirectionGeneration = job.pack.kernel.snapshot().epoch
        })
        if (saved && streams.get(key(chat,turn)) === job) streams.delete(key(chat,turn))
      } finally {
        const value = job.pack.kernel.snapshot()
        deps.log?.({kind:'streaming-director-cost',sessionId:job.sessionId,turn,operationId:job.operationId,calls:value.calls,modelCalls:job.modelCalls || 0,budget:value.budget,paragraphs:value.highWater,phase:job.error ? 'error':'committed'})
        publish(job)
      }
    })()
    tasks.add(job.finishing); job.finishing.finally(() => tasks.delete(job.finishing))
    return job.finishing
  }
  async function persistFailure(job, failure, apply = () => {}) {
    if (!deps.updateChat || disposed) return false
    let saved = false
    await deps.updateChat(job.chatId, draft => {
      const index = messageIndex(draft,job.turn)
      const message = draft.messages[index]
      if (draft.cardPath !== job.cardPath || index < 0 || draft.timeline?.branchId !== job.target.branchId ||
        captureStageTarget(draft,index).sourceKey !== failure.sourceKey ||
        (message.stageDirectionGeneration || 0) !== (job.generation || 0) || message[RECORD]) return undefined
      message[FAILURE] = failure
      delete message[RUNNING]
      apply(message)
      saved = true
      return draft
    })
    return saved
  }
  async function saveFailure(task, job, failure, apply = () => {}) {
    if (job.stopped) {
      deps.log?.({kind:'director-stopped',sessionId:job.sessionId,turn:job.turn,error:failure.error})
      // Stopped is silent: the round keeps what was saved, only its running mark goes.
      if (task) await deps.writeMessage(job.chatId, messageIndex(task.chat,job.turn), message => { delete message[RUNNING] }).catch(() => {})
      return true
    }
    deps.log?.({kind:'director-failure',sessionId:job.sessionId,turn:job.turn,sourceKey:failure.sourceKey,code:failure.code,error:failure.error})
    let saved = false
    if (task && !disposed) {
      try { saved = await persistFailure(job,failure,apply) }
      catch (error) {
        deps.log?.({kind:'director-failure-persistence',sessionId:job.sessionId,turn:job.turn,phase:'write',error:String(error.message),stack:error.stack})
      }
    }
    return saved
  }
  async function getValue(chat, turn, config, options = {}) {
    if (disposed || !chat.cardPath) return {status:'off'}
    if (!options.observed) observe(chat)
    turn ||= latestTurn(chat)
    if (!turn) return {status:'off'}
    // No extension means no service lookup, legacy catalogue or automatic generation.
    if (!await deps.assets.hasBindings(chat.cardPath)) return {status:'off', available:false}
    const id = key(chat, turn), index = messageIndex(chat, turn)
    if (index < 0) return {status:'missing'}
    const record = recordAt(chat, index, options.history)
    if (record) {
      const admission = record.stats?.imageAdmission
      return {status:admission?.director === 'error' ? 'error' : 'done',record,...record,...(admission?.director === 'error' ? {code:admission.code,error:admission.error} : {})}
    }
    if (chat.messages[index].greeting === true) return openingRecord(chat, turn, index, options.round, options.generate !== false)
    const stream = streams.get(id)
    if (stream) {
      if (stream.stopped) return {status:'missing'}
      if (options.generate !== false && !stream.finishing) void finishStream(chat,turn,stream)
      return streamEnvelope(chat,turn,stream)
    }
    // an undirected turn carries the last accepted end, never its first page.
    const baseline = predecessor(chat,index,options.history)?.end || null
    if (jobs.has(id)) {
      const job = jobs.get(id)
      // Cancellation is terminal even while the native runner is draining tools or disposing.
      // Keep ownership until cleanup finishes, but never advertise that job as running again.
      if (job.stopped) return {status:'missing',baseline}
      if (job.controller.signal.aborted) return {status:'error',code:'DIRECTOR_CANCELLED',error:'演出编排已取消；可手动重试。',retryable:true,baseline}
      return {...job.value,baseline}
    }
    const failure = chat.messages[index]?.[FAILURE] || failures.get(id)
    if (failure && failure.sourceKey === (options.history ? options.history.target(index,chat) : captureStageTarget(chat,index)).sourceKey) {
      const {preparation, ...visible} = failure
      return {...visible,baseline}
    }
    if (options.generate === false || turn !== latestTurn(chat) && !options.generate) {
      // A killed Tavern cannot save its per-message failure. Its running mark tells, so
      // phone/voice consumers are not left waiting for a prefix forever.
      const running = chat.messages[index]?.[RUNNING]
      if (running && running.boot !== BOOT) return {status:'error',code:'DIRECTOR_INTERRUPTED',error:'演出编排因重启中断。',baseline}
      return {status:'missing',baseline}
    }
    const job = {chatId:chat.id, sessionId:chat.sessionId, cardPath:chat.cardPath, turn, target:targetAt(chat,index), stopId:'director:' + (++revision), controller:new AbortController(), value:{status:'running',baseline}}
    jobs.set(id,job)
    publish(job)
    const logMods = phase => deps.log?.({kind:'director-mods',sessionId:job.sessionId,chatId:job.chatId,turn,
      generation:job.generation,phase,selected:job.preparation?.modSelection?.mods.filter(row=>row.selected).map(row=>row.id) || [],
      used:[...new Set((job.value.preview?.entries || []).flatMap(entry=>entry.ops.filter(op=>op.op==='mod.command').map(op=>op.modId)))].sort()})
    const promise = (async () => {
      let task
      try {
        task = await directedWriter(chat,turn)
        const basis = task.chat
        await task.markRunning(messageIndex(basis,turn))
        job.fence = proseFence(basis,turn)
        job.generation = basis.messages[index].stageDirectionGeneration || 0
        let input, preparationFailure
        try {
          input = await prepare(basis, turn,{preview:false,signal:job.controller.signal,hostOnly:config?.stage?.director === false,
            retryPreparation:retryPreparations.get(id),capturePreparation:value => {job.preparation = value}})
        } catch (error) {
          if (job.controller.signal.aborted || disposed || error.code === 'REVISION_CONFLICT') throw error
          input = await prepare(basis,turn,{hostOnly:true,preview:false})
          if (!input || !hasStateImagePools(input.prepared.context)) throw error
          preparationFailure = {director:'error',code:error.code || 'DIRECTION_FAILED',error:String(error.message)}
        }
        if (!input || job.controller.signal.aborted || disposed) throw expired()
        job.target = input.target
        logMods('selected')
        const getCurrentBinding = () => !disposed && !job.controller.signal.aborted && input.current() ? input.prepared.binding : null
        const oldDraft = basis.messages[input.index][DRAFT]
        const generate = trace => runAssetPackDirector({hostOnly:input.hostOnly,prepared:input.prepared, validateModCommand:input.mods?.validateCommand, getCurrentBinding, signal:job.controller.signal, trace,
          checkpoint:oldDraft, generation:basis.messages[input.index].stageDirectionGeneration || 0, guidance:options.guidance,
          publishPreview:preview => { job.value = {status:'partial', preview, baseline:preview.baseline}; publish(job); deps.mods?.applied(input.mods,preview) },
          runAgent:request => deps.runAgent({...request, sessionId:chat.sessionId,turn}),
          saveCheckpoint:checkpoint => task.checkpointMessage(input.index, (_draft, message) => {
            if (!getCurrentBinding()) throw expired()
            message[DRAFT] = checkpoint
          }, {trace, assertCurrent:() => { if (!getCurrentBinding()) throw expired() }})})
        const generated = deps.trace ? await deps.trace.run('stage-director', job.stopId, generate) : await generate()
        if (preparationFailure) (generated.effect.stats ||= {}).imageAdmission = preparationFailure
        const committed = await task.commit({apply(draft) {
          if (!generated.isCurrent() || canonicalJson(withoutRevision(targetAt(draft,input.index))) !== canonicalJson(withoutRevision(input.target))) throw expired()
          draft.messages[input.index][RECORD] = generated.effect
          if (input.judgeResult) draft.messages[input.index][RECORD].stats.judge = input.judgeResult
          if (input.mods?.selection) draft.messages[input.index][RECORD].stats.modSelection = input.mods.selection
          finalizeStageItems(draft,input.index)
          delete draft.messages[input.index][DRAFT]
          delete draft.messages[input.index][FAILURE]
        }})
        if (committed.status !== 'committed') throw expired()
        deps.mods?.applied(input.mods,generated.effect)
        retryPreparations.delete(id)
        logMods('committed')
        publish(job)
      } catch (thrown) {
        // A source-change abort surfaces from the model runner as a generic stop; log the actual cause.
        const reason = job.controller.signal.reason, error = typeof reason?.code === 'string' ? reason : thrown
        const failure = {status:'error', sourceKey:job.target.sourceKey, code:error.code || 'DIRECTION_FAILED', error:String(error.message), retryable:true, ...(job.value.preview ? {preview:job.value.preview} : {}), ...(job.preparation ? {preparation:job.preparation} : {})}
        logMods('failed')
        if (!job.stopped) failures.set(id,failure)
        await saveFailure(task,job,failure)
      }
    })().finally(() => { if (jobs.get(id) === job) jobs.delete(id); tasks.delete(promise); publish(job) })
    tasks.add(promise)
    return job.value
  }
  // observation never starts or resumes a task, including the latest turn.
  async function get(chat, turn, config, options = {}) {
    if (!options.readOnly) return getValue(chat, turn, config, options)
    // Active task cancellation inspects other turns too; it needs the complete task input.
    if (stageReadScope(chat) && [...jobs.values(),...streams.values()].some(job=>job.sessionId===chat.sessionId)) chat = await deps.readChat(chat.sessionId)
    turn ||= latestTurn(chat)
    observe(chat,{metadataOnly:!!stageReadScope(chat)})
    deps.mods?.recover?.(chat,turn)
    const measure = (name, operation) => deps.trace ? deps.trace.stage(name,operation) : operation()
    const index = messageIndex(chat, turn)
    // A chain-only view restores its own round and the earlier rounds it names, never another floor's identity row.
    if (index >= 0 && stageReadIdentityOnly(chat,index)) throw Object.assign(new Error('This stage view does not carry round ' + turn),{code:'STAGE_HISTORY_UNLOADED'})
    const history = await measure('direction.historyIdentity', () => historyCache.read(chat,index))
    // The round's own record, or the predecessor whose end an undirected round shows (one sub-path read when thin).
    if (index >= 0) await measure('direction.historyRecord', () => history.load(chat,index))
    const stream = streams.get(key(chat,turn))
    if (stream?.pack && !stream.stopped && !recordAt(chat,messageIndex(chat,turn),history)) {
      const body = streamEnvelope(chat,turn,stream)
      return observation(chat,turn,body,body.target.sourceDigest,body.binding.unitsDigest,body.binding.pageDigest,options)
    }
    const target = index >= 0 ? history.target(index,chat) : null
    const source = target ? sceneTarget(chat,turn) : null
    const round = await measure('direction.roundBody', async () => source ? deps.bodyForTurn ? await deps.bodyForTurn(chat,source,{persisted:true})
      : roundBody(await deps.paragraphParts?.(chat,source,{persisted:true}) || [{kind:'markdown',text:source.source}],{chatId:chat.id,branchId:chat.timeline?.branchId,turn}) : roundBody([]))
    const value = await measure('direction.record', () => getValue(chat, turn, config, {generate:false,history,observed:true,round}))
    const displayUnits = round.displayUnits
    const units = cleanDirectorUnits(displayUnits), pageIndex = stagePageIndex(displayUnits)
    const preview = value.preview ? readAssetPackPreview(value.preview) : null, record = value.record
    const binding = record?.binding || preview?.binding || null
    const legacyPlayback = !!record && binding.unitsDigest === undefined
    const unitsDigest = assetPackDigest(units), pageDigest = assetPackDigest(pageIndex)
    if (binding && (binding.target.sourceKey !== target.sourceKey || binding.target.sourceDigest !== target.sourceDigest)) throw expired() // preview.units are bound by binding.unitsDigest at seal time
    const generation = chat.messages[index]?.stageDirectionGeneration || 0
    const prefixRevision = preview?.prefixRevision ?? (record ? record.entries.length + units.length + 1 : undefined)
    const token = binding ? {sourceKey:target.sourceKey, branchId:target.branchId, generation,
      bindingKey:assetPackDigest(binding), prefixRevision, digest:record?.digest || preview.prefixDigest} : null
    const body = {status:value.status, phase:value.status === 'missing' ? 'unknown' : value.status,
      target, generation, token, units, displayUnits, body:round, pageIndex, legacyPlayback, assetRevision:deps.assets.revision || 0, complete:!!record, through:record ? units.length : preview?.through || 0,
      ...(binding ? {binding, bindingKey:token.bindingKey, prefixRevision, baseline:record?.baseline || preview.baseline,
        entries:record?.entries || preview.entries} : {}),
      ...(record ? {record} : {}), ...(preview ? {preview} : {}), ...(value.opening ? {opening:value.opening} : {}), ...(value.error ? {error:value.error, ...(value.code ? {code:value.code} : {})} : {})}
    Object.assign(body,roundPerformances(chat,index,target,{binding,record,preview}))
    const result = observation(chat,turn,body,assetPackDigest(displayUnits),unitsDigest,pageDigest,options)
    if (result.unchanged || !options.includePredecessor) return result
    // a page folds the performance chain only; a round that starts at a boundary needs no earlier record.
    const checked = record || preview
    return {...result,predecessor:checked && !isPerformanceChainBoundary(checked) ? (await history.load(chat,index - 1,{chain:true})).records : []}
  }
  // The round's stored performances (modPerformances, modCorrectionRevision): mod corrections for its source and core
  // items sealed against its record, or the item intents of an in-flight preview. Of the record it reads only the
  // digest and, for a preview, the binding and entries.
  function roundPerformances(chat, index, target, {binding, record, preview}) {
    const result = {}, generation = chat.messages[index]?.stageDirectionGeneration || 0
    const modCorrections=chat.messages[index]?.modCorrections
    if(binding && modCorrectionSourceMatches(modCorrections,{branchId:target.branchId,sourceKey:target.sourceKey,generation,textVersion:target.sourceKey})) {
      result.modPerformances=modProjection.projectModPerformances(modCorrections)
      result.modCorrectionRevision=modCorrections.revision
    }
    const coreItems=chat.messages[index]?.stageItems
    if(deps.itemsEnabled?.() !== false && record && coreItems?.version===2 && coreItems.directionDigest===record.digest) {
      result.modPerformances=[...(result.modPerformances || []),...coreItems.performances.filter(row=>!row.removed)]
      result.modCorrectionRevision=(result.modCorrectionRevision || 0)+coreItems.revision
    } else if(deps.itemsEnabled?.() !== false && preview && binding?.items?.version===2) {
      result.modPerformances=[...(result.modPerformances || []),...coreItemIntents({binding:{...binding,generation},entries:preview.entries})]
    }
    return result
  }
  // A round's 履历 performances (get(...).modPerformances, read-only). An earlier round of a chain-only view answers
  // from its floor fields and accepted record identity, without its record or body; the view's own round, an opening
  // and any round while a director task runs go through get().
  async function modPerformances(chat, turn) {
    const index = messageIndex(chat, turn)
    const active = [...jobs.values(),...streams.values()].some(job => job.sessionId === chat.sessionId)
    if (index < 0 || active || !stageReadIdentityOnly(chat,index) || chat.messages[index].greeting === true)
      return (await get(chat,turn,null,{readOnly:true})).modPerformances
    if (disposed || !chat.cardPath || !await deps.assets.hasBindings(chat.cardPath)) return undefined
    const history = await historyCache.read(chat,index), record = history.identity(index)
    // An earlier round without an accepted record has no binding: nothing plays.
    return record ? roundPerformances(chat,index,history.target(index,chat),{binding:record.binding,record,preview:null}).modPerformances : undefined
  }
  async function retry(chat, turn, {regenerate = false} = {}) {
    turn ||= latestTurn(chat)
    const id = key(chat,turn), job = jobs.get(id), stream = streams.get(id)
    stream?.pack?.kernel.cancel(); streams.delete(id)
    job?.controller.abort()
    // Wait until checkpoint writes have stopped before resetting the authoritative draft.
    await stream?.finishing
    if (job) await drain()
    const failure = failures.get(id) || chat.messages[messageIndex(chat,turn)]?.[FAILURE]
    const preparation = failure?.preparation
    if (preparation) retryPreparations.set(id,structuredClone(preparation))
    else retryPreparations.delete(id)
    while (retryPreparations.size > 64) retryPreparations.delete(retryPreparations.keys().next().value)
    failures.delete(id)
    const current = await deps.readChat(chat.sessionId)
    const message = current.messages[messageIndex(current,turn)]
    const imageReplay = stateImageReplay(message[RECORD]) || message[DRAFT]?.imageReplay || message[DRAFT]?.state?.imageReplay
    regenerate ||= message[RECORD]?.stats?.imageAdmission?.director === 'error'
    const reset = await deps.resetTask(current,turn,{regenerate,imageReplay})
    publish({sessionId:chat.sessionId, turn})
    return {ok:true, generation:reset.messages[messageIndex(reset,turn)]?.stageDirectionGeneration || 0, chat:reset}
  }
  async function preview(chat, turn) {
    const input = await prepare(chat,turn || latestTurn(chat))
    if (!input) return {status:'off'}
    const request = buildAssetPackRequest(input.prepared, true, undefined, '', true)
    return {...(input.judge ? {judge:input.judge} : {}),...(input.mods?.selection ? {modSelection:input.mods.selection} : {}),format:input.prepared.format, ...request, sections:nameModSections(request.sections, input.mods?.names), ...(request.commands ? {commands:nameModCommands(request.commands, input.mods?.names)} : {}), selection:input.prepared.selection, recall:input.prepared.context.catalogue.rows.filter(row => row.sent).map(row => ({ref:row.ref,reasons:row.reasons,consumer:row.consumer})), diagnostics:input.prepared.diagnostics}
  }
  async function drain() {await Promise.all([...streamStarts.values()]); await Promise.all([...streams.values()].map(job => job.pack?.kernel.drain())); await Promise.all([...tasks])}
  return {get, modPerformances, preview, retry, observe, drain, beginStream, activity, cancel,
    pendingCount: () => tasks.size + streamStarts.size + retryPreparations.size,
    // Offline migrations use the same input assembler; never run an agent.
    async prepareSnapshot(chat,turn,{authorityOnly = false} = {}) { return (await prepare(chat,turn,{authorityOnly}))?.prepared },
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn)},
    async generate(chat,turn,config) {const reset = await retry(chat,turn,{regenerate:true}); return get(reset.chat,turn,config,{generate:true})},
    dispose() {disposed = true; off(); invalidate(); listeners.clear(); versions.clear(); judgeResults.clear(); retryPreparations.clear(); historyCache.clear(); return drain()}}
}
