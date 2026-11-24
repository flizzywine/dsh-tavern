import { ensureSessionSystemHead, sessionEvents, appendSessionEvent } from './session-events.js'

const VERSION = 1
const TEXT = Object.freeze({
  1: `我们正在共同创作一部持续发展的沉浸式虚构小说。
人物卡、世界书、已有正文和现场状态构成故事事实；我之后发送的消息是“本轮演出指引”，不是已经发生的正文。
请承接现场，用自己的叙述完整演出其核心意图。所有角色都由你叙述和扮演，并保持符合人设的独立意志。
只输出小说正文，不要解释、点评、复述规则或输出元信息。`,
  3: '开始。请从人物卡给定的开场继续。'
})

const pending = new WeakMap()

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function isLegacySeedAcknowledgement(message) {
  const source = message?.source
  return message?.role === 'assistant' && source?.kind === 'model' && source.provider === 'dsh-tavern'
    && source.model === 'synthetic-trajectory' && /^tavern-seed-trajectory:v1:.+:2$/.test(message.id)
}

export function sessionSeedTrajectoryMessages(sessionId) {
  // Keep the original slots so opening recovery can recognize partially seeded saves.
  return Object.freeze(Object.entries(TEXT).map(([slot, text]) => Object.freeze({
    text, type: 'user/message', intent: { surfaceOp: 'append' },
    data: {
      id: 'tavern-seed-trajectory:v' + VERSION + ':' + str(sessionId) + ':' + slot,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'plugin:dsh-tavern', form: 'synthetic-trajectory', version: VERSION }
    }
  })))
}

function messageId(event) {
  if (event && event.type === 'user/message') return str(event.data && event.data.id)
  if (event && event.type === 'assistant/message') return str(event.data && event.data.message && event.data.message.id)
  return ''
}

function visibleEvents(session) {
  return sessionEvents(session).filter(event => event && event.type !== 'session/end-seed'
    && !(event.type === 'assistant/message' && isLegacySeedAcknowledgement(event.data?.message)))
}

function ensure(session) {
  if (!session || typeof session.append !== 'function' || str(session.id) === '') throw new Error('无法写入 Session 种子轨迹')
  ensureSessionSystemHead(session)
  const stages = sessionSeedTrajectoryMessages(session.id)
  const expectedIds = stages.map(stage => stage.data.id)
  const events = visibleEvents(session)
  const start = events.findIndex(event => messageId(event) === expectedIds[0])
  const stray = events.findIndex(event => expectedIds.includes(messageId(event)))
  if (start < 0 && stray >= 0) throw new Error('Session 种子轨迹顺序无效')

  const offset = start < 0 ? events.length : start
  let matched = 0
  while (matched < stages.length && messageId(events[offset + matched]) === expectedIds[matched]) matched += 1
  if (start >= 0 && matched < stages.length && offset + matched < events.length) {
    throw new Error('Session 种子轨迹不完整且已被其他操作推进')
  }

  for (let index = matched; index < stages.length; index += 1) {
    const stage = stages[index]
    appendSessionEvent(session, stage.type, stage.data, stage.intent)
  }
  const complete = visibleEvents(session).slice(offset, offset + stages.length)
  if (complete.length !== stages.length || complete.some((event, index) => messageId(event) !== expectedIds[index])) {
    throw new Error('Session 种子轨迹写入不完整')
  }
  return Object.freeze({ version: VERSION, events: Object.freeze(complete.slice()) })
}

export async function ensureSessionSeedTrajectory(session) {
  if (pending.has(session)) return pending.get(session)
  const operation = Promise.resolve().then(function () { return ensure(session) })
  pending.set(session, operation)
  try { return await operation } finally { pending.delete(session) }
}
