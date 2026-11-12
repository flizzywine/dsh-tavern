import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from "../tavern-plugin/lib/domain/session-events.js"
import { ensureSessionStablePrefix } from "../tavern-plugin/lib/domain/session-stable-prefix.js"
import { cardSystemPromptText, cardSystemPromptSnapshot } from "../tavern-plugin/lib/domain/card-system-prompt.js"
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'

import { retireForegroundFrames } from '../tavern-plugin/lib/domain/foreground-frame-retirement.js'

const planner = createContextPlanner({ prompt: () => '正文写作规则' })
const background = text => '【故事设定 · 人物卡】\n人物背景\n\n' + cardSystemPromptText(text) + '\n\n【常驻世界书】\n世界背景'

test('系统提示进入开局与候选固定背景，历史后指令继续逐轮提供', async () => {
  const card = { name: '角色', system_prompt: '叙述{{char}}的故事', post_history_instructions: '只输出正文' }
  const chat = { guides: [], posture: '' }
  const snapshot = await planner.plan({ purpose: 'play-card-snapshot', card, chat })
  const body = await planner.plan({ purpose: 'body', card, chat })
  const candidate = await planner.plan({ purpose: 'candidate', card, chat, task: '候选协议' })
  assert.match(snapshot.text, /【人物卡系统提示】\n叙述角色的故事/)
  assert.doesNotMatch(snapshot.text, /只输出正文/)
  assert.doesNotMatch(body.text, /叙述角色的故事/)
  assert.match(body.text, /只输出正文/)
  assert.equal(body.systemPromptText, '叙述角色的故事')
  assert.match(candidate.stableText, /叙述角色的故事/)
  assert.doesNotMatch(candidate.stableText, /只输出正文/)
  const conditional = { name: '角色', system_prompt: '{{if .enabled}}条件指令{{/if}}' }
  assert.equal((await planner.plan({ purpose: 'body', card: conditional, chat: { macroState: { local: { enabled: false } } } })).systemPromptText, '')
  assert.equal((await planner.plan({ purpose: 'body', card: conditional, chat: { macroState: { local: { enabled: true } } } })).systemPromptText, '条件指令')
})

test('更新消息不随短期 Frame 清理；同一 Frame 重试和非首步不重复追加', async () => {
  const session = Session.create('card-frame')
  await ensureSessionStablePrefix(session, background('晴'))
  const frame = createForegroundFrameBuilder().build({ chatId: 'chat', branchId: 'branch', basedOnRevision: 1, operationId: 'operation', turn: 1,
    inputs: [{ kind: 'foreground.user-input', sourceText: '继续' }, { kind: 'foreground.writing-rules', text: '本轮规则' }], source: { card: { systemPromptText: '雨' } } })
  const adapter = createForegroundFrameSessionAdapter()
  const first = adapter.append({ session, messages: [], frame, step: 1 })
  assert.equal(first.messages.length, 2)
  assert.equal(adapter.append({ session, messages: first.messages, frame, step: 1 }).receipt.reason, 'duplicate')
  assert.equal(adapter.append({ session, messages: [], frame, step: 2 }).receipt.reason, 'not-first-step')
  for (const message of first.messages) appendSessionEvent(session, 'user/message', message, { surfaceOp: 'append' })
  retireForegroundFrames(session)
  assert.equal(cardSystemPromptSnapshot(session, '雨'), null)
  assert.match(JSON.stringify(session.deriveMessages()), /人物卡系统指令更新/)
})
