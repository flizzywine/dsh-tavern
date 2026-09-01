import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackgroundAgentRunner, executeBackgroundCompaction, maximumBackgroundTokens } from '../tavern-plugin/lib/background-agent-runner.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { readSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

test('共享后台 Session 从建立起固定注册完整工具目录，切换任务只改变本轮授权', async () => {
  const catalog = [
    { name: 'posture_submit', parameters: { type: 'object' } },
    { name: 'candidate_submit_choices', parameters: { type: 'object' } }
  ]
  const registered = new Map()
  const callbacks = []
  const responses = []
  let creates = 0
  let turn = 0
  let accepted = 0
  let concluded = 0
  const execution = { concludeTurn() { concluded++ } }
  const runner = createBackgroundAgentRunner({
    id: () => 'background-stable-tools',
    backgroundTools: catalog,
    agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        creates++
        await options.setup({
          systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {},
          tools: { restrict() {}, register(tool) { registered.set(tool.name, tool) } }
        })
        return { agent: {
          session: { id: 'background-stable-tools', events: [], append() {} },
          followup() { turn++ },
          async whenIdle() {
            if (turn === 1) {
              responses.push(JSON.parse(await registered.get('candidate_submit_choices').execute({}, execution)))
              responses.push(JSON.parse(await registered.get('posture_submit').execute({ posture: '门边站立' }, execution)))
            } else {
              responses.push(JSON.parse(await registered.get('posture_submit').execute({}, execution)))
              responses.push(JSON.parse(await registered.get('candidate_submit_choices').execute({ actions: ['一'], scene: '' }, execution)))
            }
          }
        }, async dispose() {} }
      }
    }
  })
  await runner.run({ sessionId: 'parent', persistent: true, task: 'settlement', selection: { provider: 'test', model: 'test' }, messages: [],
    tools: [catalog[0]], acceptWithoutText: () => true, stopToolsWhen: () => accepted > 0,
    async onToolCall(call) { callbacks.push(call.name); accepted++; return JSON.stringify({ ok: true }) } })
  accepted = 0
  await runner.run({ sessionId: 'parent', persistent: true, task: 'candidate', selection: { provider: 'test', model: 'test' }, messages: [],
    tools: [catalog[1]], acceptWithoutText: () => true, stopToolsWhen: () => accepted > 0,
    async onToolCall(call) { callbacks.push(call.name); accepted++; return JSON.stringify({ ok: true }) } })

  assert.equal(creates, 1)
  assert.deepEqual(Array.from(registered.keys()), ['posture_submit', 'candidate_submit_choices'])
  assert.deepEqual(callbacks, ['posture_submit', 'candidate_submit_choices'])
  assert.equal(responses[0].retryable, true)
  assert.equal(responses[2].retryable, true)
  assert.equal(concluded, 2, '每个成功终态工具只结束一次回合，错误工具不能结束回合')
  await runner.dispose()
})

test('变量工具返回失败后仍可修正，成功或耗尽次数后撤下工具且只清理一次', async () => {
  for (const success of [true, false]) {
    let registered, disposed = 0, calls = 0, terminal = false
    const events = [], replies = []
    const runner = createBackgroundAgentRunner({ id: () => 'background-retry', agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        await options.setup({
          systemPrompt: { variable() {}, section() {}, suppressRuntimeContext() {} }, on() {},
          tools: { restrict() {}, register(tool) { registered = tool; return () => { disposed++ } } }
        })
        return { agent: { session: { id: 'background-retry', events, append() {} }, followup() {}, async whenIdle() {
          replies.push(await registered.execute({}))
          assert.equal(disposed, 0)
          replies.push(await registered.execute({}))
          if (!success) { assert.equal(disposed, 0); replies.push(await registered.execute({})) }
          assert.equal(disposed, 1)
          events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '{}' }] } } })
        } }, async dispose() {} }
      }
    } })
    await runner.run({ sessionId: 'parent', selection: { provider: 'test', model: 'test' }, task: 'settlement',
      messages: [], tools: [{ name: 'mvu_submit_update', parameters: { type: 'object' } }], maxToolCalls: 3,
      stopToolsWhen: () => terminal,
      async onToolCall() { calls++; terminal = success && calls === 2; return JSON.stringify({ ok: terminal, retryable: !terminal && calls < 3 }) }
    })
    assert.equal(calls, success ? 2 : 3)
    assert.equal(JSON.parse(replies[0]).retryable, true)
    assert.equal(disposed, 1)
  }
})

test('后台固定背景只保存一次，连续候选、结算和恢复均从 Session 开头复用而非 system', async () => {
  const packets = []
  const events = []
  const history = []
  const planner = createContextPlanner({ prompt: () => '' })
  const card = { name: '测试人物', description: '固定背景A', personality: '固定性格', scenario: '固定场景', mes_example: '固定示例', system_prompt: '每轮系统要求', post_history_instructions: '每轮末尾要求' }
  let creates = 0
  let resumes = 0
  const savedPrefixes = new Map()
  const stablePrefixStorage = { async read(id) { return savedPrefixes.get(id) }, async write(id, value) { savedPrefixes.set(id, value) } }
  async function open(options) {
    const session = { id: 'background', events, append(type, data) { events.push({ type, data: structuredClone(data) }) } }
    const stagedRequests = new Map()
    const projection = createNativePlayOrchestrationStrategy({ stagedRequests, sessionPrefix: () => readSessionStablePrefix(session) })
    const variables = new Map()
    const sections = []
    await options.setup({
      systemPrompt: { variable(name, value) { variables.set(name, value) }, section(value) { sections.push(value) }, suppressRuntimeContext() {} },
      tools: { restrict() {}, register() {} }, on() {}
    })
    return {
      agent: {
        session,
        followup(message) {
          const system = sections.map(section => section.text.replace(/\{\{([^}]+)\}\}/g, (_, name) => variables.get(name)())).join('\n')
          history.push(message)
          stagedRequests.set('background', { scope: 'background', snapshot: null, turn: packets.length + 1, step: 1 })
          const request = projection.projectRequest({ sessionId: 'background', system, messages: history })
          assert.equal(projection.projectRequest(request), null, '重新分发不能重复拼接前缀')
          packets.push({ system: request.system, messages: request.messages, text: message.content[0].text })
          events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '{"choices":[]}' }] } } })
        }, async whenIdle() {}
      }, async dispose() {}
    }
  }
  const agents = {
    get: () => ({ id: 'parent', session: { header: {} } }),
    async create(options) { creates++; return open(options) },
    async resume(options) { resumes++; return open(options) }
  }
  let runner = createBackgroundAgentRunner({ agents, id: () => 'background', stablePrefixStorage })
  async function candidate(persistentSessionId = '') {
    const context = await planner.plan({ purpose: 'candidate', card, chat: { guides: [{ text: '最新Guide' }], posture: '最新姿势' }, task: '候选JSON规则', constantWorldBookContext: '固定世界设定' })
    return runner.run({ sessionId: 'parent', persistent: true, persistentSessionId, task: 'candidate', selection: { provider: 'test', model: 'fake' },
      system: context.taskText, backgroundContext: context.stableText, turnContext: context.dynamicText,
      systemPromptText: context.systemPromptText, postHistoryText: context.postHistoryText,
      messages: [{ role: 'assistant', content: [{ type: 'text', text: '最新正文' }] }, { role: 'user', content: [{ type: 'text', text: '本轮候选意见' }] }]
    })
  }
  await candidate()
  await candidate('background')
  card.description = '固定背景B'
  card.post_history_instructions = '修改后的末尾要求'
  await candidate('background')
  await runner.dispose()
  runner = createBackgroundAgentRunner({ agents, stablePrefixStorage })
  await candidate('background')
  assert.equal(creates, 1)
  assert.equal(resumes, 1)
  const stableSystem = packets[0].system
  for (const [index, packet] of packets.entries()) {
    assert.equal(packet.system, stableSystem, '后台 system 必须跨轮次逐字稳定')
    assert.doesNotMatch(packet.system, /候选JSON规则/)
    assert.equal(packet.text.split('候选JSON规则').length - 1, 1, '完整任务协议只在本轮末尾追加一次')
    assert.doesNotMatch(packet.system, /固定背景|固定世界设定|固定性格|固定场景|固定示例/)
    const texts = packet.messages.map(message => message.content.map(block => block.text).join('')).join('\n')
    assert.equal(texts.split('固定背景A').length - 1, 1)
    assert.equal(texts.split('固定世界设定').length - 1, 1)
    assert.equal(packet.messages[0].source.form, 'session-prefix')
    assert.doesNotMatch(texts, /固定背景B/)
    assert.doesNotMatch(packet.system, /每轮系统要求|每轮末尾要求|修改后的末尾要求|最新Guide|最新姿势/)
    assert.doesNotMatch(packet.text, /固定背景|固定性格|固定场景|固定示例|固定世界设定/)
    assert.equal(packet.text.split('每轮系统要求').length - 1, 1)
    assert.match(packet.text, /最新正文/)
    assert.match(packet.text, /最新Guide/)
    assert.match(packet.text, /最新姿势/)
    assert.match(packet.text, /本轮候选意见/)
    assert.ok(packet.text.endsWith(index < 2 ? '每轮末尾要求' : '修改后的末尾要求'))
  }
  await runner.run({ sessionId: 'parent', persistent: true, persistentSessionId: 'background', task: 'settlement', selection: { provider: 'test', model: 'fake' }, system: '结算规则', messages: [], backgroundContext: '不应带入的候选背景', systemPromptText: '不应带入的系统要求', postHistoryText: '不应带入的末尾要求' })
  assert.equal(packets.at(-1).system, stableSystem, '结算与候选切换不得改写 system 前缀')
  assert.equal(packets.at(-1).text.split('结算规则').length - 1, 1)
  assert.doesNotMatch(packets.at(-1).system, /不应带入|固定背景|每轮系统要求/)
  assert.match(packets.at(-1).messages[0].content[0].text, /固定背景A/)
  assert.equal(events.filter(event => event.type === 'dsh-tavern/stable-prefix').length, 0)
  assert.equal(savedPrefixes.size, 1)
  await runner.dispose()
})

test('DeepSeek V4 后台任务采用官方最大输出，其他模型交给适配器', () => {
  assert.equal(maximumBackgroundTokens({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }), 384000)
  assert.equal(maximumBackgroundTokens({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }), 384000)
  assert.equal(maximumBackgroundTokens({ provider: 'test', model: 'scripted' }), undefined)
})

test('后台压缩通过进程内命令服务把 /compact 交给精确 Agent', async () => {
  const signal = new AbortController().signal
  const agent = { ctx: { get(name) { return name === 'commands' ? commands : undefined } } }
  const commands = {
    async execute(target, line, images, receivedSignal) {
      assert.equal(target, agent)
      assert.equal(line, '/compact')
      assert.deepEqual(images, [])
      assert.equal(receivedSignal, signal)
      return { result: { kind: 'success', text: 'Compacted 3 history items (~400 tokens).' } }
    }
  }

  assert.deepEqual(await executeBackgroundCompaction(agent, signal), {
    message: 'Compacted 3 history items (~400 tokens).'
  })
})

test('后台压缩由宿主直接交给 subagent Agent，不经过跨 Session 远程路由', async () => {
  const session = { id: 'background-owned', header: { origin: 'subagent' } }
  const child = { session, async whenIdle() {} }
  let compacted = null
  const runner = createBackgroundAgentRunner({
    agents: { get(id) { return id === session.id ? child : undefined } },
    async compactAgent(agent, signal) {
      assert.equal(signal.aborted, false)
      compacted = agent
      return { shadowedSeqs: [1, 2], shadowedTokenCount: 200 }
    }
  })

  const result = await runner.compact({ sessionId: session.id })

  assert.equal(compacted, child)
  assert.deepEqual(result, { shadowedSeqs: [1, 2], shadowedTokenCount: 200 })
})

test('冷恢复后台 Agent 时先挂载后台压缩预设', async () => {
  const childCtx = {}
  const child = { ctx: childCtx, session: { id: 'background-cold' }, async whenIdle() {} }
  let mounted = null
  let disposed = false
  const runner = createBackgroundAgentRunner({
    agents: {
      get() { return undefined },
      async resume(options) {
        assert.equal(options.resumeSessionId, child.session.id)
        assert.equal(typeof options.setup, 'function')
        await options.setup(childCtx)
        return { agent: child, async dispose() { disposed = true } }
      }
    },
    async setupAgent(ctx) { mounted = ctx },
    async compactAgent(agent) {
      assert.equal(mounted, childCtx)
      assert.equal(agent, child)
      return null
    }
  })

  assert.equal(await runner.compact({ sessionId: child.session.id }), null)
  assert.equal(disposed, true)
})

test('后台 Runner 执行候选任务，查询超限后提示开始推理而不终止回合', async () => {
  const parent = {
    id: 'parent-session',
    session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } }
  }
  const events = []
  const registered = []
  const sections = []
  const variables = []
  const restrictions = []
  const listeners = []
  const appended = []
  const cappedResults = []
  let pointResult = ''
  let requestMessages = []
  let concludeCalls = 0
  let disposed = false
  let work = Promise.resolve()
  let runner
  const child = {
    session: {
      id: 'candidate-session-1',
      events,
      append(type, data) { appended.push({ type, data }) }
    },
    followup(message) {
      work = (async function () {
        assert.equal(runner.owns('candidate-session-1'), true)
        assert.match(message.content[0].text, /最近剧情/)
        assert.match(message.content[0].text, /雨水敲窗/)
        const preStep = listeners.find(function (entry) { return entry.name === 'agent/pre-step' })
        assert.ok(preStep)
        const decision = await preStep.listener({ agent: child, turn: 1, step: 1 }, async function () { return { kind: 'enter', messages: [message] } })
        requestMessages = decision.messages
        pointResult = await registered[1].execute({ position: 3 })
        for (let index = 1; index <= 7; index++) {
          cappedResults.push(await registered[0].execute({ position: index }, {
            signal: new AbortController().signal,
            concludeTurn() { concludeCalls++ }
          }))
        }
        events.push({
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text: '{"choices":[{"type":"action","text":"沿着脚印继续向钟楼谨慎追去"}]}' }] } }
        })
      })()
    },
    async whenIdle() { await work }
  }
  const createCalls = []
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async create(options) {
      createCalls.push(options)
      await options.setup({
        systemPrompt: {
          section(value) { sections.push(value) },
          variable(name, provider) { variables.push({ name, provider }) },
          suppressRuntimeContext() {}
        },
        tools: {
          restrict(value) { restrictions.push(value) },
          register(value) { registered.push(value) }
        },
        on(name, listener) { listeners.push({ name, listener }) }
      })
      return { agent: child, async dispose() { disposed = true } }
    }
  }
  const calls = []
  const stagedSnapshots = []
  runner = createBackgroundAgentRunner({
    agents,
    id: () => 'candidate-session-1',
    resolveRuntimePresetSnapshot: async function () {
      return {
        front: { entries: [{ id: 'front#1', role: 'system', content: '通用破限身份' }] },
        middle: { entries: [{ id: 'middle#1', role: 'user', content: '通用破限握手' }] },
        back: { entries: [{ id: 'back#1', role: 'assistant', content: '通用破限预填充' }] },
        regexScripts: []
      }
    },
    stageRuntimePresetSnapshot(input) { stagedSnapshots.push(input) }
  })
  const result = await runner.run({
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '候选系统提示',
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: '雨水敲窗。' }] },
      { role: 'user', content: [{ type: 'text', text: '生成候选项。' }] }
    ],
    tools: [
      { name: 'tavern_read_script', description: '读取剧本', parameters: { type: 'object' } },
      { name: 'tavern_point_script', description: '定位剧本', parameters: { type: 'object' }, countsTowardLimit: false }
    ],
    async onToolCall(call) { calls.push(call); return '{"position":2}' },
    maxToolCalls: 6,
    temperature: 0.8,
    maxTokens: 4000,
    task: 'candidate',
    turn: 3
  })

  assert.equal(result.traceSessionId, 'candidate-session-1')
  assert.match(result.text, /沿着脚印/)
  assert.equal(createCalls[0].meta.parentSession, parent.id)
  assert.equal(createCalls[0].meta.origin, 'subagent')
  assert.equal(createCalls[0].agentOptions.maxTokens, 4000)
  assert.equal(sections[0].complete, true)
  assert.equal(sections.length, 1)
  assert.doesNotMatch(sections[0].text, /tavern_runtime_preset_front/)
  assert.doesNotMatch(sections[0].text, /future::macro/)
  assert.doesNotMatch(sections[0].text, /候选系统提示/)
  assert.doesNotMatch(sections[0].text, /tavern_background_task/)
  assert.equal(variables.some(function (entry) { return entry.name === 'tavern_background_task' }), false)
  assert.equal(variables.some(function (entry) { return entry.name === 'tavern_runtime_preset_front' }), false)
  assert.deepEqual(requestMessages.map(function (entry) { return [entry.role, entry.content[0].text] }), [
    ['user', '通用破限握手'],
    ['user', requestMessages[1].content[0].text]
  ])
  assert.match(requestMessages[1].content[0].text, /最近剧情/)
  assert.match(requestMessages[1].content[0].text, /候选生成/)
  assert.match(requestMessages[1].content[0].text, /DSH 后台任务协议（最终指令）/)
  assert.equal(requestMessages[1].content[0].text.split('候选系统提示').length - 1, 1)
  assert.equal(stagedSnapshots.length, 1)
  assert.equal(stagedSnapshots[0].sessionId, 'candidate-session-1')
  assert.equal(stagedSnapshots[0].scope, 'background')
  assert.equal(stagedSnapshots[0].snapshot.front.entries[0].content, '通用破限身份')
  assert.equal(stagedSnapshots[0].snapshot.back.entries[0].content, '通用破限预填充')
  assert.deepEqual(restrictions, [{ allow: ['skill'] }])
  assert.equal(registered[0].name, 'tavern_read_script')
  assert.equal(registered[1].name, 'tavern_point_script')
  const requestListener = listeners.find(function (entry) { return entry.name === 'agent/request' })
  assert.ok(requestListener)
  assert.deepEqual(await requestListener.listener({}, async function () { return { provider: 'test', model: 'scripted' } }), { provider: 'test', model: 'scripted', temperature: 0.8 })
  assert.deepEqual(appended, [{
    type: 'subagent/descriptor',
    data: { version: 3, mode: 'one-shot', provider: 'dsh-tavern-background', label: '候选研究' }
  }])
  assert.deepEqual(calls, [
    { name: 'tavern_point_script', arguments: { position: 3 } },
    ...[1, 2, 3, 4, 5, 6].map(function (position) {
      return { name: 'tavern_read_script', arguments: { position } }
    })
  ])
  assert.match(pointResult, /position/)
  assert.match(cappedResults[6], /已达到剧本查询上限/)
  assert.match(cappedResults[6], /开始推理/)
  assert.equal(concludeCalls, 0)
  assert.equal(disposed, true)
  assert.equal(runner.owns('candidate-session-1'), false)
})

test('后台 Agent 不执行前台预设正则，保持任务协议和结构化结果原样', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const events = []
  const prompts = []
  const appended = []
  let work = Promise.resolve()
  const child = {
    session: {
      events,
      append(type, data, options) {
        const event = { seq: events.length, type, data, ...options }
        events.push(event)
        appended.push({ type, data, options, event })
        return event
      }
    },
    followup(message) {
      prompts.push(message.content[0].text)
      work = Promise.resolve().then(function () {
        events.push({
          seq: 0,
          type: 'assistant/message',
          data: {
            turn: 1,
            step: 1,
            message: {
              id: 'raw-background-reply',
              role: 'assistant',
              source: { kind: 'model', provider: 'test', model: 'scripted' },
              content: [{ type: 'text', text: '{"choices":[{"type":"action","text":"去钟楼"}]}\n<Reference_Example>后台冗余输出</Reference_Example>' }]
            }
          }
        })
      })
    },
    async whenIdle() { await work }
  }
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async create(options) {
      await options.setup({
        systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
        tools: { restrict() {}, register() {} },
        on() {}
      })
      return { agent: child, async dispose() {} }
    }
  }
  const runner = createBackgroundAgentRunner({
    agents,
    id: () => 'background-regex',
    resolveRuntimePresetSnapshot: async function () {
      return {
        text: '',
        regexScripts: [{
          id: 'remove-reference-example',
          name: '删除 Reference Example',
          enabled: true,
          placement: [2],
          promptOnly: true,
          markdownOnly: true,
          findRegex: '/<Reference_Example>[\\s\\S]*?<\\/Reference_Example>/g',
          replaceString: ''
        }]
      }
    }
  })

  const result = await runner.run({
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '候选规则',
    messages: [{
      role: 'assistant',
      content: [{ type: 'text', text: '雨水敲窗。<Reference_Example>正文冗余内容</Reference_Example>' }]
    }],
    tools: [],
    task: 'candidate'
  })

  assert.match(prompts[0], /正文冗余内容/)
  assert.match(result.text, /后台冗余输出/)
  assert.equal(events[0].data.message.content[0].text.includes('后台冗余输出'), true, '原始事件保持不变')
  assert.equal(appended.length, 0, '后台不生成正则投影事件')
})

test('生图常驻会话隔离后台任务与游戏，先保存编号且恢复后延续历史', async () => {
  const sessions = new Map(), bindings = new Map(), flushed = new Set()
  let creates = 0, resumes = 0, disposed = 0
  async function open(options, resume = false) {
    const id = options.resumeSessionId || options.sessionId
    const session = resume ? sessions.get(id) : { id, header: options.meta, events: [], append(type, data) { this.events.push({ type, data }) } }
    assert.ok(session)
    sessions.set(id, session)
    await options.setup({ systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on() {} })
    return { agent: { session, followup(message) {
      session.append('user/message', { message })
      session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } })
    }, async whenIdle() {} }, async dispose() { disposed++ } }
  }
  const agents = { get: id => ({ id, session: { header: {} } }),
    async create(options) { creates++; return open(options) },
    async resume(options) { resumes++; return open(options, true) } }
  const options = { agents, id: () => 'child-' + creates, flushSession: async session => { flushed.add(session.id) } }
  let runner = createBackgroundAgentRunner(options)
  const common = { sessionId: 'game-a', persistent: true, selection: { provider: 'test', model: 'fake' }, messages: [], tools: [] }
  const image = { ...common, task: 'image',
    resolvePersistentSessionId: async () => bindings.get('game-a') || '',
    async onPersistentSessionReady(id) {
      assert.ok(flushed.has(id), 'native session must be durable before storing the binding')
      bindings.set('game-a', id)
    } }
  const [first, second] = await Promise.all([runner.run(image), runner.run(image)])
  assert.equal(first.traceSessionId, second.traceSessionId)
  assert.equal(creates, 1)
  assert.equal(disposed, 0)
  const background = await runner.run({ ...common, task: 'settlement' })
  assert.notEqual(background.traceSessionId, first.traceSessionId)
  assert.equal((await runner.run({ ...common, task: 'candidate' })).traceSessionId, background.traceSessionId)
  const other = await runner.run({ ...common, task: 'image', sessionId: 'game-b' })
  assert.notEqual(other.traceSessionId, first.traceSessionId)
  await assert.rejects(runner.run({ ...common, task: 'settlement', persistentSessionId: first.traceSessionId }), /任务类型/)
  await runner.dispose()
  runner = createBackgroundAgentRunner(options)
  try {
    await assert.rejects(runner.run({ ...common, task: 'settlement', persistentSessionId: first.traceSessionId }), /任务类型不匹配/)
    await assert.rejects(runner.run({ ...common, task: 'image', sessionId: 'game-b', persistentSessionId: first.traceSessionId }), /父会话/)
    assert.equal((await runner.run(image)).traceSessionId, first.traceSessionId)
    assert.equal(resumes, 3)
    assert.equal(creates, 3)
    const events = sessions.get(first.traceSessionId).events
    assert.equal(events.filter(e => e.type === 'user/message').length, 3)
    assert.equal(events.filter(e => e.type === 'subagent/descriptor').length, 1)
    assert.equal(events[0].data.mode, 'continuable')
  } finally { await runner.dispose() }
})

test('旧工具协议的后台 Session 自动迁移到干净 Session，不继续模仿历史 DSML 正文', async () => {
  const parent = { id: 'foreground', session: { header: { delegationDepth: 0 } } }
  let resumed = 0
  let created = 0
  let disposed = 0
  let work = Promise.resolve()
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async resume(options) {
      resumed++
      await options.setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on() {} })
      return {
        agent: {
          session: {
            id: options.resumeSessionId,
            header: { parentSession: parent.id },
            events: [{ type: 'subagent/descriptor', data: { version: 3, mode: 'continuable', provider: 'dsh-tavern-background', label: '酒馆后台 Agent' } }],
            append() {}
          },
          followup() { throw new Error('旧后台 Session 不应再执行任务') },
          async whenIdle() {}
        },
        async dispose() { disposed++ }
      }
    },
    async create(options) {
      created++
      await options.setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on() {} })
      const events = []
      return {
        agent: {
          session: { id: options.sessionId, header: options.meta, events, append(type, data) { events.push({ type, data }) } },
          followup() {
            work = Promise.resolve().then(function () {
              events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '新后台会话结果' }] } } })
              events.push({ seq: events.length, type: 'turn/end', data: {} })
            })
          },
          async whenIdle() { await work }
        },
        async dispose() { disposed++ }
      }
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => 'background-protocol-v2' })
  const result = await runner.run({
    sessionId: parent.id,
    persistent: true,
    persistentSessionId: 'background-legacy',
    task: 'candidate',
    selection: { provider: 'test', model: 'fake' },
    messages: [],
    tools: []
  })

  assert.equal(result.traceSessionId, 'background-protocol-v2')
  assert.equal(result.text, '新后台会话结果')
  assert.equal(resumed, 1)
  assert.equal(created, 1)
  assert.equal(disposed, 1, '旧 Session 只释放一次')
  await runner.dispose()
})

test('已保存的后台 Session 不存在时自动建立干净 Session', async () => {
  const parent = { id: 'foreground', session: { header: { delegationDepth: 0 } } }
  let resumed = 0
  let created = 0
  const events = []
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async resume() {
      resumed++
      throw new Error('session "background-missing" not found')
    },
    async create(options) {
      created++
      await options.setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on() {} })
      return {
        agent: {
          session: { id: options.sessionId, header: options.meta, events, append(type, data) { events.push({ type, data }) } },
          followup() { events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '新后台会话结果' }] } } }) },
          async whenIdle() {}
        },
        async dispose() {}
      }
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => 'background-recreated' })
  const result = await runner.run({
    sessionId: parent.id,
    persistent: true,
    persistentSessionId: 'background-missing',
    task: 'candidate',
    selection: { provider: 'test', model: 'fake' },
    messages: [],
    tools: []
  })

  assert.equal(resumed, 1)
  assert.equal(created, 1)
  assert.equal(result.traceSessionId, 'background-recreated')
  assert.equal(result.text, '新后台会话结果')
  await runner.dispose()
})

test('后台 Session 建立失败时不对外发布虚假的 traceSessionId', async () => {
  const runner = createBackgroundAgentRunner({
    id: () => 'background-never-created',
    agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        await options.setup({
          systemPrompt: { section() {}, suppressRuntimeContext() {} },
          tools: { restrict() { throw new Error('setup failed') }, register() {} },
          on() {}
        })
      }
    }
  })

  await assert.rejects(runner.run({
    sessionId: 'parent', persistent: true, task: 'candidate',
    selection: { provider: 'test', model: 'fake' }, messages: [], tools: []
  }), function (error) {
    assert.equal(error.traceSessionId, '')
    return true
  })
})

test('后台 Runner 不再提供预设正则历史重投影入口', () => {
  const runner = createBackgroundAgentRunner({ agents: { get() {} } })
  assert.equal(runner.reproject, undefined)
})

test('状态结算与候选生成复用同一个常驻后台 Agent，并且每轮只读取本轮新增输入', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const events = []
  const appended = []
  const prompts = []
  let createCalls = 0
  let resumeCalls = 0
  let disposeCalls = 0

  async function open(options, responses) {
    const listeners = []
    let work = Promise.resolve()
    await options.setup({
      systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
      tools: { restrict() {}, register() {} },
      on(name, listener) { listeners.push({ name, listener }) }
    })
    const child = {
      session: {
        events,
        append(type, data) {
          appended.push({ type, data })
          events.push({ type, data })
        }
      },
      followup(message) {
        prompts.push(message.content[0].text)
        const response = responses[prompts.length - 1]
        const preStep = listeners.find(function (entry) { return entry.name === 'agent/pre-step' })
        work = Promise.resolve(preStep.listener({ agent: child }, async function () { return { kind: 'enter' } })).then(function () {
          events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: response }] } } })
        })
      },
      async whenIdle() { await work }
    }
    return { agent: child, async dispose() { disposeCalls++ } }
  }

  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async create(options) {
      createCalls++
      return open(options, [
        '{"choices":[{"type":"action","text":"第一轮候选"}]}',
        '{"choices":[{"type":"action","text":"第二轮候选"}]}'
      ])
    },
    async resume(options) {
      resumeCalls++
      assert.equal(options.resumeSessionId, 'candidate-session-1')
      return open(options, '{"choices":[{"type":"action","text":"第二轮候选"}]}')
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => 'candidate-session-1' })
  const common = {
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '稳定的人物卡与候选规则',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: '本轮正文' }] }],
    tools: [],
    persistent: true
  }
  const first = await runner.run(Object.assign({}, common, { task: 'settlement', turnContext: '游标 2，姿势 A' }))
  const second = await runner.run(Object.assign({}, common, { task: 'candidate', persistentSessionId: first.traceSessionId, turnContext: '游标 3，姿势 B' }))

  assert.equal(first.traceSessionId, 'candidate-session-1')
  assert.equal(second.traceSessionId, 'candidate-session-1')
  assert.match(first.text, /第一轮候选/)
  assert.match(second.text, /第二轮候选/)
  assert.equal(createCalls, 1)
  assert.equal(resumeCalls, 0)
  assert.equal(disposeCalls, 0)
  assert.equal(runner.owns('candidate-session-1'), true)
  assert.equal(appended.filter(function (event) { return event.type === 'subagent/descriptor' }).length, 1)
  assert.deepEqual(appended[0].data, {
    version: 3,
    mode: 'continuable',
    provider: 'dsh-tavern-background-tools-v1',
    label: '酒馆后台 Agent',
    agentProvider: 'test',
    agentModel: 'scripted',
    persona: '共享剧情背景，承担世界书召回、状态结算与候选生成任务。'
  })
  assert.match(prompts[0], /游标 2，姿势 A/)
  assert.match(prompts[0], /任务类型：状态结算/)
  assert.match(prompts[1], /游标 3，姿势 B/)
  assert.match(prompts[1], /任务类型：候选生成/)
  assert.doesNotMatch(prompts[1], /游标 2，姿势 A/)

  await runner.dispose()
  assert.equal(disposeCalls, 1)
  assert.equal(runner.owns('candidate-session-1'), false)
})

test('常驻后台 Agent 每轮只挂载本轮工具', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const events = []
  const activeTools = new Set()
  const observedTools = []
  const child = {
    session: { events, append(type, data) { events.push({ type, data }) } },
    followup() {
      observedTools.push(Array.from(activeTools))
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '完成' }] } } })
    },
    async whenIdle() {}
  }
  let disposed = 0
  const runner = createBackgroundAgentRunner({
    agents: {
      get(id) { return id === parent.id ? parent : undefined },
      async create(options) {
        await options.setup({
          systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
          tools: {
            restrict() {},
            register(definition) {
              activeTools.add(definition.name)
              return function () { activeTools.delete(definition.name) }
            }
          },
          on() {}
        })
        return { agent: child, async dispose() { disposed++ } }
      }
    },
    id: () => 'resident-tools'
  })

  const first = await runner.run({
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '候选规则', messages: [], task: 'candidate', persistent: true,
    tools: [{ name: 'tavern_read_script', description: '读取', parameters: { type: 'object' }, async onToolCall() {} }],
    async onToolCall() { return '{}' }
  })
  await runner.run({
    sessionId: parent.id,
    persistentSessionId: first.traceSessionId,
    selection: { provider: 'test', model: 'scripted' },
    system: '结算规则', messages: [], task: 'settlement', persistent: true, tools: []
  })

  assert.deepEqual(observedTools, [['tavern_read_script'], []])
  assert.deepEqual(Array.from(activeTools), [])
  assert.equal(disposed, 0)
  await runner.dispose()
  assert.equal(disposed, 1)
})

test('回退后在同一个后台 Agent 中遮蔽 checkpoint 之后的 Surface', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const sourceEvents = [
    { seq: 0, type: 'user/message', data: { text: '有效正文' } },
    { seq: 1, type: 'assistant/message', data: { turn: 1, step: 1, message: { source: { kind: 'model', provider: 'test', model: 'scripted' }, content: [{ type: 'text', text: '有效候选' }] } } },
    { seq: 2, type: 'turn/end', data: {} },
    { seq: 3, type: 'user/message', data: { text: '已废弃正文' } },
    { seq: 4, type: 'assistant/message', data: { turn: 2, step: 1, message: { source: { kind: 'model', provider: 'test', model: 'scripted' }, content: [{ type: 'text', text: '已废弃候选' }] } } },
    { seq: 5, type: 'turn/end', data: {} }
  ]
  const appendCalls = []
  let createCalls = 0
  let resumeCalls = 0
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async resume(options) {
      resumeCalls++
      assert.equal(options.resumeSessionId, 'old-candidate')
      const listeners = []
      await options.setup({
        systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
        tools: { restrict() {}, register() {} },
        on(name, listener) { listeners.push({ name, listener }) }
      })
      const events = structuredClone(sourceEvents)
      let work = Promise.resolve()
      const child = {
        session: {
          events,
          surface: { nodes: [0, 1, 3, 4] },
          append(type, data, options) {
            appendCalls.push({ type, data, options })
            events.push({ seq: events.length, type, data, ...(options || {}) })
          }
        },
        followup() {
          work = Promise.resolve().then(function () {
            events.push({ seq: events.length, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '回退后候选' }] } } })
            events.push({ seq: events.length, type: 'turn/end', data: {} })
          })
        },
        async whenIdle() { await work }
      }
      return { agent: child, async dispose() {} }
    },
    async create() {
      createCalls++
      throw new Error('回退不应创建新的后台 Agent')
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => 'new-candidate' })
  const result = await runner.run({
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '候选规则', messages: [], tools: [], persistent: true,
    persistentSessionId: 'old-candidate', rewindTo: 2
  })

  assert.equal(result.traceSessionId, 'old-candidate')
  assert.equal(result.traceBoundary, 8)
  assert.equal(resumeCalls, 1)
  assert.equal(createCalls, 0)
  assert.equal(appendCalls.length, 1)
  assert.equal(appendCalls[0].type, 'assistant/message')
  assert.deepEqual(appendCalls[0].data.message.content, [])
  assert.deepEqual(appendCalls[0].options.surfaceOp, { op: 'replace', start: 3, end: 4 })
  assert.deepEqual(appendCalls[0].options.sourceEventSeqs, [3, 4])
})

test('后台回合没有回复时透传 DSH 的真实终止错误', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const events = []
  let work = Promise.resolve()
  const child = {
    session: { events, append() {} },
    followup() {
      work = Promise.resolve().then(function () {
        events.push({
          type: 'turn/end',
          data: { turn: 1, reason: { kind: 'error', error: { message: 'malformed prompt variable reference "{{getvar::stage || 1}}"' } } }
        })
      })
    },
    async whenIdle() { await work }
  }
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async create(options) {
      await options.setup({
        systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
        tools: { restrict() {}, register() {} },
        on() {}
      })
      return { agent: child, async dispose() {} }
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => 'background-error' })

  await assert.rejects(() => runner.run({
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '候选规则', messages: [], tools: [], persistent: true, task: 'candidate'
  }), /malformed prompt variable reference/)
})

test('后台回合耗尽输出 token 时返回真实终止原因', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const events = []
  let work = Promise.resolve()
  const child = {
    session: { events, append() {} },
    followup() {
      work = Promise.resolve().then(function () {
        events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } })
      })
    },
    async whenIdle() { await work }
  }
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async create(options) {
      assert.equal(options.agentOptions.maxTokens, 384000)
      assert.equal(options.agentOptions.reasoningEffort, 'high')
      await options.setup({
        systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
        tools: { restrict() {}, register() {} },
        on() {}
      })
      return { agent: child, async dispose() {} }
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => 'background-max-tokens' })

  await assert.rejects(() => runner.run({
    sessionId: parent.id,
    selection: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    system: '候选规则', messages: [], tools: [], persistent: true, task: 'candidate'
  }), /输出达到模型 token 上限/)
})
