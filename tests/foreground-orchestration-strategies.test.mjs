import assert from 'node:assert/strict'
import test from 'node:test'

import { Session } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { dshFileToolNames } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createForegroundOrchestrationStrategies, createNativePlayOrchestrationStrategy } from "../tavern-plugin/lib/domain/foreground-orchestration-strategies.js"
import { ensureSessionStablePrefix, sessionStablePrefixSections } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { pureWritingSystem } from '../tavern-plugin/lib/domain/pure-writing-request.js'
import { createSkillGatedTools } from '../tavern-plugin/lib/domain/skill-gated-tools.js'
import { foregroundStyleReferenceEnabled, foregroundStyleReferencePrompt, foregroundStyleReferenceTurnSection } from '../tavern-plugin/lib/domain/style-reference.js'
import { STYLE_REFERENCE_TOOL_NAME } from '../tavern-plugin/lib/domain/style-reference-protocol.cjs'

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
        calls.push(['native.prepare', input.userText, input.requestId, input.userContent])
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

test('关闭文风联想后，发送与重复重写都清理历史提示和工具记录', async () => {
  const style = { name: STYLE_REFERENCE_TOOL_NAME }
  const other = { name: 'tavern_read_variables' }
  const chat = { mode: 'story', backgroundTasks: { styleReference: true } }
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'story', filterMessages: messages => messages, resolvePreset: async () => null,
    visibleTools: async () => [other.name, ...(foregroundStyleReferenceEnabled(chat) ? [style.name] : [])],
    controlledToolNames: new Set([style.name, other.name]),
    styleReferencePrompt: value => foregroundStyleReferencePrompt(value, '选择范文', '借鉴笔调'),
    prepareTurn: async ({ userText }) => ({ frame: { userInput: { projectedText: userText } } }),
    appendFrame: ({ messages }) => ({ messages, receipt: {} }), recordFrame() {}
  })
  const reminder = foregroundStyleReferenceTurnSection(chat).text
  const call = (id, name) => ({ type: 'tool-call', id, name, arguments: '{}' })
  const result = (toolCallId, text) => ({ role: 'tool', toolCallId, content: [{ type: 'text', text }] })
  const priorInput = userMessage('上一轮玩家输入')
  const history = [
    priorInput,
    { ...pluginMessage('user', '保留设定\n\n' + reminder, 'dsh-tavern', 'foreground-frame'), id: 'frame',
      source: { kind: 'plugin:dsh-tavern', form: 'foreground-frame', sections: [
        { text: '保留设定', source: { stage: 'context-plan', sectionKind: 'card' } },
        { text: reminder, source: { stage: 'plugin', plugin: 'dsh-tavern', name: 'style-reference' } }
      ] } },
    { role: 'assistant', id: 'mixed', content: [
      { type: 'reasoning', text: '先用文风工具找范文' },
      call('style', style.name), call('other', other.name)
    ], source: { kind: 'model', replayState: { blocks: [{ type: 'reasoning' }, { type: 'tool-call' }, { type: 'tool-call' }] } } },
    result('style', '旧范文正文'), result('other', '变量结果'),
    { role: 'assistant', content: [
      { type: 'reasoning', text: '读过 <foreground_style_reference> 的要求' },
      { type: 'text', text: '<style_reference_submit">门开了。' }
    ] }
  ]
  const saved = structuredClone(history)
  const current = userMessage('继续')
  const oldSystem = foregroundStyleReferencePrompt(chat, '选择范文', '借鉴笔调')
  const assembly = () => strategy.assembleSystemPrompt({ tools: [style, other] }, { chat, sessionId: 'game' })
  async function prepare(turn, incoming) {
    const assembled = await assembly()
    const step = await strategy.prepareStep({ sessionId: 'game', chat, payload: { turn, step: 1, messages: [incoming] }, decision: { messages: [incoming] } })
    return { assembled, step }
  }
  const { assembled, step } = await prepare(2, current)
  assert.deepEqual(assembled.tools, [style, other])
  assert.ok(assembled.sections.some(section => section.text === oldSystem))
  assert.equal(step.startsRequestSeries, true)

  const oldRequest = {
    sessionId: 'game', messages: history, system: oldSystem + '\n\n人物卡',
    tools: [style, other], toolHistory: { tools: [style, other], updates: [] }
  }
  assert.equal(strategy.projectRequest(oldRequest), null, '开启时允许回放文风工具')
  for (const turn of [3, 4, 5, 6]) {
    // Either of the two controls can remove the tool.
    chat.backgroundTasks.styleReference = turn === 3
    chat.disabledForegroundTools = turn === 3 ? [style.name] : []
    const reroll = turn > 3
    const incoming = reroll ? pluginMessage('user', '改写这一轮', 'dsh-tavern-regen') : current
    const off = await prepare(turn, incoming)
    assert.deepEqual(off.assembled.tools, [other])
    assert.equal(off.assembled.sections.some(section => section.name === 'tavern:foreground-style-reference'), false)
    assert.equal(foregroundStyleReferenceTurnSection(chat), null)
    assert.equal(off.step.startsRequestSeries, turn === 3 ? true : undefined)
    const messages = [...history, current]
    if (reroll) {
      messages.push({ role: 'assistant', content: [{ type: 'text', text: '上一次尝试' }] }, ...off.step.messages,
        { ...pluginMessage('user', reminder, 'dsh-tavern', 'foreground-frame'), id: 'cached-frame' })
    }
    const projected = strategy.projectRequest({ ...oldRequest, messages })
    const wire = JSON.stringify(projected)
    assert.doesNotMatch(wire, /style_reference|旧范文|先用文风工具|上一次尝试/)
    assert.match(wire, /保留设定/)
    assert.match(wire, /门开了/)
    assert.ok(projected.messages.includes(history[4]), '同一批工具调用的其他结果原样保留')
    assert.deepEqual(projected.messages.find(message => message.id === 'mixed').content, [call('other', other.name)])
    assert.ok(!projected.messages.some(message => message.id === 'cached-frame'))
    assert.deepEqual(projected.tools, [other])
    assert.ok(!projected.toolHistory)
  }
  assert.deepEqual(history, saved)
})

test('游玩固定背景来自原生系统装配，预设前后段保持顺序，快照不重复发送', async () => {
  const session = Session.create('native')
  const savedPrefixes = new Map()
  const storage = { async read(id) { return savedPrefixes.get(id) }, async write(id, value) { savedPrefixes.set(id, value) } }
  let cardText = '人物卡固定基本信息\n常驻世界书'
  await ensureSessionStablePrefix(session, cardText, storage)
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
    assert.deepEqual(request.messages.map(message => message.role), ['user'])
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
    const fileTools = dshFileToolNames
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

  assert.deepEqual(await assembledToolNames('card'), ['read', 'write', 'edit', 'read_image', 'apply_patch'])
  assert.deepEqual(await assembledToolNames('story'), ['tavern_recall_history'])
})

test('工作台诊断工具在无 Skill 记录时可用，关联游玩记录后提示先读概览', async () => {
  const names = ['tavern_read_play_chat', 'tavern_read_runtime_health', 'tavern_save_skill']
  const visible = createSkillGatedTools()
  let mode = 'card'
  const run = createNativePlayOrchestrationStrategy({
    modeFor: async () => mode,
    resolvePreset: async () => null,
    workspaceContext: () => '',
    controlledToolNames: new Set(names),
    visibleTools: async () => mode === 'card' ? visible(names, { id: 'new-session', events: [] }) : []
  })
  const assemble = mountedResources => run.assembleSystemPrompt(
    { sections: [], tools: names.map(name => ({ name })) },
    { sessionId: 'new-session', chat: { mode, workspace: { mountedResources } } }
  )
  const empty = await assemble([])
  assert.deepEqual(empty.tools.map(tool => tool.name), names.slice(0, 2))
  assert.ok(!empty.sections.some(section => section.name === 'tavern:play-chat-diagnostics'))
  const linked = await assemble([{ kind: 'play-chat' }])
  assert.match(linked.sections.find(section => section.name === 'tavern:play-chat-diagnostics').text, /tavern_read_play_chat.*overview/)
  mode = 'story'
  assert.deepEqual((await assemble([{ kind: 'play-chat' }])).tools, [])
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
  const blankSystem = { role: 'system', content: [{ type: 'text', text: ' ' }] }
  const projected = strategy.projectRequest({ sessionId: 'native', messages: [blankSystem, ...result.messages] })
  assert.deepEqual(projected.messages, result.messages)
  assert.deepEqual(messages, original)
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

test('工具提交正文时，相邻轮次只在上一轮请求末尾追加新消息', async () => {
  const run = strategies({ nativePlay: {
    async modeFor() { return 'story' },
    filterMessages(messages) { return messages },
    async resolvePreset() { return null },
    async prepareTurn({ userText }) { return { frame: { userInput: { projectedText: userText } } } },
    appendFrame({ messages }) { return { messages, receipt: {} } },
    recordFrame() {},
    async visibleTools() { return ['submit_story'] },
    async storyOutputToolCall() { return true }
  } })
  const chat = run.chats.get('native')
  const tools = [{ name: 'submit_story' }]
  const request = async (turn, messages) => {
    await run.value.prepareStep({ sessionId: 'native', chat, payload: { turn, step: 1, messages }, decision: { messages } })
    return run.value.projectRequest({ sessionId: 'native', provider: 'zen', model: 'gemini-4-carbon', system: '提交正文', tools, messages })
  }
  const firstMessages = [userMessage('开场'), userMessage('走过石桥')]
  const first = await request(2, firstMessages)
  const story = { role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'text', text: '你走到了桥头。' }] }
  const next = await request(3, [...firstMessages, story, userMessage('举起灯')])

  assert.equal(first.toolChoice, 'any')
  assert.equal(next.toolChoice, 'any')
  assert.deepEqual(next.messages.slice(0, first.messages.length), first.messages)
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
  assert.match(strict.sections.find(section => section.name === 'tavern:story-tool-submission').text, /本轮只开放这一个工具/)
  assert.match(strict.sections.find(section => section.name === 'tavern:story-tool-submission').text, /写给玩家的全部内容/)
  assert.match(strict.sections.find(section => section.name === 'tavern:story-tool-submission').text, /content 之外的文字会被丢弃/)

  const normal = await assemble([{ name: 'submit_story' }, { name: 'plugin_tool' }])
  assert.deepEqual(normal.tools.map(tool => tool.name), ['submit_story', 'plugin_tool'])
  assert.deepEqual(recorded.map(tool => tool.name), ['plugin_tool'])
  assert.match(normal.sections.find(section => section.name === 'tavern:story-tool-submission').text, /可以先调用已开放的其他工具/)
  assert.match(normal.sections.find(section => section.name === 'tavern:story-tool-submission').text, /最后再调用 submit_story/)
  assert.match(normal.sections.find(section => section.name === 'tavern:story-tool-submission').text, /每轮只提交一次/)

  chat.disabledForegroundTools = ['plugin_tool']
  const filtered = await assemble([{ name: 'submit_story' }, { name: 'plugin_tool' }])
  assert.deepEqual(filtered.tools.map(tool => tool.name), ['submit_story'])
  assert.deepEqual(recorded.map(tool => tool.name), ['plugin_tool'], '关闭的工具仍要出现在设置目录里')
  assert.match(filtered.sections.find(section => section.name === 'tavern:story-tool-submission').text, /本轮只开放这一个工具/)
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

test('后台请求投影保留前段与后段预设，不因前台优化而丢弃 front', async () => {
  const { createForegroundOrchestrationStrategies } = await import('../tavern-plugin/lib/domain/foreground-orchestration-strategies.js')
  const stagedRequests = new Map([[
    'bg-session',
    {
      turn: 1,
      step: 1,
      scope: 'background',
      snapshot: {
        front: { entries: [{ role: 'system', content: '预设前段内容' }] },
        middle: { entries: [{ role: 'system', content: '预设中段内容' }] },
        back: { entries: [{ role: 'user', content: '预设后段内容' }] }
      }
    }
  ]])
  const s = createForegroundOrchestrationStrategies({
    modeFor: async () => 'story',
    nativePlay: {
      stagedRequests,
      async modeFor() { return 'story' },
      filterMessages: m => m,
      async resolvePreset() { return null },
      async prepareTurn() { return { text: '' } },
      appendFrame: i => ({ messages: i.messages, receipt: {} }),
      recordFrame() {},
      async visibleTools() { return [] },
      modePrompt: () => ''
    }
  })
  const projected = s.projectRequest({
    sessionId: 'bg-session',
    system: '后台系统提示',
    messages: [{ role: 'user', content: [{ type: 'text', text: '后台任务正文' }], source: { kind: 'plugin:dsh-tavern' } }]
  })
  assert.ok(projected)
  assert.equal(projected.system, undefined)
  assert.equal(projected.messages[0].role, 'system')
  assert.match(projected.messages[0].content[0].text, /预设前段内容[\s\S]*后台系统提示/)
  assert.match(projected.messages.at(-1).content[0].text, /后台任务正文[\s\S]*预设后段内容/)
})

test('ensureSessionStablePrefix：revision 递增但前缀正文未变化时不追加重复消息，避免破坏 Prompt Cache', async () => {
  const session = Session.create('stable-prefix-dedup')
  const first = await ensureSessionStablePrefix(session, '固定世界观背景', null, 0)
  const countAfterFirst = sessionEvents(session).filter(e => e.type === 'user/message' && String(e.data?.id || '').startsWith('tavern-session-prefix:')).length
  assert.equal(countAfterFirst, 1)

  // revision 递增但文本完全一致：应直接复用已有记录，不往轨迹追加新事件
  const same = await ensureSessionStablePrefix(session, '  固定世界观背景  ', null, 1)
  assert.equal(same.event, first.event)
  const countAfterSame = sessionEvents(session).filter(e => e.type === 'user/message' && String(e.data?.id || '').startsWith('tavern-session-prefix:')).length
  assert.equal(countAfterSame, 1)

  // 文本确实变化时才追加新 revision
  const updated = await ensureSessionStablePrefix(session, '固定世界观背景（新增设定）', null, 2)
  assert.notEqual(updated.event, first.event)
  assert.equal(updated.revision, 2)
  const countAfterUpdate = sessionEvents(session).filter(e => e.type === 'user/message' && String(e.data?.id || '').startsWith('tavern-session-prefix:')).length
  assert.equal(countAfterUpdate, 2)
})




test('pure writing protects saved worldbook macros from host interpolation and includes the resolved constants', async () => {
  const strategy = createNativePlayOrchestrationStrategy({})
  const macro = '当前状态：{{get_message_variable::stat_data.game._context}}'
  const assembly = await strategy.assembleSystemPrompt({ sections: [] }, { pureWriter: true,
    fixedSystemSections: [{ name: 'tavern:constant-worldbook', text: macro }] })
  assert.deepEqual(assembly.sections, [{ name: 'tavern:constant-worldbook', text: macro, interpolate: false }])

  const frame = { contributions: [], source: {
    worldBook: { messageVariableConstantRefs: ['current-state'] },
    regenerationMaterials: { worldbookEntries: [
      { ref: 'current-state', text: '当前状态：港口已开放' }, { ref: 'optional', text: '支线资料' }
    ] }
  } }
  assert.equal(pureWritingSystem([], frame), '<lorebook_constant>\n当前状态：港口已开放\n</lorebook_constant>')
})
