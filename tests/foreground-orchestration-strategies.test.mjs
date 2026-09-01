import assert from 'node:assert/strict'
import test from 'node:test'

import { createForegroundOrchestrationStrategies, createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { ensureSessionStablePrefix, readSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

function userMessage(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function strategies(overrides = {}) {
  const calls = []
  const chats = new Map([['native', { id: 'native', requestMode: 'dsh', mode: 'story' }], ['compat', { id: 'compat', requestMode: 'sillytavern', mode: 'story' }]])
  const value = createForegroundOrchestrationStrategies({
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
  })
  return { value, calls, chats }
}

test('前台固定背景位于全部历史之前，不进入当轮 system、Frame 或预设注入', async () => {
  const session = { id: 'native', events: [], append(type, data) { this.events.push({ type, data }) } }
  const savedPrefixes = new Map()
  const storage = { async read(id) { return savedPrefixes.get(id) }, async write(id, value) { savedPrefixes.set(id, value) } }
  let cardText = '人物卡固定基本信息\n常驻世界书'
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages },
    async resolvePreset() { return { front: { text: '预设前置指令' } } },
    async ensureSessionPrefix() { await ensureSessionStablePrefix(session, cardText, storage) },
    sessionPrefix() { return readSessionStablePrefix(session) },
    async prepareTurn() { return { frame: { userInput: { projectedText: '本轮玩家输入' } } } },
    appendFrame(input) { return { messages: input.messages.concat(userMessage('本轮动态指令')), receipt: {} } },
    recordFrame() {}, async visibleTools() { return [] },
    modePrompt() { return '正文任务' }, controlledToolNames: new Set()
  } })
  for (const turn of [2, 3]) {
    const history = [userMessage('开场历史'), userMessage('新输入')]
    const prepared = await run.value.prepareStep({ sessionId: 'native', payload: { turn, step: 1, messages: history }, decision: { kind: 'enter', messages: history }, chat: run.chats.get('native') })
    const assembly = await run.value.assembleSystemPrompt({ sections: [], tools: [] }, { sessionId: 'native', chat: run.chats.get('native') })
    const system = assembly.sections.map(section => section.text).join('\n')
    assert.doesNotMatch(system, /人物卡固定基本信息|常驻世界书/)
    assert.doesNotMatch(JSON.stringify(prepared.messages), /人物卡固定基本信息|常驻世界书/)
    const request = run.value.projectRequest({ sessionId: 'native', system, messages: prepared.messages })
    assert.equal(request.messages[0].content[0].text, '人物卡固定基本信息\n常驻世界书')
    assert.equal(request.messages[0].source.form, 'session-prefix')
    assert.equal(run.value.projectRequest(request), null)
    cardText = '后续轮次不重新覆盖最初背景'
  }
  assert.equal(session.events.length, 0)
  assert.equal(savedPrefixes.size, 1)
})

test('普通游玩与兼容模式只在策略选择点分叉', async () => {
  const run = strategies()
  const nativePayload = { turn: 2, step: 1, messages: [userMessage('继续')] }
  const native = await run.value.prepareStep({ sessionId: 'native', payload: nativePayload, decision: { kind: 'enter', messages: nativePayload.messages }, chat: run.chats.get('native'), requestId: 'rpc-native' })
  assert.deepEqual(native.messages.map(function (message) { return message.content[0].text }), ['projected', 'frame'])

  const compatPayload = { turn: 3, step: 1, messages: [userMessage('向前走')] }
  const compat = await run.value.prepareStep({ sessionId: 'compat', payload: compatPayload, decision: { kind: 'enter', messages: compatPayload.messages }, chat: run.chats.get('compat'), requestId: 'rpc-compat' })
  assert.equal(compat.messages, compatPayload.messages)
  assert.deepEqual(run.calls, [
    ['native.prepare', '继续', 'rpc-native'],
    ['native.frame', 'frame-1'],
    ['compat.before', '向前走'],
    ['compat.begin', 3, 'rpc-compat'],
    ['compat.compile', '向前走'],
    ['compat.persist', 3]
  ])
})

test('两种策略分别投影模型请求且不改写 DSH 原请求', async () => {
  const run = strategies()
  const nativePayload = { turn: 2, step: 1, messages: [userMessage('继续')] }
  await run.value.prepareStep({ sessionId: 'native', payload: nativePayload, decision: { kind: 'enter', messages: nativePayload.messages }, chat: run.chats.get('native') })
  const nativeOptions = Object.freeze({ sessionId: 'native', messages: Object.freeze([]) })
  const nativeProjected = run.value.projectRequest(nativeOptions, { turn: 2, step: 1 })
  assert.notEqual(nativeProjected, nativeOptions)
  assert.equal(nativeOptions.messages.length, 0)

  const compatPayload = { turn: 3, step: 1, messages: [userMessage('向前走')] }
  await run.value.prepareStep({ sessionId: 'compat', payload: compatPayload, decision: { kind: 'enter', messages: compatPayload.messages }, chat: run.chats.get('compat') })
  const compatOptions = Object.freeze({ sessionId: 'compat', messages: Object.freeze([]) })
  const compatProjected = run.value.projectRequest(compatOptions, { turn: 3, step: 1 })
  assert.notEqual(compatProjected, compatOptions)
  assert.equal(compatProjected.messages[0].content[0].text, 'compat')
})

test('兼容与普通游玩均清空独立系统提示，工具过滤不受影响', async () => {
  const run = strategies()
  const compatAssembly = await run.value.assembleSystemPrompt({ sections: [{}], contexts: [{}], tools: [{ name: 'bash' }] }, { sessionId: 'compat', chat: run.chats.get('compat') })
  assert.deepEqual(compatAssembly, { sections: [], contexts: [], tools: [] })

  const nativeAssembly = await run.value.assembleSystemPrompt({ sections: [], contexts: [], tools: [{ name: 'bash' }, { name: 'read' }] }, { sessionId: 'native', chat: run.chats.get('native') })
  assert.deepEqual(nativeAssembly.sections, [])
  assert.deepEqual(nativeAssembly.tools.map(function (tool) { return tool.name }), ['read'])
})

for (const mode of ['story', 'script']) {
  test(`${mode} 不加载 play-mode，也不会回退到 DSH 默认人格`, async () => {
    const strategy = createNativePlayOrchestrationStrategy({
      modeFor: async () => mode,
      visibleTools: async () => [],
      modePrompt() { throw new Error('游玩不应再读取独立人格提示词') },
      controlledToolNames: new Set()
    })
    const assembly = await strategy.assembleSystemPrompt({
      sections: [{ name: 'persona', text: 'You are a helpful software engineer assistant.' }],
      tools: []
    }, { sessionId: 'existing-session' })
    assert.deepEqual(assembly.sections, [])
  })
}

test('游玩请求移除空 system 字段，不修改非空指令或原始请求', async () => {
  const strategy = createNativePlayOrchestrationStrategy({
    stagedRequests: new Map([['native', { turn: 1, step: 1, scope: 'foreground', snapshot: null }]])
  })
  const request = Object.freeze({ sessionId: 'native', system: '', messages: [] })
  const projected = strategy.projectRequest(request)
  assert.ok(projected)
  assert.equal(Object.hasOwn(projected, 'system'), false)
  assert.equal(request.system, '')
  assert.equal(strategy.projectRequest(projected), null, 'redispatch cannot loop')
  assert.equal(strategy.projectRequest({ sessionId: 'native', system: 'explicit instructions', messages: [] }), null)
  assert.equal(strategy.projectRequest({ sessionId: 'native', purpose: 'compaction', system: '', messages: [] }), null)
})

test('卡片策略不把按需 Cordis 说明放入固定前缀', async () => {
  const run = strategies({
    nativePlay: {
      async modeFor() { return 'card' },
      filterMessages(messages) { return messages },
      async resolvePreset() { return null },
      async prepareTurn() { return { text: '' } },
      appendFrame(input) { return { messages: input.messages, receipt: {} } },
      recordFrame() {},
      async visibleTools() { return [] },
      modePrompt() { return 'card' },
      workspaceContext() { return '/resources' },
      async ensureSessionPrefix() {},
      controlledToolNames: new Set()
    }
  })
  const assembly = await run.value.assembleSystemPrompt({
    sections: [{ name: 'tool:cordis', text: 'Cordis instructions' }],
    contexts: [],
    tools: []
  }, { sessionId: 'native', chat: run.chats.get('native'), cwd: '/workspace' })

  assert.deepEqual(assembly.sections.map(function (section) { return section.name }), [
    'tavern:mode-persona',
    'tavern:resource-workspace'
  ])
})

test('卡片回合没有实际资料片段时不追加空快照消息', async () => {
  const original = userMessage('检查当前人物卡')
  const run = strategies({
    nativePlay: {
      async modeFor() { return 'card' },
      filterMessages(messages) { return messages },
      async resolvePreset() { return null },
      async prepareTurn() { return { text: '' } },
      appendFrame(input) { return { messages: input.messages, receipt: {} } },
      recordFrame() {},
      async visibleTools() { return [] },
      modePrompt() { return 'card' },
      workspaceContext() { return '/resources' },
      async ensureSessionPrefix() {},
      controlledToolNames: new Set()
    }
  })

  const prepared = await run.value.prepareStep({
    sessionId: 'native',
    payload: { turn: 1, step: 1, messages: [original] },
    decision: { kind: 'enter', messages: [original] },
    chat: run.chats.get('native')
  })

  assert.deepEqual(prepared.messages, [original])
})
