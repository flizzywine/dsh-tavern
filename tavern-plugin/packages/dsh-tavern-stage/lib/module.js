import {createCardStage} from '../../../lib/card-stage.js'
import {modelSlotRows} from '../../../lib/domain/model-slots.js'
import {createStageWorkflow} from './workflow.js'
import {createStageRequests} from './requests.js'
import {createStageStoryObserver} from './story-observer.js'
// 舞台、导演与 mod 的组装。index.js 只用这里导出的三个工厂和它们的返回值。
//
// 舞台、导演与 mod：托管 mod 的安装与配置、mod 服务、舞台导演。它们由核心创建一次，
// 只通过 `core` 里列出的这些能力读写存档、调用模型、发信号；核心反过来只用返回的四个对象。
import {createBuiltinModService} from './mod-service.js'
import {createManagedModProduction} from './mod-system-production.js'
import {resolveBoundConfig} from '../../../lib/domain/mod-system.js'
import {createModConfigHost,createModConfigStageReader} from './mod-config-host.js'
import {createModConfigFiles} from './mod-config.js'
import {createModStagePort} from './mod-stage.js'
import {createModCoreMedia} from './domain/mods/core-media.js'
import {createModelStreamTiming} from './domain/mods/models.js'
import {managedConfigStore} from './mod-system-execution.js'
import {createStageDirector} from './domain/stage-director.js'
import {normalizeResourcePath} from '../../../lib/domain/file-resources.js'
import directorCommands from '../../dsh-presentation-protocol/src/director-commands.cjs'
import {createAssetEngineSettings} from './asset-engine.js'
import {createEngineJudge} from '../../../lib/domain/engine-judge.js'
import {createJudgeRpc} from './engine-judge.js'
import {createDirectorProbeStore, createDirectorProbeRpc} from '../../../lib/director-probe.js'
import {createFigureVoiceAuthoring} from './figure-voice-authoring.js'
import {createAssetRuntime} from './asset-runtime.js'
import {createStageTimerService} from '../../../mods/timer/stage-service.js'
import {createWidgetVariableService} from './domain/widget-variable-service.js'
import {createCgGallery} from './cg-gallery.js'
import {readStageProjection, stageProjectionPage} from './domain/stage-projection.js'
import {readWidgetWindowProjection} from './domain/widget-window-projection.js'
import {stageReadCarries} from '../../../lib/domain/stage-read-projection.js'
import {frozenStageBackground} from '../../../lib/domain/stage-shared-context.js'

// cardsActive(): false once the plugin is disposed; card writes are refused from then on.
export async function createStageModule(core) {
  const {ctx, dataRoot, containStage, cardsActive, llm, requestPerformance, sessionSignals, coordinationEvents, fileResources, cardPreparation, cardStorage, cardStage, cardPlugins, bumpCardProjectionRevision, syncCardName, readChat, readChatCard, readStageChat, stageReads, readRoundView, storyEvents, deploymentWork, backgroundTaskPolicies, chatForSession, chatPersistence, chatJournalStore, rawUpdateChat, updateChat, updateChatMessage, patchChat, storyTimeline, replyDisplayForChat, sessionActivity, assetRuntime, assetEngineSettings, engineJudge, modelSelection, resolveSlot, readTavernSettings, callModel, modelRequestLog, backgroundAgentRunner, tavernScriptHostAdapter, tavernScriptDispatch} = core
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
  ctx.provide('tavernManagedModules', Object.freeze({
    apiVersion:managedModManagement.modHost.apiVersion,
    register(owner,manifest,implementation) {
      if(!cardsActive())throw Object.assign(new Error('Managed module host unavailable'),{code:'MOD_UNAVAILABLE'})
      return managedModManagement.modHost.register(owner,manifest,implementation)
    },
    async enabled(input) {
      if(!cardsActive())return false
      const enabled=await managedModManagement.enabled(input)
      return cardsActive() && enabled
    }
  }))
  ctx.effect(() => core.modelSlots.register('dsh-tavern-stage-mods',{rows:() => modService.modelSlots()}), 'dsh-tavern: mod model slots')
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
  ctx.effect(() => () => modConfigHost.dispose(), 'dsh-tavern: mod config registrations')
  ctx.inject(['assetLibrary'],child => {
    const owner=child.get('assetLibrary')
    child.effect(() => {modConfigHost.register(owner);return () => modConfigHost.unregister(owner)})
    void modService.installBuiltinAssets(owner).catch(error=>ctx.logger.warn('MOD_BUILTIN_ASSETS %s',error.message))
  })
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
    readRecords:(chat,indices) => stageReads.readRecords(chat.id,indices,{revision:chat._storageRevision}),
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
  // A stopped turn takes its director with it; deployment waits while a director runs.
  ctx.effect(() => storyEvents.on('turn-interrupted', '停止舞台导演', ({sessionId, turn}) => {
    stageDirector.cancel({sessionId}, turn)
    backgroundAgentRunner.cancel(sessionId, {task:'stage-director'})
  }), 'dsh-tavern: stop the director with its turn')
  ctx.effect(() => {
    const work = () => ({director:{busy:stageDirector.pendingCount() > 0}})
    deploymentWork.push(work)
    return () => {const index = deploymentWork.indexOf(work);if (index >= 0) deploymentWork.splice(index,1)}
  }, 'dsh-tavern: director deployment activity')
  // The director brings its own model, never searches the web, and reads the context frozen for it, never the card's.
  ctx.effect(() => {
    const policy = {ownModel:true, webSearch:false, cardContext:false, frozenContext:frozenStageBackground}
    const previous = backgroundTaskPolicies.get('stage-director')
    backgroundTaskPolicies.set('stage-director', policy)
    return () => {
      if (backgroundTaskPolicies.get('stage-director') !== policy) return
      if (previous === undefined) backgroundTaskPolicies.delete('stage-director')
      else backgroundTaskPolicies.set('stage-director', previous)
    }
  }, 'dsh-tavern: director task policy')
  const stageWorkflow = createStageWorkflow({workflow:core.workflow, chatHeaderForSession:core.chatHeaderForSession,
    dialogueBubbles:core.dialogueBubbles,chatForSession,chatPersistence,stageDirector})
  ctx.effect(() => () => stageWorkflow.dispose(), 'dsh-tavern: stage workflow')
  ctx.effect(() => core.presentationObservers.register('dsh-tavern-stage', createStageStoryObserver({
    settlementQueued:stageWorkflow.settlementQueued, modService, stageDirector, chatPersistence, readStageChat,
    chatHeaderForSession:core.chatHeaderForSession, dialogueBubbles:core.dialogueBubbles,
    readReplyPrefix:core.readReplyPrefix, activeRoundBodies:core.activeRoundBodies
  })), 'dsh-tavern: stage story observations')
  return {modService, managedModManagement, modConfigHost, stageDirector,
    requests(deps, registry) {
      const requests = createStageRequests(deps, {managedModManagement,modConfigHost,modService})
      ctx.effect(() => () => requests.dispose(), 'dsh-tavern: close stage requests')
      ctx.effect(() => registry.register('dsh-tavern-stage', requests), 'dsh-tavern: stage request routes')
      return requests
    }
  }
}

// 舞台的素材与判断：素材引擎设置、概率判断、导演探针、人物语音、素材运行时。核心在很早就要用到它们
// （写卡时让素材运行时失效、模型槽读判断模型），所以单独先建；只通过 `core` 里的几项读卡与解析模型槽。
export function createStageAssets(core) {
  const {ctx, resolveSlot, readCardWorkspace, coordinationEvents} = core
  const assetEngineSettings = createAssetEngineSettings(ctx)
  const cardStage = createCardStage({cardStorage:core.cardStorage,measure:core.measure,
    getTts:() => ctx.get('tts'),getEngine:() => assetEngineSettings.read().values,
    getAssetLibrary:() => ctx.get('assetLibrary'),getGlobalEnabledPackIds:() => ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || []})
  const manifests = [{id:'dsh.stage',name:'舞台',modelSlots:[
    {id:'director',label:'导演模型',purpose:'安排舞台演出',fallback:'foreground'},
    {id:'judge',label:'智能判断',purpose:'判断素材与剧情的相关概率',fallback:'background',kind:'scoring'}]}]
  ctx.effect(() => core.modelSlots.register('dsh-tavern-stage',{
    rows:() => modelSlotRows(manifests,['dsh.stage']),scoring:() => assetEngineSettings.read().values.judge
  }), 'dsh-tavern: stage model slots')
  const engineJudge = createEngineJudge({resolveConfig:input => resolveSlot('dsh.stage','judge',input?.sessionId),getConfig:() => assetEngineSettings.read().values.judge,credentials:() => ctx.get('credentials'),log:event => console.info('dsh-tavern:',JSON.stringify(event))})
  const judgeRpc = createJudgeRpc(assetEngineSettings,engineJudge)
  const directorProbeRpc = createDirectorProbeRpc({store:createDirectorProbeStore(ctx),
    stream:request => ctx.llm.stream(request),
    resolveSelection:async args => {
      return Object.hasOwn(args,'selection') ? args.selection : resolveSlot('dsh.stage','director',args.sessionId)
    }})
  const figureVoiceAuthoring = createFigureVoiceAuthoring({getLibrary:() => ctx.get('assetLibrary'),getTts:() => ctx.get('tts'),getSettings:() => assetEngineSettings.read().values})
  ctx.effect(() => assetEngineSettings.subscribe(() => figureVoiceAuthoring.invalidate()))
  ctx.effect(() => () => figureVoiceAuthoring.dispose())
  for (const name of ['assetLibrary','tts']) ctx.inject([name], child => child.effect(() => () => figureVoiceAuthoring.invalidate()))
  const assetRuntime = createAssetRuntime({ctx, readWorkspace:readCardWorkspace, engineSettings:assetEngineSettings,
    onInvalidate:() => { void coordinationEvents?.publishAll() }})
  ctx.effect(() => () => assetRuntime.dispose())
  ctx.effect(() => core.presentationObservers.register('dsh-tavern-stage-assets',{cardChanged:path => assetRuntime.invalidate(path)}), 'dsh-tavern: asset card invalidation')
  return {cardStage,dialogueBubbles:cardStage.bubbles,assetEngineSettings, engineJudge, judgeRpc, directorProbeRpc, figureVoiceAuthoring, assetRuntime}
}

// 舞台上的小组件变量、CG 图鉴与舞台计时器：都只读导演的演出、经请求处理表被调用。
export function createStageServices(core) {
  const {ctx, profileData, sessionSignals, conversationRegistry, tavernScriptDispatch, tavernScriptHostAdapter, readSessionMap, chatForSession, readRoundView, chatPersistence, storyTimeline, patchChat, cardStorage, cardStage, assetRuntime, assetEngineSettings, stageDirector, modService, managedModManagement} = core
  // only the trusted stage host selects a read point and installed widget.
  const widgetVariables = createWidgetVariableService({
    prepareCommit:input=>modService.variableCommit(input),
    index: async sessionId => {
      const chatId = (await readSessionMap())[sessionId]
      return chatId ? chatPersistence.readSessionState(chatId) : null
    },
    readWindow: chatPersistence.readWindow, timeline: storyTimeline, patch: patchChat,
    execute: input => tavernScriptHostAdapter.editMvuVariables(input),
    availability: sessionId => tavernScriptDispatch.status(sessionId),
    authorize: async input => {
      const chat = await chatForSession(input.sessionId)
      if (!chat || chat.mode === 'card' || !input.ref || input.ref.kind !== 'widgets') return null
      const revision = assetRuntime.revision, settings = assetEngineSettings.read()
      const current = () => assetRuntime.revision === revision && assetEngineSettings.read().revision === settings.revision
      const direction = await stageDirector.get(chat,input.turn,null,{readOnly:true,includePredecessor:true})
      if (!direction.token || JSON.stringify(direction.token) !== JSON.stringify(input.expectedDirectionToken)) return null
      const page = stageProjectionPage(direction,input.at,input.page)
      if (!page) return null
      const consumer = await assetRuntime.consumer(chat,input.origin)
      if (!consumer?.presentation.available()) return null
      const projection = await readStageProjection({expectedDirectionToken:input.expectedDirectionToken,at:input.at,page:input.page,
        performanceEnabled:assetEngineSettings.read().values.stageToggles.performance !== false,
        readDirection:async () => direction,readConsumer:async () => consumer,readSettings:() => assetEngineSettings.read(),revision:() => assetRuntime.revision})
      const matches = item => item.ref?.packId === input.ref.packId && item.ref?.kind === input.ref.kind && item.ref?.assetId === input.ref.assetId
      let widget = [...(projection.value?.widgets || []),...(projection.value?.performance?.executionDependencies || [])].find(matches)
      if (!widget) {
        const window = await readWidgetWindowProjection({widgetWindow:{ref:input.ref},turn:input.turn,at:input.at,page:input.page,
          expectedDirectionToken:input.expectedDirectionToken,readDirection:turn => stageDirector.get(chat,turn,null,{readOnly:true}),
          readTurns:async () => chat.messages.filter(row => row.role === 'assistant').map(row => Number(row.turn || (row.greeting ? 1 : 0))),
          readConsumer:async () => consumer,readSettings:() => settings,revision:() => revision,isCurrent:current})
        widget = window.widgets?.find(matches)
      }
      if (!current() || !widget || widget.definition.contentIdentity !== input.identity) return null
      return {chatId:chat.id,storageRevision:chat._storageRevision,declarations:widget.definition.document.variables || {},current,
        settings:{document:widget.definition.document,defaults:widget.definition.settingsDefaults,override:widget.definition.settingsOverride || {}},
        lastPage:direction.complete === true && page.index === direction.pageIndex.pages.length-1}
    }
  })
  ctx.effect(() => {
    const wake = sessionId => sessionSignals.publish(sessionId,{kind:'tavern-state',version:'widget-runtime:'+Date.now()})
    const ready = tavernScriptDispatch.subscribeReady(wake), settled = tavernScriptDispatch.subscribeSettled(wake)
    void conversationRegistry.list().then(rows => Promise.all(rows.map(row => widgetVariables.recover(row.sessionId))))
      .catch(error => console.warn('dsh-tavern: widget edit recovery failed:',error.message))
    return () => {ready();settled();widgetVariables.dispose()}
  })

  // no gallery state is exported through cards or asset packs.
  const cgGallery = createCgGallery({profileData,cardStorage,resolveCard:cardStorage.resolve,chatForSession,assets:assetRuntime,
    readDirection:(chat,turn) => stageDirector.get(chat,Number(turn),null,{readOnly:true}),readSettings:() => assetEngineSettings.read()})

  const stageControllerEnabled = (chat, consumer) => consumer === 'core.performance'
    ? assetEngineSettings.read().values.stageToggles.performance !== false
    : managedModManagement.enabled({modId:consumer,cardPath:chat.cardPath})

  const stageTimer = createStageTimerService({readChat:(sessionId,turn)=>readRoundView(sessionId,turn),
    // The clock reads the latest round's view; its latest saved timer may sit on an earlier round, read with that round.
    readDirection:async (chat,turn)=>stageDirector.get(stageReadCarries(chat,turn) ? chat : await readRoundView(chat.sessionId,turn),turn,null,{readOnly:true}),patchChat:chatPersistence.patch,
    enabled:chat=>managedModManagement.enabled({modId:'dsh.timer',cardPath:chat.cardPath}),
    controllerEnabled:stageControllerEnabled,publish:({sessionId,event})=>modService.stageEvent(sessionId,event)})
  ctx.effect(()=>()=>stageTimer.dispose(), 'dsh-tavern: close stage clocks')
  return {widgetVariables, cgGallery, stageTimer}
}
