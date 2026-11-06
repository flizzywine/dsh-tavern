import {createStageTimerClock} from './stage-clock.js'
import {TIMER_MOD_ID,timerCheckpoint} from '../../../../../mods/timer/state.cjs'
import {foldAssetPackEntries} from '../../domain/stage-asset-pack-director.js'

export const STAGE_TIMER_FIELD='stageTimerV1'
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const fail=(message,code='REVISION_CONFLICT')=>{throw Object.assign(new Error(message),{code})}
const turnOf=row=>Number(row.turn || (row.greeting?1:0))
const messageAt=(chat,turn)=>chat.messages.findLast(row=>row.role==='assistant' && turnOf(row)===turn)

export function stageTimerAt(direction,at) {
  const record=direction.record || direction.preview
  return record?foldAssetPackEntries(record,at).modState?.[TIMER_MOD_ID]?.timer || null:null
}
export function stageTimerSaved(chat,timer,turn) {
  if(!timer)return null
  for(let index=chat.messages.length-1;index>=0;index--) {
    const row=chat.messages[index],saved=row[STAGE_TIMER_FIELD]
    if(row.role!=='assistant' || turnOf(row)>turn || saved?.source.branchId!==chat.timeline.branchId || saved.source.generation!==(row.stageDirectionGeneration || 0))continue
    if(saved.checkpoint?.instanceId===timer.instanceId)return saved
    const event=saved.clockEvents?.findLast(value=>value.checkpoint?.instanceId===timer.instanceId)
    if(event)return {...saved,checkpoint:event.checkpoint,clockTimer:event.timer}
    const frame=Object.entries(saved.frames || {}).filter(([,value])=>value.instanceId===timer.instanceId).sort((a,b)=>Number(a[0])-Number(b[0])).at(-1)?.[1]
    if(frame)return {...saved,checkpoint:frame}
  }
  return null
}

export function stageTimerProgress(chat,turn) {
  const row=chat.messages.findLast(row=>row.role==='assistant' && turnOf(row)<turn && row[STAGE_TIMER_FIELD])
  const saved=row?.[STAGE_TIMER_FIELD]
  return saved?.source.branchId===chat.timeline.branchId && saved.source.generation===(row.stageDirectionGeneration || 0) ? saved.checkpoint : null
}

// One real event adds one fact on the following story turn; ordinary rounds add no text.
export function stageTimerFacts(chat,turn) {
  const previous=messageAt(chat,turn-1),saved=previous?.[STAGE_TIMER_FIELD]
  return saved?.source.branchId===chat.timeline.branchId && saved.source.generation===(previous.stageDirectionGeneration || 0) ? (saved.events || []).filter(event=>event.turn===turn-1).map(event=>event.fact) : []
}

// readChat(sessionId, turn) reads the chat through `turn` (the stage's own round view); without a turn, through the latest.
export function createStageTimerService({readChat,readDirection,patchChat,enabled,controllerEnabled=async()=>true,publish=()=>{},now,owner,progressFlushMs}) {
  const clock=createStageTimerClock({readChat,readDirection,patchChat,enabled,controllerEnabled,publish,now,owner,savedBudget:stageTimerSaved,progressFlushMs})
  async function snapshot(args) {
    const chat=clock.overlay(args.sessionId,await readChat(args.sessionId,args.turn))
    if(!chat || !await enabled(chat))return {enabled:false,timer:null}
    const direction=await readDirection(chat,args.turn)
    if(!same(direction.token,args.expectedDirectionToken))fail('Timer source changed; refresh the stage.')
    if(!Number.isSafeInteger(args.at) || args.at<1 || args.at>direction.through)fail('Choose a revealed paragraph.','ARG_INVALID')
    let timer=stageTimerAt(direction,args.at)
    const saved=stageTimerSaved(chat,timer,args.turn),state=foldAssetPackEntries(direction.record || direction.preview,args.at)
    const control=Object.values(state.stageControls || {}).find(row=>row.provider===TIMER_MOD_ID && row.timerInstanceId===timer?.instanceId) || null
    if(!['history','replay'].includes(args.mode) && control && (saved?.checkpoint?.releasedControlEpoch===control.epoch || !await controllerEnabled(chat,control.consumer)))timer=control.releasePolicy==='stop'?null:{...timer,suspended:true}
    return {enabled:true,chat,direction,timer,control,saved,checkpoint:timerCheckpoint(timer,saved?.checkpoint),revision:messageAt(chat,args.turn)?.[STAGE_TIMER_FIELD]?.revision || saved?.revision || 0}
  }
  return {
    async read(args) {
      const value=await snapshot(args)
      let checkpoint=value.checkpoint || null
      const message=messageAt(value.chat || {messages:[]},args.turn),saved=message?.[STAGE_TIMER_FIELD]
      const local=saved && saved.source.branchId===value.chat?.timeline?.branchId && saved.source.generation===(message.stageDirectionGeneration || 0)?saved:null
      if(args.mode==='history') {
        if(!local)return {enabled:value.enabled,timer:null,checkpoint:null,recorded:false,revision:value.revision || 0,now:clock.now()}
        const historical=clock.historical(local,args,value.timer)
        if(historical)return {enabled:value.enabled,...historical,revision:value.revision || 0,now:clock.now()}
        const frame=Object.entries(local.frames || {}).filter(([at,frame])=>Number(at)<=args.at && frame.instanceId===value.timer?.instanceId).sort((a,b)=>Number(a[0])-Number(b[0])).at(-1)?.[1]
        return {enabled:value.enabled,timer:frame?value.timer:null,checkpoint:frame?timerCheckpoint(value.timer,frame):null,recorded:!!frame,revision:value.revision || 0,now:clock.now()}
      } else if(args.mode!=='replay' && value.saved?.clockEvents) {
        return {enabled:value.enabled,timer:value.timer===null?null:value.saved.clockTimer,control:value.control,checkpoint:clock.clockView(value.saved.checkpoint),revision:value.revision || 0,now:clock.now()}
      }
      if(args.mode==='replay')checkpoint=timerCheckpoint(value.timer,null)
      return {enabled:value.enabled,timer:value.timer,control:value.control,checkpoint,revision:value.revision || 0,now:clock.now()}
    },
    update:args=>clock.update(args),
    dispose:()=>clock.dispose()
  }
}
