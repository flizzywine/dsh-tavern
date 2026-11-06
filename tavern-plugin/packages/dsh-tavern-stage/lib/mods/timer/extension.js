import {createStageTimerService} from './stage-service.js'
import {stageReadCarries} from '../../../../../lib/domain/stage-read-projection.js'

export function createTimerExtension(core) {
  const {cardStageSwitch,managedModManagement,readRoundView,stageDirector,chatPersistence,modService} = core
  // core.performance follows the card's stage switch in effect (the card's own choice with the global stageToggles).
  const stageControllerEnabled = (chat, consumer) => consumer === 'core.performance'
    ? cardStageSwitch(chat.cardPath,'performance')
    : managedModManagement.enabled({modId:consumer,cardPath:chat.cardPath})

  const stageTimer = createStageTimerService({readChat:(sessionId,turn)=>readRoundView(sessionId,turn),
    // The clock reads the latest round's view; its latest saved timer may sit on an earlier round, read with that round.
    readDirection:async (chat,turn)=>stageDirector.get(stageReadCarries(chat,turn) ? chat : await readRoundView(chat.sessionId,turn),turn,null,{readOnly:true}),patchChat:chatPersistence.patch,
    enabled:chat=>managedModManagement.enabled({modId:'dsh.timer',cardPath:chat.cardPath}),
    controllerEnabled:stageControllerEnabled,publish:({sessionId,event})=>modService.stageEvent(sessionId,event)})
  return {deps:{stageTimer},dispose:() => stageTimer.dispose()}
}
