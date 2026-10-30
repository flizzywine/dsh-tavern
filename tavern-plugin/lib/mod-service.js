import {channel} from 'node:diagnostics_channel'
const readTiming=channel('dsh.mod.read')
async function timedRead(name,task) {
  const start=performance.now()
  try {return await task()} finally {if(readTiming.hasSubscribers)readTiming.publish({name:'mod.'+name,durationMs:performance.now()-start})}
}
import {createModModelTasks} from './domain/mods/models.js'
import {timerCatalogueFragments} from '../mods/timer/catalogue.js'
import {createSettledModSource} from './mod-source.js'
import {createModSessionEvents} from './mod-events.js'
import {createModEventCatalogue} from './mod-event-catalogue.js'
import {isDeepStrictEqual as equal} from 'node:util'
import {managedExecutionView} from './mod-system-execution.js'
import {createFirstPartyMods} from './mod-builtins.js'
import {createLibraryModMedia} from './mod-media.js'
import {createModPerformanceMedia} from './domain/mods/performance-media.js'
import {createModHostRuntime} from './mod-runtime.js'
import {createModVariablePort} from './mod-variables.js'
import {compileModPrompts} from './domain/mods/prompts.js'
import {modCatalogue,modAssetCatalogue,modTurnActive,modJudgeQuestions} from './domain/mods/catalogue.js'
import {selectModAdmission,modKeepFragments} from './domain/mods/relevance.js'
import {phoneSourceView} from '../mods/phone/source-view.js'
import {phoneDevices} from '../mods/phone/logic.js'
import {modReadBindings,projectModReadSlots} from './domain/mods/variable-slots.js'
import {captureStageTarget} from './domain/stage-incremental.js'
import {createModStageCorrections,admitModSettlement} from './domain/mods/stage-corrections.js'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check,modShape:shape,modFreeze,modResultError}=contract
export const MOD_MANAGEMENT_METHODS=Object.freeze(['listMods','getMod','listModPacks','saveModSettings','readModMedia'])
const messageAt=(chat,turn)=>chat.messages.findLast(row=>row?.role==='assistant' && Number(row.turn || (row.greeting?1:0))===turn)
const sourceValue=message=>[message.swipeId || 0,message.stageDirectionGeneration || 0,message.sourceText ?? message.text]
// Installed grammar is resource data, not an executable hook. Disabled or
// unloading plugins must not gate the core director's frozen tool schema.
const installedCommands=snapshot=>Object.values(snapshot.mods).flatMap(({manifest})=>
  manifest.commands.map(command=>({...command,modId:manifest.id}))
).sort((a,b)=>a.op<b.op?-1:a.op>b.op?1:0)

// First-party-only composition. Archive/transfer code deliberately does not enter this graph.
export function createBuiltinModService({workbenchAuthority,root,management,readCard,engineJudge,variables,coreCommands=[],onChange=()=>{},onError=()=>{},onLog=()=>{},stage,config,coreMedia,connected,models,assetSnapshot,readAssetText,publishView,builtins=createFirstPartyMods({host:management.modHost})}) {
  let service,library,runtime,sessionEvents,settledSource,performanceMedia,libraryMedia,dirty=true,active=true,epoch=0,tail=Promise.resolve()
  const modelTasks=models?createModModelTasks(models):null
  const eventCatalogue=assetSnapshot?createModEventCatalogue({snapshot:assetSnapshot,builtinPacks:async()=>(await builtins).assetPacks?.() || []}):null
  let grammarRevision,grammarCommands
  const proofs=new Map(),prepared=new Map(),settlements=new Map(),notified=new WeakMap(),commands=new WeakMap(),recovering=new Set(),correcting=new Map()
  const corrections=stage?createModStageCorrections({...stage,log:onLog}):null
  const deliveryLog=(context,command,phase,error)=>onLog({kind:'mod-delivery',sessionId:context.gameId,turn:context.turn,
    sourceKey:context.source.sourceKey,generation:context.source.generation,modId:context.modId,key:command.key,commandId:command.commandId,at:command.at,phase,
    ...(error?{error:{code:error.code || 'MOD_RUNTIME_FAILED',message:String(error.message),...(error.path?{path:error.path}:{})}}:{})})
  const current=context=>{
    const proof=proofs.get(context.gameId)
    return active && !dirty && proof?.active===true && proof.key===context.source.sourceKey && proof.branchId===context.source.branchId && proof.turn===context.turn && proof.value[1]===context.source.generation
  }
  const proofFor=(context,isCurrent)=>{
    check(isCurrent() && current(context),'$.source','Mod source changed','MOD_SOURCE_STALE')
    return proofs.get(context.gameId)
  }
  function accepted(context,isCurrent) {
    const receipt=proofFor(context,isCurrent).commands.get(context.command?.key)
    check(receipt && receipt.modId===context.modId && receipt.commandId===context.command?.commandId && receipt.at===context.command.at,'$.command','A sealed director command is required','MOD_PERMISSION_DENIED')
    return receipt
  }
  const sourcePort={window:async(context,args,isCurrent)=>{
    proofFor(context,isCurrent)
    check(settledSource,'$.source','Settled Timeline source is unavailable','MOD_RESOURCE_UNAVAILABLE')
    return settledSource.window(context,args)
  }}
  const stagePort=corrections?{
    async place(context,args,isCurrent) {
      // a placed kind must be one the mod declared with its backlog and replay (manifest.performances).
      const declared=management.modHost.manifests().find(manifest=>manifest.id===context.modId)?.performances
      check(declared?.some(row=>row.kind===args?.kind),'$.kind','Declare performance kind '+JSON.stringify(args?.kind)+' in manifest.performances with its backlog and replay','MOD_PERMISSION_DENIED')
      if(context.modId!=='dsh.phone') {
        const result=await corrections.place(context,args,isCurrent)
        deliveryLog(context,context.command,'persisted')
        return result
      }
      const receipt=accepted(context,isCurrent)
      check(receipt.source==='phone.message' && args.id==='message' && args.kind==='dsh.phone.message' && equal(args.payload?.marker,{op:'phone.message',...receipt.params}) &&
        phoneDevices(context.catalogue).some(ref=>equal(ref,args.payload?.device)),'$.payload','Phone presentation must reference its admitted source mark','MOD_PERMISSION_DENIED')
      return {accepted:true,at:receipt.at}
    },
    reviseAfterSettlement:corrections.reviseAfterSettlement,
    state:{
      async get(context,isCurrent) {
        const proof=proofFor(context,isCurrent)
        return structuredClone(context.command ? accepted(context,isCurrent).state : proof.stageState?.[context.modId] || {})
      },
      async propose(context,patch,isCurrent) {
        const receipt=accepted(context,isCurrent)
        // The canonical transaction already persisted this patch with the sealed prefix.
        check(receipt.patch && equal(receipt.patch,patch),'$.state','Only the admitted state patch may be acknowledged','MOD_PERMISSION_DENIED')
        return {accepted:true,state:structuredClone(receipt.state)}
      },
    },
  }:undefined
  async function sourceCurrent(context,head) {
    if(context.sessionEvent)return sessionEvents.sourceCurrent(context,head)
    const proof=proofs.get(context.gameId)
    if(!current(context) || !head || head.timeline.branchId!==context.source.branchId)return false
    const at=head.messages.findLastIndex(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===context.turn)
    if(at<0)return false
    const page=await variables.readWindow(head.id,{limit:1,before:at+1,revision:head._storageRevision})
    return page?.revision===head._storageRevision && equal(sourceValue(page.chat.messages[0]),proof.value)
  }
  function invalidate() {epoch++;dirty=true;runtime?.dispose();sessionEvents?.dispose();modelTasks?.invalidate();eventCatalogue?.clear();prepared.clear();onChange()}
  let writingSettings=false,settingsNotified=false
  const unsubscribe=management.settings.subscribe(()=>{if(writingSettings)settingsNotified=true;else invalidate()})
  const unregister=management.modHost.subscribe(invalidate)
  async function open() {
    check(active,'$','Mod service is disposed','MOD_RESOURCE_UNAVAILABLE')
    if(!dirty)return
    const builtin=await builtins
    library=await managedExecutionView({management,builtins:builtin})
    dirty=false
    const variablePort=createModVariablePort({...variables,sourceCurrent,prepareCommit:input=>service.variableCommit(input),onError})
    settledSource=variables && stage?.source?createSettledModSource({...variables,source:stage.source}):null
    sessionEvents=variables && stage?.source?createModSessionEvents({library,builtins:builtin,readCard,config,...variables,source:stage.source,
      variables:()=>variablePort,epoch:()=>epoch,connected,onError,modelTasks,readAssetText,presentation:stage.presentation,
      catalogues:eventCatalogue?.read,publishView,modelStatus:async(manifest,sessionId)=>Object.fromEntries(await Promise.all((manifest.modelSlots || []).map(async slot=>{
        if(models?.describe)return [slot.id,await models.describe({modId:manifest.id,slotId:slot.id,sessionId,slot})]
        try {const chosen=await models?.select({modId:manifest.id,slotId:slot.id,sessionId,slot});return [slot.id,{selection:'follow-foreground',provider:chosen?.provider || null,model:chosen?.model || null,label:chosen?.model || slot.label,available:!!chosen?.provider && !!chosen?.model}]}
        catch{return [slot.id,{selection:'follow-foreground',provider:null,model:null,label:slot.label,available:false}]}
      })))}):null
    runtime=createModHostRuntime({library,builtins:builtin,engineJudge,sourceCurrent:current,coreCommands,
      readText:async(id,name)=>builtin.file(library.snapshot().mods[id].origin?.builtinId || id,name)?.toString('utf8'),
      variablePort,stagePort,sourcePort,
    })
    const media=libraryMedia=createLibraryModMedia({root,library,builtins:builtin}),mediaEpoch=epoch
    performanceMedia=stage?.readPresentation?createModPerformanceMedia({library,media,coreMedia,readPresentation:stage.readPresentation,isCurrent:()=>active && !dirty && epoch===mediaEpoch}):null
  }
  function run(task,name='service') {
    const queued=performance.now()
    const result=tail.then(async()=>{
      if(readTiming.hasSubscribers)readTiming.publish({name:'mod.'+name+'.queue',durationMs:performance.now()-queued})
      await timedRead(name+'.open',open)
      return timedRead(name+'.read',task)
    })
    tail=result.catch(()=>{});return result
  }
  async function readSnapshot(name,task,source) {
    // Capture only immutable library authority on the serial lane. Files/config
    // are read outside it; no result survives a changed owner, event epoch or source.
    const captured=await run(()=>({owner:library,view:library.readSnapshot(),epoch}),name+'.capture')
    const valid=()=>check(active && !dirty && library===captured.owner && epoch===captured.epoch &&
      library.snapshot()===captured.view.snapshot(),'$.revision','Mod read authority changed','MOD_SOURCE_STALE')
    const result=await timedRead(name+'.read',()=>task(captured.view))
    if(source && result.length)await timedRead(name+'.validateSource',source)
    valid()
    return result
  }
  function catalogueViews(cardId,manifests,text,judgeRecall,assetCatalogue) {
    return Object.fromEntries(manifests.map(manifest=>[manifest.id,manifest.admission.entryKinds.some(kind=>['props','performances','audience','timers'].includes(kind))
      ? modAssetCatalogue(manifest,assetCatalogue)
      : modCatalogue(manifest,library.getMod({modId:manifest.id,cardId}).packs,library.listModPacks({modId:manifest.id,cardId}).packs,text,judgeRecall)]))
  }
  function catalogue(catalogues,settingsByMod) {
    return Object.entries(catalogues).filter(([modId])=>library.snapshot().mods[modId].manifest.prompts.some(row=>row.target==='director') || library.snapshot().mods[modId].manifest.commands.length).flatMap(([modId,view])=>modId==='dsh.timer' ? timerCatalogueFragments(view) : view.recalled.filter(ref=>view.packs.find(pack=>pack.id===ref.packId)?.scope!=='builtin').map(ref=>{
      const id=ref.assetId ?? ref.entryId,entry=view.packs.find(pack=>pack.id===ref.packId).entries.find(row=>row.id===id)
      return {modId,id:ref.packId+'.'+id,type:'catalogue',source:'library',placement:{section:'director.catalogue',order:0},
        text:JSON.stringify({ref,name:entry.name,...(entry.performanceLevels?{levels:entry.performanceLevels,default:entry.performanceDefault}:{}),...(entry.directorNote?{directorNote:entry.directorNote}:{})})}
    }))
  }
  async function correct(snapshot) {
    if(!corrections)return
    for(const value of snapshot.contexts) {
      if(!current(value))continue
      const key=JSON.stringify([value.gameId,value.modId,value.source,value.authority])
      if(correcting.has(key)) {correcting.get(key).again=true;continue}
      const flight={again:false};correcting.set(key,flight)
      try {
        do {
          flight.again=false
          const settlement=await corrections.pending(value)
          if(!settlement || !current(value))break
          const only={...snapshot,contexts:[value]}
          for(const task of runtime.settled(only,settlement)) {
            const result=await task
            if(!result.ok)onError(result.error)
          }
        } while(flight.again)
      } catch(error) {onError(error)} finally {correcting.delete(key)}
    }
  }
  function notify(snapshot,fact) {
    if(!snapshot?.contexts || !fact || notified.get(snapshot)===fact.revision)return
    const context=snapshot.contexts[0],proof=proofs.get(context.gameId)
    if(!current(context) || !equal(fact.identity,[proof.branchId,proof.turn,...proof.value]))return
    notified.set(snapshot,fact.revision)
    // Each mod owns its read IDs; project separately rather than merging same-named slots.
    for(const value of snapshot.contexts) {
      const manifest=snapshot.manifests.find(row=>row.id===value.modId),only={...snapshot,contexts:[value],manifests:[manifest]}
      const bindings=fact.bindings?.[manifest.id] || {},slots=sources=>projectModReadSlots(manifest,bindings,sources)
      const settlement={source:value.source,turn:value.turn,status:'ok',settlementRevision:fact.revision,
        beforeRevision:fact.beforeRevision,afterRevision:fact.revision,before:slots(fact.before),after:slots(fact.after),bindings}
      if(corrections && manifest.permissions.stage.includes('reviseAfterSettlement')) {
        void corrections.settlement(value,settlement,()=>current(value),Number(fact.revision)).then(()=>correct(only)).catch(onError)
      } else for(const task of runtime.settled(only,settlement))void task.then(result=>{if(!result.ok)onError(result.error)}).catch(onError)
    }
  }
  return service=Object.freeze({invalidate,
    assetsChanged(){eventCatalogue?.clear();sessionEvents?.refresh()},
    installBuiltinAssets:owner=>run(async()=>{for(const pack of (await builtins).assetPacks?.() || [])await owner.ensureBuiltinPack(pack)}),
    stageViews(sessionId,authority) {
      check(typeof authority?.origin==='string','$.origin','Same-origin stage authority required','MOD_PERMISSION_DENIED')
      return run(()=>sessionEvents?.views(sessionId) || {views:[]})
    },
    // Only enabled installed mods contribute rows to the shared model settings.
    modelSlots:()=>run(()=>library.active().flatMap(manifest=>(manifest.modelSlots || []).map(slot=>({...slot,modId:manifest.id,modName:manifest.name})))),
    presentation(sessionId,input,authority) {
      check(typeof authority?.origin==='string','$.origin','Same-origin stage authority required','MOD_PERMISSION_DENIED')
      return run(()=>sessionEvents?.presentation(sessionId,input) || {accepted:true})
    },
    stageEvent(sessionId,event) {return run(()=>sessionEvents?.stageEvent(sessionId,event))},
    // A first-party mod's declared image files (manifest builtinAssets type image) as data URLs; e.g. dsh.timer's looks.
    async builtinImages(modId) {
      const builtin=await builtins,manifest=builtin.manifest(modId),files=builtin.files(modId)
      return Object.fromEntries(manifest.builtinAssets.filter(row=>row.type==='image').map(row=>[row.id,'data:image/'+(row.path.endsWith('.svg')?'svg+xml':row.path.split('.').pop())+';base64,'+files.get(row.path).toString('base64')]))
    },
    disconnected(ids) {sessionEvents?.disconnected(ids)},
    async eventsIdle(){await tail;await sessionEvents?.idle()},
    manifests:()=>run(()=>Object.values(library.snapshot().mods).map(row=>row.manifest)),
    // The registered managed mods' declared stage performance kinds (stage-performance-kinds.cjs), for the 履历.
    performanceKinds:()=>management.modHost.manifests().map(manifest=>({owner:manifest.id,performances:manifest.performances})),
    readPerformanceMedia(input,authority) {
      check(typeof authority?.origin==='string','$.origin','Same-origin stage authority required','MOD_PERMISSION_DENIED')
      return run(()=>{check(performanceMedia,'$','Stage media unavailable','MOD_RESOURCE_UNAVAILABLE');return performanceMedia(input)}).catch(error=>{const value=modResultError(error).error;throw Object.assign(new Error(value.message),value)})
    },
    call(method,args,authority) {
      check(MOD_MANAGEMENT_METHODS.includes(method),'$.method','Management method is unavailable','MOD_API_UNSUPPORTED')
      check(typeof authority?.origin==='string' || !!workbenchAuthority && authority===workbenchAuthority,'$.origin','Same-origin or workbench management required','MOD_PERMISSION_DENIED')
      return run(async()=>{
        if(method==='readModMedia') {
          const file=library.snapshot().mods[args.modId]?.packs[args.packId]?.files.find(row=>row.path===args.path)
          check(file,'$.path','Media is not part of this pack','MOD_RESOURCE_UNAVAILABLE')
          return libraryMedia.read(args.modId,args.packId,args.path,file.size)
        }
        if(method!=='saveModSettings')return library[method](args)
        writingSettings=true;settingsNotified=false
        try {
          const result=await library.saveModSettings(args),changes=library.presentationChanged(management.settings.read())
          if(changes)sessionEvents?.presentationSettings(changes)
          else invalidate()
          settingsNotified=false
          return result
        } finally {
          writingSettings=false
          if(settingsNotified)invalidate()
        }
      })
    },
    readPhonePresentation({chat,direction,at,view}) {
      const target=direction.target || (direction.record || direction.preview)?.binding?.target
      const validateSource=async()=>{
        if(!stage?.source)return
        const message=messageAt(chat,target.turn)
        check(message,'$.source','Phone source is unavailable','MOD_SOURCE_STALE')
        const expected=captureStageTarget(chat,chat.messages.lastIndexOf(message))
        const current=await stage.source(chat.sessionId,target.turn,{branchId:expected.branchId,value:sourceValue(message)})
        check(current.sourceKey===expected.sourceKey,'$.source','Phone source changed','MOD_SOURCE_STALE')
        const head=await variables.index(chat.sessionId)
        check(head?._storageRevision===chat._storageRevision && head.timeline.branchId===expected.branchId,'$.revision','Phone source revision changed','MOD_SOURCE_STALE')
      }
      return readSnapshot('sources',async library=>{
      const card=await readCard(chat.cardPath),manifest=card && library.active(card.meta.id).find(row=>row.id==='dsh.phone')
      const record=direction.record || direction.preview
      view ||= record?.binding.mods?.sourceViews?.phone
      if(!manifest || !record || at>direction.through)return []
      const catalogue=modCatalogue(manifest,library.getMod({modId:manifest.id,cardId:card.meta.id}).packs,library.listModPacks({modId:manifest.id,cardId:card.meta.id}).packs,'')
      const snapshot=await config.managedRequest(chat),builtin=await builtins
      const declaration=management.modHost.manifests().find(row=>row.id===manifest.id)
      return management.modHost.render(snapshot,manifest.id,{catalogue,view},{assets:{
        core:async id=>builtin.file(manifest.id,declaration.coreAssets.find(row=>row.id===id).path),
        resolve:management.assetReader({manifest:declaration,values:snapshot.config[manifest.id].values}),
        // an uploaded picture a setting names ({file}), read from the layer that supplied it.
        async upload(key) {
          const own=await config.resolved(manifest.id,card,chat),file=own.values[key]?.file,layer=own.layers?.[key]
          if(!file || !['card','global'].includes(layer))return null
          const read=await config.readFile({modId:manifest.id,layer,cardId:card.meta.id,path:file})
          return {kind:'image',identity:manifest.id+':'+layer+':'+file,url:'data:'+read.file.mime+';base64,'+read.data}
        },
      }})
    },validateSource)},
    enabled:cardPath=>readSnapshot('enabled',async library=>{const card=await readCard(cardPath);return !!card && library.active(card.meta.id).length>0}),
    observe(chat,{metadataOnly=false}={}) {
      try {if(!dirty)sessionEvents?.observe(chat);else void run(()=>sessionEvents?.observe(chat)).catch(onError)}catch(error){onError(error)}
      const proof=proofs.get(chat.sessionId)
      if(!proof)return
      const message=messageAt(chat,proof.turn)
      if(chat.timeline?.branchId!==proof.branchId || !metadataOnly && (!message || !equal(sourceValue(message),proof.value)))proof.active=false
    },
    // memo: a caller-owned Map; calls sharing it and the same chat read settings and bindings once.
    prepare(chat,turn,{target,preview=false,isCurrent=()=>true,judgeRecall,stageState,assetCatalogue,streamSource,memo}) {return run(async()=>{
      const card=await readCard(chat.cardPath),enabled=card ? library.active(card.meta.id) : []
      const installed=library.snapshot(),builtin=await builtins
      const memoKey=JSON.stringify([chat.sessionId,card?.meta.id,installed.revision,enabled.map(manifest=>manifest.id)])
      const once=(name,read)=>{
        if(!memo)return read()
        if(!memo.has(name+memoKey))memo.set(name+memoKey,read().catch(error=>{memo.delete(name+memoKey);throw error}))
        return memo.get(name+memoKey)
      }
      const enabledAssetKinds=[...new Set(enabled.flatMap(manifest=>manifest.admission.entryKinds).filter(kind=>['props','performances','audience','timers'].includes(kind)))]
      const revision=JSON.stringify(Object.entries(installed.mods).map(([id,row])=>[id,row.releaseRevision]).sort(([a],[b])=>a<b?-1:a>b?1:0))
      if(revision!==grammarRevision) {grammarCommands=modFreeze(installedCommands(installed));grammarRevision=revision}
      const schemaCommands=grammarCommands
      if(!enabled.length)return schemaCommands.length ? modFreeze({revision:installed.revision,manifests:[],contexts:[],commands:[],schemaCommands,grammarRevision,enabledAssetKinds,capabilities:library.capabilities([],card?.meta.id),fragments:[],judgeQuestions:[]}) : null
      const settingsByMod=await once('settings',async()=>Object.fromEntries(await Promise.all(enabled.map(async manifest=>[manifest.id,card && config?await config.resolved(manifest.id,card,chat):library.getMod({modId:manifest.id,cardId:card?.meta.id}).settings]))))
      const message=messageAt(chat,turn),key=target.sourceKey,version=installed.revision
      // In-flight previews may inspect only an admitted body operation, never execute mod hooks.
      const body=streamSource && chat.timeline?.operations?.[streamSource.operationId]
      check(isCurrent() && (streamSource ? preview && body?.kind==='body' && body.status==='running' && Number(body.turn)===turn : message),'$.source','Director source changed','MOD_SOURCE_STALE')
      if(!preview)eventCatalogue?.remember(chat.sessionId,key,assetCatalogue)
      const cacheKey=JSON.stringify([chat.sessionId,key,version,[...(judgeRecall || [])].sort(),stageState,assetCatalogue?.revisions,assetCatalogue?.candidates.props,assetCatalogue?.candidates.performances,assetCatalogue?.candidates.audience,assetCatalogue?.candidates.timers])
      // a preview names each mod by its registered display name (提示词 › 模组 labels).
      const names=Object.fromEntries(enabled.map(manifest=>[manifest.id,installed.mods[manifest.id].name]))
      if(preview && prepared.has(cacheKey) && !prepared.get(cacheKey).restored)return modFreeze({...prepared.get(cacheKey),names})
      const catalogues=catalogueViews(card.meta.id,enabled,streamSource ? streamSource.text : message.sourceText ?? message.text,judgeRecall,assetCatalogue)
      const judgeQuestions=enabled.flatMap(manifest=>manifest.admission.entryKinds.some(kind=>['props','performances','audience','timers'].includes(kind)) ? [] : modJudgeQuestions(manifest,catalogues[manifest.id]))
      const selection=selectModAdmission(enabled,catalogues)
      const selectedModIds=selection.mods.filter(row=>row.selected).map(row=>row.id)
      const bindings=await once('bindings',async()=>Object.fromEntries(await Promise.all(enabled.map(async manifest=>[manifest.id,config?await config.bindings(manifest,card,chat):modReadBindings(manifest,card.raw || card)]))))
      const configured=runtime.configure({cardId:card.meta.id,catalogues,bindings,settingsByMod,selectedModIds})
      const manifests=enabled.filter(manifest=>selectedModIds.includes(manifest.id) && modTurnActive(manifest,catalogues[manifest.id]) && (!manifest.commands.length || configured.some(command=>command.modId===manifest.id)))
      for(const row of selection.mods)if(row.selected && !manifests.some(manifest=>manifest.id===row.id)){row.selected=false;row.reason=null}
      const capabilities=library.capabilities(manifests.map(manifest=>manifest.id),card?.meta.id)
      const keep=modKeepFragments(enabled,selection,stageState)
      for(const fragment of keep)selection.mods.find(row=>row.id===fragment.modId).persistent=true
      if(!manifests.length)return modFreeze({revision:version,manifests:[],contexts:[],commands:[],schemaCommands,grammarRevision,enabledAssetKinds,capabilities,fragments:keep,judgeQuestions,selection,...(preview?{names}:{})})
      const activeCatalogues=Object.fromEntries(manifests.map(manifest=>[manifest.id,catalogues[manifest.id]]))
      const sourceViews=activeCatalogues['dsh.phone'] ? {phone:phoneSourceView(activeCatalogues['dsh.phone'])} : {}
      // Preview never executes a module or makes a model/variable write request.
      if(preview) {
        return modFreeze({revision:version,manifests,commands:configured,validateCommand:runtime.validateCommand,schemaCommands,grammarRevision,enabledAssetKinds,capabilities,judgeQuestions,sourceViews,names,selection,fragments:[...keep,...compileModPrompts(manifests,(id,name)=>builtin.file(library.snapshot().mods[id].origin?.builtinId || id,name).toString('utf8'),'director',configured),...catalogue(activeCatalogues,settingsByMod)]})
      }
      proofs.set(chat.sessionId,{key,turn,branchId:target.branchId,value:sourceValue(message),active:true,
        stageState:stageState && modFreeze(structuredClone(stageState)),commands:new Map()})
      while(proofs.size>64)proofs.delete(proofs.keys().next().value)
      const ownEpoch=epoch,host=runtime
      // Release the management queue before invoking code; disabling remains immediate.
      return async()=>{
        const result=await host.prepare({cardId:card.meta.id,gameId:chat.sessionId,turn,
          source:{branchId:target.branchId,sourceKey:key,generation:message.stageDirectionGeneration || 0,textVersion:key},authorityEpoch:ownEpoch,catalogueRevision:version,catalogues,bindings,settingsByMod,selectedModIds})
        check(ownEpoch===epoch && isCurrent(),'$.source','Director source changed','MOD_SOURCE_STALE')
        const snapshot=modFreeze({...result,revision:version,schemaCommands,grammarRevision,enabledAssetKinds,capabilities,judgeQuestions,sourceViews,selection,fragments:[...keep,...result.fragments,...catalogue(activeCatalogues,settingsByMod)]})
        prepared.set(cacheKey,snapshot);while(prepared.size>64)prepared.delete(prepared.keys().next().value)
        queueMicrotask(()=>{try {notify(snapshot,settlements.get(chat.sessionId));void correct(snapshot)}catch(error){onError(error)}})
        return snapshot
      }
    }).then(value=>typeof value==='function'?value():value)},
    async variableCommit({before,after,messageId}) {
      try {
        const message=before.messages[messageId],swipe=message.swipeId || 0
        const target={messageId,message,variables:message.variables[swipe]},result={receipt:{status:'updated'},variables:after.messages[messageId].variables[swipe]}
        const capture=await service.captureSettlement(before,target,result)
        capture?.(after)
        return revision=>{void service.settled(before,{...after,_storageRevision:revision},target,result).catch(onError)}
      } catch(error) {onError(error);return null}
    },
    async captureSettlement(before,target,result) {
      if(!stage || !target || !['updated','unchanged'].includes(result?.receipt?.status) || !result.variables)return null
      await run(()=>null)
      const card=await readCard(before.cardPath),manifests=card?library.active(card.meta.id).filter(row=>row.permissions.stage.includes('reviseAfterSettlement')):[]
      if(!manifests.length)return null
      const turn=Number(target.message.turn || 1),source=await stage.source(before.sessionId,turn,{branchId:before.timeline.branchId,value:sourceValue(target.message)})
      const ownEpoch=epoch,grants=new Map(manifests.map(row=>[row.id,library.authority(row.id,card.meta.id)]))
      const beforeSources={mvu:{available:true,value:structuredClone(target.variables?.stat_data || {})},'helper-chat':{available:true,value:structuredClone(before.variables || {})}}
      const configuredBindings=Object.fromEntries(await Promise.all(manifests.map(async manifest=>[manifest.id,config?await config.bindings(manifest,card,before,beforeSources):modReadBindings(manifest,card.raw || card)])))
      return draft=>{
        if(!active || dirty || ownEpoch!==epoch || draft.timeline.branchId!==source.branchId)return
        const message=Number.isSafeInteger(target.messageId)?draft.messages[target.messageId]:messageAt(draft,turn)
        if(!message || !equal(sourceValue(message),sourceValue(target.message)))return
        const afterSources={mvu:{available:true,value:structuredClone(result.variables.stat_data || {})},'helper-chat':{available:true,value:structuredClone(draft.variables || {})}}
        const revision=String(draft._storageRevision+1)
        for(const manifest of manifests) {
          if(library.authority(manifest.id,card.meta.id)!==grants.get(manifest.id))continue
          const bindings=configuredBindings[manifest.id],slots=sources=>projectModReadSlots(manifest,bindings,sources)
          const next=admitModSettlement(message.modCorrections,{modId:manifest.id,source},{source,turn,status:'ok',settlementRevision:revision,
            beforeRevision:String(before._storageRevision),afterRevision:revision,before:slots(beforeSources),after:slots(afterSources),bindings},Number(revision))
          if(next){next.revision++;message.modCorrections=next}
        }
      }
    },
    async settled(before,after,target,result) {
      sessionEvents?.settlement(before.sessionId,{revision:String(after?._storageRevision || before._storageRevision),status:result?.receipt?.status || 'skipped',turn:Number(target.message.turn || 1)})
      if(!['updated','unchanged'].includes(result?.receipt?.status)) {onLog({code:'MOD_SETTLEMENT_IGNORED',status:result?.receipt?.status || 'skipped'});return}
      if(!active || !after || !result.variables)return
      await run(()=>null)
      const card=await readCard(before.cardPath)
      if(!card || !library.active(card.meta.id).length)return
      const sources=(mvu,helper)=>({mvu:{available:true,value:mvu?.stat_data || {}},'helper-chat':helper===undefined?{available:false}:{available:true,value:helper}})
      const fact=modFreeze({identity:[before.timeline.branchId,Number(target.message.turn || 1),...sourceValue(target.message)],
        revision:String(after._storageRevision),beforeRevision:String(before._storageRevision),bindings:Object.fromEntries(await Promise.all(library.active(card.meta.id).map(async manifest=>[manifest.id,config?await config.bindings(manifest,card,before,sources(structuredClone(target.variables),structuredClone(before.variables))):modReadBindings(manifest,card.raw || card)]))),
        before:sources(structuredClone(target.variables),structuredClone(before.variables)),after:sources(structuredClone(result.variables),structuredClone(after.variables))})
      settlements.set(before.sessionId,fact);while(settlements.size>64)settlements.delete(settlements.keys().next().value)
      if(corrections) {
        const turn=Number(target.message.turn || 1)
        const source=await stage.source(before.sessionId,turn,{branchId:before.timeline.branchId,value:sourceValue(target.message)})
        for(const manifest of library.active(card.meta.id).filter(row=>row.permissions.stage.includes('reviseAfterSettlement'))) {
          const authority=library.authority(manifest.id,card.meta.id),ownEpoch=epoch
          const context={modId:manifest.id,cardId:card.meta.id,gameId:before.sessionId,turn,source}
          const bindings=fact.bindings[manifest.id],slots=sources=>projectModReadSlots(manifest,bindings,sources)
          await corrections.settlement(context,{source:context.source,turn,status:'ok',settlementRevision:fact.revision,
            beforeRevision:fact.beforeRevision,afterRevision:fact.revision,before:slots(fact.before),after:slots(fact.after),bindings},
            ()=>active && !dirty && ownEpoch===epoch && library.authority(manifest.id,card.meta.id)===authority,Number(fact.revision))
        }
      }
      queueMicrotask(()=>{for(const snapshot of prepared.values())try {if(snapshot.contexts?.[0]?.gameId===before.sessionId)notify(snapshot,fact)}catch(error){onError(error)}})
    },
    command:(snapshot,input)=>runtime.command(snapshot,input),
    applied(snapshot,effect) {
      if(!snapshot)return
      let seen=commands.get(snapshot);if(!seen)commands.set(snapshot,seen=new Set())
      // A sealed checkpoint is already playable. Neither command nor correction awaits the director.
      void (async()=>{for(const [entryIndex,{at,ops,state}] of effect.entries.entries())for(const [ordinal,op] of ops.entries())if(op.op==='mod.command') {
        const key=JSON.stringify([entryIndex,ordinal])
        if(seen.has(key))continue
        const context=snapshot.contexts.find(row=>row.modId===op.modId),identity={key,at,commandId:op.commandId}
        const logContext=context || {...snapshot.contexts[0],modId:op.modId}
        deliveryLog(logContext,identity,'accepted')
        if(!context || !current(context)) {
          deliveryLog(logContext,identity,'skipped',{code:'MOD_SOURCE_STALE',message:context?'Command source is no longer current':'Command context is unavailable'})
          continue
        }
        seen.add(key)
        try {
          const command=snapshot.commands.find(row=>row.modId===op.modId && row.id===op.commandId),change=command.admission?.state
          const patch=change?.choices.find(row=>row.value===op.params[change.parameter])?.patch
          proofs.get(context.gameId).commands.set(key,{modId:op.modId,commandId:op.commandId,at,params:op.params,source:command.admission?.source,patch,state:state?.modState?.[op.modId] || {}})
          deliveryLog(context,identity,'applied')
          const result=await runtime.command(snapshot,op,{key,at})
          if(!result.ok){deliveryLog(context,identity,'failed',result.error);onError(result.error)}
          else if(op.modId==='dsh.phone')deliveryLog(context,identity,'source-mark')
        } catch(error) {deliveryLog(context,identity,'failed',error);throw error}
        void correct(snapshot)
      }})().catch(error=>onError(error))
    },
    recover(chat,turn) {
      const message=messageAt(chat,turn),id=JSON.stringify([chat.sessionId,turn])
      if(!corrections || !message?.modCorrections || recovering.has(id) || turn!==Math.max(...chat.messages.filter(row=>row.role==='assistant').map(row=>Number(row.turn || 1))))return
      if([...prepared.values()].some(row=>row.contexts?.[0]?.gameId===chat.sessionId && row.contexts[0].turn===turn))return
      recovering.add(id)
      queueMicrotask(()=>{void (async()=>{
        const target=captureStageTarget(chat,chat.messages.indexOf(message))
        if(message.modCorrections.source.sourceKey!==target.sourceKey || message.modCorrections.source.generation!==(message.stageDirectionGeneration || 0))return
        const snapshot=await run(async()=>{
          const cacheKey=JSON.stringify([chat.sessionId,target.sourceKey,library.snapshot().revision,[]])
          if(prepared.has(cacheKey))return prepared.get(cacheKey)
          const card=await readCard(chat.cardPath)
          if(!card)return null
          proofs.set(chat.sessionId,{key:target.sourceKey,turn,branchId:target.branchId,value:sourceValue(message),active:true})
          // Recovery reauthorizes persisted intentions, never reruns prepare/command (or judge/model work).
          const value=runtime.restore({cardId:card.meta.id,gameId:chat.sessionId,turn,source:message.modCorrections.source,
            authorityEpoch:epoch,catalogueRevision:library.snapshot().revision})
          if(value){prepared.set(cacheKey,value);while(prepared.size>64)prepared.delete(prepared.keys().next().value)}
          return value
        })
        if(snapshot)await correct(snapshot)
      })().catch(onError).finally(()=>recovering.delete(id))})
    },
    dispose() {active=false;runtime?.dispose();sessionEvents?.dispose();modelTasks?.dispose();unsubscribe();unregister();proofs.clear();prepared.clear();settlements.clear()},
  })
}
