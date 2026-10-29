import { computeSceneTarget } from './domain/scene-illustration.js'

const bodyOperation = (timeline, turn) => Object.values(timeline?.operations || {}).filter(item => item.kind === 'body' && Number(item.turn) === turn).at(-1)?.id

// Reuse the chat journal's serialization boundary without changing story data.
// The stage record is one atomic write while edits/rollback cannot change its source.
export function stageDirectorCommit(persistence) {
  return async function commit(target, save) {
    let committed = false
    await persistence.update(target.chatId, async chat => {
      const latest = chat.messages.filter(message => message.role === 'assistant').at(-1)
      if (target.operationId && chat.timeline?.operations?.[target.operationId]?.status !== 'completed') {
        throw Object.assign(Error('导演所属正文 operation 已变化'), { retryable: false })
      }
      // The stage depends on this round's prose only: its body operation, branch and text (key), not the
      // story revision — choices, 手动记账 or 人物设计 committed meanwhile do not void it.
      if (chat.timeline?.branchId !== target.authority?.branchId ||
          bodyOperation(chat.timeline, target.turn) !== (target.operationId || bodyOperation(target.authority, target.turn)) ||
          Number(latest?.turn || (latest?.greeting ? 1 : 0)) !== target.turn || computeSceneTarget(chat, target.turn).key !== target.key) {
        throw Object.assign(Error('舞台导演已停止：本轮正文已变化'), { retryable: false })
      }
      const assertActive = () => {
        if (target.context.signal?.aborted || target.context.stopped?.()) throw Object.assign(Error('舞台任务已结束，本次不提交'), { retryable: false })
      }
      assertActive()
      await save(assertActive)
      committed = true
      // undefined retains the existing journal revision; only the stage record changes.
    }, { source: 'stage.commit', touchUpdatedAt: false })
    if (!committed) throw Object.assign(Error('舞台所属对话已不存在'), { retryable: false })
  }
}
