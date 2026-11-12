import { bodyGenerationFailure } from './body-generation-failure.js'
import { randomUUID, createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'
import { producerSource } from './message-source.js'
import { isTurnInput } from './session-turn-input.js'
import { toolResultsOf } from './tool-result-message.js'

export const STORY_SUBMIT_TOOL_NAME = 'submit_story'
export const STORY_GENERATE_TOOL_NAME = 'tavern_generate_body'
export const STORY_SUBMIT_PROMPT = [
  '<output_method>',
  '本轮所有面向玩家的输出都必须通过工具调用完成：最终输出必须调用 submit_story，完整放入 content 字符串参数。',
  '除已开放的其他工具调用外，不要输出任何普通文本、摘要、说明或收尾语；写在 content 之外的文字会被丢弃。',
  '可以先使用已开放的其他工具查询资料；submit_story 必须是本轮最后一次工具调用。',
  '每轮只调用一次 submit_story；content 必须包含完整最终输出，保留全部标签、格式和内容要求，不要省略、缩写或用占位符代替。',
  '提交成功即结束本轮，不要再输出任何消息。',
  '请按上述规则完成本轮；最后必须调用 submit_story 提交全部输出，不要先输出普通文本。',
  '</output_method>'
].join('\n')

// The strict policy hides every other tool; the prompt must not invite a lookup
// the request cannot serve.
export const STORY_SUBMIT_PROMPT_STRICT = [
  '<output_method>',
  '本轮所有面向玩家的输出都必须通过 submit_story 工具完成，完整放入 content 字符串参数。',
  '不要调用任何其他工具，也不要先查询资料；submit_story 是本轮唯一允许的工具调用。',
  '除 submit_story 调用外，不要输出任何普通文本、摘要、说明或收尾语；写在 content 之外的文字会被丢弃。',
  '每轮只调用一次 submit_story；content 必须包含完整最终输出，保留全部标签、格式和内容要求，不要省略、缩写或用占位符代替。',
  '提交成功即结束本轮，不要再输出任何消息。',
  '现在直接生成完整输出并调用 submit_story 提交，不要先输出普通文本，也不要调用其他工具。',
  '</output_method>'
].join('\n')

// Input-only: the tool is declared solely so the replayed history's calls name a
// tool the provider knows about. It is not this turn's output channel.
export const STORY_INPUT_ONLY_PROMPT = [
  '<output_method>',
  '历史里的 submit_story 调用只是过去正文的记录，不是本轮的提交要求。',
  '本轮请直接输出正文，不要调用 submit_story。',
  '</output_method>'
].join('\n')

// A real assistant turn before the input, not a trailing prefill: the model
// sees its own accepted commitment, while the request still ends on the player's
// message. Request-only; never written to the save.
export const STORY_SUBMIT_ACK_TEXT = '收到。本轮所有面向玩家的输出都通过工具调用完成，最终输出放入 submit_story 的 content，不直接输出普通文本。'

export function withStorySubmitAck(messages, turn) {
  if (!Array.isArray(messages)) return messages
  let inputIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isTurnInput(messages[index])) { inputIndex = index; break }
  }
  // No room before the input (or it is the very first message): leave the
  // request alone rather than making the provider start on an assistant turn.
  if (inputIndex <= 0) return messages
  const ack = {
    id: 'tavern-submit-ack:' + (Number(turn) || 0),
    role: 'assistant',
    source: producerSource('dsh-tavern', { form: 'submit-ack' }),
    content: [{ type: 'text', text: STORY_SUBMIT_ACK_TEXT }]
  }
  return [...messages.slice(0, inputIndex), ack, ...messages.slice(inputIndex)]
}

// Appended after third-party sections so the last instruction in the system
// prompt is still the submission contract, regardless of how long they are.
export const STORY_SUBMIT_REMINDER = [
  '<output_method_reminder>',
  '最后提醒：本轮所有面向玩家输出的唯一出口是 submit_story；最终输出必须放入 content，不要输出普通文本，也不要重复上面的确认。',
  '</output_method_reminder>'
].join('\n')

export function appendStorySubmissionReminder(assembly, outputEnabled) {
  if (outputEnabled !== true) return assembly
  const sections = Array.isArray(assembly?.sections) ? assembly.sections : []
  if (!sections.some(section => section.name === 'tavern:story-tool-submission')) return assembly
  return { ...assembly, sections: [...sections, { name: 'tavern:story-tool-submission-reminder', text: STORY_SUBMIT_REMINDER }] }
}

/** A Tavern settings switch; it applies to story and script play only. */
export function storyToolCallEnabled(chat, enabled) {
  return enabled === true && !!chat && (!chat.mode || chat.mode === 'story' || chat.mode === 'script')
}

function validContent(content) {
  if (typeof content !== 'string' || content.trim() === '') throw new Error('正文不能为空，content 必须是非空字符串')
  return content
}

/**
 * The body a submission carried, whether or not its receipt came back verbatim.
 *
 * Hosts differ in what they store for a tool result: some echo the returned
 * string, some wrap or truncate it, some route it through a projector first.
 * Requiring an exact echo made a successful submission invisible whenever the
 * host reformatted the receipt, and the round then failed with "模型本轮没有返回
 * 正文" while the body sat in the call arguments the whole time. A non-error
 * receipt for this call is the proof of success; the text comes from the call.
 */
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
        if (block?.type === 'tool-call' && [STORY_SUBMIT_TOOL_NAME, STORY_GENERATE_TOOL_NAME].includes(block.name)) messages.set(block.id, { index, event, block })
      }
    }
    if (event.type === 'tool/call' && [STORY_SUBMIT_TOOL_NAME, STORY_GENERATE_TOOL_NAME].includes(data.name)) {
      const model = messages.get(data.callId)
      if (model && model.block.arguments === data.arguments) calls.set(data.callId, model)
    }
    if (event.type !== 'tool/result' || data.error || (visible && !visible.has(Number(event.seq ?? index)))) continue
    for (const block of toolResultsOf(data.message)) {
      if (block.isError) continue
      const model = calls.get(block.toolCallId)
      if (!model) continue
      let content, operationId
      const generated = model.block.name === STORY_GENERATE_TOOL_NAME
      try {
        if (generated) {
          const receipt = JSON.parse(block.content.filter(item => item.type === 'text').map(item => item.text).join(''))
          if (receipt.version === 1 && receipt.status === 'failed') return {
            index: model.index, event: model.event, text: '', content: '', pluginBodyGeneration: true,
            generationError: bodyGenerationFailure(receipt.failure || receipt.message || '插件正文生成失败').message,
            ...(receipt.failure ? { failure: bodyGenerationFailure(receipt.failure) } : {})
          }
          content = validContent(receipt.text)
          if (receipt.version !== 1 || typeof receipt.operationId !== 'string' || !receipt.operationId
            || receipt.digest !== createHash('sha256').update(JSON.stringify(content)).digest('hex')) continue
          operationId = receipt.operationId
        } else content = validContent(JSON.parse(model.block.arguments).content)
      } catch { continue }
      return { index: model.index, receiptIndex: Number(event.seq ?? index), event: model.event, text: content.trim(), content, toolCallId: block.toolCallId, storyToolSubmission: true, ...(generated ? { pluginBodyGeneration: true, operationId } : {}) }
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
export function foldStorySubmission(session, result, bodyText, messageId) {
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
    // The client marks a tool-submitted body by this prefix: it arrives whole in
    // one commit, so the reader must land on its first line instead of its end.
    id: typeof messageId === 'string' && messageId.startsWith('tavern-tool-reply:') ? messageId : 'tavern-tool-reply:' + randomUUID(),
    source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' },
    content: [{ type: 'text', text: bodyText }]
  }
  // Settlement runs after the submission's step closed: the copy and its replacement
  // share one edit step, so the log stays loadable and the step still shows the answer.
  surface.editStep(() => {
    const shown = surface.append('assistant/message', { turn, step, message: reply }, { surfaceOp: 'append', sourceEventSeqs: [] })
    const shownSeq = Number(typeof shown === 'number' ? shown : shown.seq)
    const end = session.surface.nodes.map(Number).indexOf(shownSeq)
    if (end < to) return
    surface.replace('assistant/message', { turn, step, message: reply },
      { start, end: shownSeq, sourceEventSeqs: session.surface.nodes.slice(from, end + 1).map(Number) })
  })
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
export function createStorySubmissionTool({ chatForSession, enabled, isBackground = () => false, pluginGeneration = async () => false }) {
  return {
    name: STORY_SUBMIT_TOOL_NAME,
    description: '提交本轮全部最终输出，是所有面向玩家文本的唯一出口。全部输出放入 content，不要省略；成功后结束本轮，不再补充回复。',
    parameters: { content: { type: 'string', required: true, description: '完整最终输出，必须包含全部内容并保留原有格式和标签，不要省略或改写' } },
    output: { schema: { type: 'string' }, render(_args, value) { return [{ type: 'text', text: value }] } },
    isConcurrencySafe() { return false },
    async execute(args, exec) {
      exec?.signal?.throwIfAborted()
      const session = exec?.agent?.session
      const sessionId = session?.id || ''
      if (!sessionId || isBackground(sessionId)) throw new Error('正文提交只用于前台游玩回合')
      if (await pluginGeneration(sessionId)) throw new Error('本轮正文必须由插件生成，请调用 tavern_generate_body')
      const chat = await chatForSession(sessionId)
      if (!storyToolCallEnabled(chat, await enabled())) throw new Error('未开启输入或输出走工具调用')
      const turn = activeStoryTurn(session)
      if (turn === null) throw new Error('当前没有正在生成的游玩回合')
      const content = validContent(args?.content)
      const previous = storySubmissionForTurn(session, turn)
      // The same body twice is the model repeating itself after a lost receipt;
      // returning it again is harmless and keeps the round from failing.
      if (previous && previous.content !== content) throw new Error('本轮已提交正文，不允许重复覆盖')
      if (typeof exec.concludeTurn !== 'function') throw new Error('当前 DSH 版本不支持工具提交后结束回合，请关闭输出走工具调用或更新 DSH')
      exec.signal?.throwIfAborted()
      exec.concludeTurn()
      return content
    }
  }
}
