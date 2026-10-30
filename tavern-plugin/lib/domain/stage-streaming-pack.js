import { promptSection } from './prompt-section.js'
// streaming windows use the production registry/transaction, not a second validator.
import {prepareAssetPackDirector, buildAssetPackRequest, createAssetPackTransaction, readAssetPackRecord, PROMPT_PROSE as DIRECTOR_PROSE} from './stage-asset-pack-director.js'
import {expireAssetPackWidgets, stampAssetPackMusicRequests} from './stage-asset-pack-tools.js'
import {assetPackDigest} from './stage-asset-pack-catalogue.js'
import {stagePageIndex} from '../../src/client/stage-page-index.cjs'
import {cleanDirectorUnits} from './stage-director-text.js'
import {estimateDirectorTokens} from './stage-director-tokens.js'
import {initialAssetPackPacing} from './stage-asset-pack-pacing.js'
import {createStreamingDirector} from './stage-streaming-director.js'
import {hasStateImagePools} from './state-image-admission.js'
import {canonicalJson} from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'

const FIRST_WINDOW = 5

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "- In this window, paragraph numbers continue from earlier windows and `sequence` starts at 1. The window's last paragraph counts as the final one: cover it with `through` and set `done`, which closes the window, not the reply.",
  p002: "The story reply comes to you while it is being written, in windows of finished paragraphs, and you stage each window",
  p003: "Stage the opening promptly using facts already written. If a command needs a later outcome, leave it pending in the story and use it at a later paragraph when that outcome is known; earlier accepted paragraphs stay sealed."
})


export function createStreamingPackDirector({input, identity, runAgent, current, onChange = () => {}, prepareWindow, twoChunks = false}) {
  const first = prepareAssetPackDirector({...input, units:[], generation:0})
  const fixed = buildAssetPackRequest(first)
  const tool = fixed.tools[0]
  const windowPrompt = promptSection('director_window', PROMPT_PROSE.p001 + '\n' + PROMPT_PROSE.p003)
  const system = fixed.system.replace(DIRECTOR_PROSE.p006,PROMPT_PROSE.p002) + '\n' + windowPrompt
  // Each window is a one-shot request of its own (as upstream): it carries the accepted stage
  // state plus read-only directed pages and accepted effects, never the earlier conversation.
  let kernel, latest = first, attempts = 0, retries = 0, imageFailure
  function windowSource(displayUnits, firstAt, carried, epoch) {
    const units = cleanDirectorUnits(displayUnits)
    return {...input, units, imageUnits:displayUnits, recallUnits:units.slice(firstAt - 1), pageIndex:stagePageIndex(displayUnits), baseline:carried, record:undefined, generation:epoch, continuation:true}
  }
  const windowKey = (displayUnits, firstAt, carried, epoch) => canonicalJson([epoch, firstAt, displayUnits, carried])
  // The opening window's preparation starts as soon as its last paragraph is final (its paragraph
  // break arrived), before the next paragraph seals it. It is used only for byte-identical input.
  let early = null
  function dropEarly() {early?.controller.abort(); early = null}
  function prepareEarly() {
    const snapshot = kernel.snapshot()
    if (!prepareWindow || !twoChunks || snapshot.committed || snapshot.calls || snapshot.inFlight || snapshot.paragraphs.length !== FIRST_WINDOW) return
    const displayUnits = snapshot.paragraphs.map(item => item.unit), key = windowKey(displayUnits, 1, snapshot.state, snapshot.epoch)
    if (early?.key === key) return
    dropEarly()
    const controller = new AbortController()
    const promise = Promise.resolve().then(() => prepareWindow({source:windowSource(displayUnits, 1, snapshot.state, snapshot.epoch), paragraphs:snapshot.paragraphs,
        carried:snapshot.state, signal:controller.signal, epoch:snapshot.epoch, committed:false}))
    promise.catch(() => {})
    early = {key, epoch:snapshot.epoch, controller, promise}
  }
  kernel = createStreamingDirector({identity, baseline:first.baseline, system, tools:[tool],
    onChange(value) {
      if (early && (early.epoch !== value.epoch || ['failed','cancelled'].includes(value.phase))) dropEarly()
      onChange(value)
    },
    ...(twoChunks ? {firstWindowSize:FIRST_WINDOW,remainderOnCommit:true} : {}),
    async run({paragraphs, carried, request, signal, epoch, accept}) {
      if (!current()) throw Object.assign(new Error('Streaming source expired'),{code:'REVISION_CONFLICT'})
      const snapshot = kernel.snapshot(), last = paragraphs.at(-1).at
      const displayUnits = snapshot.paragraphs.slice(0,last).map(item => item.unit)
      const source = windowSource(displayUnits, paragraphs[0].at, carried, epoch), units = source.units
      const earlyInput = early && !snapshot.committed && early.key === windowKey(displayUnits, paragraphs[0].at, carried, epoch) ? early.promise : null
      if (earlyInput) early = null
      else dropEarly()
      const preparing = performance.now()
      const windowInput = earlyInput ? await earlyInput : prepareWindow ? await prepareWindow({source,paragraphs,carried,signal,epoch,committed:snapshot.committed}) : {prepared:prepareAssetPackDirector(source),mods:input.mods}
      const prepared = windowInput.prepared
      latest = prepared
      const prompt = buildAssetPackRequest({...prepared,baseline:carried,units:units.slice(paragraphs[0].at - 1)},true,undefined,'',false,paragraphs[0].at)
      // Mod framework prose can precede the JSON; window metadata is its own text part.
      prompt.messages[0].content.push({type:'text',text:JSON.stringify({first:paragraphs[0].at})})
      if (paragraphs[0].at > 1) prompt.messages[0].content.push({type:'text',text:promptSection('directed_context',
        'Read-only: these earlier paragraphs are already directed. Continue them; do not direct them or repeat their accepted effects.\n' + JSON.stringify({
          paragraphs:units.slice(0,paragraphs[0].at - 1).map((unit,index) => ({at:index + 1,unit})),
          accepted:snapshot.entries.map(({at,ops}) => ({at,ops}))
        }))})
      const wire = {...request,system:prompt.system.replace(DIRECTOR_PROSE.p006,PROMPT_PROSE.p002) + '\n' + windowPrompt,tools:prompt.tools,messages:prompt.messages,maxTokens:prompt.maxTokens}
      const capacity = prepared.modelInfo?.context?.contextWindow
      if (Number.isFinite(capacity) && estimateDirectorTokens(JSON.stringify(wire)) + wire.maxTokens > capacity) throw Object.assign(new Error('Streaming director request exceeds model context'),{code:'MODEL_CONTEXT_EXCEEDED'})
      const binding = prepared.binding
      const tx = createAssetPackTransaction({prepared:{...prepared,baseline:first.baseline}, validateModCommand:windowInput.mods?.validateCommand, signal,
        getCurrentBinding:() => current() && kernel.snapshot().epoch === epoch ? binding : null,
        window:{request:wire,first:paragraphs[0].at,entries:snapshot.entries,carried,accounting:snapshot.accounting}})
      function windowResult() {
        const record = tx.effect(), fresh = record.entries.slice(snapshot.entries.length)
        // Previews already carry the stream's event namespace (stage-director streamEnvelope), as the committed record will.
        stampAssetPackMusicRequests({binding:{...binding,stream:{version:1,operationId:identity.bodyOperationId,epoch}},baseline:first.baseline,entries:record.entries},record.end)
        let state = carried, accounting = snapshot.accounting
        const usage = tx.usage()
        return {results:paragraphs.map(paragraph => {
          const entries = fresh.filter(entry => entry.at === paragraph.at)
          if (entries.length) state = entries.at(-1).state
          if (paragraph.at === last) state = record.end
          const used = usage.findLast(item => item.at <= paragraph.at)
          if (used) accounting = {counts:used.counts,totalOps:used.totalOps}
          return {id:paragraph.id,at:paragraph.at,ops:entries.flatMap(entry => entry.ops),entries,state,accounting,diagnostics:record.diagnostics.filter(item => item.at === paragraph.at || !item.at && paragraph === paragraphs[0])}
        })}
      }
      let lastReply, error, windowAttempts = 0, chain = Promise.resolve()
      // Dev diagnostics (request log): how long this window waited for its preparation.
      const preparation = {waitMs:Math.round(performance.now() - preparing),early:!!earlyInput}
      try { if (!imageFailure) await runAgent({...wire, signal, task:'stage-director', selection:first.selection, temperature:0.2, window:{first:paragraphs[0].at,through:last}, preparation,
        persistent:false,webSearchEnabled:false,stopToolsWhen:tx.terminal,acceptWithoutText:() => lastReply !== undefined,
        onToolCall(call) {
          const pending = chain.then(() => {
            attempts++; if (windowAttempts++) retries++
            let args = call.arguments
            if (typeof args === 'string') {try {args=JSON.parse(args)} catch {args=null}}
            lastReply = tx.submitModel(call.name === tool.name ? args : null)
            if (tx.completed()) accept(windowResult())
            return JSON.stringify(lastReply)
          })
          chain = pending.catch(cause => {error=cause})
          return pending
        }}) } catch (cause) {
        if (!hasStateImagePools(prepared.context) || signal.aborted) throw cause
        tx.assertCurrent()
        imageFailure = {code:cause.code || 'DIRECTION_FAILED',error:String(cause.message)}
      }
      await chain
      if (error) throw error
      tx.finish()
      if (!tx.completed() && hasStateImagePools(prepared.context)) {
        imageFailure ||= {code:'DIRECTION_FAILED',error:lastReply?.errors[0]?.message || 'Director did not finish its body window'}
        tx.finishImages()
      }
      if (!tx.completed() && lastReply?.errors.length) throw Object.assign(new Error(lastReply.errors[0].message),{code:'STAGE_DIRECTION_REJECTED',rejection:lastReply.errors[0]})
      return windowResult()
    }})
  return {kernel, baseline:first.baseline, get binding() {return latest.binding},
    update(units, closed = false) {
      kernel.update(units)
      if (closed) prepareEarly()
    },
    complete(binding, count) {
      const snapshot = kernel.snapshot(), end = structuredClone(snapshot.state)
      if (snapshot.phase !== 'settled') throw new Error('Streaming direction incomplete')
      if (end.figureScale) delete end.figureScale.event
      expireAssetPackWidgets(end,'turn-end')
      if (end.camera.mode === 'close') end.camera = {mode:'reset',actor:null}
      delete end.cameraUntil
      end.pacing ||= initialAssetPackPacing(end)
      end.pacing.paragraph = (first.baseline.pacing?.paragraph || 0) + count
      const entries = structuredClone(snapshot.entries)
      stampAssetPackMusicRequests({binding,baseline:first.baseline,entries},end)
      const drops = snapshot.diagnostics.filter(item => item.dropped)
      const value = {format:first.format,complete:true,binding,baseline:first.baseline,entries,end,diagnostics:snapshot.diagnostics,
        partial:drops.length > 0,stats:{...(imageFailure ? {imageAdmission:{director:'error',...imageFailure}} : {}),calls:snapshot.calls,attempts,submissions:attempts,retries,failures:0,acceptedOps:snapshot.accounting.totalOps,droppedOps:drops.filter(item => !item.entry).length,droppedEntries:drops.filter(item => item.entry).length,
          dropsByCapability:Object.fromEntries([...new Set(drops.map(item => item.capability))].map(key => [key,drops.filter(item => item.capability === key).length]))}}
      return readAssetPackRecord({...value,digest:assetPackDigest({binding,baseline:value.baseline,entries:value.entries,end})})
    }}
}

