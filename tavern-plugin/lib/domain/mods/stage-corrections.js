import {isDeepStrictEqual as equal} from 'node:util'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import projection from '../../../src/client/mod-projection.cjs'
const {modCheck:check,modShape:shape,modJson,modFreeze}=contract
const {projectModPerformances}=projection
export const MOD_CORRECTIONS_FIELD='modCorrections'
const receiptKey=(modId,revision)=>JSON.stringify([modId,revision])
export const modCorrectionSourceMatches=(store,source)=>!!store && equal(store.source,source)
const empty=source=>({version:1,source:structuredClone(source),revision:0,performances:[],settlements:{},corrections:{},completed:{},seen:[],settlementOrders:{}})

export function admitModSettlement(old,context,settlement,order) {
  const store=modCorrectionSourceMatches(old,context.source)?structuredClone(old):empty(context.source)
  const key=receiptKey(context.modId,settlement.settlementRevision)
  if(store.seen.includes(key) || order!==undefined && order<=(store.settlementOrders[context.modId] ?? -1))return null
  if(order!==undefined) {
    check(Number.isSafeInteger(order) && order>=0,'$.settlementOrder')
    store.settlementOrders[context.modId]=order
  }
  store.seen.push(key)
  store.settlements[context.modId]=structuredClone(settlement)
  modJson(store,512*1024)
  return store
}

// The native message update gate owns serialization and source CAS. No task queue or playback gate.
export function createModStageCorrections({read,update,publish=()=>{},log=()=>{}}) {
  async function change(context,current,mutate) {
    let result
    await update(context,old=>{
      check(current(),'$.source','Mod source changed','MOD_SOURCE_STALE')
      const store=modCorrectionSourceMatches(old,context.source)?structuredClone(old):empty(context.source)
      result=mutate(store)
      if (!result.changed)return undefined
      store.revision++
      modJson(store,512*1024)
      return store
    },current)
    if(result?.changed)publish(context)
    return result?.value
  }
  function ownPerformances(store,context) {
    return projectModPerformances(store,{includeRemoved:true}).filter(row=>row.modId===context.modId)
  }
  return Object.freeze({
    async place(context,args,current) {
      modJson(args);shape(args,['id','kind','payload','pairing'],['id','kind','payload'])
      check(context.command,'$.command','Placement requires an accepted director command','MOD_PERMISSION_DENIED')
      check(typeof args.id==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(args.id),'$.id')
      check(typeof args.kind==='string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(args.kind),'$.kind')
      shape(args.payload,Object.keys(args.payload || {}),[],'$.payload')
      if(args.pairing) {
        shape(args.pairing,['readId','path'])
        check(context.readIds.includes(args.pairing.readId),'$.pairing.readId','Variable slot is not authorized','MOD_PERMISSION_DENIED')
        check(Array.isArray(args.pairing.path) && args.pairing.path.length<=16 && args.pairing.path.every(key=>
          typeof key==='string' && !['__proto__','prototype','constructor'].includes(key) || Number.isSafeInteger(key) && key>=0),'$.pairing.path')
      }
      const performance={id:JSON.stringify([context.modId,context.command.key,args.id]),modId:context.modId,source:context.source,
        at:context.command.at,commandId:context.command.commandId,revision:0,kind:args.kind,payload:args.payload,
        ...(args.pairing?{pairing:args.pairing}:{}),reconciliation:'pending'}
      return change(context,current,store=>{
        const existing=store.performances.find(row=>row.id===performance.id)
        if(existing) {check(equal(existing,performance),'$.id','Performance identity already used','MOD_REVISION_CONFLICT');return {changed:false,value:existing}}
        check(store.performances.length<512,'$.performances','Performance limit')
        store.performances.push(structuredClone(performance))
        return {changed:true,value:performance}
      })
    },
    async settlement(context,settlement,current,order) {
      if(settlement.status!=='ok') {log({code:'MOD_SETTLEMENT_IGNORED',status:settlement.status,modId:context.modId});return false}
      modJson(settlement)
      check(equal(settlement.source,context.source) && settlement.turn===context.turn,'$.source','Foreign settlement','MOD_SOURCE_STALE')
      return change(context,current,store=>{
        const next=admitModSettlement(store,context,settlement,order)
        if(!next)return {changed:false,value:false}
        Object.assign(store,next)
        return {changed:true,value:true}
      })
    },
    async pending(context) {
      const store=await read(context)
      if(!modCorrectionSourceMatches(store,context.source))return null
      const settlement=store.settlements[context.modId]
      if(!settlement)return null
      const done=store.completed[receiptKey(context.modId,settlement.settlementRevision)] || []
      const performances=ownPerformances(store,context)
      if(!performances.some(row=>!done.includes(row.id)))return null
      return modFreeze({...structuredClone(settlement),performances})
    },
    async reviseAfterSettlement(context,args,current) {
      modJson(args);shape(args,['settlementRevision','revisions'])
      check(context.settlementRevision===args.settlementRevision,'$.settlementRevision','Receipt callback required','MOD_PERMISSION_DENIED')
      check(Array.isArray(args.revisions) && args.revisions.length<=512,'$.revisions')
      return change(context,current,store=>{
        check(store.settlements[context.modId]?.settlementRevision===args.settlementRevision,'$.settlementRevision','Settlement superseded','MOD_SOURCE_STALE')
        const key=receiptKey(context.modId,args.settlementRevision),done=store.completed[key] || [],ids=new Set()
        const performances=new Map(ownPerformances(store,context).map(row=>[row.id,row]))
        let changed=false
        for(const revision of args.revisions) {
          shape(revision,['performanceId','expectedRevision','action','payload','reason'],['performanceId','expectedRevision','action','reason'])
          const performance=performances.get(revision.performanceId)
          check(performance && !ids.has(performance.id),'$.performanceId','Unknown, duplicate or foreign performance','MOD_PERMISSION_DENIED')
          ids.add(performance.id)
          check(['replace','remove'].includes(revision.action) && typeof revision.reason==='string' && revision.reason.length<=512,'$.action')
          if(revision.action==='replace')shape(revision.payload,Object.keys(revision.payload || {}),[],'$.payload')
          if(done.includes(performance.id))continue
          check(performance.revision===revision.expectedRevision,'$.expectedRevision','Performance revision changed','MOD_REVISION_CONFLICT')
          store.corrections[performance.id]={...structuredClone(revision),revision:performance.revision+1,settlementRevision:args.settlementRevision}
          done.push(performance.id);changed=true
        }
        if(changed)store.completed[key]=done
        return {changed,value:{accepted:true}}
      })
    },
  })
}
