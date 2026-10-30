import {isDeepStrictEqual} from 'node:util'
import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {validateModManifest} from './manifest.js'
import {assertModCurrent} from './permissions.js'
const {modCheck:check, modFreeze, modJson, modResultError} = contract
const hooks = ['prepare','command','settled','dispose','event']

// The caller supplies application imports, never modules or paths obtained from an archive.
export function createBuiltinModRegistry(releases) {
  const entries=new Map()
  for (const release of releases) {
    const manifest=validateModManifest(release.manifest),files=new Map()
    check(!entries.has(manifest.id),'$.id','Duplicate built-in mod')
    check(Object.keys(release.module).every(key=>hooks.includes(key) || ['configure','commandSchema','validateCommand'].includes(key)) && ['configure','commandSchema','validateCommand'].every(key=>release.module[key]===undefined || typeof release.module[key]==='function') && hooks.every(key=>key==='event' && release.module[key]===undefined || typeof release.module[key]==='function'),'$.runtime','Invalid first-party module')
    check(!manifest.subscriptions?.length || typeof release.module.event==='function','$.subscriptions','Subscriptions require an event callback')
    for (const file of manifest.files) {
      const bytes=Buffer.from(release.files.get(file.path) || [])
      check(bytes.length===file.size && release.files.has(file.path),'$.files','Incomplete built-in release')
      files.set(file.path,bytes)
    }
    entries.set(manifest.id,{manifest,files,module:Object.freeze({...release.module})})
  }
  return Object.freeze({
    inspect(manifest,files) {
      const validated=validateModManifest(manifest),builtin=entries.get(validated.id)
      check(builtin && isDeepStrictEqual(validated,builtin.manifest),'$.runtime','First batch supports only installed application releases','MOD_API_UNSUPPORTED')
      check(files instanceof Map && files.size===builtin.files.size,'$.files','Unexpected release files')
      for (const [path,bytes] of builtin.files) check(files.has(path) && Buffer.from(files.get(path)).equals(bytes),'$.files','Modified first-party release: '+path,'MOD_API_UNSUPPORTED')
      return builtin.manifest
    },
    manifest(modId) {const entry=entries.get(modId);check(entry,'$.modId','No built-in release','MOD_API_UNSUPPORTED');return entry.manifest},
    module(modId) {const entry=entries.get(modId);check(entry,'$.modId','No built-in runtime','MOD_API_UNSUPPORTED');return entry.module},
    file(modId,path) {const entry=entries.get(modId);check(entry,'$.modId','No built-in release','MOD_API_UNSUPPORTED');const bytes=entry.files.get(path);return bytes?Buffer.from(bytes):null},
    files(modId) {const entry=entries.get(modId);check(entry,'$.modId','No built-in release','MOD_API_UNSUPPORTED');return new Map([...entry.files].map(([path,bytes])=>[path,Buffer.from(bytes)]))}
  })
}

// timeoutMs bounds the module's own time. Host capability calls (stage.place writes the
// chat through the serialized persistence gate, which a director checkpoint can occupy for seconds) pause that clock
// and are bounded separately by hostTimeoutMs; a slow write must not silently drop an accepted director command.
export function createModRuntime({builtins, current, createHost, resolveBuiltin = modId => modId, timeoutMs=1500, hostTimeoutMs=30000, maxOutputBytes=131072}) {
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
      const output=await Promise.race([Promise.resolve().then(()=>module[hook](args,host,frozen)),timeout])
      assertModCurrent(frozen,isCurrent)
      modJson(output ?? null,maxOutputBytes)
      return modFreeze({ok:true,value:structuredClone(output ?? null)})
    } catch(error) {return modFreeze(modResultError(error))}
    finally {clearTimeout(timer);if(call){call.live=false;active.delete(call)}}
  }
  return Object.freeze({invoke,dispose(){disposed=true;for(const call of active)call.live=false;active.clear()}})
}
