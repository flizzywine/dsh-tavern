import { createStatusPartIndex } from './status-part-index.js'
import { createStatusSourceIndex } from './status-source-index.js'
import { statusViewDeclaration } from './status-view-declaration.js'
import { createIndexedArrayApi } from './indexed-array.js'
import { createImmutableJsonIndex, immutableArrayChanges } from './freeze-json.js'
import { createHash } from 'node:crypto'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { projectDisplayParts, resolveDisplayIdentityMacros } from './reply-presentation.js'

const partIndex = createStatusPartIndex()
const sourceIndex = createStatusSourceIndex()
const dependencyIndex = createStatusSourceIndex({readRow:(projection,id)=>
  typeof projection.turn==='number' && !Number.isNaN(projection.turn) && (projection.parts || []).some(part=>!part.statusKey && Number.isInteger(part.statusRule))
    ? {turn:projection.turn,source:id} : undefined})
const matchIndex = createIndexedArrayApi({eligible:row=>Boolean(row?.origin),maximum:row=>row?.legacy?1:0,measure:row=>JSON.stringify([row.origin,row.content,[...row.removed]]).length*2})
const fallbackIndex = createIndexedArrayApi({eligible:row=>Boolean(row),measure:row=>JSON.stringify(row).length*2})
const filteredIndex = createImmutableJsonIndex({measure:row=>JSON.stringify(row).length*2})

function contentOf(part) {
  return String(part && (part.content ?? part.html) || '')
}

/** Only an explicit display declaration creates a persistent panel. MVU reads
 * are diagnostic evidence, never authority to move an interactive document. */
function projectStatusView(messages, projections, options, compile, summary) {
  const sourceMessages = Array.isArray(messages) ? messages : []
  const sourceProjections = Array.isArray(projections) ? projections : []
  let inferredTurn = 1
  let latestTurn = summary?.latestTurn ?? 1
  if (!summary) for (const message of sourceMessages) {
    if (message?.role === 'user') inferredTurn++
    if (message?.role === 'assistant') latestTurn = Math.max(latestTurn, Number(message.turn) || inferredTurn)
  }
  const templates = new Map()
  const prior = summary?.previous
  let legacySources = prior?.legacySources ? sourceIndex.update(prior.legacySources,sourceMessages,summary.messageIndices) : null
  const changes = prior ? immutableArrayChanges(prior.source,sourceProjections) : null
  let legacyDependencies = prior?.legacyDependencies ? dependencyIndex.update(prior.legacyDependencies,sourceProjections,changes) : null
  const legacyDirty = changes && prior?.legacySources && legacySources && legacyDependencies ? new Set(changes) : null
  if(legacyDirty)for(const turn of sourceIndex.changed(prior.legacySources,legacySources))for(const id of dependencyIndex.values(legacyDependencies,turn))legacyDirty.add(id)
  const matchStates = new Map(), fallbackStates = new Map()
  let legacy = false
  const rules = Array.isArray(options.regexScripts) ? options.regexScripts : []
  const enabled = rules.filter(rule => rule && rule.disabled !== true && rule.enabled !== false)
  function legacyMatches(part, projection, rule) {
    if (!Number.isInteger(part.statusRule)) return false
    legacySources ||= sourceIndex.update(null,sourceMessages)
    const source = sourceIndex.get(legacySources,projection.turn)
    // Old captures have only an array index. Recover solely when the original
    // source names exactly one status declaration; never guess from MVU reads.
    const candidates = enabled.filter(candidate => statusViewDeclaration(candidate) && applyTavernRegexText(source, [candidate], { placement: 2, isMarkdown: true, depth: 0 }).changed)
    return candidates.length === 1 && candidates[0] === rule
  }
  for (const rule of rules) {
    if (!rule || rule.disabled === true || rule.enabled === false) continue
    const declaration = statusViewDeclaration(rule)
    if (!declaration) continue
    for (const [templateIndex, { content, revision }] of compile(declaration.marker, rule, options).entries()) {
      if (templates.has(revision)) continue
      let origin = null
      let templateContent = content
      const viewId = 'status-' + createHash('sha256').update(declaration.key + ':' + templateIndex).digest('hex').slice(0, 16)
      const matchKey = declaration.key + ':' + templateIndex + ':' + revision
      const oldMatches = prior?.matches.get(matchKey)
      function match(projection) {
        summary?.onMatch?.()
        const parts = (projection.parts || []).filter(part => String(part.kind === 'html' ? contentOf(part) : part.text || '').trim())
        const matches = part => part.kind === 'html' && (part.statusKey ? part.statusKey === declaration.key : contentOf(part) === content || legacyMatches(part, projection, rule))
        const index = parts.findIndex(matches)
        return {
          origin:index < 0 ? null : {sourceTurn:projection.turn,sourcePartIndex:index},
          content:index < 0 ? content : resolveDisplayIdentityMacros(contentOf(parts[index]),options),
          removed:new Set(index < 0 ? [] : parts.filter(matches)),
          legacy:parts.some(part=>!part.statusKey && Number.isInteger(part.statusRule))
        }
      }
      let candidates
      if (oldMatches && changes && (matchIndex.maximum(oldMatches)===0 || legacyDirty)) {
        const dirty=matchIndex.maximum(oldMatches)===0 ? changes : [...legacyDirty]
        candidates=matchIndex.update(oldMatches,dirty.map(id=>[id,match(sourceProjections[id])]),sourceProjections.length)
      } else candidates=matchIndex.from(sourceProjections.map(match))
      matchStates.set(matchKey,candidates)
      legacy ||= matchIndex.maximum(candidates)>0
      const last=matchIndex.previous(candidates,candidates.length)
      if(last>=0){
        origin=candidates[last].origin
        // Captured dynamic templates retain the latest matching source output.
        if (/<%|&lt;%/.test(String(rule.replaceString)) || /\$\d+|\$<[^>]+>|\{\{match\}\}/i.test(String(rule.replaceString))) templateContent=candidates[last].content
      }
      const staticTemplate = !/<%|&lt;%|\$\d+|\$<[^>]+>|\{\{match\}\}/i.test(String(rule.replaceString))
      function opening(message) {
        if (!staticTemplate || message?.role !== 'assistant' || message.greeting !== true) return null
        const source=String(message.sourceText ?? message.text ?? '')
        return applyTavernRegexText(source,[rule],{placement:2,isMarkdown:true,isEdit:false,depth:0}).changed
          ? {sourceTurn:Number(message.turn)||1,sourcePartIndex:0} : null
      }
      function receipt(message) {
        const frame=message?.displayRuntime?.frames?.find(frame=>frame.placement==='sidebar' && (frame.panelId===viewId || frame.panelId==='status-'+revision))
        return frame ? {sourceTurn:Number(message.turn)||1,sourcePartIndex:Number(frame.partIndex)||0} : null
      }
      if(summary){
        const old=prior?.fallbacks?.get(matchKey)
        const incremental=old && Array.isArray(summary.messageIndices)
        const ids=incremental ? summary.messageIndices : Array.from({length:sourceMessages.length},(_,id)=>id)
        const openings=[],receipts=[]
        for(const id of ids){
          summary.onFallback?.()
          const message=sourceMessages[id]
          openings.push([id,opening(message)]);receipts.push([id,receipt(message)])
        }
        const state={
          openings:fallbackIndex.update(incremental?old.openings:[],openings,sourceMessages.length),
          receipts:fallbackIndex.update(incremental?old.receipts:[],receipts,sourceMessages.length)
        }
        fallbackStates.set(matchKey,state)
        // Authored opening declarations outrank retained sidebar receipts.
        if(!origin)origin=state.openings[fallbackIndex.previous(state.openings,state.openings.length)] || state.receipts[fallbackIndex.previous(state.receipts,state.receipts.length)] || null
      }else{
        if(!origin)for(const message of sourceMessages)origin=opening(message)||origin
        if(!origin)for(const message of sourceMessages)origin=receipt(message)||origin
      }
      if (latestTurn <= 1 && !origin) continue
      templates.set(revision, {
        version: 1, viewId,
        title: String(rule.name || rule.scriptName || '角色状态').slice(0, 80),
        sourceTurn: origin?.sourceTurn || latestTurn, sourcePartIndex: origin?.sourcePartIndex || 0,
        targetTurn: latestTurn, templateRevision: revision, content: templateContent
      })
    }
  }
  const statusViews = [...templates.values()]
  const contents = new Set(statusViews.map(view => view.content))

  if(summary && legacy){
    legacySources ||= sourceIndex.update(null,sourceMessages)
    legacyDependencies ||= dependencyIndex.update(null,sourceProjections)
  }
  let partState=null,partBytes=0
  const filterDirty=new Set(changes || [])
  if(summary && (legacy || prior?.partState)){
    const reuse=prior?.partState && changes
    const positions=reuse ? [...changes] : Array.from({length:sourceProjections.length},(_,i)=>i)
    if(reuse)for(let i=sourceProjections.length;i<prior.source.length;i++)positions.push(i)
    const projectionEdits=positions.map(i=>[i,reuse?prior.source[i]?.parts:undefined,sourceProjections[i]?.parts])
    const removalEdits=[]
    for(const key of new Set([...matchStates.keys(),...reuse?prior.matches.keys():[]])){
      const before=reuse?prior.matches.get(key):undefined,after=matchStates.get(key)
      const indices=before && after ? matchIndex.changed(before,after) : Array.from({length:after?.length || 0},(_,i)=>i)
      if(before)for(let i=after?.length || 0;i<before.length;i++)indices.push(i)
      for(const i of indices)removalEdits.push([before?.[i]?.removed,after?.[i]?.removed])
    }
    const updated=partIndex.update(reuse?prior.partState:null,projectionEdits,removalEdits)
    partState=updated.state;partBytes=updated.bytes
    for(const id of updated.affected)filterDirty.add(id)
  }
  const legacyRemoved = new Set()
  if(legacy && !summary) for(const rows of matchStates.values()) for(const row of rows) for(const part of row.removed) legacyRemoved.add(part)
  const matchedRows=[...matchStates.values()]
  function filter(projection,id) {
    summary?.onFilter?.()
    const parts=(projection.parts || []).filter(part=>!(part.kind==='html' && (contents.has(contentOf(part)) || (partState && partIndex.has(partState,part)) || legacyRemoved.has(part) || matchedRows.some(rows=>rows[id]?.removed.has(part)))))
    return parts.length===(projection.parts || []).length ? projection : {...projection,parts,text:parts.map(part=>part.kind==='html'?contentOf(part):part.text || '').join('')}
  }
  const contentSignature=JSON.stringify([...contents])
  const incremental=summary && prior && changes && (!(legacy || prior.legacy) || prior.partState) && prior.contentSignature===contentSignature
  const filtered=incremental ? filteredIndex.update(prior.filtered,[...filterDirty].filter(id=>id<sourceProjections.length).map(id=>[id,filter(sourceProjections[id],id)]),sourceProjections.length)
    : summary ? filteredIndex.from(sourceProjections.map(filter)) : sourceProjections.map(filter)
  if(summary){
    summary.next={source:sourceProjections,matches:matchStates,filtered,contentSignature,legacy,fallbacks:fallbackStates,legacySources,legacyDependencies,partState}
    summary.filteredBytes=partBytes + (legacyDependencies?dependencyIndex.bytes(legacyDependencies):0) + (legacySources?sourceIndex.bytes(legacySources):0) + [...fallbackStates.values()].reduce((size,state)=>size+fallbackIndex.info(state.openings).bytes+fallbackIndex.info(state.receipts).bytes,0) + filteredIndex.info(filtered).bytes + matchedRows.reduce((size,rows)=>size+matchIndex.info(rows).bytes,0)
  }
  return {
    projections: filtered,
    statusView: statusViews[0] || null,
    statusViews
  }
}


/** Rule compilation is shared. Incremental match state belongs to the caller
 * that supplies a versioned immutable projection and retains its summary. */
export function createPersistentStatusProjector({ maxCacheBytes = 4 * 1024 * 1024, maxCacheEntries = 128 } = {}) {
  const cache = new Map()
  let bytes = 0, hits = 0, misses = 0
  function compile(marker, rule, options) {
    const key = createHash('sha256').update(JSON.stringify([marker, rule, options.charName, options.macroState?.userName, options.allowStaticStatus])).digest('hex')
    const previous = cache.get(key)
    if (previous) {
      hits++; cache.delete(key); cache.set(key, previous)
      return previous.value
    }
    misses++
    const rendered = applyTavernRegexText(marker, [rule], { placement: 2, isMarkdown: true, isEdit: false, depth: 0 })
    const value = []
    if (rendered.changed) for (const part of projectDisplayParts(rendered.text).parts) {
      const content = resolveDisplayIdentityMacros(contentOf(part), options)
      if (part.kind !== 'html' || (!options.allowStaticStatus && !/<(?:script|iframe|object|embed)\b/i.test(content))) continue
      value.push({ content, revision: createHash('sha256').update(content).digest('hex').slice(0, 16) })
    }
    const size = JSON.stringify(value).length * 2 + 256
    if (size <= maxCacheBytes && maxCacheEntries > 0) {
      while (cache.size && (bytes + size > maxCacheBytes || cache.size >= maxCacheEntries)) {
        const oldest = cache.keys().next().value
        bytes -= cache.get(oldest).size; cache.delete(oldest)
      }
      cache.set(key, { value, size }); bytes += size
    }
    return value
  }
  const project = (messages, projections, options = {}, summary) => projectStatusView(messages, projections, options, compile, summary)
  project.cacheStats = () => ({ entries: cache.size, estimatedBytes: bytes, hits, misses })
  return project
}

export const projectPersistentStatusView = createPersistentStatusProjector()
