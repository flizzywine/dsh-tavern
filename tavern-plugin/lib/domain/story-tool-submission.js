import { randomUUID } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'

export const STORY_SUBMIT_TOOL_NAME = 'submit_story'
export const STORY_SUBMIT_PROMPT = [
  '<output_method>',
  '本轮最终正文必须调用 submit_story 工具，完整放入 content 字符串参数，不要直接输出正文或重复复述。',
  '可以先使用已开放的历史查询、剧本读取或联网搜索；submit_story 必须是本轮最后一次工具调用。',
  '正文中的所有原有标签、格式和内容要求保持不变；提交成功即结束本轮，无需再输出任何消息。',
  '</output_method>'
].join('\n')

/** A global switch (Tavern settings); it applies to story and script play only. */
export function storyToolCallEnabled(chat, enabled) {
  return enabled === true && !!chat && (!chat.mode || chat.mode === 'story' || chat.mode === 'script')
}

function validContent(content) {
  if (typeof content !== 'string' || content.trim() === '') throw new Error('正文不能为空，content 必须是非空字符串')
  return content
}

/** Only a model call with a matching successful durable result is a submission. */
export function storySubmissionForTurn(session, turn) {
  const events = sessionEvents(session)
  const visible = Array.isArray(session?.surface?.nodes) ? new Set(session.surface.nodes.map(Number)) : null
  let start = -1
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'turn/start' && Number(events[index].data?.turn) === Number(turn)) { start = index; break }
  }
  const messages = new Map()
  const calls = new Map()
  for (let index = start + 1; index < events.length; index++) {
    const event = events[index]
    const data = event?.data
    if (Number(data?.turn) !== Number(turn)) continue
    if (event.type === 'assistant/message' && data.message?.source?.kind === 'model' && (!visible || visible.has(Number(event.seq ?? index)))) {
      for (const block of data.message.content || []) {
        if (block?.type === 'tool-call' && block.name === STORY_SUBMIT_TOOL_NAME) messages.set(block.id, { index, event, block })
      }
    }
    if (event.type === 'tool/call' && data.name === STORY_SUBMIT_TOOL_NAME) {
      const model = messages.get(data.callId)
      if (model && model.block.arguments === data.arguments) calls.set(data.callId, model)
    }
    if (event.type !== 'tool/result' || data.error || (visible && !visible.has(Number(event.seq ?? index)))) continue
    for (const block of data.message?.content || []) {
      if (block?.type !== 'tool-result' || block.isError === true) continue
      const model = calls.get(block.toolCallId)
      if (!model) continue
      let content
      try { content = validContent(JSON.parse(model.block.arguments).content) } catch { continue }
      const resultText = (block.content || []).filter(part => part?.type === 'text').map(part => part.text).join('')
      if (resultText !== content) continue
      return { index: model.index, receiptIndex: Number(event.seq ?? index), event: model.event, text: content.trim(), content, toolCallId: block.toolCallId, storyToolSubmission: true }
    }
  }
  return null
}

/**
 * Turn a finished submission into an ordinary reply. The appended text lets the
 * chat view show the step as an answer (it ignores surface replacements); the
 * replacement then leaves that one text where the call, receipt and copy were,
 * so the model sees the body once and rollback/regeneration see a normal round.
 */
export function foldStorySubmission(session, result, bodyText) {
  const data = result.event.data
  const turn = Number(data.turn) || 0
  const step = Number(data.step) || 1
  const surface = createSessionSurfaceMutator(session)
  // `submission.index` is the events-array position while the receipt is an
  // event seq; the surface is a seq list, so the call is located by its own seq.
  // A filtered or compacted log makes the two differ, and a positional lookup
  // then fails with "消息替换目标已变化".
  const start = Number(result.event?.seq ?? result.index)
  const receipt = Number(result.receiptIndex)
  const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes.map(Number) : []
  const from = nodes.indexOf(start)
  const to = nodes.indexOf(receipt)
  // A step may dispatch several tools, so other receipts can sit between the
  // call and this submission's receipt. The range must cite every node it
  // removes or the replacement is refused with "缺少有效的来源引用".
  if (from < 0 || to < from) return
  // The appended copy and the replacement are one message. The chat view keys a
  // round's actions by the message id it rendered and the fork map reads the id
  // of the newest projection event, so two ids here hide the fork action.
  const reply = {
    ...data.message,
    id: randomUUID(),
    source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' },
    content: [{ type: 'text', text: bodyText }]
  }
  const shown = surface.append('assistant/message', { turn, step, message: reply }, { surfaceOp: 'append', sourceEventSeqs: [] })
  const shownSeq = Number(typeof shown === 'number' ? shown : shown.seq)
  const end = session.surface.nodes.map(Number).indexOf(shownSeq)
  if (end < to) return
  surface.replace('assistant/message', { turn, step, message: reply },
    { start, end: shownSeq, sourceEventSeqs: session.surface.nodes.slice(from, end + 1).map(Number) })
}

export function activeStoryTurn(session) {
  const events = sessionEvents(session)
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type === 'turn/end') return null
    if (events[index]?.type === 'turn/start') return Number(events[index].data?.turn) || null
  }
  return null
}

/** Executed exclusively by the host; the durable tool result is the receipt. */
export function createStorySubmissionTool({ chatForSession, enabled, isBackground = () => false }) {
  return {
    name: STORY_SUBMIT_TOOL_NAME,
    description: '提交本轮完整最终正文。全部正文放入 content；成功后结束本轮，不再补充回复。',
    parameters: { content: { type: 'string', required: true, description: '完整正文，保留原有格式和标签' } },
    output: { schema: { type: 'string' }, render(_args, value) { return [{ type: 'text', text: value }] } },
    isConcurrencySafe() { return false },
    async execute(args, exec) {
      exec?.signal?.throwIfAborted()
      const session = exec?.agent?.session
      const sessionId = session?.id || ''
      if (!sessionId || isBackground(sessionId)) throw new Error('正文提交只用于前台游玩回合')
      const chat = await chatForSession(sessionId)
      if (!storyToolCallEnabled(chat, await enabled())) throw new Error('未开启正文走工具调用')
      const turn = activeStoryTurn(session)
      if (turn === null) throw new Error('当前没有正在生成的游玩回合')
      const content = validContent(args?.content)
      const previous = storySubmissionForTurn(session, turn)
      if (previous && previous.content !== content) throw new Error('本轮已提交正文，不允许重复覆盖')
      if (typeof exec.concludeTurn !== 'function') throw new Error('当前 DSH 版本不支持工具提交后结束回合，请关闭正文走工具调用或更新 DSH')
      exec.signal?.throwIfAborted()
      exec.concludeTurn()
      return content
    }
  }
}
