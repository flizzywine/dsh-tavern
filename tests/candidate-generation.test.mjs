import assert from 'node:assert/strict'
import test from 'node:test'

import { createCandidateGenerator } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'

const storyChoices = [
  { type: 'action', text: '走到窗边仔细观察街上的动静' },
  { type: 'action', text: '压低声音询问阿芙拉钟楼的线索' },
  { type: 'action', text: '检查桌上残留的泥水和脚印痕迹' },
  { type: 'action', text: '推开后门沿着雨中的马蹄印追踪' },
  { type: 'scene', text: '场景切换到午夜钟楼下的狭窄石巷' }
]

function script() {
  return {
    title: '银铃', importedAt: 1,
    chunks: [
      { id: 'chunk-00001', order: 0, text: '旅店相遇。' },
      { id: 'chunk-00002', order: 1, text: '雨夜追踪。' },
      { id: 'chunk-00003', order: 2, text: '钟楼对峙。' }
    ]
  }
}

function harness({ mode = 'story', outputs, initialCandidates }) {
  const continuity = createScriptContinuity()
  let chat = {
    id: 'chat-1', cardId: 'card-1', mode, messages: [{ role: 'assistant', text: '雨水敲着窗。' }],
    scriptState: mode === 'script' ? continuity.start(script(), 0) : null
  }
  if (initialCandidates !== undefined) chat.candidates = structuredClone(initialCandidates)
  const card = { id: 'card-1', name: '阿芙拉', description: '银发佣兵', tags: [] }
  let modelCalls = 0
  const store = {
    async chatForSession() { return structuredClone(chat) },
    async readChat() { return structuredClone(chat) },
    async readCard() { return structuredClone(card) },
    async readScript() { return mode === 'script' ? structuredClone(script()) : undefined },
    async writeChat(next) { chat = structuredClone(next) }
  }
  const model = {
    selection() { return { provider: 'test', model: 'scripted' } },
    async call() { return outputs[Math.min(modelCalls++, outputs.length - 1)] },
    async callWithTool() { return outputs[Math.min(modelCalls++, outputs.length - 1)] }
  }
  const plannerCalls = []
  const planner = {
    async plan(input) { plannerCalls.push(input); return { text: '候选项上下文', audit: { included: [], omitted: [], warnings: [], totalChars: 7 } } }
  }
  const candidates = createCandidateGenerator({
    store, model, planner, scripts: continuity,
    waitUntilSettled: async () => {}, sleep: async () => {}, now: () => 123456,
    logger: { error() {} }
  })
  return { candidates, continuity, plannerCalls, modelCalls: () => modelCalls, chat: () => structuredClone(chat) }
}

test('自由故事只保存完整的 4 action + 1 scene，失败输出会在 module 内重试', async () => {
  const invalid = JSON.stringify({ choices: storyChoices.slice(0, 4) })
  const truncatedButRecoverable = '{"choices":[' + storyChoices.map((item) => JSON.stringify(item)).join(',')
  const run = harness({ outputs: [invalid, truncatedButRecoverable] })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-1', guidance: '多写动作' })
  assert.equal(run.modelCalls(), 2)
  assert.equal(result.choices.length, 5)
  assert.equal(result.choices.filter((item) => item.type === 'action').length, 4)
  assert.equal(result.choices.filter((item) => item.type === 'scene').length, 1)
  assert.equal(run.plannerCalls[0].purpose, 'candidate')

  const saved = await run.candidates.find({ sessionId: 'session-1', messageId: 'message-1' })
  assert.deepEqual(saved, result)
  assert.equal(await run.candidates.find({ sessionId: 'session-1', messageId: 'old-message' }), null)
})

test('剧本候选恰好一项，并由剧本连续性 module 钳制下一轮游标', async () => {
  const raw = JSON.stringify({
    choices: [{ type: 'action', text: '沿着钟楼石阶谨慎地向上追去' }],
    scriptCursor: 99
  })
  const run = harness({ mode: 'script', outputs: [raw] })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-2' })
  assert.equal(result.choices.length, 1)
  const savedChat = run.chat()
  const progress = run.continuity.inspect({ script: script(), state: savedChat.scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
  assert.equal(run.plannerCalls[0].scriptWindow.chunks[0].id, 'chunk-00001')
})

test('三次输出都无效时不覆盖旧候选，也不改变剧本游标', async () => {
  const invalid = '{"choices":[{"type":"action","text":"太短"}]}'
  const oldCandidates = { messageId: 'old', choices: [{ type: 'action', text: '保留这一份旧的有效候选内容' }], generatedAt: 1 }
  const run = harness({ mode: 'script', outputs: [invalid, invalid, invalid], initialCandidates: oldCandidates })

  assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-3' }), /候选项生成失败|有效候选项/)
  const after = run.chat()
  assert.deepEqual(after.candidates, oldCandidates)
  assert.equal(run.continuity.inspect({ script: script(), state: after.scriptState, request: { kind: 'progress' } }).cursor, 0)
})

test('卡片模式拒绝生成候选项', async () => {
  const run = harness({ mode: 'revision', outputs: ['{}'] })
  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-4' }), /卡片模式不生成剧情候选项/)
})
