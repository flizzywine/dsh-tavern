import assert from 'node:assert/strict'
import test from 'node:test'

import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createForegroundOrchestrationStrategies, createNativePlayOrchestrationStrategy, createCompatibilityOrchestrationStrategy } from "../tavern-plugin/lib/domain/foreground-orchestration-strategies.js"
import { ensureSessionStablePrefix, sessionStablePrefixSections } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { ensureSessionSeedTrajectory } from '../tavern-plugin/lib/domain/session-seed-trajectory.js'

function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function pluginMessage(role, text, plugin, form) {
  return { role, content: [{ type: 'text', text }], source: { kind: 'plugin', plugin, ...(form ? { form } : {}) } }
}

function strategies(overrides = {}) {
  const calls = []
  const chats = new Map([['native', { id: 'native', requestMode: 'dsh', mode: 'story' }], ['compat', { id: 'compat', requestMode: 'sillytavern', mode: 'story' }]])
  const options = {
    compatibility: {
      async beforeTurn(input) { calls.push(['compat.before', input.userText]) },
      async beginTurn(input) { calls.push(['compat.begin', input.turn, input.requestId]) },
      async chatForSession(sessionId) { return chats.get(sessionId) },
      async compileTurn(_chat, userText) { calls.push(['compat.compile', userText]); return { messages: [{ role: 'system', content: 'compat' }] } },
      async persistCompiled(input) { calls.push(['compat.persist', input.turn]) },
      projectMessages(compiled) { return compiled.messages.map(function (message) { return { role: message.role, content: [{ type: 'text', text: message.content }] } }) }
    },
    nativePlay: {
      async modeFor() { return 'story' },
      filterMessages(messages) { return messages },
      async resolvePreset() { return { front: { text: 'preset' } } },
      async synchronizeTail(input) { calls.push(['native.sync', input.sessionId]) },
      async prepareTurn(input) {
        calls.push(['native.prepare', input.userText, input.requestId])
        return { frame: { frameId: 'frame-1', branchId: 'b', basedOnRevision: 1, source: {}, userInput: { projectedText: 'projected' } } }
      },
      appendFrame(input) { return { messages: input.messages.concat([{ role: 'user', content: [{ type: 'text', text: 'frame' }] }]), receipt: { appended: true } } },
      recordFrame(_sessionId, frame) { calls.push(['native.frame', frame.frameId]) },
      async visibleTools() { return [] },
      modePrompt() { return 'play' },
      workspaceContext() { return '' },
      async ensureSessionPrefix() {},
      controlledToolNames: new Set(['bash'])
    },
    ...overrides
  }
  return { value: createForegroundOrchestrationStrategies(options), compatibility: createCompatibilityOrchestrationStrategy(options.compatibility), calls, chats }
}

test('游玩固定背景来自原生系统装配，预设前后段保持顺序，快照不重复发送', async () => {
  const session = Session.create('native')
  const savedPrefixes = new Map()
  const storage = { async read(id) { return savedPrefixes.get(id) }, async write(id, value) { savedPrefixes.set(id, value) } }
  let cardText = '人物卡固定基本信息\n常驻世界书'
  await ensureSessionStablePrefix(session, cardText, storage)
  await ensureSessionSeedTrajectory(session)
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages },
    async resolvePreset() { return {
      front: { entries: [{ role: 'user', content: '预设前置指令' }] },
      back: { entries: [{ role: 'system', content: '预设后置指令' }] }
    } },
    async ensureSessionPrefix() { return await ensureSessionStablePrefix(session, cardText, storage) },
    async prepareTurn() { return { frame: { userInput: { projectedText: '本轮玩家输入' } } } },
    appendFrame(input) { return { messages: input.messages.concat([pluginMessage('user', '本轮动态指令', 'dsh-tavern', 'foreground-frame')]), receipt: {} } },
    recordFrame() {}, async visibleTools() { return [] },
    modePrompt() { return '正文任务' }, controlledToolNames: new Set()
  } })
  for (const turn of [2, 3]) {
    const incoming = [userMessage('新输入')]
    // DSH assembles the system prompt before the pre-step decision.
    const assembly = await run.value.assembleSystemPrompt({ sections: [], tools: [] }, { sessionId: 'native', chat: run.chats.get('native'), fixedSystemSections: sessionStablePrefixSections(session) })
    const prepared = await run.value.prepareStep({ sessionId: 'native', payload: { turn, step: 1, messages: incoming }, decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native') })
    const system = assembly.sections.map(section => section.text).join('\n')
    assert.match(system, /人物卡固定基本信息/ )
    assert.deepEqual(prepared.messages.map(message => message.content[0].text), ['本轮玩家输入', '本轮动态指令'])
    assert.equal(prepared.messages.some(message => message.id === 'tavern-session-prefix:native'), false)
    const modelMessages = session.deriveMessages().concat(prepared.messages)
    assert.equal(modelMessages.filter(message => message.id === 'tavern-session-prefix:native').length, 1)
    assert.equal(modelMessages[0].source.form, 'snapshot')
    assert.equal(modelMessages[0].role, 'user', 'Session 权威历史保持原样')
    // The front phase is a native system section, so it is recorded in the trajectory
    // (and replayed by compaction) instead of being projected at the request boundary.
    assert.equal(assembly.sections[0].name, 'tavern:runtime-preset-front')
    assert.match(system, /^预设前置指令\n人物卡固定基本信息/)
    assert.equal(prepared.startsRequestSeries, turn === 2 ? true : undefined, '首次或预设前段变化时才开始新请求序列')
    const request = run.value.projectRequest({ sessionId: 'native', system, messages: modelMessages })
    assert.deepEqual(request.messages.map(message => message.role), ['user', 'assistant', 'user'])
    assert.equal(request.system, system, '系统提示原样保留，不再在请求边界拆分')
    assert.equal(request.messages.at(-1).role, 'user', '本轮指令和预设后段保持 user 语义')
    assert.match(request.messages.at(-1).content[0].text, /本轮动态指令\n\n预设后置指令$/)
    assert.notEqual(request.messages[0], modelMessages[0])
    assert.equal(modelMessages[0].role, 'user', '请求投影不得回写 Session 消息')
    assert.equal(modelMessages.at(-1).role, 'user', '本轮 Frame 在 Session 中仍保持原角色')
    assert.equal(run.value.projectRequest(request), null)
    cardText = '后续轮次不重新覆盖最初背景'
  }
  assert.equal(sessionEvents(session).filter(event => event.type === 'user/message' && event.data.id === 'tavern-session-prefix:native').length, 1)
  assert.equal(savedPrefixes.size, 0)
})

test('旧 Session 的 Tavern 开场白在请求边界恢复为合成模型来源，不触发 DeepSeek reasoning 续传校验', async () => {
  const run = strategies()
  const incoming = [userMessage('继续')]
  await run.value.prepareStep({
    sessionId: 'native', payload: { turn: 2, step: 1, messages: incoming },
    decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native')
  })
  const opening = {
    id: 'tavern-opening:legacy-chat', role: 'assistant',
    content: [{ type: 'text', text: '旧开场白' }],
    source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  }
  const oldPresetBoundary = {
    role: 'system', content: [{ type: 'text', text: '旧预设边界' }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', sections: [{ name: 'tavern:runtime-preset-front', text: '旧预设边界' }] }
  }
  const original = Object.freeze({
    sessionId: 'native', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high',
    messages: Object.freeze([oldPresetBoundary, opening, userMessage('下一轮')])
  })

  const projected = run.value.projectRequest(original)
  const restored = projected.messages.find(message => message.id === opening.id)

  assert.deepEqual(restored.source, { kind: 'model', provider: 'dsh-tavern', model: 'character-card' })
  assert.equal(opening.source.kind, 'model')
})

test('新版 DSH 文件工具只向卡片 Agent 开放，不泄漏给正文 Agent', async () => {
  async function assembledToolNames(mode) {
    const fileTools = ['read', 'write', 'edit', 'read_image']
    const run = strategies({
      nativePlay: {
        async modeFor() { return mode },
        filterMessages(messages) { return messages },
        async resolvePreset() { return null },
        async prepareTurn() { return { text: '' } },
        appendFrame(input) { return { messages: input.messages, receipt: {} } },
        recordFrame() {},
        async visibleTools() { return mode === 'card' ? fileTools : ['tavern_recall_history'] },
        modePrompt() { return mode },
        workspaceContext() { return '/resources' },
        async ensureSessionPrefix() {},
        controlledToolNames: new Set([...fileTools, 'tavern_recall_history'])
      }
    })
    const assembly = await run.value.assembleSystemPrompt({
      sections: [],
      contexts: [],
      tools: [...fileTools, 'tavern_recall_history'].map(function (name) { return { name } })
    }, { sessionId: 'native', chat: run.chats.get('native'), cwd: '/workspace' })
    return assembly.tools.map(function (tool) { return tool.name })
  }

  assert.deepEqual(await assembledToolNames('card'), ['read', 'write', 'edit', 'read_image'])
  assert.deepEqual(await assembledToolNames('story'), ['tavern_recall_history'])
})

for (const sessionId of ['native']) test('regeneration gates ordinary and stale inputs before preparation: '+sessionId,async()=>{
  const run=strategies();const chat=run.chats.get(sessionId)
  chat.regenInProgress=true;chat.regenRecovery={id:'current'}
  const input=message=>({chat,sessionId,payload:{turn:3,step:1,messages:[message]},decision:{kind:'enter',messages:[message]},requestId:'request'})
  await assert.rejects(run.value.prepareStep(input(userMessage('normal'))),/重新生成尚未完成/)
  const message=pluginMessage('user','retry','dsh-tavern-regen')
  message.source.regenerationId='stale'
  await assert.rejects(run.value.prepareStep(input(message)),/重新生成尚未完成/)
  assert.equal(run.calls.length,0)
  message.source.regenerationId='current'
  chat.regenRecovery.phase='committed'
  await assert.rejects(run.value.prepareStep(input(message)),/重新生成尚未完成/)
  delete chat.regenRecovery.phase
  await run.value.prepareStep(input(message))
  assert.ok(run.calls.length>0)
})

for (const text of ['', '请根据图片继续']) test(`前台投影保留图片：${text || '纯图片'}`, async () => {
  const image = { type: 'image', attachment: { id: 'image-test', mimeType: 'image/png' } }
  const messages = [{ ...userMessage(text), content: [...(text ? [{ type: 'text', text }] : []), image] }]
  const original = structuredClone(messages)
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'story', filterMessages: value => value, resolvePreset: async () => null,
    prepareTurn: async ({ userText }) => ({ frame: { userInput: { projectedText: userText ? '处理后的文字' : '' } } }),
    appendFrame: ({ messages }) => ({ messages, receipt: {} }), recordFrame() {},
  })
  const result = await strategy.prepareStep({ sessionId: 'native', chat: {}, payload: { turn: 1, step: 1, messages }, decision: { messages } })
  assert.deepEqual(result.messages[0].content.filter(block => block.type === 'image'), [image])
  assert.equal(result.messages[0].content.some(block => block.text === '（玩家已更新酒馆运行状态）'), false)
  assert.deepEqual(messages, original)
})

test('预设后段骰子同一轮各步一致，新一轮或重新生成重新抽', async () => {
  const backs = []
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages },
    async resolvePreset() { return { back: { entries: [{ id: 'b', role: 'system', content: '骰子 {{roll::1d1000000}}' }] } } },
    async prepareTurn() { return { frame: { userInput: { projectedText: '输入' } } } },
    appendFrame(input) { return { messages: input.messages, receipt: {} } },
    recordFrame() {}, async visibleTools() { return [] },
    modePrompt() { return '正文任务' }, controlledToolNames: new Set()
  } })
  const stepOf = async (turn, step) => {
    const incoming = [userMessage('新输入')]
    await run.value.prepareStep({ sessionId: 'native', payload: { turn, step, messages: incoming }, decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native') })
    const request = run.value.projectRequest({ sessionId: 'native', system: 's', messages: incoming })
    backs.push(request.messages.at(-1).content[0].text.match(/骰子 (\d+)/)[1])
    run.value.clearRequestState('native')
  }
  await stepOf(1, 1); await stepOf(1, 2); await stepOf(1, 1); await stepOf(2, 1)
  assert.equal(backs[0], backs[1], '同一轮后续步骤沿用结果')
  assert.notEqual(backs[1], backs[2], '同一轮重新开始（重新生成）重新抽')
  assert.notEqual(backs[2], backs[3], '下一轮重新抽')
})
