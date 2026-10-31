// Stage owns its task admission and opening observation. No stage card, no round read.
export function createStageWorkflow({workflow, chatHeaderForSession, dialogueBubbles, chatForSession, chatPersistence, stageDirector}) {
  let active = true
  async function enabled(sessionId) {
    if (!active) return false
    const header = await chatHeaderForSession(String(sessionId), ['cardPath','mode','regenInProgress'])
    if (!active || !header?.cardPath || !['story','script'].includes(header.mode) || header.regenInProgress) return false
    const config = await dialogueBubbles.read(header.cardPath)
    return active && config?.enabled === true
  }
  async function directRound(sessionId) {
    if (!await enabled(sessionId)) return
    const chat = await chatForSession(String(sessionId))
    if (!active || !chat || !['story','script'].includes(chat.mode) || chat.regenInProgress) return
    const config = await dialogueBubbles.read(chat.cardPath)
    if (active && config?.enabled) return stageDirector.get(chat,0,config)
  }
  const stop = workflow.job({id:'stage-director',task:'stage-director',name:'舞台导演',on:'reply-committed',
    condition:'开启对话气泡与舞台模式时',enabled:({gameId})=>enabled(gameId),run:({gameId})=>directRound(gameId),
    cancelOn:'turn-discarded',cancel:({gameId,turn})=>{if(active)stageDirector.cancel({sessionId:String(gameId)},turn)}})
  return {
    async settlementQueued(chatId,signal) {
      if (!active || signal?.aborted) return
      const header = (await chatPersistence.readSlice(chatId,[],['sessionId']))?.chat
      if (!active || signal?.aborted || !header?.sessionId || !await enabled(header.sessionId)) return
      const recent = await chatPersistence.readRecentSummaries(chatId,4)
      if (!active || signal?.aborted) return
      // A storage adapter without summary support falls back only for an enabled stage game.
      const chat = recent || await chatForSession(header.sessionId)
      if (active && !signal?.aborted && chat?.messages?.findLast(row=>row?.role==='assistant')?.greeting === true) return directRound(header.sessionId)
    },
    dispose() {active=false;stop()}
  }
}
