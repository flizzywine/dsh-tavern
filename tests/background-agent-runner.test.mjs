
import assert from 'node:assert/strict'
import test from 'node:test'

// Match DSH's final complete-section restoration, after middleware runs.
function completeSystem(sections) {
  return sections.filter(s => s.complete).map(s => typeof s.text === 'function' ? s.text() : s.text).join('\n')
}

import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { readSceneImageSystemInstruction, readScenePlanInstruction } from '../tavern-plugin/lib/scene-image-prompts.js'

test('人物设计读取工具在生图会话中只注册一次，跨任务保持稳定且不泄漏上一任务', async () => {
  const registered = new Map(), counts = new Map(), answers = []
  let pending
  const session = { id: 'image-reader', header: {}, events: [], append(type, data) { this.events.push({ type, data }) } }
  const agents = {
    get: () => ({ session: { header: {} } }),
    async create(options) {
      await options.setup({
        systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {},
        tools: {
          restrict() {},
          register(tool) {
            registered.set(tool.name, tool)
            counts.set(tool.name, (counts.get(tool.name) || 0) + 1)
            return () => registered.delete(tool.name)
          }
        }
      })
      return { agent: { session, followup() { pending = (async () => {
        answers.push(await registered.get('character_design_read').execute({ name: '林岚' }))
        session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } })
      })() }, async whenIdle() { await pending } }, async dispose() {} }
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => session.id })
  try {
    for (const version of ['第一轮资料', '第二轮资料']) {
      await runner.run({
        sessionId: 'parent', persistent: true, task: 'image', selection: { provider: 'test', model: 'fake' },
        messages: [], tools: [{ name: 'submit_scene_plan', parameters: { type: 'object' } }],
        onToolCall: async call => { assert.equal(call.name, 'character_design_read'); return version }
      })
      assert.ok(registered.has('character_design_read'))
      assert.equal(registered.has('submit_scene_plan'), false)
      assert.equal(JSON.parse(await registered.get('character_design_read').execute({})).ok, false, '空闲时不能继续读取旧快照')
    }
    assert.deepEqual(answers, ['第一轮资料', '第二轮资料'])
    assert.equal(counts.get('character_design_read'), 1)
    assert.equal(registered.has('character_design_save'), false)
  } finally { await runner.dispose() }
})
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'

test('人物设计阶段独立提高温度，结束后恢复结算温度', async () => {
  const registered = new Map()
  const listeners = []
  const temperatures = []
  const results = []
  let work = Promise.resolve()
  const runner = createBackgroundAgentRunner({
    id: () => 'background-character-design-temperature',
    backgroundTools: [
      { name: 'character_design_read', parameters: { type: 'object' } },
      { name: 'character_design_save', parameters: { type: 'object' } },
      { name: 'posture_submit', parameters: { type: 'object' } }
    ],
    agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        await options.setup({
          systemPrompt: { section() {}, suppressRuntimeContext() {} },
          on(name, listener) { listeners.push({ name, listener }) },
          tools: { restrict() {}, register(tool) { registered.set(tool.name, tool) } }
        })
        async function sampleTemperature() {
          const request = await listeners.filter(entry => entry.name === 'agent/request').reduceRight(
            (next, entry) => () => entry.listener({}, next), async () => ({}))()
          temperatures.push(request.temperature)
        }
        return { agent: {
          session: { id: 'background-character-design-temperature', events: [], append() {} },
          followup() {
            work = (async () => {
              await sampleTemperature()
              results.push(await registered.get('character_design_read').execute({}))
              await sampleTemperature()
              results.push(await registered.get('posture_submit').execute({ posture: '不应提前提交' }))
              results.push(await registered.get('character_design_save').execute({ name: '王夫人' }))
              await sampleTemperature()
              results.push(await registered.get('character_design_finish').execute({}))
              await sampleTemperature()
              results.push(await registered.get('posture_submit').execute({ posture: '佛龛前端坐' }))
            })()
          },
          async whenIdle() { await work }
        }, async dispose() {} }
      }
    }
  })
  let submitted = false
  await runner.run({
    sessionId: 'parent', persistent: true, task: 'settlement',
    selection: { provider: 'test', model: 'test' }, temperature: 0.2,
    messages: [], tools: [
      { name: 'character_design_read', parameters: { type: 'object' } },
      { name: 'character_design_save', parameters: { type: 'object' } },
      { name: 'posture_submit', parameters: { type: 'object' } }
    ],
    acceptWithoutText: () => submitted,
    stopToolsWhen: () => submitted,
    async onToolCall(call) {
      if (call.name === 'posture_submit') submitted = true
      return JSON.stringify({ ok: true })
    }
  })

  assert.deepEqual(temperatures, [0.2, 0.7, 0.7, 0.2])
  assert.match(results[1], /character_design_finish/)
  assert.equal(JSON.parse(results[3]).ok, true)
  assert.equal(submitted, true)
  await runner.dispose()
})

test('后台固定背景只保存一次，连续候选、结算和恢复均进入固定 system 而非剧情历史', async () => {
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
    const session = { id: 'background', events, append(type, data, intent) {
      const event = { type, data: structuredClone(data), ...(intent || {}) }
      events.push(event)
      if (type === 'user/message' && data.id === 'tavern-session-prefix:' + session.id && !history.some(message => message.id === data.id)) history.push(event.data)
      return event
    } }
    const variables = new Map()
    const sections = []
    let assemble, pending
    await options.setup({
      systemPrompt: { variable(name, value) { variables.set(name, value) }, section(value) { sections.push(value) }, suppressRuntimeContext() {} },
      tools: { restrict() {}, register() {} }, on(name, fn) { if (name === 'system-prompt/assemble') assemble = fn }
    })
    return {
      agent: {
        session,
        followup(message) { pending = (async () => {
          const assembly = await assemble(null, { agent: { session } }, async () => ({ sections, tools: [] }))
          const system = completeSystem(sections)
          history.push(message)
          const request = { sessionId: 'background', system, messages: history.slice() }
          packets.push({ system: request.system, messages: request.messages, text: message.content[0].text })
          events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '{"choices":[]}' }] } } })
        })() }, async whenIdle() { await pending }
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
    assert.match(packet.system, /固定背景A/)
    assert.match(packet.system, /固定世界设定/)
    const texts = packet.messages.map(message => message.content.map(block => block.text).join('')).join('\n')
    assert.equal(texts.split('固定背景A').length - 1, 0)
    assert.equal(texts.split('固定世界设定').length - 1, 0)
    assert.equal(packet.messages[0].source.form, 'snapshot')
    assert.doesNotMatch(texts, /固定背景B/)
    assert.match(packet.system, /每轮系统要求/)
    assert.doesNotMatch(packet.system, /每轮末尾要求|修改后的末尾要求|最新Guide|最新姿势/)
    assert.doesNotMatch(packet.text, /固定背景|固定性格|固定场景|固定示例|固定世界设定/)
    assert.doesNotMatch(packet.text, /每轮系统要求/)
    assert.match(packet.text, /最新正文/)
    assert.match(packet.text, /最新Guide/)
    assert.match(packet.text, /最新姿势/)
    assert.match(packet.text, /本轮候选意见/)
    assert.ok(packet.text.endsWith(index < 2 ? '每轮末尾要求' : '修改后的末尾要求'))
  }
  await runner.run({ sessionId: 'parent', persistent: true, persistentSessionId: 'background', task: 'settlement', selection: { provider: 'test', model: 'fake' }, system: '结算规则', messages: [], backgroundContext: '不应带入的候选背景', systemPromptText: '不应带入的系统要求', postHistoryText: '不应带入的末尾要求' })
  assert.equal(packets.at(-1).system, stableSystem, '结算与候选切换不得改写 system 前缀')
  assert.equal(packets.at(-1).text.split('结算规则').length - 1, 1)
  assert.doesNotMatch(packets.at(-1).system, /不应带入/)
  assert.match(packets.at(-1).system, /仅用于候选文本/)
  assert.match(packets.at(-1).system, /固定背景A/)
  assert.equal(events.filter(event => event.type === 'dsh-tavern/stable-prefix').length, 0)
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.id === 'tavern-session-prefix:background').length, 1)
  assert.equal(savedPrefixes.size, 0)
  await runner.dispose()
})

test('生图常驻会话隔离后台任务与游戏，先保存编号且恢复后延续历史', async () => {
  const sessions = new Map(), bindings = new Map(), flushed = new Set()
  const personas = new Map()
  let creates = 0, resumes = 0, disposed = 0
  async function open(options, resume = false) {
    const id = options.resumeSessionId || options.sessionId
    const session = resume ? sessions.get(id) : { id, header: options.meta, events: [], append(type, data) { this.events.push({ type, data }) } }
    assert.ok(session)
    sessions.set(id, session)
    await options.setup({ systemPrompt: { section(value) { personas.set(id, typeof value.text === 'function' ? value.text() : value.text) }, variable() {}, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on() {} })
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
  const image = { ...common, task: 'image', system: readScenePlanInstruction(),
    resolvePersistentSessionId: async () => bindings.get('game-a') || '',
    async onPersistentSessionReady(id) {
      assert.ok(flushed.has(id), 'native session must be durable before storing the binding')
      bindings.set('game-a', id)
    } }
  const [first, second] = await Promise.all([runner.run(image), runner.run(image)])
  assert.equal(first.traceSessionId, second.traceSessionId)
  assert.equal(personas.get(first.traceSessionId), readSceneImageSystemInstruction())
  const taskMessage = sessions.get(first.traceSessionId).events.find(event => event.type === 'user/message').data.message.content[0].text
  assert.ok(taskMessage.endsWith('【任务要求】\n' + readScenePlanInstruction()))
  assert.ok(!taskMessage.includes(readSceneImageSystemInstruction()), '初始系统提示词不重复放入本次任务')
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
    assert.equal(personas.get(first.traceSessionId), readSceneImageSystemInstruction(), '恢复会话仍从文件安装系统提示词')
    assert.equal(resumes, 3)
    assert.equal(creates, 3)
    const events = sessions.get(first.traceSessionId).events
    assert.equal(events.filter(e => e.type === 'user/message').length, 3)
    assert.equal(events.filter(e => e.type === 'subagent/descriptor').length, 1)
    assert.equal(events[0].data.mode, 'continuable')
  } finally { await runner.dispose() }
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

for (const rewindFails of [false, true]) test('后台 Surface 回退失败时停止任务: ' + rewindFails, async () => {
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
  let resumeCalls = 0, followups = 0
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
            if (rewindFails) throw new Error('fixture: 历史消息面不可回退')
            appendCalls.push({ type, data, options })
            events.push({ seq: events.length, type, data, ...(options || {}) })
          }
        },
        followup() {
          followups++
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
  const pending = runner.run({
    sessionId: parent.id,
    selection: { provider: 'test', model: 'scripted' },
    system: '候选规则', messages: [], tools: [], persistent: true,
    persistentSessionId: 'old-candidate', rewindTo: 2
  })

  if (rewindFails) { await assert.rejects(pending, /后台历史回退失败/); assert.equal(appendCalls.length, 0); assert.equal(createCalls, 0); assert.equal(followups, 0); return }
  const result = await pending
  assert.equal(result.traceSessionId, 'old-candidate')
  assert.equal(result.traceBoundary, rewindFails ? 7 : 8)
  assert.equal(resumeCalls, 1)
  assert.equal(createCalls, 0)
  if (rewindFails) { assert.equal(appendCalls.length, 0); return }
  assert.equal(appendCalls.length, 1)
  assert.equal(appendCalls[0].type, 'assistant/message')
  assert.deepEqual(appendCalls[0].data.message.content, [])
  assert.deepEqual(appendCalls[0].options.surfaceOp, { op: 'replace', start: 3, end: 4 })
  assert.deepEqual(appendCalls[0].options.sourceEventSeqs, [3, 4])
})

test('整段回退失败时改用新的后台会话，旧会话退休 (#164)', async () => {
  const parent = { id: 'parent-session', session: { header: { cwd: '/tmp/tavern', delegationDepth: 0 } } }
  const source = { kind: 'model', provider: 'test', model: 'scripted' }
  const retired = [], ready = [], created = []
  function child(events, nodes, appendFails) {
    let work = Promise.resolve()
    return {
      session: {
        events, surface: { nodes },
        append(type, data, options) {
          if (appendFails && options?.surfaceOp?.op === 'replace') throw new Error('assistant/message embeds its source stream and cannot carry sourceEventSeqs')
          events.push({ seq: events.length, type, data, ...(options || {}) })
        }
      },
      followup() {
        work = Promise.resolve().then(function () {
          events.push({ seq: events.length, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '新会话结算' }] } } })
          events.push({ seq: events.length, type: 'turn/end', data: {} })
        })
      },
      async whenIdle() { await work }
    }
  }
  const setupCtx = () => ({ systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on() {} })
  const agents = {
    get(id) { return id === parent.id ? parent : undefined },
    async resume(options) {
      assert.equal(options.resumeSessionId, 'old-background')
      await options.setup(setupCtx())
      return { agent: child([
        { seq: 0, type: 'user/message', data: { text: '第一轮' } },
        { seq: 1, type: 'assistant/message', data: { turn: 1, step: 1, message: { source, content: [{ type: 'text', text: '第一轮结算' }] } } },
        { seq: 2, type: 'turn/end', data: {} }
      ], [0, 1], true), async dispose() {} }
    },
    async create(options) {
      created.push(options.sessionId)
      await options.setup(setupCtx())
      return { agent: child([], [], true), async dispose() {} }
    }
  }
  const runner = createBackgroundAgentRunner({ agents, id: () => 'new-background',
    retirement: { async isRetired() { return false }, async retire(id, parentId) { retired.push([id, parentId]) } } })
  const result = await runner.run({
    sessionId: parent.id, task: 'settlement', selection: { provider: 'test', model: 'scripted' },
    system: '结算规则', messages: [], tools: [], persistent: true, persistentSessionId: 'old-background', rewindTo: -1,
    onPersistentSessionReady: id => ready.push(id)
  })
  assert.equal(result.traceSessionId, 'new-background')
  assert.deepEqual(created, ['new-background'])
  assert.deepEqual(retired, [['old-background', parent.id]])
  assert.deepEqual(ready, ['new-background'])
})

test('manual stop cancels the active background agent belonging to this game only', async () => {
  let ready, finish, cancelled = 0;
  const started = new Promise(resolve => { ready = resolve; });
  const idle = new Promise(resolve => { finish = resolve; });
  const session = { id: 'stop-background', header: {}, events: [], append(type, data) { this.events.push({ type, data }); } };
  const runner = createBackgroundAgentRunner({ id: () => session.id, agents: {
    get: () => ({ session: { header: {} } }),
    async create(options) {
      await options.setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {}, tools: { restrict() {}, register() { return () => {}; } } });
      return { agent: { session, followup() { ready(); }, whenIdle: () => idle,
        cancel(reason) { assert.equal(reason.kind, 'user'); cancelled++; finish(); }
      }, async dispose() {} };
    }
  } });
  const run = runner.run({ sessionId: 'game', persistent: true, task: 'settlement', selection: { provider: 'fake', model: 'fake' }, messages: [], tools: [] });
  const rejected = assert.rejects(run);
  await started;
  assert.equal(runner.cancel('other-game'), 0);
  assert.equal(runner.cancel('game'), 1);
  await rejected;
  assert.equal(cancelled, 1);
  assert.equal(runner.cancel('game'), 0);
  await runner.dispose();
});

test('常驻后台会话在下一任务替换世界书，任务内固定且不改历史', async () => {
  let assemble, pending, current = '当前DLC', creates = 0
  const seen = [], prompts = [], sections = []
  const session = { id: 'dynamic-book-background', header: {}, events: [], append(type, data) { const event = { type, data, seq: this.events.length }; this.events.push(event); return event } }
  const runner = createBackgroundAgentRunner({
    id: () => session.id,
    resolveStablePrefix: async () => '【故事设定 · 人物卡】\n人物\n【常驻世界书】\n开局DLC',
    resolveCurrentWorldbook: async () => current,
    agents: { get: () => ({ session: { header: {} } }), async create(options) {
      creates++
      await options.setup({ systemPrompt: { section(value) { sections.push(value) }, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on(name, callback) { if (name === 'system-prompt/assemble') assemble = callback } })
      return { agent: { session, followup(message) { prompts.push(message.content[0].text); pending = (async () => {
        current = '任务中途变化'
        const result = await assemble({}, { agent: { session } }, async () => ({ sections: [], tools: [] }))
        seen.push(completeSystem(sections))
        session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } })
      })() }, async whenIdle() { await pending } }, async dispose() {} }
    } }
  })
  try {
    for (const text of ['当前DLC', '', { prefixContext: '固定规则', foregroundContext: '本轮骰子17' }, { prefixContext: '固定规则', foregroundContext: '本轮骰子8' }]) {
      current = text
      await runner.run({ sessionId: 'parent', persistent: true, task: 'candidate', selection: { provider: 'test', model: 'test' }, messages: [], tools: [] })
    }
    assert.equal(creates, 1)
    assert.equal(seen[2], seen[3])
    assert.doesNotMatch(seen.join('\n'), /本轮骰子/)
    assert.match(prompts[2], /本轮骰子17/)
    assert.match(prompts[3], /本轮骰子8/)
    assert.doesNotMatch(prompts[3], /本轮骰子17/)
    assert.match(seen[0], /当前DLC/)
    assert.doesNotMatch(seen.join('\n'), /开局DLC|任务中途变化/)
    assert.doesNotMatch(seen[1], /当前DLC/)
    assert.match(JSON.stringify(session.events), /开局DLC/)
  } finally { await runner.dispose() }
})

for (const task of ['settlement', 'image']) test(task + ' 已有会话在明确更新人物卡后切换背景', async () => {
  let assemble, pending, revision = 0, background = '开局人物设定', backgroundReads = 0
  const seen = [], sections = []
  const session = { id: 'updated-' + task, header: {}, events: [], append(type, data) { const event = { type, data, seq: this.events.length + 1 }; this.events.push(event); return event } }
  const runner = createBackgroundAgentRunner({
    resolveStablePrefixRevision: async () => revision, resolveStablePrefix: async () => { backgroundReads++; return background },
    agents: { get: () => ({ session: { header: {} } }), async create(options) {
      await options.setup({ systemPrompt: { section(value) { sections.push(value) }, suppressRuntimeContext() {} }, tools: { restrict() {}, register() {} }, on(event, callback) { if (event === 'system-prompt/assemble') assemble = callback } })
      return { agent: { session, followup() { pending = (async () => {
        const result = await assemble({}, { agent: { session } }, async () => ({ sections: [], tools: [] }))
        seen.push(completeSystem(sections))
        session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } })
      })() }, async whenIdle() { await pending } }, async dispose() {} }
    } }
  })
  try {
    for (const version of [0, 1, 1]) {
      revision = version; background = version ? '已确认的新版设定' : '开局人物设定'
      await runner.run({ sessionId: 'parent', persistent: true, task, selection: { provider: 'test', model: 'fake' }, messages: [], tools: [] })
    }
    assert.match(seen[0], /开局人物设定/)
    assert.doesNotMatch(seen[1], /开局人物设定/)
    assert.match(seen[1], /已确认的新版设定/)
    assert.equal(seen[1], seen[2])
    assert.equal(session.events.filter(e => e.data?.id === 'tavern-session-prefix:' + session.id + ':revision-1').length, 1)
    assert.equal(backgroundReads, 2, 'unchanged revision reuses the saved background')
  } finally { await runner.dispose() }
})

test('插件结算工具：随后台会话固定注册，只在结算任务里可调用，说明附在本轮任务后', async () => {
  const registered = new Map(), texts = [], results = []
  const pluginCalls = []
  let work = Promise.resolve(), script = async () => {}
  const pluginSettlement = {
    tools: () => [{ name: 'anchor_submit', description: '提交锚点', parameters: { type: 'object' }, countsTowardLimit: false }],
    has: name => name === 'anchor_submit',
    toolNames: async () => ({ available: ['anchor_submit'], unavailable: ['old_tool'] }),
    sections: async ({ gameId, turn }) => [{ text: gameId + ' 第 ' + turn + ' 轮记录锚点' }],
    calls: context => async (name, args) => { pluginCalls.push([context, name, args]); return JSON.stringify({ ok: true }) }
  }
  const runner = createBackgroundAgentRunner({
    id: () => 'background-plugin-tools',
    backgroundTools: [{ name: 'posture_submit', parameters: { type: 'object' } }, { name: 'candidate_submit', parameters: { type: 'object' } }],
    pluginSettlement: () => pluginSettlement,
    pluginCandidate: () => ({ sections: async ({ gameId }) => [{ text: gameId + ' 候选多给探索选项' }] }),
    agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        await options.setup({
          systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {},
          tools: { restrict() {}, register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } }
        })
        const session = { id: 'background-plugin-tools', events: [], append(type, data) { this.events.push({ type, data }) } }
        return { agent: { session,
          followup(message) { texts.push(message.content[0].text); work = (async () => { await script(); session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } }) })() },
          async whenIdle() { await work } }, async dispose() {} }
      }
    }
  })
  try {
    let submitted = false
    script = async () => {
      results.push(await registered.get('anchor_submit').execute({ text: '门' }))
      results.push(await registered.get('posture_submit').execute({}))
      results.push(await registered.get('anchor_submit').execute({ text: '迟到' }))
    }
    await runner.run({ sessionId: 'parent', persistent: true, task: 'settlement', turn: 4, selection: { provider: 'test', model: 'test' },
      messages: [], tools: [{ name: 'posture_submit', parameters: { type: 'object' } }],
      stopToolsWhen: () => submitted, acceptWithoutText: () => submitted,
      onToolCall: async call => { if (call.name === 'posture_submit') submitted = true; return JSON.stringify({ ok: true }) } })
    assert.ok(registered.has('anchor_submit'), 'plugin tools sit in the fixed tool list')
    assert.deepEqual(pluginCalls, [[{ gameId: 'parent', turn: 4 }, 'anchor_submit', { text: '门' }]])
    assert.match(results[2], /提交结算之前/, 'after the final submission a plugin tool is refused')
    assert.match(texts[0], /【插件附加的结算任务】[\s\S]*本轮可用插件工具：anchor_submit。以本轮列出的为准[\s\S]*parent 第 4 轮记录锚点/)
    assert.match(texts[0], /本轮不可用的插件工具（玩家在本局关闭了对应插件）：old_tool。本轮不要调用/)

    script = async () => { results.push(await registered.get('anchor_submit').execute({ text: '候选里' })) }
    await runner.run({ sessionId: 'parent', persistent: true, task: 'candidate', selection: { provider: 'test', model: 'test' },
      messages: [], tools: [{ name: 'candidate_submit', parameters: { type: 'object' } }], onToolCall: async () => '{}' })
    assert.match(results.at(-1), /不允许调用 anchor_submit/)
    assert.equal(pluginCalls.length, 1)
    assert.doesNotMatch(texts[1], /插件附加的结算任务/)
    assert.match(texts[1], /【插件附加的候选要求】[\s\S]*parent 候选多给探索选项/)
  } finally { await runner.dispose() }
})
