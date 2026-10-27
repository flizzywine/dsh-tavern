import { createHash } from 'node:crypto'

// 自动生成候选项: after a live foreground reply completes, submit the same candidate task the
// 生成候选项 button submits. Only scheduling lives here; generation, persistence, recovery and
// errors stay with the candidate task mailbox. Eligibility is held in memory: nothing is
// written, old replies are never caught up on chat open or restart, and nothing retries.

function latestReply(chat) {
  return (chat?.messages || []).findLast(message => message?.role === 'assistant')
}

// The reply the player is looking at; any edit, swipe, branch or newer reply changes it.
function identity(chat) {
  const reply = latestReply(chat)
  return JSON.stringify([chat?.id, chat?.timeline?.branchId, reply?.turn, reply?.ts,
    reply?.swipeId, reply?.sourceText, reply?.text])
}

const playModes = ['story', 'script']

export function createAutoChoices({ read, preferences, activity, submit,
  defer = callback => setTimeout(callback, 1000), clear = clearTimeout, report = console.error }) {
  const pending = new Map()
  const seen = new Set()
  let disposed = false

  function cancel(sessionId) {
    const item = pending.get(sessionId)
    if (item?.timer) clear(item.timer)
    pending.delete(sessionId)
  }

  function cancelAll() {
    for (const sessionId of pending.keys()) cancel(sessionId)
  }

  function current(item) { return !disposed && pending.get(item.sessionId) === item }

  function later(item) {
    if (!current(item)) return
    item.timer = defer(() => { item.timer = null; void check(item) })
    item.timer?.unref?.()
  }

  async function check(item) {
    try {
      const enabled = (await preferences()).candidateAutoGenerate === true
      const state = await read(item.sessionId)
      if (!current(item)) return
      const chat = state?.chat
      if (!enabled || !chat || !playModes.includes(chat.mode || 'story') ||
          identity(chat) !== item.identity || state.messageId !== item.messageId) {
        cancel(item.sessionId)
        return
      }
      // A manual request, or an earlier one for this reply (even a failed one), wins.
      const existing = Object.values(chat.taskMailbox?.tasks || {}).some(task =>
        task?.kind === 'candidate' && task.input?.messageId === item.messageId)
      if (existing || chat.candidates?.messageId === item.messageId) {
        cancel(item.sessionId)
        return
      }
      // Settlement shares the background participant and revision with candidates, so it
      // blocks even while pending; compaction and regeneration rewrite what candidates read.
      const background = activity(chat)
      const settlement = background.role === 'settlement' && ['pending', 'running'].includes(background.phase)
      const compacting = chat.contextCompaction?.operation?.status === 'running'
      if (background.busy || settlement || compacting || chat.regenInProgress) {
        later(item)
        return
      }
      // Consumed before submitting: a failure or a duplicate event never becomes a retry loop.
      cancel(item.sessionId)
      await submit({ sessionId: item.sessionId, messageId: item.messageId,
        kind: 'candidate', requestId: item.requestId, guidance: '' })
    } catch (error) {
      if (current(item)) cancel(item.sessionId)
      report('dsh-tavern: 自动生成候选项失败', error)
    }
  }

  async function completed({ sessionId, messageId, turn, reason }) {
    if (disposed || !messageId || !['completed', 'max-tokens'].includes(reason)) return
    const key = JSON.stringify([sessionId, messageId])
    if (seen.has(key)) return
    seen.add(key)
    cancel(sessionId)
    // Deterministic per reply, so the mailbox treats a repeated submission as the same task.
    const item = { sessionId, messageId, requestId: 'auto-choices-' + createHash('sha256').update(key).digest('hex') }
    pending.set(sessionId, item)
    try {
      const enabled = (await preferences()).candidateAutoGenerate === true
      const state = await read(sessionId)
      if (!current(item)) return
      const chat = state?.chat
      const reply = latestReply(chat)
      if (!enabled || !chat || reply?.greeting ||
          !playModes.includes(chat.mode || 'story') || Number(reply?.turn) !== Number(turn) ||
          !String(reply?.text || '').trim() || state.messageId !== messageId) {
        cancel(sessionId)
        return
      }
      item.identity = identity(chat)
      await check(item)
    } catch (error) {
      if (current(item)) cancel(sessionId)
      report('dsh-tavern: 自动生成候选项失败', error)
    }
  }

  return Object.freeze({ completed, cancel, cancelAll, isPending: sessionId => pending.has(sessionId), dispose() { disposed = true; cancelAll() } })
}
