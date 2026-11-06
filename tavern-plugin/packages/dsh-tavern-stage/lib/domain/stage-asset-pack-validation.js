// a correction window is durable but unpublished until its anchors are sealed.
import { assertJson, check, canonicalJson } from '../../../dsh-presentation-protocol/src/asset-pack-json.js'
import { recordedAssetPackOperation, validateAssetPackToolValue, reduceAssetPackOperation, deriveAssetPackFigureScale, assetPackCommandDefinition } from './stage-asset-pack-tools.js'
import { paceAssetPackOperation } from './stage-asset-pack-pacing.js'
import directorCommands from '../../../dsh-presentation-protocol/src/director-commands.cjs'
import resolution from '../../../dsh-presentation-protocol/src/figure-resolution.cjs'
import {assetContent} from '../../../dsh-presentation-protocol/src/asset-variant-content.js'
// deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a, b) => canonicalJson(a) === canonicalJson(b)

const clone = value => structuredClone(value)
// Repair hints describe only this field; nested object/array grammar is already in the tool.
export function assetPackFieldConstraint(schema, defs = {}) {
  if (!schema) return undefined
  if (schema.$ref) return assetPackFieldConstraint(defs[schema.$ref.split('/').at(-1)], defs)
  return Object.fromEntries(Object.entries(schema)
    .filter(([key]) => !['properties','items','$defs','additionalProperties'].includes(key))
    .map(([key, value]) => [key, ['oneOf','anyOf','allOf'].includes(key)
      ? value.map(item => assetPackFieldConstraint(item, defs))
      : key === 'not' ? assetPackFieldConstraint(value, defs) : value]))
}
// resolve the failing slot, not an unresolved $ref or a whole catalogue.
function slotFeedback(error, definition, context, op, state, at) {
  if (!definition) {
    // An unknown op lists its own namespace when it has one (screen.flash: screen.*), else every command.
    const all=directorCommands.selected(context), noun=typeof op?.op === 'string' ? op.op.split('.')[0] : null, family=all.filter(item=>item.name.split('.')[0]===noun)
    const commands=family.length ? family : all
    return {received:op?.op ?? op ?? null,validValues:commands.map(item=>item.name),...(family.length ? {} : {choiceDetails:commands.map(item=>({value:item.name,label:item.label || item.summary || item.name}))})}
  }
  if (error.path?.startsWith('$.pacing')) return {received:op}
  const defs = directorCommands.defs(context), resolve = s => s?.$ref ? defs[s.$ref.split('/').at(-1)] : s
  const parts = (error.path || '$').slice(2).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let schema = definition.schema(context), received = op
  for (const part of parts) {
    schema = resolve(schema)
    schema = schema?.properties?.[part] || schema?.items
    received = received?.[part]
  }
  schema = resolve(schema)
  const values = s => {
    s = resolve(s)
    if (!s) return undefined
    if (s.enum) return s.enum
    if (Object.hasOwn(s,'const')) return [s.const]
    if (s.oneOf || s.anyOf) return (s.oneOf || s.anyOf).flatMap(item => values(item) || [])
    if (s.properties?.actor) return (values(s.properties.actor) || []).map(actor => ({actor}))
    return undefined
  }
  if (error.code === 'DISABLED' || error.code === 'CAP_EXCEEDED') return {received:received ?? op,validValues:[]}
  let validValues = values(schema), choiceDetails
  const field = parts[0]
  const kind = definition.refs?.[field]
  if (kind) {
    const layer = definition.lookLayer
    const owners=definition.ref ? directorCommands.selected(context).filter(item=>item.name===definition.name && item.ref).map(item=>item.ref) : null
    const rows=context.catalogue.candidates[kind].filter(row => (!layer || row.asset.layer === layer) && (!owners || owners.some(ref=>same(row.ref,ref))))
    validValues = rows.map(row => row.ref)
    choiceDetails=rows.map(row=>({value:row.ref,label:row.asset.name}))
  }
  let sourceFeedback={}
  if (definition.command?.admission?.source === 'phone.message' || definition.effect === 'source.mark') {
    const unit=context.phone.units[at - 1], rows=context.phone.characters.map(row=>({...row,actorKey:row.alias}))
    const speaker=unit?.kind==='line' ? resolution.resolveFigureName(rows,unit) : null
    const sender=unit?.alias==='$player' || speaker?.actorKey && speaker.actorKey===context.phone.playerId ? '$player' : speaker?.actorKey
    const label=sender==='$player' ? '$player' : speaker?.row?.name || unit?.name || unit?.alias || 'unresolved'
    sourceFeedback.message=`Source at=${at}: kind=${unit?.kind || 'missing'}, speaker=${unit?.kind==='line' ? label : 'none'}. ${error.message}`
    if (field === 'to') {
      validValues=['$player',...context.phone.aliases.filter(id=>id!==context.phone.playerId && id!=='$player')].filter(id=>id!==sender)
      choiceDetails=validValues.map(value=>({value,label:value==='$player'?'Player':context.phone.characters.find(row=>row.alias===value)?.name || value}))
      sourceFeedback.next_action='Keep this source; choose a different listed recipient, or omit this mark. Accepted ops stay.'
    }
    if (field === 'thread') {
      const threads=state?.modState?.[definition.command?.modId]?.threads || {}
      validValues=Object.keys(threads).filter(id=>threads[id].participants.some(person=>person===sender || sender==='$player' && person===context.phone.playerId))
      choiceDetails=validValues.map(value=>({value,label:threads[value].name}))
      sourceFeedback.next_action='Choose a group containing this speaker, use to=<recipient> for a direct message, or omit this mark. Accepted ops stay.'
    }
    if (definition.effect === 'source.mark' && field === 'contact') {
      validValues=context.phone.aliases.filter(actor=>speaker?.status!=='resolved' || (op.side==='in' ? actor===speaker.actorKey : actor!==speaker.actorKey))
      sourceFeedback.next_action='Use this speaker for side=in, or a different contact for side=out; otherwise omit this mark. Accepted ops stay.'
    }
    if (field === 'form') sourceFeedback.next_action='Use form=text|voice, or omit this mark; keep the source and destination. Accepted ops stay.'
    if (field === 'source') sourceFeedback.next_action='Omit this duplicate mark; the accepted mark stays.'
    if (unit?.kind!=='line' || !sender) sourceFeedback.next_action='Omit this mark; this paragraph has no listed message speaker. Accepted ops stay.'
  }
  if (field === 'outfit') {
    const rows=context.outfits[op.actor] || []
    validValues=rows.map(row=>row.key)
    choiceDetails=rows.map(row=>({value:row.key,label:row.label || row.key}))
  }
  if (field === 'level' && definition.refs.ref) {
    const row = context.catalogue.candidates[definition.refs.ref].find(row => same(row.ref, op.ref))
    validValues = row?.[op.op === 'skin.set' ? 'skinLevels' : 'performanceLevels'] || []
  }
  const performance = definition.command?.admission?.performance
  if (performance && field === 'ref') {
    validValues = performance.choices.map(row=>row.ref)
    choiceDetails=validValues.map(value=>({value,label:context.catalogue.candidates.performances.find(row=>same(row.ref,value))?.asset.name || value.assetId}))
  }
  if (performance && field === 'level') validValues = performance.choices.find(row=>same(row.ref,op.ref))?.levels || []
  if (op.op === 'actor.gaze.set' && field === 'target') {
    const actors = Object.keys(context.actors).filter(actor => actor !== op.actor)
    validValues = parts.length > 1 ? actors : ['viewer','away',...actors.map(actor => ({actor}))]
  }
  if (field === 'after' || field === 'actor' && error.code === 'PRECONDITION') validValues = op.op === 'cast.add' && field === 'actor'
    ? Object.keys(context.actors).filter(actor => !(state?.cast || []).includes(actor)) : state?.cast || []
  if (op.op === 'cg.focus.set' && field === 'focus') {
    const asset=context.catalogue.candidates.cg.find(row=>state?.cg && same(row.ref,state.cg.ref))?.asset
    const rows=asset?(assetContent(asset,state.cg.variant ?? undefined).focusHints || []):[]
    validValues=rows.map(row=>row.key)
    choiceDetails=rows.map(row=>({value:row.key,label:row.label || row.key}))
  }
  if (field === 'variant' && (op.op?.startsWith('cg.') || op.op?.startsWith('scene.'))) {
    const kind=op.op.startsWith('cg.')?'cg':'backgrounds'
    const ref = op.op === 'cg.set' ? op.cg : op.op === 'scene.set' ? op.background : kind==='cg'?state?.cg?.ref:state?.scene?.background
    const rows=context.catalogue.candidates[kind].find(row => ref && same(row.ref, ref))?.asset.variants?.entries || []
    validValues=rows.map(row=>row.id)
    choiceDetails=rows.map(row=>({value:row.id,label:row.name || row.id}))
  }
  if (['actor','actors','after','contact','target'].includes(field) && validValues) choiceDetails=validValues.map(value=>{
    const id=value?.actor || value
    return {value,label:context.actors[id]?.name || context.phone?.characters.find(row=>row.alias===id)?.name || String(id)}
  })
  if (choiceDetails) choiceDetails=choiceDetails.filter(row=>validValues.some(value=>same(value,row.value)))
  return {received:received ?? null, ...(schema ? {expected:assetPackFieldConstraint(schema, defs)} : {}), ...(validValues ? {validValues} : {}),...(choiceDetails?.length ? {choiceDetails} : {}),...sourceFeedback}
}
export function assetPackDrop(error, context, slot = {}, state) {
  const command = typeof slot.op?.op === 'string' ? slot.op.op : null
  const actor = context.actors?.[slot.op?.actor]
  const field = error.path?.split('.').at(-1)
  if (actor && ['emotion','difference'].includes(field) && !actor.emotions?.some(row=>row.label !== undefined)) {
    error = Object.assign(new Error(actor.name + ' has no variants; omit ' + field + '.'), {code:'UNKNOWN_FIELD',path:error.path})
  }
  const path = command?.startsWith('lighting.') && error.path === '$.light.ref' ? '$.ref' : error.path
  if (path !== error.path) error = Object.assign(new Error(error.message),{code:error.code,path})
  // Name-only matches classify repairability; execution still requires the exact full ref.
  const definition = command ? directorCommands.resolve(slot.op,context) || directorCommands.selected(context).find(item => item.name === command) : null
  // Handle decoding can fail before availability checks; unavailable commands cannot be repaired.
  if (error.handleChoices && definition?.configured?.(context)===false) error=Object.assign(new Error('Command disabled or no recalled candidates'),{code:'DISABLED',path:'$.op'})
  const code = error.code === 'INVALID_ASSET_PACK' || error.code === 'INVALID_JSON'
    ? /pacing|paragraphs|music.*change|mood.*turn/i.test(error.message) ? 'PACING'
      : /\b(?:caps?|budget)\b/i.test(error.message) ? 'CAP_EXCEEDED' : 'ARG_INVALID'
    : error.code || 'INTERNAL'
  const usage = definition && directorCommands.describe(context, command, slot.op.ref)[0]
  // Level 2 repair (stage-effects.md): a resendable op for a near name; it is also the example.
  const near = definition?.mod ? undefined : directorCommands.didYouMean(slot.op, error, Boolean(definition))
  const didYouMean = near && directorCommands.resolve(near, context)?.enabled(context) ? near : undefined
  let example=didYouMean || (usage?.enabled ? usage.examples[0] || null : null)
  // An empty candidate enum can produce an undefined sample slot; diagnostics must remain JSON.
  try { assertJson(example) } catch { example=null }
  const feedback = slotFeedback(error,definition,context,slot.op,state,slot.at)
  // The choices travel once, in `choices`; the message names the problem only.
  const message = feedback.validValues?.length && error.message.startsWith('Choose one of: ') ? 'Choose a listed value.' : error.message
  const suffix = (error.path || '$').startsWith('$.pacing') ? '' : (error.path || '$').slice(1)
  const retryable = error.itemError ? error.itemError.retryable : (Boolean(definition) || Boolean(command) || code === 'ARG_INVALID' && Object.hasOwn(slot, 'op')) && !['PACING','CAP_EXCEEDED','DISABLED','ACCEPTED_CONFLICT'].includes(code)
  return { code, path: slot.path ? slot.path + suffix : error.path || '$', command,
    capability: definition?.toggle || 'unknown', at: slot.at || null, retryable,
    hint: message, message, example,
    ...feedback,
    ...(didYouMean ? {didYouMean, next_action:'Resend didYouMean at the same anchor if it says what you meant, or omit this operation; keep sequence/through/done. Accepted ops stay.'} : {}),
    ...(error.next_action ? {next_action:error.next_action} : {}),
    ...(command==='actor.outfit.set' && field==='outfit' ? {next_action:'Pick one that fits the described clothing, or omit the outfit change if none fits; keep sequence/through/done. Accepted ops stay.'} : {}),
    ...(error.handleChoices ? {validValues:error.handleChoices} : {}),
    ...(error.choiceDetails ? {choiceDetails:error.choiceDetails} : {}),
    ...(error.itemError?.candidates ? {validValues:error.itemError.candidates} : {}),
    ...(error.modError?.candidates ? {validValues:error.modError.candidates} : {}),
    ...(error.musicAt ? {validValues:[{force:true,reason:'Another scene/mood turn'},{omit:true}],next_action:`本轮第${error.musicAt}段已换曲；给此处加 force:true 和非空 reason，否则删除此处 music 操作。`} : {}) }
}

// Untrusted echoes are diagnostics, not schemas: omit reserved keys and render pointers as inert text.
// Canonical operations and saved diagnostics remain unchanged.
export function assetPackToolFeedback(value) {
  if (typeof value === 'string') return value.replaceAll('#/$defs/', '[schema-definition]/')
    .replaceAll('$ref', '[schema-reference]').replaceAll('$defs', '[schema-definitions]')
  if (Array.isArray(value)) return value.map(assetPackToolFeedback)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['$ref','$defs'].includes(key))
    .map(([key, item]) => [assetPackToolFeedback(key), assetPackToolFeedback(item)]))
}

// CLI error classes are wire-only; stored diagnostics keep their domain codes.
export function assetPackToolResult(drops, accepted) {
  const errors = drops.map(drop => {
    const code = ({ARG_INVALID:'INVALID_ARGUMENT', REF_UNAVAILABLE:'NOT_FOUND', DISABLED:'UNAVAILABLE',
      PRECONDITION:'CONFLICT', PACING:'CONFLICT', MUSIC_FREQUENCY:'CONFLICT', CAP_EXCEEDED:'CONFLICT', ACCEPTED_CONFLICT:'CONFLICT',
      REVISION_CONFLICT:'CONFLICT', TASK_ENDED:'CONFLICT'})[drop.code] || drop.code
    const next_action = drop.next_action || (['REVISION_CONFLICT','CANCELLED','INTERNAL'].includes(drop.code)
      ? 'Stop this task; inspect the current source before starting a new task.'
      : drop.code === 'TASK_ENDED' ? 'Stop submitting; this task has ended.'
      : drop.code === 'UNKNOWN_FIELD' ? `Remove the unknown field at ${drop.path}; resubmit this slot at the same anchor; keep sequence/through/done.`
      : drop.code === 'ACCEPTED_CONFLICT' ? 'Do not change an accepted sequence or operation. Inspect progress; continue only the pending repair window.'
      : drop.retryable ? 'Pick a listed choice or correct this slot using its schema, or omit this operation if none fits; resubmit at the same anchor with sequence/through/done unchanged. Accepted ops stay.'
      : `Omit this ${drop.entry ? 'beat' : 'operation'}; keep accepted ops.`)
    return {path:drop.path, code, message:drop.message, received:drop.received ?? null,
      ...(drop.at ? {at:drop.at} : {}),
      ...(drop.command ? {command:drop.command} : {}),
      ...(drop.retryable && drop.didYouMean ? {didYouMean:drop.didYouMean} : drop.retryable && drop.example ? {example:drop.example} : {}),
      // Level 2 (stage-effects.md §4.1): a sure suggestion for a known command's value travels alone; an unknown command
      // keeps its choices beside the suggestion.
      ...(drop.retryable && drop.didYouMean && drop.capability !== 'unknown' ? {} : drop.validValues?.length ? {choices:drop.validValues,...(drop.choiceDetails?.length ? {choice_details:drop.choiceDetails.filter(row=>drop.validValues.some(value=>same(value,row.value)))} : {})} : drop.expected ? {schema:drop.expected} : {}),
      next_action, retryable:drop.retryable}
  })
  return assetPackToolFeedback({schema_version:1, ok:errors.length === 0, outcome:errors.length ? accepted ? 'partial' : 'not_applied' : 'applied', accepted, errors})
}

export function foldAssetPackWindow(prepared, base, slots, validateModCommand) {
  const { context, binding } = prepared
  let state = clone(base.state), entries = clone(base.entries), counts = {...base.counts}, totalOps = base.totalOps
  const diagnostics = [], usage = [], result = clone(slots), offset = prepared.baseline.pacing?.paragraph || 0
  for (let index = 0; index < result.length;) {
    const first = result[index], group = []
    while (index < result.length && result[index].beat === first.beat) group.push(result[index++])
    const before = clone(state), ops = [], at = offset + first.at - 1
    let sceneSet = false, cut = false, timeTransitionMs = 0
    if (state.cameraUntil !== undefined && at >= state.cameraUntil) { state.camera = {mode:'reset',actor:null}; delete state.cameraUntil }
    for (const slot of group) {
      if (slot.error && !slot.accepted) continue
      let op = clone(slot.op)
      const nextCounts = {...counts}
      try {
        // Level 1 repair: the same name written differently is accepted as its canonical id.
        const repaired = directorCommands.normalize(op)
        if (repaired && !slot.corrections) {
          op = repaired.op
          slot.normalized = repaired.normalized.map(row => ({code:'NORMALIZED',path:slot.path + row.path.slice(1),at:slot.at,received:row.received,used:row.used}))
        }
        const definition = assetPackCommandDefinition(op,context)
        check(definition, '$.op', 'Choose a registered command', 'ARG_INVALID')
        // A model's string rationale is inert metadata, not part of AssetRef identity.
        // Only this observed annotation is stripped; all other extra fields still fail.
        const annotations = []
        for (const field of Object.keys(definition.refs || {})) if (typeof op[field]?.reason === 'string') {
          delete op[field].reason
          annotations.push({code:'REF_ANNOTATION_IGNORED',path:slot.path+'.'+field+'.reason',at:slot.at})
        }
        validateAssetPackToolValue(op, definition.schema(context), '$', {$defs:directorCommands.defs(context)})
        if (definition.mod && validateModCommand) {
          const flat=definition.command.paramsStyle==='flat',params=flat?Object.fromEntries(Object.entries(op).filter(([key])=>key!=='op')):op.params
          try {validateModCommand(definition.mod.id,definition.mod.commandId,params)}
          catch(error) {
            if (error.code==='MOD_API_UNSUPPORTED' || error.code==='ARG_INVALID') {
              throw Object.assign(new Error(error.message),{code:'ARG_INVALID',path:flat?(error.path || '$.params').replace(/^\$\.params(?=\.|\[|$)/,'$'):error.path || '$.params'})
            }
            throw error
          }
        }
        if (op.op === 'cast.set') {
          const cast = state.cg?.resumeCast || state.cast
          op.actors = cast.filter(id => op.actors.includes(id)).concat(op.actors.filter(id => !cast.includes(id)))
        }
        const key = definition.capKey && (definition.perActor ? definition.capKey + ':' + op.actor : definition.capKey)
        const safety = op.op === 'screen.play' && op.effect !== 'blackout' || op.op === 'actor.act.play' && ['shake','tremble'].includes(op.motion)
        if (safety && key && context.actionCaps[definition.capKey] !== undefined) {
          nextCounts[key] = (nextCounts[key] || 0) + 1
          check(nextCounts[key] <= context.actionCaps[definition.capKey], '$.budget', `${definition.capKey} safety limit ${context.actionCaps[definition.capKey]} per turn reached; omit this effect`, 'CAP_EXCEEDED')
        }
        // A screen look follows story moments, not lines: at most 4 changes a turn (stage-effects.md).
        if (definition.capKey === 'screen') {
          nextCounts.screen = (nextCounts.screen || 0) + 1
          check(nextCounts.screen <= 4, '$.budget', 'screen look limit 4 per turn reached; omit this change', 'CAP_EXCEEDED')
        }
        if(definition.mod) {
          const {group,perTurn}=definition.command.caps
          const key=group?'mod-group:'+definition.command.modId+':'+group:'mod:'+definition.name
          const limit=group?Math.min(perTurn,...(context.modCommands || []).filter(row=>row.modId===definition.command.modId && row.caps.group===group).map(row=>row.caps.perTurn)):perTurn
          nextCounts[key]=(nextCounts[key] || 0)+1
          check(nextCounts[key]<=limit,'$.budget',`${definition.name}: limit ${limit} per turn reached; omit further calls this turn`,'CAP_EXCEEDED')
        }
        if (op.op === 'item.play') {
          nextCounts.items = (nextCounts.items || 0) + 1
          nextCounts.itemBytes = (nextCounts.itemBytes || 0) + Buffer.byteLength(JSON.stringify(op))
          check(nextCounts.items <= 8 && nextCounts.itemBytes <= 4096,'$.budget','Item performance budget exceeded','CAP_EXCEEDED')
        }
        if (definition.effect === 'source.mark') {
          const key = 'source-at:' + slot.at
          check(!nextCounts[key], '$.source', 'One source marker per paragraph'); nextCounts[key] = 1
        }
        const reduced = reduceAssetPackOperation(state, op, context, {sceneSet, sourceKey:binding.target.sourceKey, generation:binding.generation, at:slot.at, turn:binding.target.turn,
          page:prepared.pageIndex?.firstPageByPara[slot.at], entryOrdinal:entries.length, opOrdinal:ops.length})
        if (op.op === 'cg.set') op.variant = reduced.state.cg.variant
        const performance = definition.toggle === 'performance'
        if (performance && op.op === 'performance.set') op.level = reduced.state.performance.level
        const changed = performance ? !same(state.performance || null, reduced.state.performance || null)
          : definition.persistence !== 'state' || state.performance && op.op.startsWith('music.') || !same(state, reduced.state)
        // Turn-local counts survive repair/checkpoint windows, never carry into the next turn.
        if (op.op.startsWith('music.') && !same(state.music, reduced.state.music)) {
          // Resuming the track just cleared is continuity, not another track selection.
          const restoring = !state.music && counts.stoppedMusic && same(counts.stoppedMusic, reduced.state.music)
          if (!restoring && counts.musicAt && !(op.force === true && typeof op.reason === 'string' && op.reason.trim())) {
            throw Object.assign(new Error('本轮已换曲一次；如确有第二个场景/气氛转折，加 force:true 和 reason，否则删除这一处'), {code:'MUSIC_FREQUENCY',path:'$',musicAt:counts.musicAt})
          }
          if (!restoring) nextCounts.musicAt = slot.at
          if (!reduced.state.music) nextCounts.stoppedMusic = state.music
          else delete nextCounts.stoppedMusic
        }
        paceAssetPackOperation(state, reduced.state, context, at, reduced.locationChanged)
        // The reducer validates state; admit the persisted command here too.
        recordedAssetPackOperation(definition.mod ? reduced.operation : op, binding, slot.path)
        if (changed || definition.mod && !performance) ops.push(definition.mod ? reduced.operation : op)
        cut ||= reduced.locationChanged || op.op === 'scene.clear' || op.op === 'transition.play'
        state = reduced.state; counts = nextCounts; totalOps++
        if (op.op === 'scene.set' || op.op === 'scene.clear') sceneSet = true
        timeTransitionMs = Math.max(timeTransitionMs, reduced.transitionMs || 0)
        if (op.op === 'closeup.play') state.cameraUntil = at + 4
        else if (state.camera.mode !== 'close') delete state.cameraUntil
        slot.corrections ||= [...annotations, ...(slot.normalized || [])]
        delete slot.normalized
        diagnostics.push(...slot.corrections, ...reduced.diagnostics.map(item => ({...item,at:slot.at})))
        slot.op = op; slot.accepted = true; delete slot.error
      } catch (error) {
        delete slot.normalized
        if (!error.code || error.code === 'REVISION_CONFLICT') throw error
        // A repair may not revoke a command that an earlier attempt already accepted.
        if (slot.accepted) throw Object.assign(new Error('Repair would invalidate an accepted operation: ' + error.message), {code:'ACCEPTED_CONFLICT',path:'$'})
        // A rejected scene cannot satisfy a same-beat transition dependency.
        if (op?.op === 'transition.play' && !sceneSet) {
          const prerequisite = group.slice(0, group.indexOf(slot)).find(item => ['scene.set','scene.clear'].includes(item.op?.op) && item.error)
          if (prerequisite) error.next_action = `Repair ${prerequisite.path} first (${prerequisite.error.message}); resubmit it and this transition at the same anchor, or omit this transition; keep sequence/through/done. Accepted ops stay.`
        }
        slot.error = assetPackDrop(error, context, slot, state)
      }
    }
    state.figureScale = deriveAssetPackFigureScale(before, state, first.at, cut)
    if (ops.length) entries.push({at:first.at,ops,state:clone(state),timeTransitionMs})
    // streaming windows carry accepted caps, including normalized no-ops.
    usage.push({at:first.at,counts:{...counts},totalOps})
  }
  return {state,entries,counts,totalOps,slots:result,diagnostics,usage}
}
