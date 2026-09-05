import assert from 'node:assert/strict'
import test from 'node:test'

import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createForegroundOrchestrationStrategies, createNativePlayOrchestrationStrategy, createCompatibilityOrchestrationStrategy, projectRegenerationRequestMessages } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { ensureSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'

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

test('正式编排拒绝旧兼容对话的生成与系统提示组装，不写入、不调用模型也不静默迁移', async () => {
  const run = strategies()
  const chat = run.chats.get('compat')
  const before = structuredClone(chat)
  for (const step of [1, 2]) {
    await assert.rejects(run.value.prepareStep({ chat, sessionId: 'compat', payload: { turn: 3, step, messages: [userMessage('继续')] } }), /兼容模式已停用/)
  }
  await assert.rejects(run.value.assembleSystemPrompt({ sections: [], tools: [] }, { chat, sessionId: 'compat' }), /兼容模式已停用/)
  assert.deepEqual(run.calls, [])
  assert.deepEqual(chat, before)
  assert.equal(run.value.projectRequest({ sessionId: 'compat', messages: [] }), null)
})

test('前台固定背景来自标准 Session 消息，不进入当轮 system、Frame 或预设投影', async () => {
  const session = Session.create('native')
  const savedPrefixes = new Map()
  const storage = { async read(id) { return savedPrefixes.get(id) }, async write(id, value) { savedPrefixes.set(id, value) } }
  let cardText = '人物卡固定基本信息\n常驻世界书'
  await ensureSessionStablePrefix(session, cardText, storage)
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages },
    async resolvePreset() { return { front: { text: '预设前置指令' } } },
    async ensureSessionPrefix() { return await ensureSessionStablePrefix(session, cardText, storage) },
    async prepareTurn() { return { frame: { userInput: { projectedText: '本轮玩家输入' } } } },
    appendFrame(input) { return { messages: input.messages.concat(userMessage('本轮动态指令')), receipt: {} } },
    recordFrame() {}, async visibleTools() { return [] },
    modePrompt() { return '正文任务' }, controlledToolNames: new Set()
  } })
  for (const turn of [2, 3]) {
    const incoming = [userMessage('新输入')]
    const prepared = await run.value.prepareStep({ sessionId: 'native', payload: { turn, step: 1, messages: incoming }, decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native') })
    const assembly = await run.value.assembleSystemPrompt({ sections: [], tools: [] }, { sessionId: 'native', chat: run.chats.get('native') })
    const system = assembly.sections.map(section => section.text).join('\n')
    assert.doesNotMatch(system, /人物卡固定基本信息|常驻世界书/)
    assert.deepEqual(prepared.messages.map(message => message.content[0].text), ['本轮玩家输入', '本轮动态指令'])
    assert.equal(prepared.messages.some(message => message.id === 'tavern-session-prefix:native'), false)
    const modelMessages = session.deriveMessages().concat(prepared.messages)
    assert.equal(modelMessages.filter(message => message.id === 'tavern-session-prefix:native').length, 1)
    assert.equal(modelMessages[0].source.form, 'snapshot')
    const request = run.value.projectRequest({ sessionId: 'native', system, messages: modelMessages })
    assert.equal(request.messages[0], modelMessages[0])
    assert.equal(run.value.projectRequest(request), null)
    cardText = '后续轮次不重新覆盖最初背景'
  }
  assert.equal(sessionEvents(session).filter(event => event.type === 'user/message' && event.data.id === 'tavern-session-prefix:native').length, 1)
  assert.equal(savedPrefixes.size, 0)
})

test('旧会话在 pre-step 提升外部背景后，不把已记录消息再次作为本轮输入提交', async () => {
  const session = Session.create('legacy-native')
  const fixed = await ensureSessionStablePrefix(session, '人物卡旧背景\n常驻世界书')
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages }, async resolvePreset() { return null },
    async ensureSessionPrefix() { return fixed },
    async prepareTurn() { return { frame: { userInput: { projectedText: '继续' } } } },
    appendFrame(input) { return { messages: input.messages.concat(userMessage('本轮 Frame')), receipt: {} } },
    recordFrame() {}, async visibleTools() { return [] }, modePrompt() { return '' }, controlledToolNames: new Set()
  } })
  const input = [userMessage('旧历史'), userMessage('继续')]
  const prepared = await run.value.prepareStep({
    sessionId: 'native', payload: { turn: 2, step: 1, messages: input },
    decision: { kind: 'enter', messages: input }, chat: run.chats.get('native')
  })

  assert.deepEqual(prepared.messages.map(message => message.content[0].text), ['旧历史', '继续', '本轮 Frame'])
  assert.equal(prepared.messages.some(message => message.id === fixed.id), false)
  assert.equal(session.deriveMessages().filter(message => message.id === fixed.id).length, 1)
})

test('旧原生 Session 的稳定前缀含 EJS 时仅在请求投影中换成新静态快照', async () => {
  const oldPrefix = {
    id: 'tavern-session-prefix:native', role: 'user',
    content: [{ type: 'text', text: '人物卡\n@@preprocessing\n<% print(await getwi("资料")) %>' }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'snapshot' }
  }
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages }, async resolvePreset() { return null },
    async ensureSessionPrefix() { return { projectedText: '人物卡\n真正静态的常驻规则' } },
    async prepareTurn() { return { frame: { userInput: { projectedText: '继续' } } } },
    appendFrame(input) { return { messages: input.messages, receipt: {} } },
    recordFrame() {}, async visibleTools() { return [] }, modePrompt() { return '' }, controlledToolNames: new Set()
  } })
  const incoming = [userMessage('继续')]
  await run.value.prepareStep({
    sessionId: 'native', payload: { turn: 2, step: 1, messages: incoming },
    decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native')
  })
  const original = Object.freeze({ sessionId: 'native', messages: Object.freeze([oldPrefix]) })

  const projected = run.value.projectRequest(original)

  assert.equal(projected.messages[0].content[0].text, '人物卡\n真正静态的常驻规则')
  assert.doesNotMatch(projected.messages[0].content[0].text, /<%|getwi|@@preprocessing/)
  assert.match(original.messages[0].content[0].text, /getwi/)
})

test('普通游玩正常运行，保留的兼容实现仅供独立测试', async () => {
  const run = strategies()
  const nativePayload = { turn: 2, step: 1, messages: [userMessage('继续')] }
  const native = await run.value.prepareStep({ sessionId: 'native', payload: nativePayload, decision: { kind: 'enter', messages: nativePayload.messages }, chat: run.chats.get('native'), requestId: 'rpc-native' })
  assert.deepEqual(native.messages.map(function (message) { return message.content[0].text }), ['projected', 'frame'])

  const compatPayload = { turn: 3, step: 1, messages: [userMessage('向前走')] }
  const compat = await run.compatibility.prepareStep({ sessionId: 'compat', payload: compatPayload, decision: { kind: 'enter', messages: compatPayload.messages }, chat: run.chats.get('compat'), requestId: 'rpc-compat' })
  assert.equal(compat.messages, compatPayload.messages)
  assert.deepEqual(run.calls, [
    ['native.sync', 'native'],
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
  await run.compatibility.prepareStep({ sessionId: 'compat', payload: compatPayload, decision: { kind: 'enter', messages: compatPayload.messages }, chat: run.chats.get('compat') })
  const compatOptions = Object.freeze({ sessionId: 'compat', messages: Object.freeze([]) })
  const compatProjected = run.compatibility.projectRequest(compatOptions, { turn: 3, step: 1 })
  assert.notEqual(compatProjected, compatOptions)
  assert.equal(compatProjected.messages[0].content[0].text, 'compat')
})

test('DeepSeek thinking 续传为旧 Session 的 reasoning 补齐可回放元数据', async () => {
  const run = strategies()
  const incoming = [userMessage('继续')]
  await run.value.prepareStep({
    sessionId: 'native', payload: { turn: 8, step: 1, messages: incoming },
    decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native')
  })
  const legacyAssistant = {
    role: 'assistant',
    content: [{ type: 'reasoning', text: '旧思考' }, { type: 'text', text: '旧正文' }],
    source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  }
  const oldPresetBoundary = {
    role: 'system', content: [{ type: 'text', text: '旧预设边界' }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', sections: [{ name: 'tavern:runtime-preset-front', text: '旧预设边界' }] }
  }
  const original = Object.freeze({
    sessionId: 'native', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high',
    messages: Object.freeze([oldPresetBoundary, legacyAssistant, userMessage('下一轮')])
  })

  const projected = run.value.projectRequest(original)
  const replay = projected.messages[0].source.replayState

  assert.equal(replay.response.kind, 'pi-ai')
  assert.equal(replay.response.provider, 'deepseek-official')
  assert.equal(replay.response.model, 'deepseek-v4-flash')
  assert.deepEqual(replay.blocks, [
    { type: 'reasoning', thinkingSignature: 'reasoning_content' },
    { type: 'text' }
  ])
  assert.equal(original.messages[0].source.replayState, undefined)
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

test('DeepSeek thinking 请求为没有原始思考的合成 assistant 上下文补齐 reasoning_content 载体', async () => {
  const run = strategies()
  const incoming = [userMessage('继续')]
  await run.value.prepareStep({
    sessionId: 'native', payload: { turn: 2, step: 1, messages: incoming },
    decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native')
  })
  const preset = pluginMessage('assistant', '预置助手示例', 'dsh-tavern', 'snapshot')
  const opening = {
    id: 'tavern-opening:current', role: 'assistant', content: [{ type: 'text', text: '开场白' }],
    source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' }
  }
  const original = {
    sessionId: 'native', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high',
    messages: [{
      role: 'system', content: [{ type: 'text', text: '旧预设边界' }],
      source: { kind: 'plugin', plugin: 'dsh-tavern', sections: [{ name: 'tavern:runtime-preset-front', text: '旧预设边界' }] }
    }, preset, opening, userMessage('下一轮')]
  }

  const projected = run.value.projectRequest(original)
  const assistants = projected.messages.filter(message => message.role === 'assistant')

  // Runtime preset projection replaces stale preset-boundary messages. The
  // surviving opening is enough to prove the final DeepSeek serialization
  // boundary repairs every assistant message that will actually be sent.
  assert.equal(assistants.length >= 1, true)
  for (const message of assistants) {
    assert.equal(message.content.some(block => block.type === 'reasoning' && block.text.length > 0), true)
  }
  assert.equal(preset.content.some(block => block.type === 'reasoning'), false)
  assert.equal(opening.content.some(block => block.type === 'reasoning'), false)
})

test('正文重生成在请求边界回到原玩家输入，不泄露旧回答或重生成元信息', () => {
  const originalPlayer = { id: 'player-2', ...userMessage('推门') }
  const messages = [
    pluginMessage('user', '人物卡', 'dsh-tavern', 'snapshot'),
    { role: 'assistant', content: [{ type: 'text', text: '开场' }], source: { kind: 'model' } },
    originalPlayer,
    pluginMessage('user', '旧本轮规则', 'dsh-tavern', 'foreground-frame'),
    { role: 'assistant', content: [{ type: 'reasoning', text: '旧思考' }, { type: 'text', text: '旧正文' }], source: { kind: 'model' } },
    pluginMessage('user', '推门', 'dsh-tavern-regen'),
    pluginMessage('user', '新本轮规则', 'dsh-tavern', 'foreground-frame')
  ]

  const projected = projectRegenerationRequestMessages(messages)

  assert.deepEqual(projected.map(message => message.role), ['user', 'assistant', 'user', 'user'])
  assert.equal(projected[2].id, 'player-2')
  assert.equal(projected[2].source.kind, 'user')
  assert.equal(projected[2].content[0].text, '推门')
  assert.equal(projected[3].content[0].text, '新本轮规则')
  assert.doesNotMatch(JSON.stringify(projected), /旧思考|旧正文|旧本轮规则|重新生成|dsh-tavern-regen/)
  assert.equal(messages.length, 7, '不改写 DSH 原请求')
})

test('带意见重生成只投影为本轮补充要求', () => {
  const messages = [
    userMessage('推门'),
    pluginMessage('user', '旧本轮规则', 'dsh-tavern', 'foreground-frame'),
    { role: 'assistant', content: [{ type: 'text', text: '旧正文' }], source: { kind: 'model' } },
    pluginMessage('user', '推门\n\n【本轮补充要求】\n写得短一些', 'dsh-tavern-regen'),
    pluginMessage('user', '新本轮规则', 'dsh-tavern', 'foreground-frame')
  ]

  const projected = projectRegenerationRequestMessages(messages)

  assert.equal(projected[0].content[0].text, '推门\n\n【本轮补充要求】\n写得短一些')
  assert.doesNotMatch(JSON.stringify(projected), /旧正文|重新生成|dsh-tavern-regen/)
})

test('兼容与普通游玩均清空独立系统提示，工具过滤不受影响', async () => {
  const run = strategies()
  const compatAssembly = await run.compatibility.assembleSystemPrompt({ sections: [{}], contexts: [{}], tools: [{ name: 'bash' }] }, { sessionId: 'compat', chat: run.chats.get('compat') })
  assert.deepEqual(compatAssembly, { sections: [], contexts: [], tools: [] })

  const nativeAssembly = await run.value.assembleSystemPrompt({ sections: [], contexts: [], tools: [{ name: 'bash' }, { name: 'read' }] }, { sessionId: 'native', chat: run.chats.get('native') })
  assert.deepEqual(nativeAssembly.sections, [])
  assert.deepEqual(nativeAssembly.tools.map(function (tool) { return tool.name }), ['read'])
})

test('兼容前台仅在游戏快照开启时保留联网搜索工具', async () => {
  const run = strategies()
  const chat = run.chats.get('compat')
  const tools = [{ name: 'bash' }, { name: 'web_search' }]
  const disabled = await run.compatibility.assembleSystemPrompt({ sections: [{ name: 'old' }], contexts: [{}], tools: tools.slice() }, { sessionId: 'compat', chat })
  assert.deepEqual(disabled.tools, [])

  chat.webSearchEnabled = true
  const enabled = await run.compatibility.assembleSystemPrompt({ sections: [{ name: 'old' }], contexts: [{}], tools: tools.slice() }, { sessionId: 'compat', chat })
  assert.deepEqual(enabled.tools.map(function (tool) { return tool.name }), ['web_search'])
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

test('卡片策略保留 Shell 与未知的通用基础工具，不要求先走 Tavern 专用工具', async () => {
  const run = strategies({
    nativePlay: {
      async modeFor() { return 'card' },
      filterMessages(messages) { return messages },
      async resolvePreset() { return null },
      async prepareTurn() { return { text: '' } },
      appendFrame(input) { return { messages: input.messages, receipt: {} } },
      recordFrame() {},
      async visibleTools() { return ['bash', 'tavern_read_card'] },
      modePrompt() { return 'card' },
      workspaceContext() { return '/resources' },
      async ensureSessionPrefix() {},
      controlledToolNames: new Set(['bash', 'tavern_read_card', 'tavern_update_card'])
    }
  })
  const assembly = await run.value.assembleSystemPrompt({
    sections: [],
    contexts: [],
    tools: [
      { name: 'bash' },
      { name: 'read_file' },
      { name: 'write_file' },
      { name: 'tavern_read_card' },
      { name: 'tavern_update_card' }
    ]
  }, { sessionId: 'native', chat: run.chats.get('native'), cwd: '/workspace' })

  assert.deepEqual(assembly.tools.map(function (tool) { return tool.name }), [
    'bash', 'read_file', 'write_file', 'tavern_read_card'
  ])
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
