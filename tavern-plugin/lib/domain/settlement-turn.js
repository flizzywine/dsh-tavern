import { promptSection } from './prompt-section.js'
import { projectAgentContent, projectAgentMessageText } from './runtime-content-projection.js'

// What one background settlement reads from the latest round and writes back to the save.

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Setup belongs to the first reply after its floor, including retries of that reply.
// A later assistant floor closes the window without another persisted flag.
export function openingSettlementContext(messages, messageId) {
  for (let index = messageId - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'assistant') break
    if (message?.role === 'system' && message.openingSetup === true) {
      return '【开局设定】（玩家本局的起始状态；按其中陈述的事实结算变量，可以超出初始基线。每轮进度与互动限制从下一轮起才适用）\n' + str(message.text)
    }
  }
  return ''
}

// `knownPosture`: the posture the background history already shows; the block is
// repeated only when that differs (new session, compaction, rewind).
export function settleUserText(chat, includePosture = true, knownPosture = '') {
  const msgs = (chat.messages || []).filter(function (message) {
    return message && (message.role === 'user' || message.role === 'assistant')
  }).slice(-2)
  const repeatPosture = includePosture && !(str(chat.posture).trim() !== '' && str(chat.posture).trim() === knownPosture)
  const lines = [
    ...(repeatPosture ? ['Last settled posture:',
    str(chat.posture) !== '' ? projectAgentContent(chat.posture, { charName: chat.cardName, macroState: chat.macroState }).agentText : '(none)'] : []),
    ...[openingSettlementContext(chat.messages || [], (chat.messages || []).lastIndexOf(msgs.at(-1)))].filter(Boolean),
    'Latest exchange:'
  ]
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    if (m === null || typeof m !== 'object') continue
    const text = projectAgentMessageText(m, { charName: chat.cardName, macroState: chat.macroState })
    if (text.trim() === '') continue
    lines.push((m.role === 'assistant' ? 'Story' : 'Player') + ': ' + text)
  }
  return promptSection('settlement_context', lines.join('\n'))
}
export function applySettlement(chat, result) {
  let postureUpdated = false
  const posture = str(result.posture).trim()
  if (posture !== '') {
    chat.posture = posture
    postureUpdated = true
  }
  return { postureUpdated: postureUpdated }
}
export function pendingMvuTarget(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
    const message = messages[messageId]
    if (!message || message.role !== 'assistant' || !message.mvu || message.mvu.pending !== true) continue
    const swipeId = Math.max(0, Number(message.swipeId) || 0)
    const variables = message.mvuBaseline?.swipeId === swipeId ? message.mvuBaseline.variables : (Array.isArray(message.variables) ? message.variables[swipeId] : undefined)
    return {
      messageId,
      swipeId,
      message,
      variables: variables && typeof variables === 'object' ? structuredClone(variables) : {}
    }
  }
  return null
}
