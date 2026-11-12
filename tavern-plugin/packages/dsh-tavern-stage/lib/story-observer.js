import {roundBody, streamTailClosed} from '../../../lib/domain/round-body.js'

// Only the existing commit event admits automatic writes. Reads and saved projections
// (including opening recovery) deliberately have no path to this writer.
// afterRound(chat): the round's automatic figures are written (or nothing was to write); 自动选角 takes the round from here.
// deferred(chat): 自动选角 handles this card's new speakers itself (it decides before anything is created), so they are left to it.
export function registerAutoFigureObserver({storyEvents, chatHeaderForSession, dialogueBubbles, readStageChat, bodyForTurn, getLibrary, afterRound = async () => {}, deferred = async () => false, onError}) {
  let active = true, loading, writer
  const off = storyEvents.on('reply-committed', '登记气泡人物', async ({sessionId}) => {
    const header = await chatHeaderForSession(sessionId, ['cardPath'])
    if (!active || !header?.cardPath || !(await dialogueBubbles.read(header.cardPath))?.enabled) return
    const chat = await readStageChat(sessionId)
    if (!active || !chat) return
    loading ||= import('./auto-figure.js').then(({createAutoFigureWriter}) => {
      if (!active) return
      writer = createAutoFigureWriter({getLibrary, dialogueBubbles, readCurrent:chat => readStageChat(chat.sessionId), bodyForTurn, onError})
      return writer
    })
    if (!await deferred(chat)) await (await loading)?.committed(chat)
    if (active) await afterRound(chat)
  })
  return () => {active = false; off(); writer?.dispose()}
}

// Stage-owned adapter. Core saves and streams know only optional observers.
export function createStageStoryObserver({settlementQueued, modService, stageDirector, chatPersistence,
  chatHeaderForSession, dialogueBubbles, readStageChat, readReplyPrefix, activeRoundBodies}) {
  return {
    activity:chat => ({director:stageDirector.activity(chat)}),
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
