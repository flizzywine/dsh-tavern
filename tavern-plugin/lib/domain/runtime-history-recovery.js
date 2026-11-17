import {conversationSummaryFields} from './tavern-conversation-registry.js'

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
