import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {assertModCurrent} from './permissions.js'
const {modCheck:check, modFreeze, modJson, modResultError} = contract
const hooks = ['prepare','command','dispose']

// timeoutMs bounds the module's own time. Host capability calls (stage.place writes the
// chat through the serialized persistence gate, which a director checkpoint can occupy for seconds) pause that clock
// and are bounded separately by hostTimeoutMs; a slow write must not silently drop an accepted director command.
export function createModRuntime({builtins, current, createHost, resolveBuiltin = modId => modId, onError=()=>{}, timeoutMs=1500, hostTimeoutMs=30000, maxOutputBytes=131072}) {
  const active=new Set()
  let disposed=false
  async function invoke(context,hook,input) {
    let timer,call,fail,budget=timeoutMs,started=Date.now(),inHost=0
    const expire=(message,ms)=>{clearTimeout(timer);timer=setTimeout(()=>fail(Object.assign(new Error(message),{code:'MOD_RUNTIME_FAILED'})),Math.max(0,ms))}
    const enterHost=()=>{if(inHost++===0){budget-=Date.now()-started;expire('Mod host call timed out',hostTimeoutMs)}}
    const leaveHost=()=>{if(--inHost===0){started=Date.now();expire('Mod callback timed out',budget)}}
    try {
      check(!disposed && hooks.includes(hook),'$.hook','Runtime is not available','MOD_RUNTIME_FAILED')
      assertModCurrent(context,current)
      modJson(context);modJson(input)
      const frozen=modFreeze(structuredClone(context)),args=modFreeze(structuredClone(input)),module=builtins.module(resolveBuiltin(context.modId))
      call={live:true};active.add(call)
      const isCurrent=()=>!disposed && call.live && current(frozen)
      // Each call gets revocable capabilities; a timed-out continuation cannot use its old facade.
      const wrap=value=>typeof value==='function' ? async(...args)=>{
        assertModCurrent(frozen,isCurrent)
        enterHost()
        let result
        try {result=await value(...args)} finally {if(call.live)leaveHost()}
        assertModCurrent(frozen,isCurrent)
        return result
      } : Object.freeze(Object.fromEntries(Object.entries(value).map(([key,item])=>[key,wrap(item)])))
      const host=wrap(createHost(frozen,isCurrent))
      const timeout=new Promise((_,reject)=>{fail=reject;started=Date.now();expire('Mod callback timed out',timeoutMs)})
      // Managed view-only mods need not implement director lifecycle hooks.
      const output=await Promise.race([Promise.resolve().then(()=>hook==='command' ? module[hook](args,host,frozen) : module[hook]?.(args,host,frozen)),timeout])
      assertModCurrent(frozen,isCurrent)
      modJson(output ?? null,maxOutputBytes)
      return modFreeze({ok:true,value:structuredClone(output ?? null)})
    } catch(error) {
      const diagnostic={modId:context.modId,operation:hook,name:error?.name || 'Error',message:String(error?.message ?? error),...(error?.stack?{stack:error.stack}:{})}
      onError(diagnostic)
      const result=modResultError(error)
      result.error={...result.error,modId:diagnostic.modId,operation:hook,message:diagnostic.modId+' '+hook+': '+diagnostic.message}
      return modFreeze(result)
    }
    finally {clearTimeout(timer);if(call){call.live=false;active.delete(call)}}
  }
  return Object.freeze({invoke,dispose(){disposed=true;for(const call of active)call.live=false;active.clear()}})
}
