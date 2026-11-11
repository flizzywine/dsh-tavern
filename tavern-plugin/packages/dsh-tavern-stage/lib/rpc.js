import { stageEntranceChoices } from './domain/stage-entrance.js'
import { widgetSourceRounds } from './domain/widget-window-projection.js'
import {projectStageLease} from './domain/stage-lease-projection.js'
import {cardGreetings, messageOpeningId, resolveOpeningScene} from './domain/stage-opening-scene.js'
import { NARRATOR_VOICE, GENERAL_VOICE } from '../../../lib/domain/asset-pack-speech.js'
import { phoneMark, phoneMarkRounds as phoneRounds } from '../../../mods/phone/call-context.js'
// The stage's requests: director, asset packs, figures and voices, widgets, mods, stage timers, phone, CG gallery.
// They run on the same authenticated dispatcher as every other area; core requests live in the other rpc/ files.
// A dsh.phone message mark: the phone reads in full only the earlier rounds whose record binds a phone view and marks one.
export function createStageHandlers(deps) {
  const { ctx } = deps
  return {
    async readWidgetVariables(args, method, serverTemplate, authority) {
      const { widgetVariables } = deps
return widgetVariables.read({...args,origin:authority?.origin})
    },
    async getStageLeasePresentation(args, method, serverTemplate, authority) {
      if (serverTemplate || !authority?.origin) throw new Error('Authenticated same-origin carrier required')
      const {readRoundView, assetRuntime, figureRuntimes} = deps
      const chat = await readRoundView(args.sessionId, 1)
      if (!chat || !await assetRuntime.hasBindings(chat.cardPath)) return {status:'unavailable'}
      const consumer = await assetRuntime.consumer(chat, authority.origin)
      if (!consumer?.presentation.available()) return {status:'unavailable'}
      let openingScene = null
      if (args.scene === undefined) {
        const assets = await assetRuntime.snapshot(chat.cardPath)
        if (assets) {
          const greeting = chat.messages.find(row => row.role === 'assistant' && row.greeting)
          const opening = resolveOpeningScene(assets, messageOpeningId(greeting || {}, cardGreetings(assets.raw)))
          openingScene = opening.state.scene
        }
      }
      const revision = assetRuntime.revision
      const value = await projectStageLease({consumer, actors:args.actors, scene:args.scene, openingScene,
        live2d:await figureRuntimes.available('live2d'), spine:await figureRuntimes.available('spine')})
      return revision === assetRuntime.revision ? {status:'ready', value} : {status:'stale'}
    },
    async readCardPages(args) {
      return deps.cardPages.list(args)
    },
    async readCardPage(args) {
      return { page: await deps.cardPages.read(args) }
    },
    async readCardOpening(args) {
      return { opening: await deps.cardPages.opening(args) }
    },
    async locateCardPageAsset(args) {
      return { place: await deps.cardPages.locate(args) }
    },
    async listCardPageAssets(args) {
      return { assets: await deps.cardPages.assets(args) }
    },
    async proposeWidgetVariables(args, method, serverTemplate, authority) {
      const { widgetVariables } = deps
return widgetVariables.propose(args)
    },
    async widgetVariableStatus(args, method, serverTemplate, authority) {
      const { widgetVariables } = deps
return widgetVariables.status(args)
    },
    async invalidateWidgetVariables(args, method, serverTemplate, authority) {
      const { widgetVariables } = deps
return {invalidated:widgetVariables.invalidate(args)}
    },
    async getStageModHistory(args, method, serverTemplate, authority) {
      const { modService, readRoundView, stageDirector, stageModHistoryTurns } = deps

        // The latest round view: an earlier round's performances come from its floor fields and record identity. An
        // opening's come from its card, so its floor is read in full.
        const latest=await readRoundView(args.sessionId)
        const openings=latest?.messages.filter(row=>row.role==='assistant' && row.greeting && (row.modCorrections || row.stageItems)).map(row=>Number(row.turn || 1)) || []
        const chat=openings.length?await readRoundView(args.sessionId,0,openings):latest
        return {turns:await stageModHistoryTurns(chat?.messages,turn=>stageDirector.modPerformances(chat,turn)),kinds:modService.performanceKinds()}

    },
    async getStagePerformanceKinds(args, method, serverTemplate, authority) {
      const { modService } = deps
return {kinds:modService.performanceKinds()}
    },
    async updateStageTimer(args, method, serverTemplate, authority) {
      const { stageTimer } = deps
return method==='getStageTimer'?stageTimer.read(args):stageTimer.update(args)
    },
    async getStageTimerLooks(args, method, serverTemplate, authority) {
      const { modService } = deps
return modService.builtinImages('dsh.timer')
    },
    async getStageTimerReaction(args, method, serverTemplate, authority) {
      const { STAGE_TIMER_FIELD, assetEngineSettings, assetRuntime, cardStageSwitch, readRoundView, stageDirector } = deps

        const chat=await readRoundView(args.sessionId,args.turn)
        if(!chat)return {status:'unavailable'}
        const direction=await stageDirector.get(chat,Number(args.turn),null,{readOnly:true})
        if(JSON.stringify(direction.token)!==JSON.stringify(args.expectedDirectionToken))return {status:'stale'}
        const message=chat.messages.findLast(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===Number(args.turn))
        const event=message?.[STAGE_TIMER_FIELD]?.events?.find(row=>row.id===args.eventId),ref=event?.onTimeup
        if(!ref || !await cardStageSwitch(chat.cardPath,'performance'))return {status:'unavailable'}
        const consumer=await assetRuntime.consumer(chat,authority?.origin)
        if(!consumer?.presentation.available() || !consumer.allowedPackIds.includes(ref.packId))return {status:'unavailable'}
        const metadata=await consumer.presentation.performanceMetadata([ref])
        const performance=await consumer.presentation.performance({ref,instanceKey:[event.id],phase:'entry'},{snapshots:metadata,engine:assetEngineSettings.read().values,isCurrent:()=>true})
        return performance.unavailable?{status:'unavailable'}:{status:'ready',performance}

    },
    async getStageItems(args, method, serverTemplate, authority) {
      const { cardStageSwitch, readCardWorkspace, readRoundView, stageDirector } = deps

        const chat = await readRoundView(args.sessionId,args.turn)
        if (!chat) return {enabled:false,records:[]}
        const raw = (await readCardWorkspace(chat.cardPath))?.raw
        const ids = [...new Set([...((raw?.data || raw)?.extensions?.dsh_tavern?.assetBindings?.boundPackIds || []),...(ctx.get('assetPackSettings')?.read().values.globalEnabledPackIds || [])])]
        const library = ctx.get('assetLibrary')
        const snapshots = library ? (await Promise.all(ids.map(packId => library.getPackSnapshot({packId}).catch(() => null)))).filter(Boolean) : []
        if (!await cardStageSwitch(chat.cardPath,'items')) return {enabled:false,records:[],performances:[]}
        if (args.revision === chat._storageRevision && args.waiting !== true) return {unchanged:true}
        const turn = Number(args.turn), direction = await stageDirector.get(chat,turn,null,{readOnly:true})
        const performances=(direction.modPerformances || []).filter(row=>row.kind==='core.items.item' && !row.removed).map(row=>{
          const pack=snapshots.find(pack=>pack.manifest.id===row.payload.ref.packId)
          const asset=pack?.manifest.assets.find(asset=>asset.kind==='props' && asset.id===row.payload.ref.assetId && asset.enabled)
          const image=asset && row.payload.media && pack.manifest.blobs[row.payload.media] ? {resource:true,kind:'media',ref:row.payload.ref,hash:row.payload.media,revision:pack.revision,identity:row.payload.ref.packId+':props:'+asset.id+':'+row.payload.media} : null
          return {...row,image}
        })
        return {enabled:true,revision:chat._storageRevision,branchId:chat.timeline.branchId,turn,sourceKey:direction.token?.sourceKey,generation:direction.token?.generation,records:[],performances,pending:direction.status==='running' || direction.status==='partial'}

    },
    async getCgGallery(args, method, serverTemplate, authority) {
      const { cgGallery } = deps
return cgGallery.list(args,authority?.origin)
    },
    // 回想 › 删除这张 CG: a 场景生图 entry leaves the card's pack, the gallery and its turn (scene-cg.js).
    async removeSceneCg(args) {
      return deps.sceneCg.remove({sessionId:args.sessionId, ref:args.ref})
    },
    async ackCgPlayed(args, method, serverTemplate, authority) {
      const { cgGallery } = deps
return cgGallery.ack(args,authority?.origin)
    },
    async getStagePhoneThreads(args, method, serverTemplate, authority) {
      const { readStageChat, stagePhoneDirectory } = deps

        const chat=await readStageChat.view(args.sessionId)
        return chat?stagePhoneDirectory(chat):{enabled:false,contacts:[],threads:[]}

    },
    // one contact's call, its own context window.
    async phoneCallStart(args, method, serverTemplate, authority) {
      return deps.phoneCallHost.startByContact({sessionId:args.sessionId, contactId:String(args.contactId || ''), origin:authority?.origin, at:args.at})
    },
    async phoneCallHear(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.hear({audio:args.audio, language:args.language})
    },
    async phoneCallTurn(args) {
      const { phoneCallHost, readStageChat } = deps
      const said = String(args.said || '').trim()
      if (!said) throw new Error('没有听清')
      // The call is anchored to the latest round; its recent-story section reads its own view.
      // note: the camera's quiet line for the model (FaceTime), never in the transcript.
      const note = typeof args.note === 'string' ? args.note.slice(0, 200) : ''
      return phoneCallHost.calls.turn({sessionId:args.sessionId, callId:args.callId, said, note, cue:args.cue === true, timing:args.timing, chat:await readStageChat.view(args.sessionId,{configOnly:true})})
    },
    // the call turned into a video call (its record), and a call
    // party's stage figure (`who`: a contact id or 'self') in the outfit of the page it was made from and the clause's mood.
    async phoneCallVideo(args) {
      return deps.phoneCallHost.calls.video({sessionId:args.sessionId, callId:args.callId})
    },
    async phoneCallFigure(args, method, serverTemplate, authority) {
      const at = args.at && Number.isSafeInteger(args.at.turn) && args.at.turn > 0 ? {turn:args.at.turn, ...(Number.isSafeInteger(args.at.para) && args.at.para > 0 ? {para:args.at.para} : {})} : null
      return deps.phoneCallHost.figure({sessionId:args.sessionId, who:String(args.who || ''), emotion:typeof args.emotion === 'string' && args.emotion ? args.emotion : undefined, at, origin:authority?.origin})
    },
    async phoneCallPoll(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.calls.poll({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, says:Number(args.says) || 0, subs:Number(args.subs) || 0, waitMs:Number(args.waitMs) || 0})
    },
    async phoneCallAlive(args) {
      return deps.phoneCallHost.calls.alive({sessionId:args.sessionId, callId:args.callId})
    },
    // her cached greeting sounded as she picked up: it enters the call's record
    async phoneCallGreeted(args) {
      return deps.phoneCallHost.calls.greeted({sessionId:args.sessionId, callId:args.callId})
    },
    async phoneCallTtsRequested(args, method, serverTemplate, authority) {
      return deps.phoneCallHost.calls.ttsRequested({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, origin:authority?.origin})
    },
    async phoneCallHeard(args) {
      return deps.phoneCallHost.calls.heard({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, heard:args.heard, timing:args.timing})
    },
    async phoneCallInterrupt(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.calls.interrupt({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, heard:args.heard, timing:args.timing, retract:args.retract === true})
    },
    async phoneCallEnd(args) {
      const { phoneCallHost } = deps
      return phoneCallHost.calls.end({sessionId:args.sessionId, callId:args.callId, turnId:args.turnId, heard:args.heard, timing:args.timing})
    },
    async phoneCallThreads(args, method, serverTemplate, authority) {
      const { phoneCallHost, readStageChat } = deps
      // Dev diagnostics: each phase's wall time, logged and returned as `timing`.
      const started = performance.now(), timing = {}
      const timed = async (name, work) => { const at = performance.now(); try { return await work } finally { timing[name] = Math.round(performance.now() - at) } }
      const chat = await timed('chatMs', readStageChat.view(args.sessionId,{configOnly:true}))
      // The call button shows only where calls can work: local speech recognition answering (started here when it is set
      // up but not running; `starting` asks the page to look again). `voices`: the phone's 电话 app also asks which
      // contacts have a voice to call with.
      const readiness = chat ? await timed('readinessMs', phoneCallHost.readiness()) : {available:false}
      if (!chat) return {threads:{}, ...readiness}
      const [calls, facts] = await Promise.all([timed('callsMs', phoneCallHost.calls.threads({chat})),
        args.voices === true ? timed('contactsMs', phoneCallHost.directoryFacts(args.sessionId, authority?.origin)) : null])
      timing.totalMs = Math.round(performance.now() - started)
      if (facts) { timing.contacts = Object.keys(facts.voices).length; console.info('[dsh-tavern.phone-directory]', JSON.stringify(timing)) }
      // The 电话 app opened: the contacts called before in this chat get their pick-up greeting ready in idle time.
      if (facts) phoneCallHost.wantGreetings({sessionId:args.sessionId, origin:authority?.origin, contactIds:Object.keys(calls.threads).filter(id => facts.voices[id])})
      return {...calls, ...(facts || {}), ...readiness, timing}
    },
    async getStagePhonePresentation(args, method, serverTemplate, authority) {
      const { modService, readRoundOps, readRoundView, stageDirector } = deps

        if(!Number.isSafeInteger(args.turn) || args.turn<1)return {status:'failed',widgets:[]}
        // Of the page's latest 20 rounds, the earlier ones whose beats mark a phone message are read with their records;
        // every other floor stays an identity row.
        const marks=await readRoundOps(args.sessionId,args.turn,20)
        if(!marks)return {status:'revoked',widgets:[]}
        const rounds=phoneRounds(marks.records)
        const read=()=>readRoundView(args.sessionId,args.turn,rounds)
        const chat=await marks.view(rounds)
        if(!chat)return {status:'revoked',widgets:[]}
        const direction=await stageDirector.get(chat,Number(args.turn),null,{readOnly:true})
        if(JSON.stringify(direction.token)!==JSON.stringify(args.expectedDirectionToken) || !Number.isSafeInteger(args.at) || args.at<1 || args.at>direction.through)return {status:'stale',widgets:[]}
        let view
        const found=[]
        for(const message of chat.messages.filter(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))<=args.turn).slice(-20).reverse()) {
          const turn=Number(message.turn || (message.greeting?1:0))
          // An earlier round without a phone mark adds nothing (the record the director restores is the floor's own); a
          // floor without a record has no phone view.
          if(turn!==args.turn && !rounds.includes(turn))continue
          const candidate=turn===args.turn?direction:await stageDirector.get(chat,turn,null,{readOnly:true})
          const record=candidate.record || candidate.preview,bound=record?.binding.mods?.sourceViews?.phone
          if(!bound)continue
          let used=false
          for(const entry of record.entries) {
            if(entry.at>candidate.through || turn===args.turn && entry.at>args.at)continue
            if(entry.ops.some(phoneMark)) {view ||= bound;used=true}
          }
          if(used)found.push({turn,token:candidate.token})
        }
        const authorizeSource=async()=>{
          const latest=await read()
          if(!latest || latest.id!==chat.id || latest.cardPath!==chat.cardPath || latest.timeline.branchId!==chat.timeline.branchId)return false
          const checked=await stageDirector.get(latest,Number(args.turn),null,{readOnly:true})
          if(JSON.stringify(checked.token)!==JSON.stringify(direction.token))return false
          for(const source of found)if(JSON.stringify((await stageDirector.get(latest,source.turn,null,{readOnly:true})).token)!==JSON.stringify(source.token))return false
          return true
        }
        const widgets=view?await modService.readPhonePresentation({chat,direction,at:args.at,view}):[]
        return await authorizeSource()?{status:'ready',widgets}:{status:'stale',widgets:[]}

    },
    async getAssetPackPresentation(args, method, serverTemplate, authority) {
      const { STAGE_PLAYBACK_FIELD, assetEngineSettings, assetRuntime, cardStageSwitch, cgGallery, chatPersistence, deletedChatIds, modService, patchStagePlayback, readRoundOps, readRoundView, readStageProjection, readWidgetWindowProjection, requestPerformance, figureRuntimes, stageDirector, stageTimer, view } = deps

        if (Object.hasOwn(args,'widgetWindow')) {
          // One turn view per request, naming the earlier rounds whose beats mark this widget: later reads in the same
          // request are cache hits unless the chat changed meanwhile.
          const turn = Number(args.turn) || 0, marks = args.widgetWindow?.ref ? await readRoundOps(args.sessionId,turn,20) : null
          const rounds = marks ? widgetSourceRounds(marks.records,args.widgetWindow.ref) : []
          const read = () => readRoundView(args.sessionId,turn,rounds)
          const initial = marks ? await marks.view(rounds) : await read()
          let current = Boolean(initial)
          const chat = async () => {
            const value = await read()
            if (!value || value.id !== initial?.id || value.cardPath !== initial?.cardPath) current = false
            return current ? value : null
          }
          return readWidgetWindowProjection({...args,revision:() => assetRuntime.revision,readSettings:() => assetEngineSettings.read(),isCurrent:() => current,
            readTurns:async () => (await chat())?.messages.filter(m => m.role === 'assistant').map(m => Number(m.turn || (m.greeting ? 1 : 0))) || [],
            // An earlier round that marks no source of this widget adds nothing; its direction is not read.
            readDirection:async number => {const value=await chat();return value && (number === turn || rounds.includes(number)) ? stageDirector.get(value,number,null,{readOnly:true}) : {token:null}},
            readConsumer:async () => {const value=await chat();return value ? assetRuntime.consumer(value,authority?.origin) : null}
          })
        }
        // the runtime is the only stage projection consumer.
        // Live2D needs both Core and display; otherwise retain the missing-runtime prompt and static fallback.
        const live2d = await requestPerformance.stage('projection.live2d', () => figureRuntimes.available('live2d')), spine = await requestPerformance.stage('projection.spine', () => figureRuntimes.available('spine'))
        const read = () => readRoundView(args.sessionId,args.turn)
        const chat=await requestPerformance.stage('projection.chat', read)
        // A round that binds mod source views (the phone, widget windows) asks next for the marks in its latest 20 rounds:
        // their beats, then the rounds that carry a phone mark or a widget source, are read while this page projects.
        const turn=Number(args.turn),current=chat?.messages.find(row => row.role === 'assistant' && Number(row.turn || (row.greeting ? 1 : 0)) === turn)
        if (current?.stageDirectionAssetPacks?.binding?.mods?.sourceViews) void (async () => {
          const marks=await readRoundOps(args.sessionId,turn,20)
          if (!marks) return
          const marked=[...new Set([...phoneRounds(marks.records),...widgetSourceRounds(marks.records)])]
          if (marked.length) await marks.view(marked)
        })().catch(() => {})
        const performanceEnabled=!!chat && await cardStageSwitch(chat.cardPath,'performance')
        return cgGallery.project(args,() => readStageProjection({
          ...args, trace:requestPerformance, live2d, spine, performanceEnabled, revision:() => assetRuntime.revision, readSettings:() => assetEngineSettings.read(),
          readCountdown:async ({direction,at}) => stageTimer.read({sessionId:args.sessionId,turn:Number(args.turn),at,expectedDirectionToken:direction.token,mode:args.history?'history':'live'}),
          readModSources:async ({direction,at,state}) => {
            const chat=await read()
            return chat?modService.readPhonePresentation({chat,direction,at,state}):[]
          },
          readPlayback:async () => (await read())?.messages.find(m => m.role === 'assistant' && Number(m.turn || (m.greeting ? 1 : 0)) === Number(args.turn))?.[STAGE_PLAYBACK_FIELD],
          writePlayback:async (direction,metadata,assetRevision) => {
            const chat = await read()
            // Exact-revision, one-floor CAS; never materialize/rewrite the whole archive.
            return patchStagePlayback(chat,Number(args.turn),direction,metadata,{
              patch:chatPersistence.patch,
              assertCurrent:() => {
                if (deletedChatIds.has(chat.id) || assetRuntime.revision !== assetRevision) throw Object.assign(new Error('Stage assets changed'),{code:'REVISION_CONFLICT'})
              }
            })
          },
          readDirection:async () => {
            const chat = await read()
            return chat ? requestPerformance.stage('projection.direction', () => stageDirector.get(chat,Number(args.turn),null,{readOnly:true,includePredecessor:true})) : {token:null}
          },
          readConsumer:async () => {
            const chat = await read()
            return chat?.cardPath ? requestPerformance.stage('projection.consumer', () => assetRuntime.consumer(chat,authority?.origin)) : null
          }
        }))

    },
    async saveStagePlaybackMeasurement(args, method, serverTemplate, authority) {
      const { STAGE_PLAYBACK_FIELD, addStageMeasurement, chatForSession, rawUpdateChat, saveStagePlayback, stageDirector } = deps

        const chat = await chatForSession(args.sessionId)
        const direction = await stageDirector.get(chat,Number(args.turn),null,{readOnly:true})
        if (JSON.stringify(direction.token) !== JSON.stringify(args.expectedDirectionToken)) throw Object.assign(new Error('Stale stage measurement'),{code:'REVISION_CONFLICT'})
        await rawUpdateChat(chat.id,current => {
          const message = current.messages.find(m => m.role === 'assistant' && Number(m.turn || (m.greeting ? 1 : 0)) === Number(args.turn))
          const previous = message?.[STAGE_PLAYBACK_FIELD]
          const saved = saveStagePlayback(current,Number(args.turn),direction,addStageMeasurement(previous,direction,args.measurement))
          return saved === previous ? undefined : current
        },{source:'stage-playback.measurement',touchUpdatedAt:false})
        return {saved:true}

    },
    async openAssetPackVoice(args, method, serverTemplate, authority) {
      const { assetRuntime, chatForSession } = deps

        const chat = await chatForSession(args?.sessionId)
        const consumer = chat?.cardPath && await assetRuntime.consumer(chat,authority?.origin)
        return consumer ? consumer.speech.open(args?.narrator === true ? NARRATOR_VOICE : args?.general === true ? GENERAL_VOICE : args?.alias) : {available:false,diagnostics:['voice-unbound']}

    },
    async getStageMusicTracks(args, method, serverTemplate, authority) {
      const { assetRuntime, readStageChat, requestPerformance, view } = deps

        // the BGM player's list; the card's bound packs only.
        const chat = await requestPerformance.stage('music.chat', () => readStageChat.view(args?.sessionId,{configOnly:true}))
        const consumer = chat?.cardPath && await requestPerformance.stage('music.consumer', () => assetRuntime.consumer(chat,authority?.origin))
        return {tracks:consumer ? await requestPerformance.stage('music.tracks', () => consumer.presentation.musicTracks()) : []}

    },
    async getStageBackgrounds(args, method, serverTemplate, authority) {
      const { assetRuntime, readStageChat, requestPerformance, view } = deps

        // the manual background picker's list; bound packs only.
        const chat = await requestPerformance.stage('backgrounds.chat', () => readStageChat.view(args?.sessionId,{configOnly:true}))
        const consumer = chat?.cardPath && await requestPerformance.stage('backgrounds.consumer', () => assetRuntime.consumer(chat,authority?.origin))
        return {backgrounds:consumer ? await requestPerformance.stage('backgrounds.list', () => consumer.presentation.backgrounds()) : []}

    },
    async getCardVariableBindings(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.readVariables(args || {})
    },
    async setCardVariableBinding(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.setVariable(args || {})
    },
    async clearCardVariableBinding(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.clearVariable(args || {})
    },
    async readCardVariables(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.readCardVariables(args || {})
    },
    async listCardVariableSlots(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.listVariableSlots(args || {})
    },
    async copyWidgetToCardPack(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.copyWidget(args || {})
    },
    async detectStageSetupCharacters(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.detectCharacters(args || {})
    },
    async getCardAssetBindings(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.inspect(args || {})
    },
    async saveCardAssetBindings(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.update(args || {})
    },
    async getCardOpeningScenes(args, method, serverTemplate, authority) {
      const { assetRuntime, describeOpeningScenes, path, readCardWorkspace, readCardAssetExtension } = deps

        const workspace = await readCardWorkspace(args?.path)
        if (!workspace) throw Object.assign(new Error('Card not found'), {code:'NOT_FOUND'})
        const snapshot = await assetRuntime.snapshot(args.path)
        return {...describeOpeningScenes(workspace.raw, snapshot), entranceChoices:snapshot ? stageEntranceChoices(readCardAssetExtension(workspace.raw), snapshot.snapshots, snapshot.engine) : []}

    },
    async getAssetPackDependencies(args, method, serverTemplate, authority) {
      const { cardAssetBindings } = deps
return cardAssetBindings.dependencies(args || {})
    },
    async getFigureVoiceEditor(args, method, serverTemplate, authority) {
      const { figureVoiceAuthoring } = deps
return figureVoiceAuthoring.editor(args || {})
    },
    async listFigureVoiceChoices(args, method, serverTemplate, authority) {
      const { figureVoiceAuthoring } = deps
return figureVoiceAuthoring.choices()
    },
    async assignFigureVoice(args, method, serverTemplate, authority) {
      const { figureVoiceAuthoring } = deps
return figureVoiceAuthoring.assign(args || {})
    },
    async previewFigureVoice(args, method, serverTemplate, authority) {
      const { figureVoiceAuthoring } = deps
return figureVoiceAuthoring.preview(args || {},authority?.origin)
    },
    async openFigureVoicePreview(args, method, serverTemplate, authority) {
      const { figureVoiceAuthoring } = deps
return figureVoiceAuthoring.open(args || {},authority?.origin)
    },
    async closeFigureVoicePreview(args, method, serverTemplate, authority) {
      const { figureVoiceAuthoring } = deps
return figureVoiceAuthoring.close(args || {})
    },
    async getAssetVoiceServices(args, method, serverTemplate, authority) {
      const {  } = deps

        const tts = ctx.get('tts')
        return { services: tts?.apiVersion === 1 ? await tts.listServices() : [] }

    },
    async evaluateJudge(args) { return deps.judgeRpc.evaluateJudge(args) },
    async testJudgeConnection(args, method, serverTemplate, authority) {
      const { judgeRpc } = deps
return judgeRpc[method](args)
    },
    async getDirectorToolSupport(args, method, serverTemplate, authority) {
      const { directorProbeRpc } = deps
return directorProbeRpc.getDirectorToolSupport()
    },
    async testDirectorConnection(args, method, serverTemplate, authority) {
      const { directorProbeRpc } = deps
 const {_performance,_traceId,...input} = args || {}; return directorProbeRpc.testDirectorConnection(input)
    },
    async getAssetEngineSettings(args, method, serverTemplate, authority) {
      const { assetEngineSettings } = deps
return assetEngineSettings.read()
    },
    async saveAssetEngineSettings(args, method, serverTemplate, authority) {
      const { assetEngineSettings, dialogueBubbles, fileResources, hasCardAssetBindings, readCardWorkspace, worldBooks } = deps

        const result = await assetEngineSettings.save(args || {})
        // P6 dialogue settings are global; refresh every opted-in card, not just the open chat.
        for (const path of await fileResources.list('card')) {
          if (hasCardAssetBindings((await readCardWorkspace(path))?.raw)) await dialogueBubbles.sync(worldBooks, path)
        }
        return result

    },
    async importAssetEnginePreset(args, method, serverTemplate, authority) {
      const { assetEngineSettings, importPreset } = deps
return assetEngineSettings.importPreset(args || {})
    },
    async exportAssetEnginePreset(args, method, serverTemplate, authority) {
      const { assetEngineSettings } = deps
return assetEngineSettings.exportPreset(args || {})
    },
    async previewStageDirectorPrompt(args, method, serverTemplate, authority) {
      const { chatForSession, dialogueBubbles, stageDirector, str } = deps

        const chat = await chatForSession(str(args && args.sessionId))
        if (!chat) throw new Error('找不到当前对话')
        return await stageDirector.preview(chat, Number(args?.turn) || 0, await dialogueBubbles.read(chat.cardPath))

    },
    async getModStageViews(args, method, serverTemplate, authority) {
      const { modService, str } = deps
return modService.stageViews(str(args?.sessionId),authority)
    },
    async notifyModPresentation(args, method, serverTemplate, authority) {
      const { modService } = deps

        const {sessionId,_performance,_traceId,...input}=args || {}
        return modService.presentation(sessionId,input,authority)

    },
    async getRoundBody(args, method, serverTemplate, authority) {
      const { activeRoundBodies, activeTurnOf, agentRegistry, readChatCard, readRoundView, replyDisplayForChat, view } = deps

        const chat = await readRoundView(args?.sessionId,args?.turn)
        if (!chat) return null
        const turn = Number(args?.turn)
        const cached = activeRoundBodies.get(chat.sessionId)
        const active = cached?.branchId === chat.timeline?.branchId ? cached : null
        if (active?.turn === turn && activeTurnOf({agent:agentRegistry.get(chat.sessionId)}) === turn) return active.body
        const display = await replyDisplayForChat(chat,await readChatCard(chat),true)
        return display.projections.find(item => item.turn === turn)?.body || (active?.turn === turn ? active.body : null)

    },
    async getStageDirection(args, method, serverTemplate, authority) {
      const { chatForSession, readRoundView, requestPerformance, stageDirector, view } = deps

        const chat = await requestPerformance.stage('direction.chat', () => args?.readOnly === true ? readRoundView(args.sessionId,args.turn) : chatForSession(args?.sessionId))
        if (!chat) return args?.readOnly === true ? {status:'off',phase:'off',revision:0,token:null,generation:0} : {status:'off'}
        // The director owns its frozen binding; its unused config argument must not hydrate today's catalogue.
        return await requestPerformance.stage('direction.get', () => stageDirector.get(chat, Number(args && args.turn), null, args?.readOnly === true ? {readOnly:true, sinceRevision:args.sinceRevision} : {}))

    },
    async generateStageDirection(args, method, serverTemplate, authority) {
      const { chatForSession, dialogueBubbles, stageDirector } = deps

        const chat = await chatForSession(args?.sessionId)
        if (!chat) throw new Error('找不到当前对话')
        return await stageDirector.generate(chat, Number(args?.turn), await dialogueBubbles.read(chat.cardPath))

    },
    async retryStageDirection(args, method, serverTemplate, authority) {
      const { chatForSession, dialogueBubbles, stageDirector, str } = deps

        const chat = await chatForSession(args && args.sessionId)
        if (!chat) return { ok: false }
        // explicit redirection replaces even a successful record; observers remain read-only.
        const turn = Number(args?.turn)
        const reset = await stageDirector.retry(chat, turn, {regenerate:true})
        await stageDirector.get(reset.chat, turn, await dialogueBubbles.read(chat.cardPath), {generate:true, guidance:str(args?.guidance).trim()})
        return reset

    },
    // The stage's 重新生成 › 舞台指导 停止: that round's director only (停止后台 does not list a director).
    async stopStageDirection(args, method, serverTemplate, authority) {
      const { stageDirector, str } = deps

        stageDirector.cancel({ sessionId: str(args?.sessionId) }, Number(args?.turn))
        return { ok: true }

    },
    async previewForegroundVoicePlan(args, method, serverTemplate, authority) {
      const { chatForSession, foregroundCapabilities } = deps

        const chat = await chatForSession(args?.sessionId)
        if (!chat) throw new Error('Chat not found')
        const current = await foregroundCapabilities.preview(chat)
        const next = await foregroundCapabilities.preview(chat,{nextRound:true})
        return {dirty:JSON.stringify(current)!==JSON.stringify(next),injection:next}

    },
    async refreshForegroundCapabilities(args, method, serverTemplate, authority) {
      const { agentRegistry, chatForSession, foregroundCapabilities } = deps

        const chat = await chatForSession(args?.sessionId)
        if (!chat) throw new Error('Chat not found')
        if (agentRegistry.get(args.sessionId)?.phase?.kind === 'running') throw new Error('Wait until the current turn completes')
        return {injection:await foregroundCapabilities.refresh(chat,args.expectedInjection)}

    },
    async getDialogueBubbles(args, method, serverTemplate, authority) {
      const { DEFAULT_BUBBLE_TEMPLATE, assetEngineSettings, bubbleInjection, bubbleInstructionPreview, dialogueBubblePresets, dialogueBubbles, foregroundCapabilities, readDialogueBubblePlacement, readStageChat, requestPerformance, str, view, worldBooks } = deps

        const chat = await requestPerformance.stage('config.chat', () => readStageChat.view(args?.sessionId,{configOnly:true}))
        const prepared = await requestPerformance.stage('config.bubbles', () => dialogueBubbles.snapshot(chat && chat.cardPath))
        const config = prepared.config
        const placement = chat?.cardPath ? await requestPerformance.stage('config.placement', () => readDialogueBubblePlacement(worldBooks, chat.cardPath, config.injection.placement)) : null
        const nativeForeground = chat && chat.requestMode !== 'sillytavern' && ['story','script'].includes(chat.mode || 'story')
        const injection = nativeForeground ? await requestPerformance.stage('config.foreground', () => foregroundCapabilities.preview(chat,{readConfig:()=>prepared.requireAvailable()})) : bubbleInjection(config, { userName: chat?.macroState?.userName })
        return { engineSettings:assetEngineSettings.read(), cardPath: chat ? str(chat.cardPath) : '', cardName: chat ? str(chat.cardName) : '', userName: chat && chat.macroState ? str(chat.macroState.userName) : '', config, defaultTemplate: DEFAULT_BUBBLE_TEMPLATE, presets: await dialogueBubblePresets.list(), ...bubbleInstructionPreview(config, { userName: chat?.macroState?.userName }), injection, placement: nativeForeground && placement ? {...placement,entries:[]} : placement }

    },
    async getDialogueBubblePresets(args, method, serverTemplate, authority) {
      const { dialogueBubblePresets } = deps
return { presets: await dialogueBubblePresets.list() }
    },
    async saveDialogueBubblePreset(args, method, serverTemplate, authority) {
      const { dialogueBubblePresets } = deps
return { preset: await dialogueBubblePresets.upsert(args && args.preset) }
    },
    async deleteDialogueBubblePreset(args, method, serverTemplate, authority) {
      const { dialogueBubblePresets } = deps
return await dialogueBubblePresets.remove(args && args.presetId)
    },
    async previewDialogueBubbleInstruction(args, method, serverTemplate, authority) {
      const { bubbleInstructionPreview, chatForSession, normalizeBubbleConfig } = deps

        const chat = await chatForSession(args && args.sessionId)
        const config = normalizeBubbleConfig(args && args.config)
        return { config, ...bubbleInstructionPreview(config, { userName: chat?.macroState?.userName }), warnings: config.voiceWarnings || [] }

    },
    async prepareAssetGeneration(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.prepare(args))
    },
    async generateAssetCandidate(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.generate(args))
    },
    async getAssetGenerationJob(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.get(args))
    },
    async cancelAssetGenerationJob(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.cancel(args))
    },
    async listAssetCandidates(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.list(args))
    },
    async readAssetCandidate(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.read(args))
    },
    async rejectAssetCandidate(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.reject(args))
    },
    async retryAssetCandidateSave(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.retrySave(args))
    },
    async acceptAssetCandidate(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.accept(args))
    },
    async getAssetGenPrompts(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.prompts())
    },
    async setAssetGenPrompt(args, method, serverTemplate, authority) {
      const { assetGeneration, assetGenerationResult } = deps
return assetGenerationResult(() => assetGeneration.setPrompt(args))
    },
  }
}
