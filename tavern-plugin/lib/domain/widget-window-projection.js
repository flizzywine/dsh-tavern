import directorCommands from '../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import {stageProjectionPage} from './stage-projection.js'
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const refKey=ref=>JSON.stringify([ref.packId,ref.kind,ref.assetId])
// A recorded op that marks `ref` as a widget source, or null.
const sourceOp=(raw,ref)=>{const op=directorCommands.recordOperation(raw);return op?.op==='widget.source' && refKey(op.ref)===refKey(ref) ? op : null}
// Of the earlier rounds' records by turn (beat ops suffice), those whose beats mark `ref` as a widget source (any widget
// source without a ref): the only rounds whose directions the window reads.
export const widgetSourceRounds=(records,ref)=>[...records].flatMap(([turn,record])=>
  record.entries.some(entry=>entry.ops.some(raw=>ref ? sourceOp(raw,ref) : directorCommands.recordOperation(raw)?.op==='widget.source')) ? [turn] : [])
// A narrow mode of the existing projection endpoint: no playback writer, scene or audio projection.
export async function readWidgetWindowProjection({widgetWindow,turn,at,page,expectedDirectionToken,readDirection,readTurns,readConsumer,readSettings,revision,isCurrent}) {
  const ref=widgetWindow?.ref
  if (!ref || ref.kind!=='widgets' || Object.keys(widgetWindow).join(',')!=='ref' || Object.keys(ref).sort().join(',')!=='assetId,kind,packId' || typeof ref.packId!=='string' || typeof ref.assetId!=='string') return {status:'failed'}
  const version=revision(),settings=readSettings()
  const valid=()=>isCurrent() && revision()===version && readSettings().revision===settings.revision
  try {
    const current=await readDirection(turn)
    if (!current.token || !equal(current.token,expectedDirectionToken)) return {status:'stale'}
    const coordinate=stageProjectionPage(current,at,page)
    if (!Number.isSafeInteger(at) || at<1 || at>current.through || coordinate && coordinate.para!==at) return {status:'stale'}
    const turns=[...new Set(await readTurns())].filter(n=>Number.isSafeInteger(n) && n<=turn).sort((a,b)=>b-a).slice(0,20)
    const found=[], avatarSources=[]
    for (const number of turns) {
      const direction=number===turn ? current : await readDirection(number)
      if (!direction?.token || !['partial','done'].includes(direction.phase)) continue
      const record=direction.record || direction.preview
      const entries=record?.entries.filter(entry=>entry.at<=direction.through && (number!==turn || entry.at<=at)) || []
      let used=false
      for (const entry of [...entries].reverse()) for (const raw of entry.ops) {
        const op=sourceOp(raw,ref)
        if (!op) continue
        used=true
        if (avatarSources.length<80 && number<turn) avatarSources.push({turn:number,para:entry.at,contact:op.contact,actor:entry.state?.actors?.[op.contact]})
      }
      if (used) found.push({number,token:direction.token})
    }
    if (!found.length || !valid()) return {status:'revoked',widgets:[]}
    const consumer=await readConsumer()
    if (!consumer?.presentation.available()) return {status:'revoked',widgets:[]}
    const authorizeSource=async()=>{
      try {
        if (!valid()) return false
        const cursor=await readDirection(turn)
        if (!equal(cursor?.token,expectedDirectionToken)) return false
        for (const source of found) if (!equal((await readDirection(source.number))?.token,source.token)) return false
        return valid()
      } catch { return false }
    }
    const widgets=await consumer.presentation.widgets({widgets:{}},{sourceRefs:[ref],engine:settings.values,isCurrent:valid,
      grantKey:JSON.stringify([expectedDirectionToken,found]),authorizeSource,avatarSources})
    if (!await authorizeSource()) return {status:'stale'}
    return {status:'ready',widgets,revision:version}
  } catch { return {status:'failed',widgets:[]} }
}
