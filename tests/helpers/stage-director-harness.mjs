import {modelRequest} from './director-model-call.mjs' // fake models use the request DTO.
import { createStageDirector } from '../../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-director.js'
import { createAssetRuntime } from '../../tavern-plugin/packages/dsh-tavern-stage/lib/asset-runtime.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../../tavern-plugin/lib/domain/background-task-coordinator.js'
import { stageEnabledExtension } from './stage-enabled-settings.mjs'
import { defaultAssetEngineSettings } from '../../tavern-plugin/lib/domain/asset-engine-settings.js'
import { createSessionSignalTransport } from '../../tavern-plugin/lib/domain/session-signal-transport.js'
import { syntheticPack, cardExtension, PACK_ID } from '../fixtures/asset-packs/pack.mjs'
const clone = value => structuredClone(value)
export const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r}); return {promise,resolve}}
export const answer = {sequence:1, through:2, done:true, beats:[{at:1,ops:[{op:"scene.set", background:{packId:PACK_ID,kind:'backgrounds',assetId:'classroom'}, time:'day'}]},{at:2,ops:[{op:"scene.set", background:{packId:PACK_ID,kind:'backgrounds',assetId:'classroom'}, time:'dusk'}]}]}
export const GREETINGS = ['Synthetic greeting.\n\nSynthetic hello.', 'Alternate greeting.']
// `greeting` starts the chat with a card greeting (turn 1) instead of a directed reply.
export async function fixture(model, {bound = true, tts, getBinding, greeting = false, extension = stageEnabledExtension(cardExtension()), sessionId = 'session', paragraphParts, bodyForTurn, timedWidgets = false, configurePack, engineValues = {}, foreground, judge, mods, log} = {}) {
  const pack = await syntheticPack(), packListeners = new Set(), engineListeners = new Set(), effects = []
  // new-schema tests author figures explicitly without changing legacy-record fixtures.
  configurePack?.(pack)
  if (timedWidgets) {pack.widgets.clock.lifetime = {until:'explicit',durationSeconds:600};extension.stage={...extension.stage,widgets:true}} // card opt-in
  let reads = 0, engineRevision = 'engine-1'
  const workspace = {meta:{id:'card-a'}, raw:{name:'Card',first_mes:GREETINGS[0],alternate_greetings:GREETINGS.slice(1),extensions:bound ? {dsh_tavern:extension} : {dsh_tavern:{old:true}}}}
  const library = {apiVersion:2,
    async leaseMedia({hash}) {return {revision:'pack-1',ticket:hash,url:'/fixture/'+hash,expiresAt:Date.now()+60000}},
    async leaseBundle({bundleKey}) {return {revision:'pack-1',ticket:bundleKey,url:'/fixture/'+bundleKey,expiresAt:Date.now()+60000}},
    releaseLease() {}, subscribe(fn) {packListeners.add(fn); return () => packListeners.delete(fn)},
    async getPackSnapshot({packId}) {reads++; return packId === PACK_ID ? {...pack,revision:'pack-1'} : null},
    async resolveAssets({refs}) {return refs.map(ref => ({ref,revision:'pack-1',value:pack.manifest.assets.find(a => a.kind === ref.kind && a.id === ref.assetId), diagnostics:[]}))},
    async resolveFigures({refs}) {return refs.map(ref => ({ref,value:pack.figures[ref.figureId],revision:'pack-1',diagnostics:[]}))}}
  if (tts) {
    Object.values(pack.figures)[0].voice = {id:'fixture/voice',language:'ja',preset:{kind:'azure',label:'Fixture',languages:['ja'],params:{voiceName:'ja-JP-NanamiNeural'}}}
  }
  const services = new Map([['assetLibrary',library],...(tts ? [['tts',tts]] : [])])
  const ctx = {get:key => services.get(key), inject(names, fn) {if(names.every(name => services.has(name))) fn(this)}, effect(fn) {effects.push(fn())}}
  // engineValues overrides engine settings (e.g. directorModel).
  const engineSettings = {read:() => ({values:{...defaultAssetEngineSettings(),...engineValues},revision:engineRevision}), subscribe(fn) {engineListeners.add(fn); return () => engineListeners.delete(fn)}}
  const assets = createAssetRuntime({ctx,readWorkspace:async () => clone(workspace),engineSettings,getBinding})
  const signals = createSessionSignalTransport()
  let n = 0, director
  const timeline = createStoryTimeline({id:prefix => prefix + ++n, now:() => n})
  let chat = timeline.apply({chat:{id:'chat',sessionId,cardPath:'cards/a.json',mode:'story',messages:[]},intent:{kind:'ensure'}}).chat
  if (typeof greeting === 'object') chat.messages.push({role:'assistant',turn:1,greeting:true,...greeting})
  else if (greeting) chat.messages.push({role:'assistant',turn:1,greeting:true,text:GREETINGS[0],sourceText:GREETINGS[0]})
  else {
    const begun = timeline.apply({chat,intent:{kind:'body.begin',turn:1,userText:'Continue'}})
    chat = timeline.complete({chat:begun.chat, operationId:begun.value.operationId,basedOn:begun.value.basedOn,outcome:{status:'success'},apply(draft) {draft.messages.push({role:'assistant',turn:1,text:'Synthetic fixture.\n\nSynthetic dusk.'})}}).chat
  }
  const store = {readChat:async () => clone(chat),writeChat:async value => {chat = clone(value); director?.observe(chat)},updateChat:async (_id, fn) => {chat = fn(clone(chat)) ?? chat; director?.observe(chat); return clone(chat)}}
  const tasks = createBackgroundTaskCoordinator({store,timeline,presentationActivity:chat => ({director:director?.activity(chat)})}) // production deploy-gate projection
  const calls = []
  director = createStageDirector({assets, judge, mods, paragraphParts, bodyForTurn, log, // fake judge injection
    updateChat:store.updateChat, readChat:store.readChat,
    publish:event => signals.publish(event.sessionId,event), readTaskChat:store.readChat,
    writeMessage:async (_id,index,mutate) => {const next = clone(chat); if (!next.messages[index]) return false; mutate(next.messages[index]); chat = next; director?.observe(chat); return true}, /* the director runs on the chat model (foreground) */ foreground:foreground || (async () => ({provider:'fake',model:'fake'})),
    resetTask:async (_chat,turn,{regenerate,imageReplay}) => {const message=chat.messages.find(message=>message.turn===turn);message.stageDirectionGeneration = (message.stageDirectionGeneration || 0) + 1; delete message.stageDirectionAssetPacksDraft; if (imageReplay) message.stageDirectionAssetPacksDraft = {imageReplay}; delete message.stageDirectionAssetPacksFailure; if(regenerate) delete message.stageDirectionAssetPacks; return clone(chat)},
    runAgent:async request => {calls.push(request); await model(modelRequest(request))}})
  return {director,signals,tasks,calls,assets,services,workspace,engineSettings,ctx, store, read:() => clone(chat), reads:() => reads,
    // stream tests exercise an actually running body operation before commit.
    beginReply(turn) {
      const begun = timeline.apply({chat,intent:{kind:'body.begin',turn,userText:'Continue'}})
      chat = begun.chat; director.observe(chat)
      return begun.value
    },
    commitReply(operation,turn,text) {
      chat = timeline.complete({chat,operationId:operation.operationId,basedOn:operation.basedOn,outcome:{status:'success'},apply(draft) {draft.messages.push({role:'assistant',turn,text})}}).chat
      director.observe(chat)
    },
    appendReply(turn) {
      const begun = timeline.apply({chat,intent:{kind:'body.begin',turn,userText:'Continue'}})
      chat = timeline.complete({chat:begun.chat,operationId:begun.value.operationId,basedOn:begun.value.basedOn,outcome:{status:'success'},apply(draft) {draft.messages.push({role:'assistant',turn,text:'Synthetic fixture.\n\nSynthetic dusk.'})}}).chat
      director.observe(chat)
    },
    changePack(event = {}) {for(const fn of packListeners) fn({packId:PACK_ID,...event})},
    changeEngine() {engineRevision += 'x'; for(const fn of engineListeners) fn()},
    branch() {chat.timeline.branchId += '-new'; director.observe(chat)},
    async dispose() {await director.dispose(); assets.dispose(); for(const off of effects) off?.()}}
}

