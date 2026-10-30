// 舞台、导演与 mod：托管 mod 的安装与配置、mod 服务、舞台导演。它们由核心创建一次，
// 只通过 `core` 里列出的这些能力读写存档、调用模型、发信号；核心反过来只用返回的四个对象。
import {createBuiltinModService} from './mod-service.js'
import {createManagedModProduction} from './mod-system-production.js'
import {resolveBoundConfig} from './domain/mod-system.js'
import {createModConfigHost,createModConfigStageReader} from './mod-config-host.js'
import {createModConfigFiles} from './mod-config.js'
import {createModStagePort} from './mod-stage.js'
import {createModCoreMedia} from './domain/mods/core-media.js'
import {createModelStreamTiming} from './domain/mods/models.js'
import {managedConfigStore} from './mod-system-execution.js'
import {createStageDirector} from './domain/stage-director.js'
import {normalizeResourcePath} from './domain/file-resources.js'
import directorCommands from '../packages/dsh-presentation-protocol/src/director-commands.cjs'

// cardsActive(): false once the plugin is disposed; card writes are refused from then on.
export async function createStageModule(core) {
  const {ctx, dataRoot, containStage, cardsActive, llm, requestPerformance, sessionSignals, coordinationEvents, fileResources, cardPreparation, cardStorage, cardStage, cardPlugins, bumpCardProjectionRevision, syncCardName, readChat, readChatCard, readStageChat, readRoundView, chatForSession, chatPersistence, chatJournalStore, rawUpdateChat, updateChat, updateChatMessage, patchChat, storyTimeline, replyDisplayForChat, sessionActivity, assetRuntime, assetEngineSettings, engineJudge, modelSelection, resolveSlot, readTavernSettings, callModel, modelRequestLog, backgroundAgentRunner, tavernScriptHostAdapter, tavernScriptDispatch} = core
  let modService
  // Enumerating the built-in library must never migrate legacy card files.
  const readModCard = async cardPath => {
    const value=await fileResources.readCard(normalizeResourcePath(cardPath,'card'))
    return cardPreparation.isWorkspace(value) ? value : undefined
  }
  const modCardStorage={cardPreparation,listPaths:()=>fileResources.list('card'),readWorkspace:readModCard,
    withCardLock:cardStorage.withCardLock,async writeWorkspace(cardPath,workspace) {
      if(!cardsActive())throw Object.assign(new Error('Card owner unavailable'),{code:'MOD_RESOURCE_UNAVAILABLE'})
      await fileResources.writeWorking(cardPath,JSON.stringify(workspace,null,2))
      await bumpCardProjectionRevision(cardPath)
      await syncCardName(cardPath,cardPreparation.project(workspace).name)
    }}
  const readModStage=createModConfigStageReader({readChat:sessionId=>readStageChat.view(sessionId,{stateOnly:true}),readRevision:chatPersistence.readRevision})
  const managedModManagement=createManagedModProduction({ctx,cardPlugins,...modCardStorage,
    readSession:sessionId=>readStageChat.view(sessionId,{configOnly:true}),
    async readSkin(cardPath,{sessionId}={}) {
      const base=(await cardStage.bubbles.read(cardPath)).stage.skin
      if(!sessionId)return base
      const chat=await readStageChat.view(sessionId,{configOnly:true}),state=await readModStage(sessionId,chat._storageRevision),ref=state?.skin?.ref
      if(!ref || JSON.stringify(ref)===JSON.stringify(base?.ref))return base
      const pack=await ctx.get('assetLibrary')?.getPackSnapshot({packId:ref.packId}).catch(()=>null),document=pack?.skins?.[ref.assetId]
      if(!document)return base
      const asset=pack.manifest.assets.find(row=>row.kind==='skins' && row.id===ref.assetId),hash=pack.manifest.bundles[asset.bundleKey].contentHash
      return {document,ref,bundleKey:asset.bundleKey,entry:asset.entry,resource:{resource:true,kind:'bundle',ref,revision:pack.revision,hash,bundleKey:asset.bundleKey,identity:`${ref.packId}:skins:${ref.assetId}:${hash}`}}
    },
    resolveOptionConfig:async(manifest,f)=>resolveBoundConfig(manifest,f.choices.global,f.choices.card,{sources:modConfigHost.sources,context:await modConfigHost.context({cardId:f.cardId,sessionId:f.sessionId}),manifests:f.manifests,globalValues:f.choices.global.config,cardValues:f.choices.card.config,skin:f.skin?.document?.mods?.[manifest.id],assetAvailable:key=>Object.hasOwn(f.skin?.document?.assets || {},key)}),
    onChange:()=>{modService?.invalidate();assetRuntime.invalidate()}})
  await containStage('安装内置 mod', () => managedModManagement.installBuiltins())
  const coreModCommands=[...directorCommands.definitions.map(row=>({op:row.name})),
    ...new Set([...directorCommands.definitions.map(row=>row.name.split('.')[0]),'perform'])].map(row=>typeof row==='string'?{dsl:{verb:row}}:row)
  let modConfigHost
  const workbenchAuthority=Object.freeze({})
  let modViewVersion=0
  modService=createBuiltinModService({workbenchAuthority,root:dataRoot+'/managed-mod-media',management:managedModManagement,readCard:readModCard,
    config:{values:(...args)=>modConfigHost.values(...args),bindings:(...args)=>modConfigHost.bindings(...args),
      managedRequest:async chat=>managedModManagement.request(chat,{sources:modConfigHost.sources,context:await modConfigHost.context({sessionId:chat.sessionId})}),
      // the phone reads which layer supplied a value and that layer's uploaded files.
      resolved:(...args)=>modConfigHost.resolved(...args),readFile:(...args)=>modConfigHost.readFile(...args)},
    models:{
      describe:async({modId,slotId,sessionId,slot})=>{
        const explicit=(await readTavernSettings()).modModels[modId]?.[slotId],chosen=await resolveSlot(modId,slotId,sessionId,slot)
        let available=false
        if(chosen)try {await llm.resolveCallConfig(chosen);available=true}catch{}
        return {selection:explicit?'explicit':'follow-'+slot.fallback,provider:chosen?.provider || null,model:chosen?.model || null,label:chosen?.model || (slot.fallback==='background'?'跟随后台':'跟随前台'),available}
      },
      select:async({modId,slotId,sessionId,slot})=>{
        const chosen=await resolveSlot(modId,slotId,sessionId,slot)
        if(!chosen)throw new Error('请在全局模型设置中选择模组模型')
        await llm.resolveCallConfig(chosen)
        return chosen
      },
      busy:async (sessionId,purpose)=>purpose!=='comments' && (await sessionActivity(sessionId))?.busy===true,
      run:async input=>{
        const chat=await chatForSession(input.sessionId)
        const record=await modelRequestLog.record({chat,context:{scope:'background',task:'mod.'+input.modId+'.'+input.slotId,turn:chat.messages?.at(-1)?.turn || 0},options:{...input,signal:undefined,onText:undefined}})
        try {
          const timing=createModelStreamTiming()
          const result=await callModel({...input,returnUsage:true,onText:text=>{timing.text(text);input.onText?.(text)}})
          await modelRequestLog.complete({chatId:chat.id,id:record.id,text:result.output,finish:{kind:'stop',timing:timing.finish(),...(result.usage?{usage:result.usage}:{})}})
          return result
        } catch(error) {
          await modelRequestLog.complete({chatId:chat.id,id:record.id,error:String(error.message),interrupted:input.signal.aborted})
          throw error
        }
      },
    },
    engineJudge,coreCommands:coreModCommands,connected:sessionId=>sessionSignals.connected(sessionId),
    readAssetText:input=>ctx.get('assetLibrary').readAssetText(input),
    assetSnapshot:assetRuntime.snapshot,publishView:(sessionId,snapshot)=>sessionSignals.publish(sessionId,{kind:'mod-view',sessionId,version:String(++modViewVersion),snapshot}),
    stage:createModStagePort({readChat:readStageChat,readTurn:(sessionId,turn)=>readRoundView(sessionId,turn),readSource:(sessionId,turn)=>readStageChat.view(sessionId,{turn,sourceOnly:true}),updateChat:rawUpdateChat,readCard:readModCard,publish:event=>sessionSignals.publish(event.sessionId,event)}),
    coreMedia:createModCoreMedia({readChat:(sessionId,turn)=>readRoundView(sessionId,turn),snapshot:assetRuntime.snapshot,service:()=>ctx.get('assetLibrary')}),
    onLog:event=>event.kind==='mod-delivery'?ctx.logger.debug('%s',JSON.stringify(event)):console.info('dsh-tavern:',JSON.stringify(event)),onChange:()=>assetRuntime.invalidate(),onError:error=>ctx.logger.warn('MOD_CALLBACK_FAILED %s',JSON.stringify({code:error?.code || 'MOD_RUNTIME_FAILED',message:error?.message,stack:error?.stack})),variables:{
      // Mod admission needs operation facts and message coordinates, not rollback checkpoints.
      index:sessionId=>readStageChat.view(sessionId,{configOnly:true}),
      readWindow:chatPersistence.readWindow,readRevision:chatPersistence.readRevision,timeline:storyTimeline,patch:patchChat,
      execute:input=>tavernScriptHostAdapter.editMvuVariables(input),availability:sessionId=>tavernScriptDispatch.status(sessionId),
    }})
  const offModAssets=assetRuntime.subscribe(()=>modService.assetsChanged())
  ctx.effect(()=>()=>{offModAssets();modService.dispose()})
  const configCards=async()=>Promise.all((await fileResources.list('card')).map(async path=>({path,workspace:await readModCard(path)})))
  modConfigHost=createModConfigHost({workbenchAuthority,store:({cardPacks})=>managedConfigStore({management:managedModManagement,readCard:readModCard,listCards:configCards,files:createModConfigFiles({root:dataRoot+'/mod-library/config',cardPacks})}),manifests:await modService.manifests(),managedManifests:(await managedModManagement.selection()).manifests,listCards:configCards,readCard:readModCard,
    getAssetLibrary:()=>ctx.get('assetLibrary'),getEngine:()=>({...assetEngineSettings.read(),assetRevision:assetRuntime.revision}),
    getGlobalEnabledPackIds:()=>ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || [],
    readSession:sessionId=>readStageChat.view(sessionId,{configOnly:true}),readWindow:chatPersistence.readWindow,readRevision:chatPersistence.readRevision,
    readStage:createModConfigStageReader({readChat:sessionId=>readStageChat.view(sessionId,{stateOnly:true}),readRevision:chatPersistence.readRevision}),
    resolveOptionValues:(modId,card,chat,values)=>managedModManagement.optionValues(modId,card,chat,values),
    async projectOptions(value,args,authority) {
      if(args.modId==='dsh.state')return value
      const answer=await managedModManagement.call('managedModOptions',{modId:args.modId,cardId:args.cardId,sessionId:args.sessionId},authority),mod=answer.mods[0]
      if(!mod)return value
      return {...value,skin:answer.skin?{name:answer.skin.document.label}:null,resolved:Object.fromEntries(Object.entries(value.resolved).map(([key,row])=>[key,{...row,...mod.options[key]}]))}
    },
    invalidate:()=>modService.invalidate()})
  ctx.inject(['assetLibrary'],()=>{const owner=ctx.get('assetLibrary');modConfigHost.register(owner);void modService.installBuiltinAssets(owner).catch(error=>ctx.logger.warn('MOD_BUILTIN_ASSETS %s',error.message))})
  // galgame stage director
  const stageDirector = createStageDirector({
    readChat:readStageChat,
    trace: requestPerformance,
    judge:engineJudge,mods:modService,
    itemsEnabled:()=>assetEngineSettings.read().values.stageToggles.items !== false,
    stateSource:(chat,raw)=>modConfigHost.stateSource(chat,raw),
    log:event => console.info('dsh-tavern:',JSON.stringify(event)),
    publish:event => {
      sessionSignals.publish(event.sessionId,event)
      void coordinationEvents?.publish(event.sessionId) // refresh the existing stop action.
    },
    assets:assetRuntime,
    readChanges:(id,revision) => chatJournalStore.readChangedIndices(id,revision),
    // Full earlier records of a chain-only turn view, pinned to the revision the view was read at.
    readRecords:(chat,indices) => chatJournalStore.readStageRecords(chat.id,indices,{revision:chat._storageRevision}),
    // The director writes beside the game's other work: whole-save updates for its record and
    // failure, a one-message patch for checkpoints and its running mark.
    readTaskChat: chatId => readChat(chatId),
    updateChat: (id, mutate) => rawUpdateChat(id, mutate, {source:'stage-director'}),
    writeMessage: (chatId, index, mutate) => updateChatMessage(chatId, index, mutate, {source:'stage-director.checkpoint'}),
    resetTask: (chat, turn, {regenerate, imageReplay}) => updateChat(chat.id, current => {
      const message = current.messages?.find(item => item.role === 'assistant' && Number(item.turn || (item.greeting ? 1 : 0)) === turn)
      if (message) {
        message.stageDirectionGeneration = (message.stageDirectionGeneration || 0) + 1
        delete message.stageDirectionAssetPacksDraft
        if (imageReplay) message.stageDirectionAssetPacksDraft = {imageReplay}
        delete message.stageDirectionAssetPacksFailure
        if (regenerate) delete message.stageDirectionAssetPacks
      }
      return current
    }, {source:'stage-director.retry'}),
    // 舞台模式 › 导演模型 「跟随前台」 (the default) — the conversation's chat model.
    foreground: chat => modelSelection(chat && chat.sessionId),
    selection: chat => resolveSlot('dsh.stage','director',chat?.sessionId),
    judgeConfig: chat => resolveSlot('dsh.stage','judge',chat?.sessionId),
    modelInfo: async selection => {
      const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
      const output = info.defaultMaxTokens
      return { ...(info.context ? {context:info.context} : {}), ...(output !== undefined ? {defaultMaxTokens:output} : {}) }
    }, runAgent: input => backgroundAgentRunner.run(input),
    bodyForTurn: async (chat, target, options = {}) => {
      const display = await replyDisplayForChat(chat,await readChatCard(chat),options.persisted === true)
      const projection = display.projections.find(item => item.turn === target.turn)
      return projection.body
    }
  })
  ctx.effect(() => () => stageDirector.dispose(), 'dsh-tavern: dispose stage director')
  return {modService, managedModManagement, modConfigHost, stageDirector}
}
