import {createStageTimerService,STAGE_TIMER_FIELD} from './stage-service.js'
import {TIMER_MOD_ID} from '../state.cjs'

// The timer's stage service (stage contribution hostExtension): the countdown clock and its own RPC methods.
export function createTimerExtension(core) {
  const {stage,cardStageSwitch,managedModManagement,readRoundView,stageDirector,chatPersistence,modService,assetRuntime,assetEngineSettings} = core
  // core.performance follows the card's stage switch in effect (the card's own choice with the global stageToggles).
  const stageControllerEnabled = (chat, consumer) => consumer === 'core.performance'
    ? cardStageSwitch(chat.cardPath,'performance')
    : managedModManagement.enabled({modId:consumer,cardPath:chat.cardPath})

  const stageTimer = createStageTimerService({stage,readChat:(sessionId,turn)=>readRoundView(sessionId,turn),
    // The clock reads the latest round's view; its latest saved timer may sit on an earlier round, read with that round.
    readDirection:async (chat,turn)=>stageDirector.get(stage.readCarries(chat,turn) ? chat : await readRoundView(chat.sessionId,turn),turn,null,{readOnly:true}),patchChat:chatPersistence.patch,
    enabled:chat=>managedModManagement.enabled({modId:TIMER_MOD_ID,cardPath:chat.cardPath}),
    controllerEnabled:stageControllerEnabled,publish:({sessionId,event})=>modService.stageEvent(sessionId,event)})

  // The performance a reached timeup names (its onTimeup ref), resolved for the asking page.
  async function reaction(args,authority) {
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
  }
  const methods={
    getStageTimer:args=>stageTimer.read(args),
    updateStageTimer:args=>stageTimer.update(args),
    getStageTimerLooks:()=>modService.builtinImages(TIMER_MOD_ID),
    getStageTimerReaction:reaction,
  }
  return {deps:{stageTimer},requests:{methods:Object.keys(methods),call:(method,args,authority)=>methods[method](args,authority)},dispose:() => stageTimer.dispose()}
}
