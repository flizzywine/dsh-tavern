import {randomUUID} from 'node:crypto'
import {foldAssetPackEntries} from '../../packages/dsh-tavern-stage/lib/domain/stage-asset-pack-director.js'
import {stageReadScope,markStageRead} from '../../lib/domain/stage-read-projection.js'
import {timerTimeupFact} from './state.cjs'
import {timerClockSample,timerClockRemaining,timerClockFrozen} from './clock.cjs'

// One host lifetime owns stage-open leases. A saved clock from a dead host resumes
// from its last durable sample, never from a timestamp spanning an application exit.
// Page progress is coalesced: a visit whose only
// changes are at/highWater/floors and the balance derived from an unchanged clock anchor is held in memory, read
// through by this clock, and written at most every progressFlushMs, when a stage closes and on dispose. Any other
// change writes at once and carries the held progress with it.
export const STAGE_TIMER_PROGRESS_FLUSH_MS=20000
export function createStageTimerClock({readChat,readDirection,patchChat,enabled,controllerEnabled=async()=>true,publish=()=>{},now,owner=randomUUID(),savedBudget,progressFlushMs=STAGE_TIMER_PROGRESS_FLUSH_MS}) {
  const epoch=Date.now(),start=performance.now()
  now ||= ()=>Math.floor(epoch+performance.now()-start)
  const sessions=new Map(),pending=new Map(),field='stageTimerV1'
  const turnOf=row=>Number(row.turn || (row.greeting?1:0))
  const progress=({revision,at,highWater,floors,checkpoint,...rest})=>JSON.stringify([rest,checkpoint?.clock?{...checkpoint,remainingMs:0,elapsedMs:0}:checkpoint])
  const release=sessionId=>{clearTimeout(pending.get(sessionId)?.timer);pending.delete(sessionId)}
  // Held progress stays valid while its floor and the stored record it was based on are unchanged. A view through an
  // earlier turn does not carry that floor's fields and neither applies nor judges it.
  function held(sessionId,chat) {
    const value=pending.get(sessionId)
    if(!value || !chat)return null
    const index=chat.messages.findLastIndex(row=>row.role==='assistant' && turnOf(row)===value.turn),row=chat.messages[index]
    if(index>stageReadScope(chat)?.index)return null
    if(row && chat.timeline.branchId===value.branchId && (row.stageDirectionGeneration || 0)===value.generation && (row[field]?.revision || 0)===value.base)return {value,index}
    release(sessionId)
    return null
  }
  function overlay(sessionId,chat) {
    const found=held(sessionId,chat)
    if(!found)return chat
    const messages=[...chat.messages]
    messages[found.index]={...messages[found.index],[field]:found.value.saved}
    // The overlaid copy is the same stage view: it keeps the view's scope (which floors carry what).
    const scope=stageReadScope(chat),copy={...chat,messages}
    return scope ? markStageRead(copy,scope) : copy
  }
  async function flush(sessionId,attempt=0) {
    const chat=await readChat(sessionId),found=held(sessionId,chat)
    if(!found)return
    if(await patchChat(chat.id,chat._storageRevision,[{op:'set',path:['messages',found.index,field],value:found.value.saved}],{source:'stage-timer.clock',touchUpdatedAt:false}))release(sessionId)
    else if(attempt===0)return flush(sessionId,1)
    else release(sessionId)
  }
  const queue=(sessionId,task)=>{
    const state=stateFor(sessionId),result=state.tail.then(task)
    state.tail=result.catch(()=>{})
    return result
  }
  const valid=(chat,row)=>row?.[field]?.source.branchId===chat.timeline.branchId && row[field].source.generation===(row.stageDirectionGeneration || 0)
  const latestSaved=chat=>chat.messages.findLast(row=>row.role==='assistant' && valid(chat,row))
  const source=(chat,direction,turn)=>({branchId:chat.timeline.branchId,generation:direction.token.generation,sourceKey:direction.token.sourceKey,turn})
  const fail=message=>{throw Object.assign(new Error(message),{code:'MOD_SOURCE_STALE'})}
  const clockView=checkpoint=>checkpoint?.clock?.owner===owner ? {...checkpoint,remainingMs:timerClockRemaining(checkpoint,now())}
    : checkpoint?.clock ? {...checkpoint,clock:{...checkpoint.clock,open:false,remainingMs:checkpoint.remainingMs}} : checkpoint
  const identity=timer=>timer && JSON.stringify([timer.instanceId,timer.revision,timer.status,!!timer.suspended])
  const stageOpen=state=>[...state.leases.values()].some(Boolean)
  function stateFor(sessionId) {
    if(!sessions.has(sessionId))sessions.set(sessionId,{leases:new Map(),tail:Promise.resolve()})
    return sessions.get(sessionId)
  }
  async function mutate(args,state,stamp,attempt=0) {
    if(!['open','visit','sample','close','pause'].includes(args.action) || typeof args.lease!=='string' || !args.lease || args.lease.length>100)fail('Invalid stage clock lease')
    // HTTP responses may be slow or arrive out of order. A closed lease is final;
    // a late open/visit cannot resurrect a stage that has already left.
    if(args.action==='close')state.leases.set(args.lease,false)
    else if(state.leases.get(args.lease)===false)fail('Stage clock is closed')
    else if(args.action==='open')state.leases.set(args.lease,true)
    else if(args.action!=='visit' && !state.leases.get(args.lease))fail('Stage clock is closed')
    const stored=await readChat(args.sessionId),chat=overlay(args.sessionId,stored)
    if(!chat)return {enabled:false,timer:null,checkpoint:null,now:stamp}
    if(args.action!=='close' && !await enabled(chat))return {enabled:false,timer:null,checkpoint:null,now:stamp}
    const visit=args.action==='visit'
    let row=visit ? chat.messages.findLast(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===args.turn) : latestSaved(chat)
    if(!row)return {enabled:true,timer:null,checkpoint:null,now:stamp}
    const turn=Number(row.turn || (row.greeting?1:0)),direction=await readDirection(chat,turn)
    if(visit && (args.mode!=='live' || row!==chat.messages.findLast(row=>row.role==='assistant') || JSON.stringify(args.expectedDirectionToken)!==JSON.stringify(direction.token)))fail('Only the latest live floor can execute timer commands')
    if(visit && (!Number.isSafeInteger(args.at) || args.at<1 || args.at>direction.through || !Number.isSafeInteger(args.offset??0) || (args.offset??0)<0))fail('Invalid timer floor')
    const record=direction.record || direction.preview
    const activeState=record && foldAssetPackEntries(record,visit?args.at:row[field]?.highWater || row[field]?.at || 1)
    const control=Object.values(activeState?.stageControls || {}).find(value=>value.provider==='dsh.timer')
    const controllerOff=control && !await controllerEnabled(chat,control.consumer)
    let result,event,change,hold
    {
      const current=chat
      const message=current.messages.findLast(value=>value.role==='assistant' && Number(value.turn || (value.greeting?1:0))===turn)
      if(!message || (message.stageDirectionGeneration || 0)!==direction.token.generation)fail('Timer generation changed')
      if(visit)state.leases.set(args.lease,true)
      const local=valid(current,message)?message[field]:null
      const prior=local || latestSaved(current)?.[field]
      let timer=prior?.clockTimer || null,checkpoint=prior?.checkpoint || null
      const clocks=[...(local?.clockEvents || [])],floors={...(local?.floors || {})}
      let highWater=local?.highWater ?? (local?.checkpoint ? local.at : 0)
      const frontier=highWater
      const append=(op,definition,entry)=>{
        if(timer && definition && timer.instanceId!==definition.instanceId) {
          checkpoint=timerClockSample(timer,checkpoint,stamp,{open:false,owner})
          clocks.push({op:'settle',atMs:stamp,timer:structuredClone(timer),checkpoint:structuredClone(checkpoint)})
        }
        if(definition && checkpoint?.instanceId!==definition.instanceId) {
          const saved=clocks.findLast(event=>event.checkpoint?.instanceId===definition.instanceId) || savedBudget(current,definition,turn)
          if(saved)checkpoint=saved.checkpoint
        }
        timer=definition
        checkpoint=timerClockSample(timer,checkpoint,stamp,{open:stageOpen(state),owner,
          ...(args.action==='pause'?{playerPaused:args.playerPaused===true}:{})})
        clocks.push({op,atMs:stamp,...(entry===undefined?{}:{entry}),timer:structuredClone(timer),checkpoint:structuredClone(checkpoint)})
      }
      if(!timer && prior?.checkpoint && !prior.clockEvents) {
        // V1 has no timestamp. Recover only its known balance, not invented past time.
        const previousState=prior.source.turn===turn ? foldAssetPackEntries(record,prior.at) : record?.baseline
        const own=previousState?.modState?.['dsh.timer']?.timer
        timer=own?.instanceId===prior.checkpoint.instanceId?own:null
        if(timer)checkpoint={...checkpoint,durationMs:timer.durationMs}
      }
      if(visit && args.at>=highWater) {
        const candidates=[{at:0,state:record?.baseline,index:-1},...(record?.entries || []).map((entry,index)=>({...entry,index}))].filter(entry=>entry.at<=args.at && (entry.at>highWater || highWater===0))
        for(const entry of candidates) {
          const state=entry.state
          let next=state?.modState?.['dsh.timer']?.timer || null
          const control=Object.values(state?.stageControls || {}).find(control=>control.provider==='dsh.timer' && control.timerInstanceId===next?.instanceId)
          if(control?.exiting)next=control.releasePolicy==='stop'?null:{...next,suspended:true}
          if(identity(next)!==identity(timer))append(next ? next.instanceId!==timer?.instanceId?'set':next.command?.id || next.status : 'stop',next,entry.index)
        }
        highWater=Math.max(highWater,args.at)
      }
      if(timer && (controllerOff || control?.exiting) && control.timerInstanceId===timer.instanceId) {
        const released=control.releasePolicy==='stop'?null:{...timer,suspended:true}
        if(identity(released)!==identity(timer))append('release',released)
      }
      if(timer) {
        const before=checkpoint
        checkpoint=timerClockSample(timer,checkpoint,stamp,{open:stageOpen(state),owner,
          ...(args.action==='pause'?{playerPaused:args.playerPaused===true}:{})})
        if(!clocks.length || JSON.stringify(before?.clock)!==JSON.stringify(checkpoint.clock))clocks.push({op:args.action,atMs:stamp,timer:structuredClone(timer),checkpoint:structuredClone(checkpoint)})
        if(checkpoint.status==='expired' && !checkpoint.event) {
          event={type:'timer.timeup',id:'timer.timeup:'+timer.instanceId+':'+timer.revision,instanceId:timer.instanceId,mode:timer.mode,label:timer.label,ref:timer.ref,look:timer.look,onTimeup:timer.onTimeup,
            fact:timerTimeupFact(timer),turn,at:visit?args.at:local?.at || 1,source:structuredClone(direction.token)}
          checkpoint={...checkpoint,event}
        }
      }
      if(visit && clocks.length) {
        const key=args.at+':'+(args.offset || 0)
        floors[key] ||= {eventSeq:clocks.length-1,atMs:stamp}
      }
      const saved={source:source(current,direction,turn),at:visit?args.at:local?.at || 1,highWater,revision:(local?.revision || 0)+1,
        checkpoint,clockTimer:timer,clockEvents:clocks,floors,frames:local?.frames || {},events:[...(local?.events || []),...(event?[event]:[])]}
      // An enabled mod with no countdown has no clock to persist. Existing empty
      // records are left alone; visits and ten-second samples must not rewrite a save.
      // A record whose only difference is its own counter is not a new save state.
      const unchanged=local && JSON.stringify({...saved,revision:local.revision})===JSON.stringify(local)
      if(!unchanged && (timer || checkpoint || clocks.length || Object.keys(saved.frames).length || saved.events.length)) {
        const index=current.messages.indexOf(message),before=stored.messages[index]
        if(visit && valid(stored,before) && progress(saved)===progress(before[field]))hold={turn,branchId:current.timeline.branchId,generation:direction.token.generation,base:before[field].revision || 0,saved}
        else change={op:'set',path:['messages',index,field],value:saved}
      }
      // A page behind the live frontier whose own countdown has since stopped or been replaced shows that countdown frozen
      // at the page's recorded floor (the nearest earlier one), never the live clock's later state; only reads, never
      // writes. The same countdown still on the live clock keeps the live clock (same-command paging).
      const shown=!controllerOff && args.at<frontier ? behind(record,floors,clocks,local?.frames,args,turn,timer) : null
      result={enabled:true,timer:shown?shown.timer:timer,checkpoint:shown?shown.checkpoint:checkpoint,revision:change || hold?saved.revision:local?.revision || 0,now:stamp,event,
        fallbackAction:event && timer.mode==='reply' && current.messages.at(-1)===message && args.waitingForInput===true && args.inputStarted!==true ? timer.onTimeout?.fallbackAction || null : null}
    }
    if(change && !await patchChat(chat.id,chat._storageRevision,[change],{source:'stage-timer.clock',touchUpdatedAt:false})) {
      // A concurrent projection receipt can advance the revision without changing
      // this clock. Re-read once, retaining the event's original arrival timestamp.
      if(attempt===0)return mutate(args,state,stamp,1)
      fail('Timer read point changed')
    }
    // A written record already carries this floor's held progress; another floor's is written before it is replaced.
    const prior=pending.get(args.sessionId)
    if(change && prior?.turn===turn)release(args.sessionId)
    else if(hold && prior && prior.turn!==turn)await flush(args.sessionId)
    if(hold) {
      const timer=pending.get(args.sessionId)?.timer ?? setTimeout(()=>{
        if(pending.get(args.sessionId))pending.get(args.sessionId).timer=null
        queue(args.sessionId,()=>flush(args.sessionId))
      },progressFlushMs)
      timer?.unref?.()
      pending.set(args.sessionId,{...hold,timer})
    }
    if(event)await publish({sessionId:args.sessionId,event})
    result.now=now()
    return result
  }
  // The view's page (visit, or sample/pause carrying the shown turn/at/offset) on the live turn, when its own countdown
  // is not the live clock's: that countdown at the page's floor, frozen; a legacy V1 frame where no floor names it.
  function behind(record,floors,clocks,frames,args,turn,timer) {
    if(!record || args.turn!==turn || !Number.isSafeInteger(args.at) || args.at<1)return null
    const state=foldAssetPackEntries(record,args.at)
    let own=state.modState?.['dsh.timer']?.timer || null
    const control=Object.values(state.stageControls || {}).find(value=>value.provider==='dsh.timer' && value.timerInstanceId===own?.instanceId)
    if(control?.exiting && control.releasePolicy==='stop')own=null
    if(!own || own.instanceId===timer?.instanceId)return null
    const position=[args.at,args.offset || 0]
    const floor=Object.entries(floors).map(([key,value])=>[key.split(':').map(Number),value])
      .filter(([[at,offset],value])=>(at<position[0] || at===position[0] && offset<=position[1]) && clocks[value.eventSeq]?.timer?.instanceId===own.instanceId)
      .sort(([x],[y])=>x[0]-y[0] || x[1]-y[1]).at(-1)?.[1]
    if(floor)return {timer:clocks[floor.eventSeq].timer,checkpoint:timerClockFrozen(clocks[floor.eventSeq].checkpoint,floor.atMs)}
    const frame=Object.entries(frames || {}).filter(([at,value])=>Number(at)<=args.at && value.instanceId===own.instanceId).sort((a,b)=>Number(a[0])-Number(b[0])).at(-1)?.[1]
    return frame?{timer:own,checkpoint:{...frame,durationMs:own.durationMs}}:null
  }
  return {
    now,owner,clockView,
    overlay,
    update(args) {
      const state=stateFor(args.sessionId),stamp=now(),result=queue(args.sessionId,()=>mutate(args,state,stamp))
      if(args.action!=='close')return result
      return queue(args.sessionId,()=>flush(args.sessionId)).catch(()=>{}).then(()=>result)
    },
    historical(saved,args,timer) {
      if(!saved?.clockEvents)return undefined
      const position=[args.at,args.offset || 0]
      const selected=Object.entries(saved.floors || {}).filter(([key])=>{const [at,offset]=key.split(':').map(Number);return at<position[0] || at===position[0] && offset<=position[1]})
        .sort(([a],[b])=>{const x=a.split(':').map(Number),y=b.split(':').map(Number);return x[0]-y[0] || x[1]-y[1]}).at(-1)
      const legacy=Object.entries(saved.frames || {}).filter(([at,frame])=>Number(at)<=args.at && frame.instanceId===timer?.instanceId).map(([at])=>Number(at)).sort((a,b)=>a-b).at(-1)
      if(legacy!==undefined && (!selected || legacy>Number(selected[0].split(':')[0]) || selected[0]===legacy+':0'))return undefined
      if(!selected)return {timer:null,checkpoint:null,recorded:false}
      const floor=selected[1],event=saved.clockEvents[floor.eventSeq]
      return {timer:event.timer,checkpoint:timerClockFrozen(event.checkpoint,floor.atMs),recorded:true}
    },
    async dispose() {
      await Promise.all([...sessions].flatMap(([sessionId,state])=>[...state.leases].filter(([,open])=>open).map(([lease])=>this.update({sessionId,lease,action:'close'}))))
      await Promise.all([...pending.keys()].map(sessionId=>queue(sessionId,()=>flush(sessionId)).catch(()=>{})))
    }
  }
}
