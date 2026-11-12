import {isDeepStrictEqual as equal} from 'node:util'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modJson}=contract
export const MOD_CORRECTIONS_FIELD='modCorrections'
export const modCorrectionSourceMatches=(store,source)=>!!store && equal(store.source,source)
// The stored record keeps its settlement buckets (settlements/corrections/completed/seen/settlementOrders): saved chats
// carry them and the replay projection (mod-projection.cjs) reads corrections; nothing writes them any more.
const empty=source=>({version:1,source:structuredClone(source),revision:0,performances:[],settlements:{},corrections:{},completed:{},seen:[],settlementOrders:{}})

// The native message update gate owns serialization and source CAS. No task queue or playback gate.
export function createModStageCorrections({update,publish=()=>{}}) {
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
  return Object.freeze({
    async place(context,args,current) {
      modJson(args);shape(args,['id','kind','payload'])
      check(context.command,'$.command','Placement requires an accepted director command','MOD_PERMISSION_DENIED')
      check(typeof args.id==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(args.id),'$.id')
      check(typeof args.kind==='string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(args.kind),'$.kind')
      shape(args.payload,Object.keys(args.payload || {}),[],'$.payload')
      const performance={id:JSON.stringify([context.modId,context.command.key,args.id]),modId:context.modId,source:context.source,
        at:context.command.at,commandId:context.command.commandId,revision:0,kind:args.kind,payload:args.payload,reconciliation:'pending'}
      return change(context,current,store=>{
        const existing=store.performances.find(row=>row.id===performance.id)
        if(existing) {check(equal(existing,performance),'$.id','Performance identity already used','MOD_REVISION_CONFLICT');return {changed:false,value:existing}}
        check(store.performances.length<512,'$.performances','Performance limit')
        store.performances.push(structuredClone(performance))
        return {changed:true,value:performance}
      })
    },
  })
}
