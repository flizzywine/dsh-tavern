import assert from 'node:assert/strict'
import test from 'node:test'

import { createCandidateGenerator } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
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

function harness({ mode = 'story', outputs, initialCandidates, initialCandidateAgent, initialSettleStatus, messages, initialScriptCursor = 0, initialScriptEnded = false, scriptData, cardData, macroState, waitUntilSettled, writeChatHook }) {
  const continuity = createScriptContinuity()
  const activeScript = scriptData || script()
  let scriptState = mode === 'script' ? continuity.start(activeScript, initialScriptCursor) : null
  if (initialScriptEnded) scriptState = continuity.transition({ script: activeScript, state: scriptState, event: { kind: 'end' } }).state
  let chat = {
    id: 'chat-1', cardId: 'card-1', mode, messages: messages || [{ role: 'assistant', text: '雨水敲着窗。' }],
    scriptState,
    settleStatus: initialSettleStatus || 'idle',
    macroState: macroState || { userName: 'User', local: {}, global: {} }
  }
  if (initialCandidates !== undefined) chat.candidates = structuredClone(initialCandidates)
  if (initialCandidateAgent !== undefined) chat.candidateAgent = structuredClone(initialCandidateAgent)
  const card = cardData || { id: 'card-1', name: '阿芙拉', description: '银发佣兵', tags: [] }
  let modelCalls = 0
  const modelRequests = []
  function remember(options) {
    modelRequests.push({
      system: options.system,
      turnContext: options.turnContext,
      messages: structuredClone(options.messages),
      tools: structuredClone(options.tools || []),
      maxTokens: options.maxTokens,
      persistent: options.persistent,
      persistentSessionId: options.persistentSessionId,
      rewindTo: Number.isSafeInteger(options.rewindTo) ? options.rewindTo : null
    })
  }
  async function nextOutput(options) {
    remember(options)
    const call = ++modelCalls
    const output = outputs[Math.min(call - 1, outputs.length - 1)]
    const text = typeof output === 'function' ? await output(options) : output
    return { text, traceSessionId: options.persistentSessionId || 'candidate-trace-' + call }
  }
  const store = {
    async chatForSession() { return structuredClone(chat) },
    async readChat() { return structuredClone(chat) },
    async readCard() { return structuredClone(card) },
    async readScript() { return mode === 'script' ? structuredClone(activeScript) : undefined },
    async writeChat(next) {
      if (typeof writeChatHook === 'function') await writeChatHook(next, chat)
      chat = structuredClone(next)
    }
  }
  const model = {
    selection() { return { provider: 'test', model: 'scripted' } },
    async runCandidate(options) { return await nextOutput(options) }
  }
  const plannerCalls = []
  const warnings = []
  const planner = {
    async plan(input) {
      plannerCalls.push(input)
      return { text: '候选项上下文', stableText: '稳定候选上下文', dynamicText: '本轮游标、Guide 与姿势', audit: { included: [], omitted: [], warnings: [], totalChars: 7 } }
    }
  }
  const candidates = createCandidateGenerator({
    store, model, planner, prompt, scripts: continuity,
    timeline: createStoryTimeline({ id: (prefix) => prefix + '-' + Math.random().toString(36).slice(2), now: () => 123456 }),
    waitUntilSettled: waitUntilSettled || (async () => {}), sleep: async () => {}, now: () => 123456,
    logger: { error() {}, warn(message) { warnings.push(String(message)) } }
  })
  return {
    candidates, continuity, plannerCalls, modelRequests, warnings, modelCalls: () => modelCalls,
    chat: () => structuredClone(chat),
    setMessages(next) {
      chat.messages = structuredClone(next)
      if (chat.timeline) chat.timeline.revision++
    },
    mutateChat(change) { change(chat) }
  }
}

test('开场白后的首次候选会先等待完整后台结算，再规划候选', async () => {
  const order = []
  const run = harness({
    outputs: [JSON.stringify({ choices: storyChoices })],
    messages: [{ role: 'assistant', text: '雨水敲着窗。', greeting: true }],
    async waitUntilSettled(chat) {
      assert.equal(chat.messages[0].greeting, true)
      order.push('settlement')
    }
  })
  const originalPlan = run.plannerCalls
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'opening' })
  if (originalPlan.length > 0) order.push('candidate')

  assert.deepEqual(order, ['settlement', 'candidate'])
})

test('Story Timeline 后台 operation 运行时立即拒绝候选生成，不相信重复的 settleStatus', async () => {
  let waits = 0
  const run = harness({
    outputs: [JSON.stringify({ choices: storyChoices })],
    initialSettleStatus: 'done',
    async waitUntilSettled() { waits++ }
  })
  const timeline = createStoryTimeline({ id: (prefix) => prefix + '-busy', now: () => 123456 })
  run.mutateChat(function (chat) {
    const begun = timeline.apply({ chat, intent: { kind: 'agent.begin', role: 'settlement' } })
    Object.assign(chat, begun.chat)
  })

  await assert.rejects(
    run.candidates.generate({ sessionId: 'session-1', messageId: 'message-running' }),
    /后台 Agent 正在执行 settlement/
  )
  assert.equal(waits, 0)
  assert.equal(run.modelCalls(), 0)
})

test('候选 prepare 只持久化 Operation，模型 Promise 由响应结束后再创建', async () => {
  const run = harness({ outputs: [JSON.stringify({ choices: storyChoices })] })

  const prepared = await run.candidates.prepare({ sessionId: 'session-1', messageId: 'message-prepared' })
  assert.match(prepared.operationId, /^operation-/)
  assert.equal(run.modelCalls(), 0)

  const result = await prepared.execute()
  assert.equal(run.modelCalls(), 1)
  assert.equal(result.messageId, 'message-prepared')
})

test('候选任务依次报告生成、校验、保存与发布阶段', async () => {
  const run = harness({ outputs: [JSON.stringify({ choices: storyChoices })] })
  const stages = []

  await run.candidates.generate({
    sessionId: 'session-1', messageId: 'message-stages',
    onStage(stage) { stages.push(stage) }
  })

  assert.deepEqual(stages, ['generating', 'validating', 'committing', 'publishing'])
})

test('模型成功但 chat 提交失败时明确报告候选已经生成但保存失败', async () => {
  const run = harness({
    outputs: [JSON.stringify({ choices: storyChoices })],
    async writeChatHook(next) {
      if (next.candidates && next.candidates.messageId === 'message-save-failure') {
        const error = new Error('模拟 chat 文件写入失败')
        error.code = 'EIO'
        throw error
      }
    }
  })

  await assert.rejects(
    () => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-save-failure' }),
    function (error) {
      return error && error.stage === 'committing' && /候选已经生成，但保存失败/.test(error.message)
    }
  )
  assert.equal(run.modelCalls(), 1)
  assert.equal(run.chat().candidates, undefined)
})

test('模型调用失败与候选输出无效保留各自的失败阶段', async () => {
  const modelFailure = harness({ outputs: [async function () { throw new Error('上游模型不可用') }] })
  await assert.rejects(
    () => modelFailure.candidates.generate({ sessionId: 'session-1', messageId: 'message-model-failure' }),
    function (error) { return error && error.stage === 'generating' && /候选 Agent 生成失败/.test(error.message) }
  )

  const invalid = harness({ outputs: ['{"choices":[]}'] })
  await assert.rejects(
    () => invalid.candidates.generate({ sessionId: 'session-1', messageId: 'message-invalid-stage' }),
    function (error) { return error && error.stage === 'validating' && /候选输出无效/.test(error.message) }
  )
})

test('相同请求标识重复 prepare 复用 Operation，服务端只调度首次执行', async () => {
  const run = harness({ outputs: [JSON.stringify({ choices: storyChoices })] })
  const input = { sessionId: 'session-1', messageId: 'message-idempotent', requestId: 'candidate-request-1' }

  const first = await run.candidates.prepare(input)
  const retried = await run.candidates.prepare(input)

  assert.equal(first.created, true)
  assert.equal(retried.created, false)
  assert.equal(retried.operationId, first.operationId)
  const result = await first.execute()
  assert.equal(result.requestId, 'candidate-request-1')
  assert.equal(result.operationId, first.operationId)
  assert.equal((await run.candidates.find(input)).requestId, 'candidate-request-1')
  assert.equal(run.modelCalls(), 1)
})

test('自由故事只保存完整的 4 action + 1 scene', async () => {
  const truncatedButRecoverable = '{"choices":[' + storyChoices.map((item) => JSON.stringify(item)).join(',')
  const run = harness({ outputs: [truncatedButRecoverable] })
  let started = null

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-1', guidance: '多写动作', onStarted(operation) { started = operation } })
  assert.match(started.operationId, /^operation-/)
  assert.equal(started.basedOn.revision, 0)
  assert.equal(run.modelCalls(), 1)
  assert.equal(result.choices.length, 5)
  assert.equal(result.choices.filter((item) => item.type === 'action').length, 4)
  assert.equal(result.choices.filter((item) => item.type === 'scene').length, 1)
  assert.equal(result.traceSessionId, 'candidate-trace-1')
  assert.equal(result.traceMode, 'continuable')
  assert.equal(run.modelRequests[0].persistent, true)
  assert.equal(run.modelRequests[0].maxTokens, undefined)
  assert.equal(run.plannerCalls[0].purpose, 'candidate')
  assert.match(run.plannerCalls[0].task, /剧情候选项生成器/)

  const saved = await run.candidates.find({ sessionId: 'session-1', messageId: 'message-1' })
  assert.deepEqual(saved, result)
  assert.equal(await run.candidates.find({ sessionId: 'session-1', messageId: 'old-message' }), null)
})

test('自由故事过滤无效项后按类型顺序裁剪超额候选', async () => {
  const output = [
    { type: 'scene', text: '第一个场景' },
    { type: 'action', text: '行动一' },
    { type: 'action', text: '行动一' },
    { type: 'action', text: '行动二' },
    { type: 'scene', text: '第二个场景' },
    { type: 'action', text: '行动三' },
    { type: 'action', text: '行动四' },
    { type: 'action', text: '行动五' },
    { type: 'action', text: '   ' },
    { type: 'unknown', text: '无效类型' },
  ]
  const run = harness({ outputs: [JSON.stringify({ choices: output })] })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-extra' })

  assert.deepEqual(result.choices, [
    { type: 'action', text: '行动一' },
    { type: 'action', text: '行动二' },
    { type: 'action', text: '行动三' },
    { type: 'action', text: '行动四' },
    { type: 'scene', text: '第一个场景' },
  ])
  assert.equal(run.modelCalls(), 1)
  assert.match(run.warnings.join('\n'), /候选项.*裁剪/)
})

test('剧本模式存在多个有效候选时只保留第一个', async () => {
  const run = harness({
    mode: 'script',
    outputs: [JSON.stringify({ choices: [
      { type: 'action', text: '沿着剧本继续调查' },
      { type: 'scene', text: '提前切换到下一幕' },
    ] })],
  })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'script-extra' })

  assert.deepEqual(result.choices, [{ type: 'action', text: '沿着剧本继续调查' }])
  assert.equal(run.modelCalls(), 1)
  assert.match(run.warnings.join('\n'), /候选项.*裁剪/)
})

test('候选输出无效时不自动创建第二个 Agent', async () => {
  const invalid = JSON.stringify({ choices: storyChoices.slice(0, 4) })
  const valid = JSON.stringify({ choices: storyChoices })
  const run = harness({ outputs: [invalid, valid] })

  await assert.rejects(() => run.candidates.generate({ sessionId: 'session-1', messageId: 'message-no-retry' }), /至少 4 个行动候选/)
  assert.equal(run.modelCalls(), 1)
})

test('自由故事候选总数超额但缺少必需类型时仍然失败', async () => {
  const onlyActions = storyChoices.slice(0, 4).concat([{ type: 'action', text: '第五个行动' }])
  const tooFewActions = storyChoices.slice(0, 3).concat([
    { type: 'scene', text: '第一个场景' },
    { type: 'scene', text: '第二个场景' },
  ])
  const noSceneRun = harness({ outputs: [JSON.stringify({ choices: onlyActions })] })
  const tooFewActionsRun = harness({ outputs: [JSON.stringify({ choices: tooFewActions })] })

  await assert.rejects(() => noSceneRun.candidates.generate({ sessionId: 'session-1', messageId: 'no-scene' }), /至少 4 个行动候选和 1 个场景候选/)
  await assert.rejects(() => tooFewActionsRun.candidates.generate({ sessionId: 'session-1', messageId: 'too-few-actions' }), /至少 4 个行动候选和 1 个场景候选/)
})

test('候选生成期间时间线变化，迟到候选与 point 都不会落盘', async () => {
  let run
  run = harness({ mode: 'script', outputs: [async function (options) {
    await options.onToolCall({ name: 'tavern_point_script', arguments: { position: 3 } })
    run.mutateChat(function (chat) { chat.timeline.revision++ })
    return JSON.stringify({ choices: [{ type: 'action', text: '这是已经过期的候选' }] })
  }] })

  await assert.rejects(
    () => run.candidates.generate({ sessionId: 'session-1', messageId: 'stale-candidate' }),
    /剧情状态已变化/
  )
  assert.equal(run.chat().candidates, undefined)
  assert.equal(run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } }).cursor, 0)
})

test('候选字数只是软约束，过短或超过 80 字都可以通过', async () => {
  const shortStory = [
    { type: 'action', text: '观察' },
    { type: 'action', text: '追问' },
    { type: 'action', text: '检查' },
    { type: 'action', text: '追踪' },
    { type: 'scene', text: '转场' }
  ]
  const storyRun = harness({ outputs: [JSON.stringify({ choices: shortStory })] })
  const storyResult = await storyRun.candidates.generate({ sessionId: 'session-1', messageId: 'message-short' })
  assert.deepEqual(storyResult.choices, shortStory)

  const longText = '接着最近的正文，人物先稳住情绪，再从桌上遗留的痕迹谈起，逐步问清雨夜钟声背后的线索，并决定亲自去钟楼核实那个被隐瞒已久的真相，即使这个行动可能带来新的危险也不再回避，因为错过今夜就可能永远失去找到答案的机会'
  assert.ok(longText.length > 80)
  const scriptRun = harness({ mode: 'script', outputs: [JSON.stringify({ choices: [{ type: 'action', text: longText }] })] })
  const scriptResult = await scriptRun.candidates.generate({ sessionId: 'session-1', messageId: 'message-long' })
  assert.equal(scriptResult.choices[0].text, longText)
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
    researched.push(JSON.parse(await options.onToolCall({
      name: 'tavern_point_script',
      arguments: { position: 3 }
    })))
    return JSON.stringify({
      choices: [{ type: 'action', text: '沿着钟楼石阶谨慎地向上追去' }]
    })
  }] })

  const result = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-2' })
  assert.equal(result.choices.length, 1)
  assert.deepEqual(researched.slice(0, 2).map((item) => item.chunks[0].id), ['chunk-00002', 'chunk-00003'])
  assert.equal(researched[2].pointedAt, 3)
  assert.match(run.plannerCalls[0].task, /剧本候选项生成器/)
  assert.match(run.plannerCalls[0].task, /tavern_point_script/)
  const savedChat = run.chat()
  const progress = run.continuity.inspect({ script: script(), state: savedChat.scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
  assert.equal(run.plannerCalls[0].scriptWindow.chunks[0].id, 'chunk-00001')
  assert.deepEqual(run.modelRequests[0].tools.map((tool) => tool.name), ['tavern_read_script', 'tavern_point_script'])
  assert.equal(run.modelRequests[0].tools[0].parameters.properties.position.minimum, 1)
  assert.equal(run.modelRequests[0].tools[0].parameters.properties.point, undefined)
  assert.equal(run.modelRequests[0].tools[1].parameters.properties.position.minimum, 1)
  assert.equal(run.modelRequests[0].tools[1].parameters.properties.query, undefined)
  assert.equal(run.modelRequests[0].tools[1].countsTowardLimit, false)
  assert.equal(result.traceSessionId, 'candidate-trace-1')
  assert.deepEqual(savedChat.messages, [{ role: 'assistant', text: '雨水敲着窗。' }])
})

test('剧本候选保存并复用持久 Agent，会话建立后每轮只追加最新正文', async () => {
  const firstOutput = JSON.stringify({ choices: [{ type: 'action', text: '沿着雨夜脚印继续调查' }] })
  const secondOutput = JSON.stringify({ choices: [{ type: 'action', text: '根据新线索转向钟楼入口' }] })
  const run = harness({ mode: 'script', outputs: [firstOutput, secondOutput] })

  const first = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-persistent-1' })
  assert.equal(first.traceSessionId, 'candidate-trace-1')
  assert.equal(first.traceMode, 'continuable')
  assert.equal(run.chat().candidateAgent.sessionId, 'candidate-trace-1')
  assert.equal(run.chat().candidateAgent.mode, 'continuable')
  assert.equal(run.modelRequests[0].persistent, true)
  assert.equal(run.modelRequests[0].persistentSessionId, '')
  assert.equal(run.modelRequests[0].system, '稳定候选上下文')
  assert.equal(run.modelRequests[0].turnContext, '本轮游标、Guide 与姿势')

  run.setMessages([
    { role: 'assistant', text: '雨水敲着窗。' },
    { role: 'user', text: '查看脚印' },
    { role: 'assistant', text: '她在泥水里发现了指向钟楼的新脚印。' }
  ])
  const second = await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-persistent-2' })

  assert.equal(second.traceSessionId, 'candidate-trace-1')
  assert.equal(run.modelRequests[1].persistentSessionId, 'candidate-trace-1')
  assert.equal(run.modelRequests[1].messages.length, 2)
  assert.match(run.modelRequests[1].messages[0].content[0].text, /指向钟楼的新脚印/)
  assert.doesNotMatch(JSON.stringify(run.modelRequests[1].messages), /雨水敲着窗/)
})

test('剧本候选未 point 时保持当前块，读取位置不改变游标', async () => {
  const stay = harness({ mode: 'script', initialScriptCursor: 1, outputs: [JSON.stringify({
    choices: [{ type: 'action', text: '继续追问雨夜脚印留下的具体方向' }]
  })] })
  await stay.candidates.generate({ sessionId: 'session-1', messageId: 'message-stay' })
  assert.equal(stay.continuity.inspect({ script: script(), state: stay.chat().scriptState, request: { kind: 'progress' } }).cursor, 1)

  const ended = harness({ mode: 'script', initialScriptCursor: 2, outputs: [async function (options) {
    const end = JSON.parse(await options.onToolCall({ name: 'tavern_read_script', arguments: { position: 4 } }))
    assert.equal(end.ended, true)
    await options.onToolCall({ name: 'tavern_point_script', arguments: { position: 4 } })
    return JSON.stringify({ choices: [{ type: 'action', text: '在钟声消散后收起武器离开这里' }] })
  }] })
  await ended.candidates.generate({ sessionId: 'session-1', messageId: 'message-ended' })
  const progress = ended.continuity.inspect({ script: script(), state: ended.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 3)

  const remainsEnded = harness({ mode: 'script', initialScriptEnded: true, outputs: [async function (options) {
    await options.onToolCall({ name: 'tavern_point_script', arguments: { position: 4 } })
    return JSON.stringify({ choices: [{ type: 'scene', text: '让钟楼余波成为故事最后的安静尾声' }] })
  }] })
  await remainsEnded.candidates.generate({ sessionId: 'session-1', messageId: 'message-remains-ended' })
  assert.equal(remainsEnded.continuity.inspect({ script: script(), state: remainsEnded.chat().scriptState, request: { kind: 'progress' } }).cursor, 3)
})

test('剧本候选可任意读取前文，但不能让游标后退', async () => {
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
    const backwardPoint = JSON.parse(await options.onToolCall({
      name: 'tavern_point_script',
      arguments: { position: 1 }
    }))
    assert.equal(backwardPoint.pointedAt, 3)
    assert.equal(backwardPoint.ignoredBackward, true)
    return JSON.stringify({
      choices: [{ type: 'action', text: '折返旅店查看当时遗留的重要线索' }]
    })
  }] })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-backward' })
  const progress = run.continuity.inspect({ script: script(), state: run.chat().scriptState, request: { kind: 'progress' } })
  assert.equal(progress.cursor, 2)
})

test('剧本候选搜索到远处内容后不自动提交该位置', async () => {
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
  assert.equal(progress.cursor, 0)
})

test('后台剧本读取工具解析宏但不再擅自删除剧本内的 HTML', async () => {
  const scriptWithUi = script()
  scriptWithUi.chunks[0].text = '阶段 {{getvar::stage || 1}}。\n<style>.panel{color:red}</style><div class="panel">阶段 {{.stage}}</div>'
  const run = harness({
    mode: 'script',
    scriptData: scriptWithUi,
    macroState: { userName: 'User', local: { stage: 2 }, global: {} },
    outputs: [async function (options) {
      const result = JSON.parse(await options.onToolCall({
        name: 'tavern_read_script',
        arguments: { position: 1 }
      }))
      assert.equal(result.chunks[0].text, '阶段 2。\n<style>.panel{color:red}</style><div class="panel">阶段 2</div>')
      assert.doesNotMatch(result.chunks[0].text, /\{\{/)
      return JSON.stringify({ choices: [{ type: 'action', text: '按照当前阶段继续推进既定剧情内容' }] })
    }]
  })

  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-projected-script' })
})

test('剧本读取与游标定位使用两个独立工具', async () => {
  const run = harness({ mode: 'script', outputs: [async function (options) {
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: {} }), /position 或 query/)
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: { position: 2, query: '雨夜' } }), /position 或 query/)
    await assert.rejects(() => options.onToolCall({ name: 'tavern_read_script', arguments: { position: 5 } }), /1 到 4/)
    await assert.rejects(() => options.onToolCall({ name: 'tavern_point_script', arguments: {} }), /position/)
    await assert.rejects(() => options.onToolCall({ name: 'tavern_point_script', arguments: { position: 5 } }), /1 到 4/)
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
  const invalid = '{"choices":[{"type":"unknown","text":"有文本但类型无效"}]}'
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
  const run = harness({ mode: 'card', outputs: ['{}'] })
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

test('候选项使用被展示正则移走的内部源文本', async () => {
  const run = harness({
    outputs: [JSON.stringify({ choices: storyChoices })],
    messages: [{ role: 'assistant', text: '\u00a0', sourceText: '叶天邪走进白伊甸校园。' }]
  })
  await run.candidates.generate({ sessionId: 'session-1', messageId: 'message-projected' })

  assert.match(JSON.stringify(run.modelRequests[0].messages), /叶天邪走进白伊甸校园/)
})
