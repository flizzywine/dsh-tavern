import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { ensureSessionStablePrefix, sessionStablePrefixSections } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { cardSystemPromptText, cardSystemPromptSnapshot, cardSystemPromptSource } from '../tavern-plugin/lib/domain/card-system-prompt.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from '../tavern-plugin/lib/domain/foreground-frame-session-adapter.js'

import { retireForegroundFrames } from '../tavern-plugin/lib/domain/foreground-frame-retirement.js'

import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'

const planner = createContextPlanner({ prompt: () => '正文写作规则' })
const background = text => '【故事设定 · 人物卡】\n人物背景\n\n' + cardSystemPromptText(text) + '\n\n【常驻世界书】\n世界背景'
function appendUpdate(session, text) {
  const snapshot = cardSystemPromptSnapshot(session, text)
  if (!snapshot) return null
  return appendSessionEvent(session, 'user/message', { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: snapshot.rendered }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'card-system-prompt-update', trace: cardSystemPromptSource(snapshot) } }, { surfaceOp: 'append' })
}

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

test('同值不追加，变化、恢复开局值和清空分别追加完整版本；旧事件与固定前缀不变', async () => {
  const session = Session.create('card-instructions')
  await ensureSessionStablePrefix(session, background('晴'))
  const fixed = structuredClone(sessionStablePrefixSections(session))
  const openingEvents = structuredClone(sessionEvents(session))
  assert.equal(appendUpdate(session, '晴'), null)
  appendUpdate(session, '雨')
  assert.equal(appendUpdate(session, '雨'), null)
  appendUpdate(session, '晴')
  const cleared = appendUpdate(session, '')
  assert.match(cleared.data.content[0].text, /全部失效/)
  assert.equal(appendUpdate(session, ''), null)
  assert.deepEqual(sessionStablePrefixSections(session), fixed)
  assert.deepEqual(sessionEvents(session).slice(0, openingEvents.length), openingEvents)
  assert.equal(session.deriveMessages().filter(m => m.source?.form === 'card-system-prompt-update').length, 3)
  const restored = Session.create(session.id, sessionEvents(session), session.header)
  assert.equal(appendUpdate(restored, ''), null)
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

test('真实后台候选请求：复用固定前缀，变化与清空追加，重启后去重且结算不改写前缀', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, { residentOptions: { resolveStablePrefix: () => background('天气：晴') } })
  t.after(() => runtime.dispose())
  let id
  const run = async (task, systemPromptText) => {
    const result = await runtime.runBackground({ sessionId: 'scene-parent', task, persistent: true, persistentSessionId: id,
      selection: { provider: 'scene-fixture', model: 'fixture-text' }, system: '本轮任务协议', systemPromptText, postHistoryText: '历史后指令', messages: [], tools: [] })
    id = result.traceSessionId
  }
  await run('settlement', '不属于结算的指令')
  for (const text of ['天气：晴', '天气：雨', '天气：雨']) await run('candidate', text)
  await runtime.restart()
  await run('candidate', '天气：雨')
  await run('candidate', '')
  await run('candidate', '天气：晴')
  await run('settlement', '不属于结算的指令')
  const updates = request => request.messages.filter(m => m.source?.trace?.cardSystemPromptSnapshot)
  assert.deepEqual(runtime.requests.map(r => updates(r).length), [0, 0, 1, 1, 1, 2, 3, 3])
  for (const [index, request] of runtime.requests.entries()) {
    assert.equal(request.system, runtime.requests[0].system)
    assert.match(request.system, /仅用于候选文本的写作/)
    assert.match(request.system, /天气：晴/)
    assert.doesNotMatch(request.system, /历史后指令|天气：雨|不属于结算/)
    if (index && index < 7) assert.match(JSON.stringify(request.messages.at(-1).content), /历史后指令/)
  }
  assert.match(updates(runtime.requests[5]).at(-1).content[0].text, /全部失效/)
})

test('生图和手机私聊的真实 system 不继承人物卡写作指令', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, { residentOptions: { resolveStablePrefix: () => background('ONLY_CARD_DIRECTIVE') } })
  t.after(() => runtime.dispose())
  for (const task of ['image', 'phone']) {
    await runtime.runBackground({ sessionId: 'scene-parent', task, selection: { provider: 'scene-fixture', model: 'fixture-text' }, messages: [], tools: [] })
    assert.doesNotMatch(runtime.requests.at(-1).system, /ONLY_CARD_DIRECTIVE/)
    assert.match(runtime.requests.at(-1).system, /人物背景/)
  }
})
