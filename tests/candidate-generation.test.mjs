import assert from 'node:assert/strict'
import test from 'node:test'

import { createCandidateGenerator } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

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

function harness({ mode = 'story', outputs, initialCandidates, messages, initialScriptCursor = 0, initialScriptEnded = false }) {
  const continuity = createScriptContinuity()
  let scriptState = mode === 'script' ? continuity.start(script(), initialScriptCursor) : null
  if (initialScriptEnded) scriptState = continuity.transition({ script: script(), state: scriptState, event: { kind: 'end' } }).state
  let chat = {
    id: 'chat-1', cardId: 'card-1', mode, messages: messages || [{ role: 'assistant', text: '雨水敲着窗。' }],
    scriptState
  }
  if (initialCandidates !== undefined) chat.candidates = structuredClone(initialCandidates)
  const card = { id: 'card-1', name: '阿芙拉', description: '银发佣兵', tags: [] }
  let modelCalls = 0
  const modelRequests = []
  function remember(options) {
    modelRequests.push({ system: options.system, messages: structuredClone(options.messages), tools: structuredClone(options.tools || []), maxTokens: options.maxTokens })
  }
  async function nextOutput(options) {
    remember(options)
    const call = ++modelCalls
    const output = outputs[Math.min(call - 1, outputs.length - 1)]
    const text = typeof output === 'function' ? await output(options) : output
    return { text, traceSessionId: 'candidate-trace-' + call }
  }
  const store = {
    async chatForSession() { return structuredClone(chat) },
    async readChat() { return structuredClone(chat) },
    async readCard() { return structuredClone(card) },
    async readScript() { return mode === 'script' ? structuredClone(script()) : undefined },
    async writeChat(next) { chat = structuredClone(next) }
  }
  const model = {
    selection() { return { provider: 'test', model: 'scripted' } },
    async runCandidate(options) { return await nextOutput(options) }
  }
  const plannerCalls = []
  const planner = {
    async plan(input) { plannerCalls.push(input); return { text: '候选项上下文', audit: { included: [], omitted: [], warnings: [], totalChars: 7 } } }
  }
  const candidates = createCandidateGenerator({
    store, model, planner, prompt, scripts: continuity,
    waitUntilSettled: async () => {}, sleep: async () => {}, now: () => 123456,
    logger: { error() {} }
  })
  return { candidates, continuity, plannerCalls, modelRequests, modelCalls: () => modelCalls, chat: () => structuredClone(chat) }
}

test('自由故事只保存完整的 4 action + 1 scene', async () => {
  const truncatedButRecoverable = '{"choices":[' + storyChoices.map((item) => JSON.stringify(item)).join(',')
  const run = harness({ outputs: [truncatedButRecoverable] })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-1', guidance: '多写动作' })
  assert.equal(run.modelCalls(), 1)
  assert.equal(result.choices.length, 5)
  assert.equal(result.choices.filter((item) => item.type === 'action').length, 4)
  assert.equal(result.choices.filter((item) => item.type === 'scene').length, 1)
  assert.equal(result.traceSessionId, 'candidate-trace-1')
  assert.equal(run.modelRequests[0].maxTokens, 4000)
  assert.equal(run.plannerCalls[0].purpose, 'candidate')
  assert.match(run.plannerCalls[0].task, /剧情候选项生成器/)

  const saved = await run.candidates.find({ sessionId: 'session-1', messageId: 'message-1' })
  assert.deepEqual(saved, result)
  assert.equal(await run.candidates.find({ sessionId: 'session-1', messageId: 'old-message' }), null)
})

test('候选输出无效时不自动创建第二个 Agent', async () => {
  const invalid = JSON.stringify({ choices: storyChoices.slice(0, 4) })
  const valid = JSON.stringify({ choices: storyChoices })
  const run = harness({ outputs: [invalid, valid] })

  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-no-retry' }), /恰好 4 个行动候选/)
  assert.equal(run.modelCalls(), 1)
})

test('剧本候选可按数字自由读取远处剧本并直接定位游标', async () => {
  const researched = []
  const run = harness({ mode: 'script', outputs: [async function (options) {
    researched.push(JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { position: 2 }
    })))
    researched.push(JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { position: 3 }
    })))
    return JSON.stringify({
      choices: [{ type: 'action', text: '沿着钟楼石阶谨慎地向上追去' }]
    })
  }] })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-2' })
  assert.equal(result.choices.length, 1)
  assert.deepEqual(researched.map((item) => item.chunks[0].id), ['chunk-00002', 'chunk-00003'])
  assert.match(run.plannerCalls[0].task, /剧本候选项生成器/)
  assert.match(run.plannerCalls[0].task, /直接输入 position 阅读指定块/)
  const savedChat = run.chat()
  const progress = run.continuity.inspect({ script: script(), state: savedChat.scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
  assert.equal(run.plannerCalls[0].scriptWindow.chunks[0].id, 'chunk-00001')
  assert.equal(run.modelRequests[0].tools[0].name, 'tavern_read_script')
  assert.equal(run.modelRequests[0].tools.length, 1)
  assert.equal(run.modelRequests[0].tools[0].parameters.properties.position.minimum, 1)
  assert.equal(run.modelRequests[0].tools[0].parameters.properties.action, undefined)
  assert.equal(result.traceSessionId, 'candidate-trace-1')
  assert.deepEqual(savedChat.messages, [{ role: 'assistant', text: '雨水敲着窗。' }])
})

test('剧本候选未读取时保持当前块，最后读取位置自动成为游标', async () => {
  const stay = harness({ mode: 'script', initialScriptCursor: 1, outputs: [JSON.stringify({
    choices: [{ type: 'action', text: '继续追问雨夜脚印留下的具体方向' }]
  })] })
  await stay.candidates.generate({ sessionId: 'session-1', messageId: 'message-stay' })
  assert.equal(stay.continuity.inspect({ script: script(), state: stay.chat().scriptState, request: { kind: 'progress' } }).cursor, 1)

  const ended = harness({ mode: 'script', initialScriptCursor: 2, outputs: [async function (options) {
    const end = JSON.parse(await options.onToolCall({ name: 'tavern_read_script', arguments: { position: 4 } }))
    assert.equal(end.ended, true)
    return JSON.stringify({ choices: [{ type: 'action', text: '在钟声消散后收起武器离开这里' }] })
  }] })
  await ended.candidates.generate({ sessionId: 'session-1', messageId: 'message-ended' })
  const progress = ended.continuity.inspect({ script: script(), state: ended.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 3)

  const remainsEnded = harness({ mode: 'script', initialScriptEnded: true, outputs: [async function (options) {
    await options.onToolCall({ name: 'tavern_read_script', arguments: { position: 4 } })
    return JSON.stringify({ choices: [{ type: 'scene', text: '让钟楼余波成为故事最后的安静尾声' }] })
  }] })
  await remainsEnded.candidates.generate({ sessionId: 'session-1', messageId: 'message-remains-ended' })
  assert.equal(remainsEnded.continuity.inspect({ script: script(), state: remainsEnded.chat().scriptState, request: { kind: 'progress' } }).cursor, 3)
})

test('剧本候选可按数字读取前文并向后定位游标', async () => {
  const run = harness({ mode: 'script', initialScriptCursor: 2, outputs: [async function (options) {
    const second = JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { position: 2 }
    }))
    assert.equal(second.chunks[0].id, 'chunk-00002')
    const first = JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { position: 1 }
    }))
    assert.equal(first.chunks[0].id, 'chunk-00001')
    return JSON.stringify({
      choices: [{ type: 'action', text: '折返旅店查看当时遗留的重要线索' }]
    })
  }] })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-backward' })
  const progress = run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 0)
})

test('剧本候选搜索到远处内容后自动提交该位置', async () => {
  const run = harness({ mode: 'script', outputs: [async function (options) {
    const found = JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { query: '钟楼' }
    }))
    assert.equal(found.chunks[0].id, 'chunk-00003')
    return JSON.stringify({
      choices: [{ type: 'action', text: '前往钟楼调查刚刚检索到的关键线索' }]
    })
  }] })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-sequential-read' })
  const progress = run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
})

test('剧本读取必须且只能提供数字位置或关键词', async () => {
  const run = harness({ mode: 'script', outputs: [async function (options) {
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: {} }), /position 或 query/)
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: { position: 2, query: '雨夜' } }), /position 或 query/)
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: { position: 5 } }), /1 到 4/)
    return JSON.stringify({ choices: [{ type: 'action', text: '继续留在当前场景观察人物的即时反应' }] })
  }] })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-invalid-search' })
})

test('剧本候选 JSON 中的旧 scriptCursor 字段不能再移动游标', async () => {
  const blind = JSON.stringify({
    choices: [{ type: 'action', text: '直接前往钟楼顶层寻找最终的真相' }],
    scriptCursor: 3
  })
  const run = harness({ mode: 'script', outputs: [blind] })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-blind' })
  const progress = run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 0)
})

test('单次输出无效时不覆盖旧候选，也不改变剧本游标', async () => {
  const invalid = '{"choices":[{"type":"action","text":"太短"}]}'
  const oldCandidates = { messageId: 'old', choices: [{ type: 'action', text: '保留这一份旧的有效候选内容' }], generatedAt: 1 }
  const stageThenFail = async function (options) {
    await options.onToolCall({ name: 'tavern_read_script', arguments: { position: 2 } })
    return invalid
  }
  const run = harness({ mode: 'script', outputs: [stageThenFail], initialCandidates: oldCandidates })

  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-3' }), /有效候选项/)
  assert.equal(run.modelCalls(), 1)
  const after = run.chat()
  assert.deepEqual(after.candidates, oldCandidates)
  assert.equal(run.continuity.inspect({ script: script(), state: after.scriptState, request: { kind: 'progress' } }).cursor, 0)
})

test('卡片模式拒绝生成候选项', async () => {
  const run = harness({ mode: 'revision', outputs: ['{}'] })
  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-4' }), /卡片模式不生成剧情候选项/)
})

test('候选项只读取最近 6 段正文，不注入历史用户输入', async () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: 'history-' + index
  }))
  const run = harness({ outputs: [JSON.stringify({ choices: storyChoices })], messages })
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-window' })

  const sent = run.modelRequests[0].messages
  assert.equal(sent.length, 7)
  assert.doesNotMatch(JSON.stringify(sent), /history-7/)
  assert.match(JSON.stringify(sent), /history-9/)
  assert.match(JSON.stringify(sent), /history-19/)
  assert.doesNotMatch(JSON.stringify(sent), /history-(8|10|12|14|16|18)"/)
})
