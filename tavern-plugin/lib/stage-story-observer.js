import {roundBody, streamTailClosed} from './domain/round-body.js'

// Stage-owned adapter. Core saves and streams know only optional observers.
export function createStageStoryObserver({settlementQueued, modService, stageDirector, chatPersistence,
  chatHeaderForSession, dialogueBubbles, readStageChat, readReplyPrefix, activeRoundBodies}) {
  return {
    modelChanged:() => modService.invalidate(),
    cardChanged:() => modService.invalidate(),
    cancelled:sessionId => stageDirector.cancel({sessionId:String(sessionId)}),
    settlementQueued,
    saved(chat, metadata) {
      // The director already forwards this observation to its mod runtime.
      if (chat) return stageDirector.observe(chat, metadata)
    },
    async patched(saved, changes, signal) {
      const sourceChanged = changes.some(change => change.path?.length === 0 || change.path?.[0] === 'messages'
        && (change.path.length < 3 || ['role', 'turn', 'greeting', 'text', 'sourceText', 'swipes', 'swipeId'].includes(change.path[2])))
      if (!sourceChanged) return
      const projection = await chatPersistence.readSceneImageState(saved.id)
      if (!signal?.aborted && projection) return stageDirector.observe({...saved, messages:projection.messages})
    },
    disconnected:ids => modService.disconnected(ids),
    async beginReply(sessionId,turn,signal) {
      if (!Number.isSafeInteger(turn)) return null
      // The streaming round body (getRoundBody) is the stage's alone: a card without one reads no stage view and
      // re-splits no reply on every delta. Admission runs independently of the first token.
      const header = await chatHeaderForSession(sessionId, ['cardPath'])
      const config = header?.cardPath ? await dialogueBubbles.read(header.cardPath) : null
      if (signal?.aborted || !config?.enabled) return null
      const chat = await readStageChat(sessionId)
      if (signal?.aborted || !chat) return null
      const director = config?.enabled && config.stage?.director === true ? await stageDirector.beginStream(chat,turn) : null
      if (signal?.aborted) { await director?.cancel(); return null }
      const prefix = readReplyPrefix(sessionId,turn)
      const active = {turn, branchId:chat.timeline?.branchId, body:roundBody([{kind:'markdown',text:prefix}], {chatId:chat.id,branchId:chat.timeline?.branchId,turn,streaming:true})}
      activeRoundBodies.set(sessionId,active)
      return {update(text) {
        const full = [prefix,text].filter(Boolean).join('\n\n')
        active.body = roundBody([{kind:'markdown',text:full}],{chatId:chat.id,branchId:chat.timeline?.branchId,turn,streaming:true})
        return director?.update(active.body.displayUnits,streamTailClosed(full,active.body.displayUnits))
      }, cancel() {if (activeRoundBodies.get(sessionId) === active) activeRoundBodies.delete(sessionId);return director?.cancel()}}
    },
  }
}
