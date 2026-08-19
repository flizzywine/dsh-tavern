import assert from 'node:assert/strict'
import test from 'node:test'

import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'

test('后台 Runner 执行候选任务，查询超限后提示开始推理而不终止回合', async () => {
  const parent = {
    id: 'parent-session',
    session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } }
  }
  const events = []
  const registered = []
  const sections = []
  const restrictions = []
  const listeners = []
  const appended = []
  const cappedResults = []
  let pointResult = ''
  let concludeCalls = 0
  let disposed = false
  let work = Promise.resolve()
  let runner
  const child = {
    session: {
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
        await preStep.listener({ agent: child }, async function () { return { kind: 'enter' } })
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
  runner = createBackgroundAgentRunner({ agents, id: () => 'candidate-session-1' })
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
    maxTokens: 4000
  })

  assert.equal(result.traceSessionId, 'candidate-session-1')
  assert.match(result.text, /沿着脚印/)
  assert.equal(createCalls[0].meta.parentSession, parent.id)
  assert.equal(createCalls[0].meta.origin, 'subagent')
  assert.equal(createCalls[0].agentOptions.maxTokens, 4000)
  assert.equal(sections[0].complete, true)
  assert.deepEqual(restrictions, [{ allow: [] }])
  assert.equal(registered[0].name, 'tavern_read_script')
  assert.equal(registered[1].name, 'tavern_point_script')
  const requestListener = listeners.find(function (entry) { return entry.name === 'agent/request' })
  assert.ok(requestListener)
  assert.deepEqual(await requestListener.listener({}, async function () { return { provider: 'test', model: 'scripted' } }), { provider: 'test', model: 'scripted', temperature: 0.8 })
  assert.deepEqual(appended, [{
    type: 'subagent/descriptor',
    data: { version: 2, mode: 'one-shot', provider: 'dsh-tavern-background', label: '候选研究' }
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

test('状态结算与候选生成复用同一个后台会话，并且每轮只读取本轮新增输入', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const events = []
  const appended = []
  const prompts = []
  let createCalls = 0
  let resumeCalls = 0
  let disposeCalls = 0

  async function open(options, response) {
    const listeners = []
    let work = Promise.resolve()
    await options.setup({
      systemPrompt: { section() {}, suppressRuntimeContext() {} },
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
      return open(options, '{"choices":[{"type":"action","text":"第一轮候选"}]}')
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
  assert.equal(resumeCalls, 1)
  assert.equal(disposeCalls, 2)
  assert.equal(appended.filter(function (event) { return event.type === 'subagent/descriptor' }).length, 1)
  assert.deepEqual(appended[0].data, {
    version: 2,
    mode: 'continuable',
    provider: 'dsh-tavern-background',
    label: '酒馆后台 Agent',
    agentProvider: 'test',
    agentModel: 'scripted',
    persona: '共享剧情背景，承担状态结算与候选生成任务。'
  })
  assert.match(prompts[0], /游标 2，姿势 A/)
  assert.match(prompts[0], /任务类型：状态结算/)
  assert.match(prompts[1], /游标 3，姿势 B/)
  assert.match(prompts[1], /任务类型：候选生成/)
  assert.doesNotMatch(prompts[1], /游标 2，姿势 A/)
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
        systemPrompt: { section() {}, suppressRuntimeContext() {} },
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
