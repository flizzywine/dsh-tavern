import {conversationSummaryFields} from './tavern-conversation-registry.js'
import { withConversationReadLane } from './conversation-read-lanes.js'

export function scheduleRuntimeHistoryRecovery(index, startedBefore, {
  requestPerformance, recoverRegeneration, chatPersistence, readChat, writeChat,
  presetLibrary, conversationRegistry, foregroundHandoff, candidateTasks, mvuSettlementReconciler,
  logger = console,
}) {
  setImmediate(() => {
    requestPerformance.run('startup-history', '', () => withConversationReadLane('background', () => recoverRuntimeHistory(index, {
      recoverRegeneration: id => requestPerformance.stage('recovery.regeneration', () => recoverRegeneration(id)),
      readSlice: (...args) => requestPerformance.stage('recovery.page-store', () => chatPersistence.readSlice(...args)),
      readChat,
      restoreChat: chat => presetLibrary.restoreChat(chat),
      writeChat,
      syncSummary: async chat => {
        try { await requestPerformance.stage('recovery.registry-sync', () => conversationRegistry.sync(chat, { metadataOnly: true })) }
        catch (error) { logger.warn('dsh-tavern: 会话摘要索引同步失败，将在下次启动修复:', String(error?.message || error)) }
      },
      // Work started since startup belongs to this process.
      recoverHandoff: ids => requestPerformance.stage('recovery.handoff', () => foregroundHandoff.recover(ids, { startedBefore })),
      recoverCandidates: ids => requestPerformance.stage('recovery.candidates', () => candidateTasks.recover(ids, { startedBefore })),
      scanSettlement: () => mvuSettlementReconciler.scan(),
      logger,
    }))).catch(error => logger.error('dsh-tavern: 后台恢复历史对话失败', error?.message || error))
  })
}

// Restart republishes sidebar metadata, not a new story observation. Actual
// recovery writes still pass through the normal timeline/observer write ports.
export async function recoverRuntimeHistory(index, {recoverRegeneration,readSlice,readChat,restoreChat,writeChat,syncSummary,recoverHandoff,recoverCandidates,scanSettlement,logger=console}) {
  const active=[]
  for (const row of index.chats || []) {
    try { await recoverRegeneration(row.id) }
    catch (error) { logger.error('dsh-tavern: regeneration recovery failed',row.id,error?.message || error) }
    const selected=await readSlice(row.id,[],[...conversationSummaryFields,'bypassPlanId'])
    let chat=selected?.chat
    if (!chat) continue
    active.push(row.id)
    try {
      if (String(chat.bypassPlanId || '') !== '') {
        chat=await readChat(row.id)
        if (await restoreChat(chat)) await writeChat(chat)
      }
    } catch (error) { logger.warn('dsh-tavern: preset recovery failed',row.id,error) }
    await syncSummary(chat)
  }
  await recoverHandoff(active)
  await recoverCandidates(active)
  // Durable running operations must be converted before settlement scans them.
  void scanSettlement()
}
