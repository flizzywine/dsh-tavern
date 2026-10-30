import {isDeepStrictEqual as equal} from 'node:util'
import {sourceKey,anchorKey} from './contract.js'
import {restoreMetrics} from './metrics.js'

const fail=(message,code='MOD_SOURCE_STALE')=>{throw Object.assign(new Error(message),{code})}
export const emptyPresentation=()=>({revision:'0',rows:[],operations:[]})

// Pure transaction helper. The host supplies its existing persistence CAS and current source lease.
// No filesystem/Chat/MVU write or independently maintained story/branch index lives here.
export function appendPresentation(state,args,{source,turn,active,mode,anchorAllowed}) {
  if(!active || !['live','history'].includes(mode))fail('Presentation writes need an active stage')
  if(typeof args.operationId!=='string' || !args.operationId || !Number.isSafeInteger(args.offsetMs) || args.offsetMs<0 ||
      !Array.isArray(args.records) || args.records.length<1 || args.records.length>8)fail('Invalid presentation append','MOD_RESOURCE_UNAVAILABLE')
  if(args.anchor.sourceKey!==source.sourceKey || !anchorAllowed(args.anchor))fail('Presentation anchor is not available')
  const intent={anchor:args.anchor,offsetMs:args.offsetMs,records:args.records}
  const prior=state.operations.find(row=>row.operationId===args.operationId)
  if(prior) {
    if(!equal(prior.intent,intent))fail('Operation identity already has another intent','MOD_REVISION_CONFLICT')
    return {state,receipt:structuredClone(prior.receipt),changed:false}
  }
  // A history page is written once, by its corpus backfill (controller.js backfill): real comments, never a page that
  // already has a record.
  if(mode==='history' && (args.records.some(record=>record.type!=='batch' || record.batch?.comments?.some(row=>row.source!=='real')) ||
      // Records of an earlier direction generation of the same text are not this source's: they never block its backfill.
      state.rows.some(row=>row.record.type==='batch' && anchorKey(row.anchor)===anchorKey(args.anchor) && sourceKey(row.record.batch.source)===sourceKey(source))))fail('History pages keep their recorded comments','MOD_REVISION_CONFLICT')
  if(args.expectedRevision!==state.revision)fail('Presentation changed; refresh before a new operation','MOD_REVISION_CONFLICT')
  for(const record of args.records) {
    const bound=record.type==='batch'?record.batch?.source:record.type==='memory'?record.source:null
    if(!bound || sourceKey(bound)!==sourceKey(source))fail('Record source is not current')
    if(record.type==='memory' && (record.turn!==turn || typeof record.memory!=='string' || [...record.memory].length>300))fail('Invalid audience memory','MOD_RESOURCE_UNAVAILABLE')
    if(record.type==='batch' && (anchorKey(record.batch.anchor)!==anchorKey(args.anchor) || record.batch.offsetMs!==args.offsetMs ||
        !Array.isArray(record.batch.comments) || record.batch.comments.length>12))fail('Invalid presentation batch','MOD_RESOURCE_UNAVAILABLE')
  }
  const revision=String(Number(state.revision)+1)
  const rows=args.records.map((record,index)=>({id:args.operationId+':'+index,operationId:args.operationId,
    anchor:structuredClone(args.anchor),offsetMs:args.offsetMs,record:structuredClone(record)}))
  const receipt={revision,recordIds:rows.map(row=>row.id)}
  return {state:{revision,rows:[...state.rows,...rows],operations:[...state.operations,{operationId:args.operationId,intent:structuredClone(intent),receipt}]},receipt,changed:true}
}

// The original Timeline owner supplies the selected source lineage; no name/branch guessing.
export function readPresentation(state,{anchor,sources}) {
  const allowed=new Set(sources.map(sourceKey))
  const lineage=state.rows.filter(row=> {
    const record=row.record,source=record.type==='batch'?record.batch.source:record.source
    return allowed.has(sourceKey(source))
  })
  const records=lineage.filter(row=>row.record.type==='memory' || anchorKey(row.anchor)===anchorKey(anchor))
  const memories=records.filter(row=>row.record.type==='memory')
  return {revision:state.revision,records:structuredClone([...memories.slice(-1),...records.filter(row=>row.record.type==='batch')]),
    metricsState:restoreMetrics(lineage)}
}
