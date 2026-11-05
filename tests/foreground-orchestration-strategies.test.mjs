import assert from 'node:assert/strict'
import test from 'node:test'

import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { createForegroundOrchestrationStrategies, createNativePlayOrchestrationStrategy } from "../tavern-plugin/lib/domain/foreground-orchestration-strategies.js"
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
  return { value: createForegroundOrchestrationStrategies(options), calls, chats }
}

test('retired conversation mode is rejected before native preparation or system assembly', async () => {
  const run = strategies()
  const input = { chat: run.chats.get('compat'), sessionId: 'compat', payload: { step: 1, turn: 1, messages: [] } }
  await assert.rejects(run.value.prepareStep(input), /silly 模式已停用/)
  await assert.rejects(run.value.assembleSystemPrompt({ sections: [], tools: [] }, input), /silly 模式已停用/)
  assert.deepEqual(run.calls, [])
})

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

test('历史正文走工具调用：开关打开时请求里的旧正文变成提交参数，关掉后原样', async () => {
  const body = { id: 'body-1', role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text: '上一轮正文' }] }
  async function requestWith(historyToolCall, visibleTools = ['submit_story']) {
    const run = strategies({ nativePlay: {
      async modeFor() { return 'story' },
      filterMessages(messages) { return messages },
      async resolvePreset() { return null },
      async prepareTurn() { return { frame: { userInput: { projectedText: '输入' } } } },
      appendFrame(input) { return { messages: input.messages, receipt: {} } },
      recordFrame() {}, async visibleTools() { return visibleTools },
      modePrompt() { return '正文任务' }, controlledToolNames: new Set(),
      ...(historyToolCall === undefined ? {} : { historyToolCall: async () => historyToolCall })
    } })
    const messages = [userMessage('第一次'), body, userMessage('第二次')]
    await run.value.prepareStep({ sessionId: 'native', payload: { turn: 2, step: 1, messages }, decision: { kind: 'enter', messages }, chat: run.chats.get('native') })
    return run.value.projectRequest({ sessionId: 'native', system: 's', messages })
  }

  // Nothing else staged, so an untouched request is handed back to the host as-is.
  const off = await requestWith(undefined)
  assert.equal(off, null, '开关关闭时不改请求')

  // 本轮工具表里没有 submit_story（例如本局把它逐项关了）：不能造出调用未声明工具的假历史。
  assert.equal(await requestWith(true, []), null, '提交工具没下发时不回放')

  const on = await requestWith(true)
  // 玩家消息与模型正文都变成提交调用；本轮输入（最后一条玩家消息）保持原样。
  // 历史以调用开头时先垫一条固定的 user 轮次，严格的 Gemini 渠道才接受（#330）。
  assert.deepEqual(on.messages.map(message => message.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'user'])
  assert.equal(on.messages[0].id, on.messages[1].content[0].id + ':anchor')
  assert.deepEqual(JSON.parse(on.messages[1].content[0].arguments), { content: '第一次' })
  assert.deepEqual(on.messages[3].content.map(block => block.type), ['tool-call'])
  assert.equal(on.messages[3].content[0].name, 'submit_story')
  assert.deepEqual(JSON.parse(on.messages[3].content[0].arguments), { content: '上一轮正文' })
  assert.equal(on.messages[4].toolCallId, on.messages[3].content[0].id, 'DSH 0.2 的回执是对应这次调用的 tool 消息')
  assert.equal(on.messages[5].content[0].text, '第二次', '本轮玩家输入保持原样')
})

test('Anthropic：去掉本轮输入之前各轮回复的签名思考块，本轮工具循环里的保留', async () => {
  const { projectAnthropicPriorThinking } = await import('../tavern-plugin/lib/domain/foreground-orchestration-strategies.js')
  const replay = blocks => ({ response: { kind: 'pi-ai', version: 2, api: 'anthropic-messages', provider: 'opencode', model: 'claude-opus-5-5' }, blocks })
  const model = blocks => ({ kind: 'model', provider: 'opencode', model: 'claude-opus-5-5', replayState: replay(blocks) })
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '第一轮' }], source: { kind: 'user' } },
    { role: 'assistant', content: [{ type: 'reasoning', text: '' }, { type: 'text', text: '第一轮正文' }],
      source: model([{ type: 'reasoning', thinkingSignature: 'sig-1' }, { type: 'text' }]) },
    { role: 'assistant', content: [{ type: 'reasoning', text: '只有思考' }], source: model([{ type: 'reasoning', thinkingSignature: 'sig-2' }]) },
    { role: 'user', content: [{ type: 'text', text: '第二轮' }], source: { kind: 'user' } },
    { role: 'assistant', content: [{ type: 'reasoning', text: '' }, { type: 'tool-call', id: 't1', name: 'x', arguments: '{}' }],
      source: model([{ type: 'reasoning', thinkingSignature: 'sig-3' }, { type: 'tool-call' }]) }
  ]
  const projected = projectAnthropicPriorThinking(messages)
  assert.equal(projected.length, 4, '只有思考的旧回复整条去掉')
  assert.deepEqual(projected[1].content, [{ type: 'text', text: '第一轮正文' }])
  assert.deepEqual(projected[1].source.replayState.blocks, [{ type: 'text' }], '回传记录与内容保持对齐')
  assert.equal(projected[3], messages[4], '本轮工具循环里的思考原样保留')
  // 其他协议不动。
  const deepseek = messages.map(message => message.role === 'assistant'
    ? { ...message, source: { ...message.source, replayState: { ...message.source.replayState, response: { ...message.source.replayState.response, api: 'openai-completions' } } } } : message)
  assert.equal(projectAnthropicPriorThinking(deepseek), deepseek)
})

test('提交提示词按最终工具列表选择，插件工具关闭后仍留在目录里', async () => {
  let visibleNames = ['submit_story']
  let recorded = null
  let outputToolCall = true
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages },
    async resolvePreset() { return null },
    async prepareTurn() { return { text: '' } },
    appendFrame(input) { return { messages: input.messages, receipt: {} } },
    recordFrame() {},
    async visibleTools() { return visibleNames },
    recordTools(_sessionId, tools) { recorded = tools },
    async storyOutputToolCall() { return outputToolCall },
    modePrompt() { return 'story' },
    workspaceContext() { return '' },
    async ensureSessionPrefix() {},
    controlledToolNames: new Set(['submit_story'])
  } })
  const chat = run.chats.get('native')
  const assemble = tools => run.value.assembleSystemPrompt({ sections: [], contexts: [], tools }, { sessionId: 'native', chat })

  const strict = await assemble([{ name: 'submit_story' }])
  assert.deepEqual(strict.tools.map(tool => tool.name), ['submit_story'])
  assert.match(strict.sections.find(section => section.name === 'tavern:story-tool-submission').text, /不要调用任何其他工具/)
  assert.match(strict.sections.find(section => section.name === 'tavern:story-tool-submission').text, /所有面向玩家的输出/)
  assert.match(strict.sections.find(section => section.name === 'tavern:story-tool-submission').text, /写在 content 之外的文字会被丢弃/)

  const normal = await assemble([{ name: 'submit_story' }, { name: 'plugin_tool' }])
  assert.deepEqual(normal.tools.map(tool => tool.name), ['submit_story', 'plugin_tool'])
  assert.deepEqual(recorded.map(tool => tool.name), ['plugin_tool'])
  assert.match(normal.sections.find(section => section.name === 'tavern:story-tool-submission').text, /可以先使用已开放的其他工具/)
  assert.match(normal.sections.find(section => section.name === 'tavern:story-tool-submission').text, /除已开放的其他工具调用外/)
  assert.match(normal.sections.find(section => section.name === 'tavern:story-tool-submission').text, /每轮只调用一次 submit_story/)

  chat.disabledForegroundTools = ['plugin_tool']
  const filtered = await assemble([{ name: 'submit_story' }, { name: 'plugin_tool' }])
  assert.deepEqual(filtered.tools.map(tool => tool.name), ['submit_story'])
  assert.deepEqual(recorded.map(tool => tool.name), ['plugin_tool'], '关闭的工具仍要出现在设置目录里')
  assert.match(filtered.sections.find(section => section.name === 'tavern:story-tool-submission').text, /不要调用任何其他工具/)
  chat.disabledForegroundTools = []

  // 只开输入回放：submit_story 在工具表里，但不能把本轮也要求成工具输出。
  outputToolCall = false
  const inputOnly = await assemble([{ name: 'submit_story' }])
  const inputOnlySection = inputOnly.sections.find(section => section.name === 'tavern:story-tool-submission')
  assert.match(inputOnlySection.text, /历史里的 submit_story 调用只是过去正文的记录/)
  assert.doesNotMatch(inputOnlySection.text, /本轮最终正文必须/)
  outputToolCall = true

  visibleNames = []
  const none = await assemble([])
  assert.deepEqual(none.tools, [])
  assert.ok(none.sections.some(section => section.name === 'tavern:no-foreground-tools'))
})

test('输出走工具调用：请求在当前输入前插一条真实 assistant 收到', async () => {
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages },
    async resolvePreset() { return null },
    async prepareTurn() { return { frame: { userInput: { projectedText: '新输入' } } } },
    appendFrame(input) { return { messages: input.messages, receipt: {} } },
    recordFrame() {},
    async visibleTools() { return ['submit_story'] },
    async storyOutputToolCall() { return true },
    modePrompt() { return '正文任务' },
    controlledToolNames: new Set(['submit_story'])
  } })
  const incoming = [
    userMessage('第一次'),
    { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '上一轮正文' }] },
    userMessage('第二次')
  ]
  const prepared = await run.value.prepareStep({
    sessionId: 'native', payload: { turn: 2, step: 1, messages: incoming },
    decision: { kind: 'enter', messages: incoming }, chat: run.chats.get('native')
  })
  const request = run.value.projectRequest({ sessionId: 'native', system: 's', messages: prepared.messages })
  assert.ok(request, '插入确认后请求必须被投影')
  assert.deepEqual(request.messages.map(message => message.role), ['user', 'assistant', 'assistant', 'user'])
  const ack = request.messages[2]
  assert.equal(ack.source.kind, 'plugin:dsh-tavern')
  assert.equal(ack.source.form, 'submit-ack')
  assert.match(ack.content[0].text, /^收到。/)
  assert.equal(request.messages.at(-1).content[0].text, '新输入', '玩家输入仍在最后')
})


test('style instructions appear only with its offered tool, never inject polish principles', async () => {
  let offered = true
  const strategy = createNativePlayOrchestrationStrategy({ modeFor: async () => 'story',
    visibleTools: async () => offered ? ['style_reference_submit'] : [], resolvePreset: async () => null,
    controlledToolNames: new Set(['style_reference_submit']), styleReferencePrompt: () => '前台选段后继续写正文' })
  const input = { sessionId: 'game', chat: { mode: 'story' }, fixedSystemSections: [{ name: 'card', text: '人物设定' }] }
  const assemble = () => strategy.assembleSystemPrompt({ tools: [{ name: 'style_reference_submit' }], sections: [] }, input)
  const on = await assemble()
  assert.ok(on.sections.some(section => section.name === 'tavern:foreground-style-reference'))
  assert.ok(!on.sections.some(section => /polish|draft/.test(section.name)))
  offered = false
  const off = await assemble()
  assert.ok(!off.sections.some(section => section.name === 'tavern:foreground-style-reference'))
})

test('插件工具声明了解锁 Skill 时，未加载前不进入工作台请求', async () => {
  const unlocked = new Set()
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'card', visibleTools: async () => ['bash'], controlledToolNames: new Set(['bash', 'tavern_save_skill']),
    workspaceContext: () => '', pluginToolModes: name => name === 'stage_play_only' ? ['play'] : null,
    pluginToolsUnlocked: async (sessionId, names) => names.filter(name => name !== 'stage_patch' || unlocked.has(sessionId))
  })
  const tools = () => ['bash', 'tavern_save_skill', 'stage_patch', 'stage_lookup', 'stage_play_only'].map(name => ({ name }))
  const input = { sessionId: 'card', chat: { mode: 'card' }, fixedSystemSections: [] }
  const before = { sections: [], tools: tools() }
  await strategy.assembleSystemPrompt(before, input)
  assert.deepEqual(before.tools.map(tool => tool.name), ['bash', 'stage_lookup'])
  unlocked.add('card')
  const after = { sections: [], tools: tools() }
  await strategy.assembleSystemPrompt(after, input)
  assert.deepEqual(after.tools.map(tool => tool.name), ['bash', 'stage_patch', 'stage_lookup'])
})

test('宿主 system-prompt/assemble waterfall 中 assembly.tools 为 undefined 时不崩溃', async () => {
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'story',
    visibleTools: async () => [],
    resolvePreset: async () => null,
    controlledToolNames: new Set()
  })
  const input = { sessionId: 'game', chat: { mode: 'story' }, fixedSystemSections: [] }
  // DSH host waterfall passes assembly with sections, contexts, variables, but NO tools property
  const assembly = { sections: [], contexts: [], variables: {} }
  const result = await strategy.assembleSystemPrompt(assembly, input)
  assert.ok(result)
  assert.ok(Array.isArray(result.sections))
  assert.ok(!result.sections.some(section => section.name === 'tavern:no-foreground-tools'), 'missing metadata is not an empty tool set')
})

test('宿主 tools 不在 assembly 中时，输出契约使用实际 toolSet 定义', async () => {
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'story', visibleTools: async () => ['submit_story'],
    storyOutputToolCall: async () => true, resolvePreset: async () => null,
    controlledToolNames: new Set(['submit_story'])
  })
  const assembly = { sections: [], contexts: [], variables: {} }
  const result = await strategy.assembleSystemPrompt(assembly, {
    sessionId: 'game', chat: { mode: 'story' }, fixedSystemSections: [],
    toolDefinitions: [{ name: 'submit_story' }]
  })
  assert.ok(result.sections.some(section => section.name === 'tavern:story-tool-submission'))
  assert.ok(!result.sections.some(section => section.name === 'tavern:no-foreground-tools'))
  assert.equal(Object.hasOwn(result, 'tools'), false, 'host owns tools outside the assembly')
  const actual = await strategy.assembleSystemPrompt({ sections: [] }, {
    sessionId: 'game', chat: { mode: 'story', disabledForegroundTools: ['plugin_tool'] },
    toolDefinitions: [{ name: 'submit_story' }, { name: 'plugin_tool' }]
  })
  assert.match(actual.sections.find(section => section.name === 'tavern:story-tool-submission').text, /可以先使用已开放的其他工具/,
    'a host-owned list must not be described as filtered by a waterfall mutation')
})
