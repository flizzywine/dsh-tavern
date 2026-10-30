import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {createModRuntime} from './domain/mods/runtime.js'
import {createModJudge} from './domain/mods/judge.js'
import {createModAssets} from './domain/mods/assets.js'
import {createModVariables} from './domain/mods/variables.js'
import {compileModPrompts,replaceModPromptSections} from './domain/mods/prompts.js'
import {registerModCommands,validateModCommand} from './domain/mods/commands.js'
import {assertModPermission} from './domain/mods/permissions.js'
import {modTurnActive} from './domain/mods/catalogue.js'
const {modCheck:check,modShape:shape,modJson,modFreeze} = contract

// Source/Timeline/lease adapters are supplied by the existing host owners. No raw RPC or FS facade.
export function createModHostRuntime({library,builtins,engineJudge,sourceCurrent,readText,assetPort,variablePort,stagePort,sourcePort,coreCommands=[]}) {
  const contexts=new WeakSet(),prepareCalls=new Map()
  let active=true
  const current=context=>active && contexts.has(context) && sourceCurrent(context)===true && library.authority(context.modId,context.cardId)===context.authority
  const unavailable=()=>{check(false,'$.capability','Host capability is unavailable','MOD_RESOURCE_UNAVAILABLE')}
  function context(input,modId) {
    modJson(input)
    const row=library.snapshot().mods[modId],authority=library.authority(modId,input.cardId)
    check(row && authority,'$.modId','Mod is disabled or not authorized','MOD_DISABLED')
    const {catalogues,bindings,settingsByMod,...base}=input
    const value=modFreeze({...structuredClone(base),...(settingsByMod?{settings:structuredClone(settingsByMod[modId])}:{}),...(catalogues?{catalogue:structuredClone(catalogues[modId])}:{}),...(bindings?{variableBindings:structuredClone(bindings[modId])}:{}),modId,modRevision:row.releaseRevision,authority,invocationId:randomUUID()})
    contexts.add(value)
    return value
  }
  // Runtime clones its input context; the identity guard also pins all caller-controlled source fields.
  const issued=new Map()
  function isCurrent(value) {
    const original=issued.get(value.invocationId)
    return !!original && equal(original,value) && current(original)
  }
  function issue(value) {
    issued.set(value.invocationId,value)
    while(issued.size>128)issued.delete(issued.keys().next().value)
    return value
  }
  const runtime=createModRuntime({builtins,current:isCurrent,resolveBuiltin:modId=>library.snapshot().mods[modId]?.origin?.builtinId || modId,
    createHost(value,callCurrent) {
      const manifest=library.snapshot().mods[value.modId].manifest
      const own=()=>library.getMod({modId:value.modId,cardId:value.cardId})
      const correctionOnly=()=>check(false,'$.settlement','Corrections cannot call models or write variables','MOD_PERMISSION_DENIED')
      const variableHost=variablePort?createModVariables({...variablePort,manifest,context:value,current:callCurrent}):{getTurn:unavailable,patch:unavailable,setVariables:unavailable}
      const bridge=method=>async args=>{assertModPermission(manifest,'stage.'+method);check(stagePort && typeof stagePort[method]==='function','$.stage','Stage capability unavailable','MOD_RESOURCE_UNAVAILABLE');return stagePort[method]({...value,readIds:(manifest.permissions.variables?.reads || []).map(row=>row.id)},args,callCurrent)}
      return {
        settings:{get:async args=>{shape(args,[],[]);return value.settings || own().settings}},
        library:{
          snapshot:async args=>{shape(args,[],[]);return value.catalogue || {packs:[],recalled:[]}},
          list:async args=>{shape(args,['packId','kind'],[]);return own().packs.filter(pack=>!args.packId || pack.id===args.packId).map(pack=>({...pack,entries:pack.entries.filter(entry=>!args.kind || entry.kind===args.kind)}))},
          read:async args=>{shape(args,['ref']);check(args.ref.modId===value.modId,'$.ref','Cross-mod library access denied','MOD_PERMISSION_DENIED');return own().packs.find(pack=>pack.id===args.ref.packId)?.entries.find(entry=>entry.id===args.ref.entryId && entry.kind===args.ref.kind) || null},
        },
        judge:value.settlementRevision?correctionOnly:createModJudge({engineJudge,manifest,context:value,current:callCurrent}),
        assets:assetPort?createModAssets({...assetPort,manifest,context:value,current:callCurrent}):{read:unavailable},
        variables:value.settlementRevision?{getTurn:variableHost.getTurn,patch:correctionOnly,setVariables:correctionOnly}:variableHost,
        source:{window:async args=>{check(manifest.permissions.source?.includes('dialogue'),'$.source','Source permission required','MOD_PERMISSION_DENIED');return sourcePort?sourcePort.window(value,args,callCurrent):unavailable()}},
        stage:{...Object.fromEntries(['place','playDeclarative','reviseAfterSettlement'].map(method=>[method,bridge(method)])),state:{
          get:async()=>{assertModPermission(manifest,'stage.state');return stagePort?.state?.get ? stagePort.state.get(value,callCurrent) : unavailable()},
          propose:async args=>{assertModPermission(manifest,'stage.state');return stagePort?.state?.propose ? stagePort.state.propose(value,args,callCurrent) : unavailable()},
        }},
        prompt:{sections:async args=>{
          shape(args,['target','sections'])
          const preparation=prepareCalls.get(value.invocationId)
          check(preparation && args.target==='director','$.target','Prompt assembly is already frozen','MOD_SOURCE_STALE')
          preparation.fragments=replaceModPromptSections({manifest,fragments:preparation.fragments,target:args.target,sections:args.sections})
          return {accepted:true}
        }},
      }
    },
  })
  function configure({cardId,catalogues={},bindings={},settingsByMod={},selectedModIds}) {
    const manifests=library.active(cardId).filter(manifest=>(!selectedModIds || selectedModIds.includes(manifest.id)) && modTurnActive(manifest,catalogues[manifest.id])),commands=registerModCommands(manifests,coreCommands)
    return modFreeze(commands.flatMap(command=>{
      const manifest=manifests.find(row=>row.id===command.modId),module=builtins.module(library.snapshot().mods[manifest.id].origin?.builtinId || manifest.id)
      if(!module.configure)return [command]
      const result=module.configure(modFreeze({manifest,catalogue:catalogues[manifest.id] || {packs:[],recalled:[]},bindings:bindings[manifest.id] || {},settings:settingsByMod[manifest.id] || library.getMod({modId:manifest.id,cardId}).settings}))
      modJson(result)
      const configured=result.commands.find(row=>row.id===command.id)
      if(configured?.caps)check(Number.isSafeInteger(configured.caps.perTurn) && configured.caps.perTurn>=1 && configured.caps.perTurn<=256 && configured.caps.bytes===command.caps.bytes,'$.caps','Invalid configured command cap')
      return configured?[{...command,params:configured.params,...(configured.caps?{caps:configured.caps}:{}),...(configured.admission?{admission:configured.admission}:{})}]:[]
    }))
  }
  function validateCommand(modId,commandId,params) {
    const module=builtins.module(library.snapshot().mods[modId].origin?.builtinId || modId)
    const result=module.validateCommand?.(commandId,modFreeze(structuredClone(params)))
    check(result===undefined,'$.params','Command semantic validation must be synchronous and return undefined','MOD_API_UNSUPPORTED')
  }
  return Object.freeze({
    configure,validateCommand,
    async prepare(input) {
      check(active,'$','Mod runtime is disposed','MOD_RESOURCE_UNAVAILABLE')
      modJson(input)
      shape(input,['cardId','gameId','turn','source','authorityEpoch','catalogueRevision','catalogues','bindings','settingsByMod','selectedModIds'],['cardId','gameId','turn','source','authorityEpoch','catalogueRevision'])
      check(typeof input.cardId==='string' && typeof input.gameId==='string' && Number.isSafeInteger(input.turn),'$.source')
      const commands=configure(input)
      const manifests=library.active(input.cardId).filter(manifest=>(!input.selectedModIds || input.selectedModIds.includes(manifest.id)) && modTurnActive(manifest,input.catalogues?.[manifest.id]) && (!manifest.commands.length || commands.some(command=>command.modId===manifest.id)))
      if (!manifests.length) return null
      const contextsForTurn=manifests.map(manifest=>issue(context(input,manifest.id))),texts=new Map()
      await Promise.all(manifests.flatMap(manifest=>manifest.prompts.filter(prompt=>prompt.target==='director').map(async prompt=>texts.set(manifest.id+'\0'+prompt.path,await readText(manifest.id,prompt.path)))))
      let fragments=compileModPrompts(manifests,(id,path)=>texts.get(id+'\0'+path),'director',commands)
      for (const value of contextsForTurn) {
        const key=value.invocationId,preparation={fragments}
        prepareCalls.set(key,preparation)
        try {
          const result=await runtime.invoke(value,'prepare',{})
          check(result.ok,'$.prepare',result.error?.message || 'Mod preparation failed',result.error?.code || 'MOD_RUNTIME_FAILED')
          fragments=preparation.fragments
          if (result.value?.sections?.length) fragments=replaceModPromptSections({manifest:manifests.find(row=>row.id===value.modId),fragments,target:'director',sections:result.value.sections})
        } finally {prepareCalls.delete(key)}
      }
      check(contextsForTurn.every(current),'$.source','Mod source changed while preparing','MOD_SOURCE_STALE')
      return modFreeze({contexts:contextsForTurn,manifests,commands,fragments,validateCommand})
    },
    restore(input) {
      check(active,'$','Mod runtime is disposed','MOD_RESOURCE_UNAVAILABLE')
      modJson(input)
      shape(input,['cardId','gameId','turn','source','authorityEpoch','catalogueRevision'])
      const manifests=library.active(input.cardId)
      if(!manifests.length)return null
      return modFreeze({restored:true,validateCommand,contexts:manifests.map(manifest=>issue(context(input,manifest.id))),manifests,
        commands:registerModCommands(manifests,coreCommands),fragments:[]})
    },
    async command(prepared,{modId,commandId,params},accepted) {
      const value=prepared.contexts.find(row=>row.modId===modId)
      check(value && current(value),'$.source','Command source is stale','MOD_SOURCE_STALE')
      const command=prepared.commands.find(row=>row.modId===modId && row.id===commandId)
      check(command,'$.commandId','Command is not registered','MOD_PERMISSION_DENIED')
      validateModCommand(command,params)
      validateCommand(modId,commandId,params)
      const invocation=accepted?context({...value,command:{...accepted,commandId}},modId):value
      return runtime.invoke(issue(invocation),'command',{commandId,params})
    },
    settled(prepared,settlement) {
      // Failed/skipped settlements provide no correction facts and never invoke a callback.
      if (settlement.status!=='ok') return []
      modJson(settlement)
      shape(settlement,['source','turn','settlementRevision','status','beforeRevision','afterRevision','before','after','performances','bindings'],['source','turn','settlementRevision','status','beforeRevision','before'])
      check(typeof settlement.settlementRevision==='string' && typeof settlement.beforeRevision==='string' && (settlement.afterRevision===undefined || typeof settlement.afterRevision==='string'),'$.settlementRevision')
      for (const key of ['before','after']) if (settlement[key]!==undefined) shape(settlement[key],Object.keys(settlement[key] || {}),[],'$.'+key)
      return prepared.contexts.filter(value=>current(value) && value.turn===settlement.turn && equal(value.source,settlement.source)).map(value=>{
        const reads=library.snapshot().mods[value.modId].manifest.permissions.variables?.reads || []
        const project=slots=>Object.fromEntries(reads.filter(row=>Object.hasOwn(slots || {},row.id)).map(row=>[row.id,slots[row.id]]))
        return runtime.invoke(issue(context({...value,settlementRevision:settlement.settlementRevision},value.modId)),'settled',{
          ...settlement,before:project(settlement.before),after:project(settlement.after),...(settlement.bindings?{bindings:project(settlement.bindings)}:{}),
          ...(settlement.performances?{performances:settlement.performances.filter(row=>row.modId===value.modId && equal(row.source,value.source))}:{})})
      })
    },
    dispose() {active=false;runtime.dispose();issued.clear();prepareCalls.clear()},
  })
}
