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
    modelRequests.push({ system: options.system, messages: structuredClone(options.messages), tools: structuredClone(options.tools || []) })
  }
  async function nextOutput(options) {
    remember(options)
    const output = outputs[Math.min(modelCalls++, outputs.length - 1)]
    return typeof output === 'function' ? await output(options) : output
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
    async call(options) { return await nextOutput(options) },
    async callWithTools(options) { return await nextOutput(options) }
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
  assert.match(run.plannerCalls[0].task, /剧情候选项生成器/)

  const saved = await run.candidates.find({ sessionId: 'session-1', messageId: 'message-1' })
  assert.deepEqual(saved, result)
  assert.equal(await run.candidates.find({ sessionId: 'session-1', messageId: 'old-message' }), null)
})

test('剧本候选可自由读取远处剧本，读过目标块后向前移动游标', async () => {
  const researched = []
  const run = harness({ mode: 'script', outputs: [async function (options) {
    researched.push(JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { action: 'next' }
    })))
    researched.push(JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { action: 'next' }
    })))
    const pointed = JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { action: 'point' }
    }))
    assert.equal(pointed.pointedAt, 3)
    return JSON.stringify({
      choices: [{ type: 'action', text: '沿着钟楼石阶谨慎地向上追去' }]
    })
  }] })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-2' })
  assert.equal(result.choices.length, 1)
  assert.deepEqual(researched.map((item) => item.chunks[0].id), ['chunk-00002', 'chunk-00003'])
  assert.match(run.plannerCalls[0].task, /剧本候选项生成器/)
  assert.match(run.plannerCalls[0].task, /next、prev、search 和 point/)
  const savedChat = run.chat()
  const progress = run.continuity.inspect({ script: script(), state: savedChat.scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
  assert.equal(run.plannerCalls[0].scriptWindow.chunks[0].id, 'chunk-00001')
  assert.equal(run.modelRequests[0].tools[0].name, 'tavern_read_script')
  assert.deepEqual(run.modelRequests[0].tools[0].parameters.properties.action.enum, ['next', 'prev', 'search', 'point'])
  assert.equal(run.modelRequests[0].tools[0].parameters.properties.offset, undefined)
  assert.deepEqual(savedChat.messages, [{ role: 'assistant', text: '雨水敲着窗。' }])
})

test('剧本候选不 point 时保持当前块，point 到结尾时结束剧本', async () => {
  const stay = harness({ mode: 'script', initialScriptCursor: 1, outputs: [JSON.stringify({
    choices: [{ type: 'action', text: '继续追问雨夜脚印留下的具体方向' }]
  })] })
  await stay.candidates.generate({ sessionId: 'session-1', messageId: 'message-stay' })
  assert.equal(stay.continuity.inspect({ script: script(), state: stay.chat().scriptState, request: { kind: 'progress' } }).cursor, 1)

  const ended = harness({ mode: 'script', initialScriptCursor: 2, outputs: [async function (options) {
    const end = JSON.parse(await options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'next' } }))
    assert.equal(end.ended, true)
    await options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'point' } })
    return JSON.stringify({ choices: [{ type: 'action', text: '在钟声消散后收起武器离开这里' }] })
  }] })
  await ended.candidates.generate({ sessionId: 'session-1', messageId: 'message-ended' })
  const progress = ended.continuity.inspect({ script: script(), state: ended.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 3)

  const remainsEnded = harness({ mode: 'script', initialScriptEnded: true, outputs: [async function (options) {
    await options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'point' } })
    return JSON.stringify({ choices: [{ type: 'scene', text: '让钟楼余波成为故事最后的安静尾声' }] })
  }] })
  await remainsEnded.candidates.generate({ sessionId: 'session-1', messageId: 'message-remains-ended' })
  assert.equal(remainsEnded.continuity.inspect({ script: script(), state: remainsEnded.chat().scriptState, request: { kind: 'progress' } }).cursor, 3)
})

test('剧本候选读取前文后可向后移动游标', async () => {
  const run = harness({ mode: 'script', initialScriptCursor: 2, outputs: [async function (options) {
    const second = JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { action: 'prev' }
    }))
    assert.equal(second.chunks[0].id, 'chunk-00002')
    const first = JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { action: 'prev' }
    }))
    assert.equal(first.chunks[0].id, 'chunk-00001')
    await options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'point' } })
    return JSON.stringify({
      choices: [{ type: 'action', text: '折返旅店查看当时遗留的重要线索' }]
    })
  }] })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-backward' })
  const progress = run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 0)
})

test('剧本候选可随机搜索到远处内容，但只有 point 才提交正式游标', async () => {
  const run = harness({ mode: 'script', outputs: [async function (options) {
    const found = JSON.parse(await options.onToolCall({
      name: 'tavern_read_script',
      arguments: { action: 'search', query: '钟楼' }
    }))
    assert.equal(found.chunks[0].id, 'chunk-00003')
    await options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'point' } })
    return JSON.stringify({
      choices: [{ type: 'action', text: '前往钟楼调查刚刚检索到的关键线索' }]
    })
  }] })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-sequential-read' })
  const progress = run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
})

test('剧本随机搜索必须提供关键词，旧块号参数仍不能直接定位', async () => {
  const run = harness({ mode: 'script', outputs: [async function (options) {
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'search' } }), /关键词/)
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: { offset: 3 } }), /next|prev|search|point|动作/)
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

test('三次输出都无效时不覆盖旧候选，也不改变剧本游标', async () => {
  const invalid = '{"choices":[{"type":"action","text":"太短"}]}'
  const oldCandidates = { messageId: 'old', choices: [{ type: 'action', text: '保留这一份旧的有效候选内容' }], generatedAt: 1 }
  const stageThenFail = async function (options) {
    await options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'next' } })
    await options.onToolCall({ name: 'tavern_read_script', arguments: { action: 'point' } })
    return invalid
  }
  const run = harness({ mode: 'script', outputs: [stageThenFail, stageThenFail, stageThenFail], initialCandidates: oldCandidates })

  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-3' }), /候选项生成失败|有效候选项/)
  const after = run.chat()
  assert.deepEqual(after.candidates, oldCandidates)
  assert.equal(run.continuity.inspect({ script: script(), state: after.scriptState, request: { kind: 'progress' } }).cursor, 0)
})

test('卡片模式拒绝生成候选项', async () => {
  const run = harness({ mode: 'revision', outputs: ['{}'] })
  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-4' }), /卡片模式不生成剧情候选项/)
})

test('候选项只读取最近 12 条剧情消息', async () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: 'history-' + index
  }))
  const run = harness({ outputs: [JSON.stringify({ choices: storyChoices })], messages })
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-window' })

  const sent = run.modelRequests[0].messages
  assert.equal(sent.length, 13)
  assert.doesNotMatch(JSON.stringify(sent), /history-7/)
  assert.match(JSON.stringify(sent), /history-8/)
  assert.match(JSON.stringify(sent), /history-19/)
})
