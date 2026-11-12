import {createFigureRuntimes} from './figure-runtimes.js'
import {spineRuntimeAvailable, spineRuntimeStatus, importSpineRuntime} from '../../../lib/domain/tavern-runtime-assets.js'
import {createCardStage, watchFigureBubbleBooks} from './card-stage.js'
import {modelSlotRows} from '../../../lib/domain/model-slots.js'
import {createStageWorkflow} from './workflow.js'
import {createVoiceBackfill} from './voice-backfill.js'
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
import {managedConfigStore} from './mod-system-execution.js'
import {createStageDirector} from './domain/stage-director.js'
import {finalizeStageItems, invalidateStageItems} from './domain/stage-items.js'
import {normalizeResourcePath} from '../../../lib/domain/file-resources.js'
import directorCommands from '../../dsh-presentation-protocol/src/director-commands.cjs'
import {createAssetEngineSettings} from './asset-engine.js'
import {createEngineJudge} from '../../../lib/domain/engine-judge.js'
import {createJudgeRpc} from './engine-judge.js'
import {createDirectorProbeStore, createDirectorProbeRpc} from '../../../lib/director-probe.js'
import {createFigureVoiceAuthoring, countServiceUsers} from './figure-voice-authoring.js'
import {createAssetRuntime} from './asset-runtime.js'
import {foldAssetPackEntries} from './domain/stage-asset-pack-director.js'
import {createStageExtensions} from './stage-extensions.js'
import {createWidgetVariableService} from './domain/widget-variable-service.js'
import {createCardPagesService} from './domain/status-panel-service.js'
import {createCgGallery} from './cg-gallery.js'
import {createSceneCg} from './scene-cg.js'
import {readStageProjection, stageProjectionPage} from './domain/stage-projection.js'
import {readWidgetWindowProjection} from './domain/widget-window-projection.js'
import {frozenStageBackground} from '../../../lib/domain/stage-shared-context.js'
import {effectiveCardStage} from '../../../lib/domain/card-stage-settings.js'
import {readCardAssetExtension} from '../../../lib/domain/card-asset-bindings.js'
import {hasCardAssetBindings} from '../../../lib/card-asset-bindings.js'
import {createStageClipExport} from './clip/clip-export-stage.js'
import {registerStageWorkbench} from './workbench/index.js'

// cardsActive(): false once the plugin is disposed; card writes are refused from then on.
export async function createStageModule(core) {
  const {ctx, dataRoot, containStage, cardsActive, llm, requestPerformance, sessionSignals, coordinationEvents, fileResources, cardPreparation, cardStorage, cardStage, cardPlugins, bumpCardProjectionRevision, syncCardName, readChat, readChatCard, readStageChat, stageReads, readRoundView, storyEvents, deploymentWork, backgroundTaskPolicies, chatForSession, chatPersistence, chatJournalStore, rawUpdateChat, updateChat, updateChatMessage, patchChat, storyTimeline, replyDisplayForChat, assetRuntime, assetEngineSettings, engineJudge, modelSelection, resolveSlot, backgroundAgentRunner, tavernScriptHostAdapter, tavernScriptDispatch} = core
  // Pack-driven writer updates belong to the stage lifetime, including rollback.
  ctx.inject(['assetLibrary'], child => {
    const books = watchFigureBubbleBooks({service:child.get('assetLibrary'), packSettings:ctx.get('assetPackSettings'),
      listCards:() => fileResources.list('card'), readWorkspace:cardStorage.readWorkspace,
      sync:path => cardStage.bubbles.sync(core.worldBooks, path),
      onError:(error, path) => console.warn('dsh-tavern: figure writer sync failed', path || '', error.message)})
    child.effect(() => () => books.dispose())
  })
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
  modService=createBuiltinModService({workbenchAuthority,management:managedModManagement,readCard:readModCard,
    config:{values:(...args)=>modConfigHost.values(...args),
      managedRequest:async chat=>managedModManagement.request(chat,{sources:modConfigHost.sources,context:await modConfigHost.context({sessionId:chat.sessionId})}),
      // the phone reads which layer supplied a value and that layer's uploaded files.
      resolved:(...args)=>modConfigHost.resolved(...args),readFile:(...args)=>modConfigHost.readFile(...args)},
    coreCommands:coreModCommands,
    stage:createModStagePort({readChat:readStageChat,readTurn:(sessionId,turn)=>readRoundView(sessionId,turn),readSource:(sessionId,turn)=>readStageChat.view(sessionId,{turn,sourceOnly:true}),updateChat:rawUpdateChat,readCard:readModCard,publish:event=>sessionSignals.publish(event.sessionId,event)}),
    onLog:event=>event.kind==='mod-delivery'?ctx.logger.debug('%s',JSON.stringify(event)):console.info('dsh-tavern:',JSON.stringify(event)),onChange:()=>assetRuntime.invalidate(),onError:error=>ctx.logger.warn('MOD_CALLBACK_FAILED %s',JSON.stringify({code:error?.code || 'MOD_RUNTIME_FAILED',message:error?.message,stack:error?.stack})),variables:{
      // Mod admission needs operation facts and message coordinates, not rollback checkpoints.
      index:sessionId=>readStageChat.view(sessionId,{configOnly:true}),
      readWindow:chatPersistence.readWindow,readRevision:chatPersistence.readRevision,timeline:storyTimeline,patch:patchChat,
      execute:input=>tavernScriptHostAdapter.editMvuVariables(input),availability:sessionId=>tavernScriptDispatch.status(sessionId),
    }})
  ctx.effect(()=>()=>modService.dispose())
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
  modConfigHost=createModConfigHost({library:core.hostLibrary,workbenchAuthority,store:({cardPacks})=>managedConfigStore({management:managedModManagement,readCard:readModCard,listCards:configCards,files:createModConfigFiles({root:dataRoot+'/mod-library/config',cardPacks})}),manifests:await modService.manifests(),managedManifests:(await managedModManagement.selection()).manifests,listCards:configCards,readCard:readModCard,
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
  const stageDirector = createStageDirector({activeStageSkin:core.activeStageSkin,
    readChat:readStageChat,
    trace: requestPerformance,
    judge:engineJudge,mods:modService,
    itemsEnabled:chat=>core.cardStageSwitch(chat.cardPath,'items'),
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
    // One round's streaming windows continue one director conversation.
    openConversation: () => backgroundAgentRunner.conversation(),
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
  // 配音补译: voice text for unrecalled foreign-voice lines, stored with the round (voice-backfill.js).
  const voiceBackfill = createVoiceBackfill({workflow:core.workflow, chatHeaderForSession:core.chatHeaderForSession, dialogueBubbles:core.dialogueBubbles, chatForSession,
    bodyForTurn:async (chat, turn) => (await replyDisplayForChat(chat, await readChatCard(chat), true)).projections.find(item => item.turn === turn)?.body,
    voiceBackfillLines:core.voiceBackfillLines, voiceBackfillKept:core.voiceBackfillKept,
    writeMessage:(chatId, index, mutate) => updateChatMessage(chatId, index, mutate, {source:'voice-backfill'}),
    runAgent:input => backgroundAgentRunner.run(input), selection:sessionId => modelSelection(sessionId), blocked:chat => core.backgroundBlocked(chat)})
  ctx.effect(() => () => voiceBackfill.dispose(), 'dsh-tavern: voice backfill')
  // A reply's stage items follow its variable settlement, inside the settlement's own commit.
  const finalizeItems = (chat, messageId) => {if (chat.messages[messageId]?.stageDirectionAssetPacks?.binding?.items) finalizeStageItems(chat, messageId)}
  ctx.effect(() => core.settlementParticipants.register('dsh-tavern-stage', {
    capture:(snapshot, target) => draft => {if (target) finalizeItems(draft, target.messageId)},
    closed:finalizeItems,
    retrying:message => {if (message.stageItems) invalidateStageItems(message)}
  }), 'dsh-tavern: stage settlement participant')
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
      // The mods' stage services build their requests from these bindings (stage-extensions.js bind) and report their
      // in-flight work to deployment.
      deps.stageExtensions.bind(registry, Object.create(deps, {readModCard:{value:readModCard}, resolveSlot:{value:resolveSlot},
        managedModManagement:{value:managedModManagement}, modConfigHost:{value:modConfigHost}, stageDirector:{value:stageDirector}}))
      ctx.effect(() => {
        const works = deps.stageExtensions.works()
        deploymentWork.push(...works)
        return () => {for (const work of works) {const index = deploymentWork.indexOf(work);if (index >= 0) deploymentWork.splice(index,1)}}
      }, 'dsh-tavern: stage extension deployment activity')
      // Clip export replays a chat's rounds in an isolated page; its recorded reads go back through these requests and the
      // mods' stage services (a history timer, the phone's directory).
      const clipExport = createStageClipExport({ctx, deps, stageDirector, modService, deploymentWork,
        cardStageSwitch:core.cardStageSwitch, dialogueBubbles:core.dialogueBubbles, assetEngineSettings:core.assetEngineSettings, live2dFiles:deps.live2dFiles,
        call:(method, args, authority) => deps.stageExtensions.handles(method) ? deps.stageExtensions.call(method, args, authority) : requests.call(method, args, authority)})
      // 场景生图 pictures become the card's CG entries and 回想 unlocks (scene-cg.js) as each one finishes.
      const sceneCg = createSceneCg({library:() => ctx.get('assetLibrary'), attachments:() => ctx.get('attachments'), chatForSession:deps.chatForSession,
        cardAssetBindings:deps.cardAssetBindings, resolveCard:cardStorage.resolve, cgGallery:deps.cgGallery, removePicture:deps.removePluginPicture})
      ctx.effect(() => deps.pluginApi.onPictureReady(event => sceneCg.sync(event)), 'dsh-tavern: scene CG sync')
      const requests = createStageRequests(Object.create(deps, {sceneCg:{value:sceneCg}}), {managedModManagement,modConfigHost,modService,clipExport})
      ctx.effect(() => () => requests.dispose(), 'dsh-tavern: close stage requests')
      ctx.effect(() => registry.register('dsh-tavern-stage', requests), 'dsh-tavern: stage request routes')
      ctx.effect(() => registerStageWorkbench({ctx, deps, call:(method, args) => requests.call(method, args, workbenchAuthority)}), 'dsh-tavern: stage workbench tools')
      return requests
    }
  }
}

// 舞台的素材与判断：素材引擎设置、概率判断、导演探针、人物语音、素材运行时。核心在很早就要用到它们
// （写卡时让素材运行时失效、模型槽读判断模型），所以单独先建；只通过 `core` 里的几项读卡与解析模型槽。
// The stage's model slots (the director and the relevance judge), registered with the host's model-slot registry.
export const STAGE_MODEL_MANIFESTS = [{id:'dsh.stage',name:'舞台',modelSlots:[
  {id:'director',label:'导演模型',purpose:'安排舞台演出',fallback:'foreground'},
  {id:'judge',label:'智能判断',purpose:'判断素材与剧情的相关概率',fallback:'background',kind:'scoring'}]}]

export function createStageAssets(core) {
  const {ctx, resolveSlot, readCardWorkspace, coordinationEvents} = core
  const figureRuntimes = createFigureRuntimes()
  ctx.effect(() => () => figureRuntimes.dispose())
  ctx.provide('figureRuntimes', figureRuntimes)
  figureRuntimes.register('spine', {
    files:{available:spineRuntimeAvailable,status:spineRuntimeStatus,import:importSpineRuntime},
    routes:{getSpineRuntimeStatus:(_args,_authority,_template,files) => files.status(),
      importSpineRuntime:(args,_authority,_template,files) => files.import(args)}
  })
  const stageExtensions = createStageExtensions()
  ctx.effect(() => () => stageExtensions.dispose())
  // A mod's own stage service (its stage contribution's hostExtension), under the mod id.
  for (const contribution of core.modStageContributions()) if (contribution.hostExtension) stageExtensions.register(contribution.modId, contribution.hostExtension)
  ctx.provide('stageExtensions', stageExtensions)
  // stage: the read helpers a mod's stage service folds and scopes its state with (core.stageReads plus the record fold).
  const stageModReads = Object.freeze({fold:foldAssetPackEntries,...core.stageReads})
  const assetEngineSettings = createAssetEngineSettings(ctx)
  const getTts = () => ctx.get('tts')
  // A card's stage switch in effect (effectiveCardStage: the card's own setting over the global stageToggles), for the
  // readers that have a chat or card path, not a stage snapshot.
  async function cardStageSwitch(cardPath, key) {
    const raw = (await readCardWorkspace(cardPath))?.raw
    return effectiveCardStage(raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null, assetEngineSettings.read().values)[key] === true
  }
  // The two switches the session view publishes (view.stage): the client loads and asks the stage only when one is on.
  async function cardStageMode(cardPath) {
    const raw = (await readCardWorkspace(cardPath))?.raw
    const stage = effectiveCardStage(raw && hasCardAssetBindings(raw) ? readCardAssetExtension(raw) : null, assetEngineSettings.read().values)
    return {dialogue:stage.dialogue === true, stage:stage.stage === true}
  }
  const cardStage = createCardStage({cardStorage:core.cardStorage,measure:core.measure,
    getTts,getEngine:() => assetEngineSettings.read().values,
    getAssetLibrary:() => ctx.get('assetLibrary'),getGlobalEnabledPackIds:() => ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || []})
  ctx.effect(() => core.modelSlots.register('dsh-tavern-stage',{
    rows:() => modelSlotRows(STAGE_MODEL_MANIFESTS,['dsh.stage']),scoring:() => assetEngineSettings.read().values.judge
  }), 'dsh-tavern: stage model slots')
  const engineJudge = createEngineJudge({resolveConfig:input => resolveSlot('dsh.stage','judge',input?.sessionId),getConfig:() => assetEngineSettings.read().values.judge,credentials:() => ctx.get('credentials'),log:event => console.info('dsh-tavern:',JSON.stringify(event))})
  const judgeRpc = createJudgeRpc(assetEngineSettings,engineJudge)
  const directorProbeRpc = createDirectorProbeRpc({store:createDirectorProbeStore(ctx),
    stream:request => ctx.llm.stream(request),
    resolveSelection:async args => {
      return Object.hasOwn(args,'selection') ? args.selection : resolveSlot('dsh.stage','director',args.sessionId)
    }})
  const figureVoiceAuthoring = createFigureVoiceAuthoring({getLibrary:() => ctx.get('assetLibrary'),getTts})
  ctx.effect(() => assetEngineSettings.subscribe(() => figureVoiceAuthoring.invalidate()))
  ctx.effect(() => () => figureVoiceAuthoring.dispose())
  for (const name of ['assetLibrary','tts']) ctx.inject([name], child => child.effect(() => () => figureVoiceAuthoring.invalidate()))
  ctx.inject(['assetLibrary','tts'], child => child.effect(() => child.get('tts').registerUsageSource({owner:'dsh-tavern-stage',
    inspect:serviceId => countServiceUsers({library:child.get('assetLibrary'),tts:child.get('tts'),serviceId})})))
  const assetRuntime = createAssetRuntime({ctx, readWorkspace:readCardWorkspace, engineSettings:assetEngineSettings,
    onInvalidate:() => { void coordinationEvents?.publishAll() }})
  ctx.effect(() => () => assetRuntime.dispose())
  ctx.effect(() => core.presentationObservers.register('dsh-tavern-stage-assets',{cardChanged:path => assetRuntime.invalidate(path)}), 'dsh-tavern: asset card invalidation')
  return {figureRuntimes,stageExtensions,stageModReads,cardStage,dialogueBubbles:cardStage.bubbles,assetEngineSettings, cardStageSwitch, cardStageMode, engineJudge, judgeRpc, directorProbeRpc, figureVoiceAuthoring, assetRuntime}
}

// 舞台上的小组件变量、CG 图鉴与舞台计时器：都只读导演的演出、经请求处理表被调用。
export function createStageServices(core) {
  const {ctx, profileData, sessionSignals, conversationRegistry, tavernScriptDispatch, tavernScriptHostAdapter, readSessionMap, chatForSession, readRoundView, chatPersistence, storyTimeline, patchChat, cardStorage, cardStage, assetRuntime, assetEngineSettings, cardStageSwitch, stageDirector, modService, managedModManagement} = core
  // only the trusted stage host selects a read point and installed widget.
  const readSessionIndex = async sessionId => {
    const chatId = (await readSessionMap())[sessionId]
    return chatId ? chatPersistence.readSessionState(chatId) : null
  }
  const widgetVariables = createWidgetVariableService({
    index: readSessionIndex,
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
        performanceEnabled:await cardStageSwitch(chat.cardPath,'performance'),
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

  // The status panel reads the library card's declared paths and ledger sections, never the chat's frozen snapshot.
  const cardPages = createCardPagesService({readWorkspace:cardStorage.readWorkspace, chatForSession, index:readSessionIndex, cardPageOpening:core.cardPageOpening,
    packSnapshot:packId => ctx.get('assetLibrary')?.getPackSnapshot({packId}).catch(() => null)})
  // no gallery state is exported through cards or asset packs.
  const cgGallery = createCgGallery({profileData,cardStorage,resolveCard:cardStorage.resolve,chatForSession,assets:assetRuntime,
    readDirection:(chat,turn) => stageDirector.get(chat,Number(turn),null,{readOnly:true}),readSettings:() => assetEngineSettings.read()})

  const extensions = core.stageExtensions.start({...core,widgetVariables,cgGallery,stage:core.stageModReads})
  return {widgetVariables, cardPages, cgGallery, ...extensions}
}
