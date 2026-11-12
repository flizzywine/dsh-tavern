import { createSettlementItems } from '../tavern-plugin/lib/domain/background-pipeline.js'

import assert from 'node:assert/strict'
import test from 'node:test'

// Match DSH's final complete-section restoration, after middleware runs.
function completeSystem(sections) {
  return sections.filter(s => s.complete).map(s => typeof s.text === 'function' ? s.text() : s.text).join('\n')
}

import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
test('candidate and settlement reject terminal failure even after text and a tool submission', async () => {
  for (const task of ['candidate','settlement']) for (const reason of [{kind:'error',error:{message:'transport failed'}},{kind:'aborted',reason:{kind:'user'}}]) {
    const registered = new Map()
    let work, submitted = false
    const session = {id:'failed-background',events:[],append(type,data){this.events.push({type,data})}}
    const runner = createBackgroundAgentRunner({id:()=>session.id,agents:{
      get:()=>({session:{header:{}}}),
      async create(options){
        await options.setup({systemPrompt:{section(){},suppressRuntimeContext(){}},on(){},tools:{restrict(){},register(tool){registered.set(tool.name,tool)}}})
        return {agent:{session,followup(){work=(async()=>{
          await registered.get('submit_result').execute({})
          session.append('assistant/message',{message:{content:[{type:'text',text:'partial result'}]}})
          session.append('turn/end',{reason})
        })()},async whenIdle(){await work}},async dispose(){}}
      }
    }})
    try {
      await assert.rejects(runner.run({sessionId:'parent',task,selection:{provider:'test',model:'fake'},messages:[],
        tools:[{name:'submit_result',parameters:{type:'object'}}],onToolCall:async()=>{submitted=true;return '{}'},acceptWithoutText:()=>submitted
      }), /transport failed|已中断/)
      assert.equal(submitted,true)
    } finally {await runner.dispose()}
  }
})

import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'

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
  assert.equal(result.traceBoundary, rewindFails ? 7 : 12)
  assert.equal(resumeCalls, 1)
  assert.equal(createCalls, 0)
  if (rewindFails) { assert.equal(appendCalls.length, 0); return }
  // The replacement lands after the closed turn, so the rewind opens a turn for
  // it and closes it again: released V4 reads the replacement at the log tail.
  assert.deepEqual(appendCalls.map(call => call.type), ['turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end'])
  const written = appendCalls.find(call => call.type === 'assistant/message')
  assert.deepEqual(written.data.message.content, [])
  assert.deepEqual(written.options.surfaceOp, { op: 'replace', start: 3, end: 4 })
  assert.deepEqual(written.options.sourceEventSeqs, [3, 4])
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

// internal cancellation must keep skipping the parallel director.
for (const task of ['settlement', 'stage-director']) test('manual stop cancels only the selected game/task: ' + task, async () => {
  let ready, finish, cancelled = 0;
  const started = new Promise(resolve => { ready = resolve; });
  const idle = new Promise(resolve => { finish = resolve; });
  const session = { id: 'stop-background', header: {}, events: [], append(type, data) { this.events.push({ type, data }); } };
  const runner = createBackgroundAgentRunner({ parallelTasks: ['stage-director'], id: () => session.id, agents: {
    get: () => ({ session: { header: {} } }),
    async create(options) {
      await options.setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {}, tools: { presentAs() {}, restrict() {}, register() { return () => {}; } } });
      return { agent: { session, followup() { ready(); }, whenIdle: () => idle,
        cancel(reason) { assert.equal(reason.kind, 'user'); cancelled++; finish(); }
      }, async dispose() {} };
    }
  } });
  const run = runner.run({ sessionId: 'game', persistent: true, task, selection: { provider: 'fake', model: 'fake' }, messages: [{role:'user',content:[{type:'text',text:'test'}]}], tools: task === 'stage-director' ? [{name:'submit_direction',parameters:{type:'object'}}] : [] });
  const rejected = assert.rejects(run);
  await Promise.race([started, run]);
  assert.equal(runner.cancel('other-game', {task}), 0);
  if (task === 'stage-director') {
    assert.equal(runner.cancel('game'), 0);
    assert.equal(cancelled, 0);
    assert.equal(runner.cancel('game', {task}), 1);
  } else assert.equal(runner.cancel('game'), 1);
  await rejected;
  assert.equal(cancelled, 1);
  assert.equal(runner.cancel('game'), 0);
  await runner.dispose();
});
for (const task of ['settlement']) test(task + ' 已有会话在明确更新人物卡后切换背景', async () => {
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

// same real runner with a stable catalogue, director and candidate controls.
test('stage-director isolates native tools/persona and preserves correction history; candidate stays unchanged', async () => {
  for (const task of ['stage-director', 'candidate']) {
    const director = task === 'stage-director'
    const registered = new Map(), sections = [], hooks = new Map(), followed = [], restrictions = [], modes = [], usages = []
    let mounted = 0, prefixes = 0, worldbooks = 0, appended = 0, concluded = 0, calls = 0
    const session = { id: 'isolated-' + task, header: {}, events: [], append(type, data) { this.events.push({ type, data }) } }
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Completed reply data' }] }]
    const tool = { name: 'submit_direction', parameters: { type: 'object' } }
    const runner = createBackgroundAgentRunner({
      id: () => session.id,
      setupAgent: () => mounted++, systemAppend: () => { appended++; return 'GLOBAL APPEND' },
      backgroundTools: [{ name: 'posture_submit', parameters: { type: 'object' } }],
      resolveStablePrefix: () => { prefixes++; return 'FIXED PREFIX' },
      resolveCurrentWorldbook: () => { worldbooks++; return 'WORLDBOOK' },
      agents: {
        get: () => ({ id: 'parent', session: { header: {} } }),
        async create(options) {
          await options.setup({
            on(event, hook) { const list = hooks.get(event) || []; list.push(hook); hooks.set(event, list) },
            systemPrompt: { section(section) { sections.push(section) }, suppressRuntimeContext() {} },
            tools: { presentAs(mode) { modes.push(mode) }, restrict(input) { restrictions.push(input.allow) }, register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } }
          })
          async function request(base) {
            const list = hooks.get('agent/request') || []
            const invoke = i => i === list.length ? base : list[i]({}, () => invoke(i + 1))
            return invoke(0)
          }
          return { agent: {
            session, followup(message) { followed.push(message) },
            async whenIdle() {
              if (director) {
                assert.deepEqual([...registered.keys()], ['submit_direction'])
                const history = [{ role: 'user', content: messages[0].content }]
                const first = await request({ tools: [tool], messages: history })
                assert.equal(first.messages, history)
                let feedback
                await assert.rejects(registered.get('submit_direction').execute({ beats: 'bad' }, { concludeTurn() { concluded++ } }), error => {
                  feedback = error.message
                  assert.equal(JSON.parse(feedback).errors[0].message, 'Fix beats[0]')
                  return true
                })
                assert.equal(concluded, 0)
                history.push({ role: 'assistant', content: [{ type: 'tool-call', name: 'submit_direction', id: 'call-1', arguments: { beats: 'bad' } }] }, { role: 'tool', content: [{ type: 'text', text: feedback }] })
                const second = await request({ tools: [tool], messages: history })
                assert.equal(second.messages, history, 'no correction history replacement/filtering')
                const streamGuard = (payload, next) => {
                  const list = hooks.get('llm/stream') || []
                  const invoke = i => i === list.length ? next() : list[i](payload, () => invoke(i + 1))
                  return invoke(0)
                }
                assert.throws(() => streamGuard({ sessionId: session.id, tools: [tool, { name: 'skill' }] }, () => {}), /only submit_direction/)
                streamGuard({ sessionId: session.id, tools: [tool] }, () => {})
                await registered.get('submit_direction').execute({ beats: [] }, { concludeTurn() { concluded++ } })
                assert.equal(concluded, 1)
                // tool-only settlements still expose the provider's disjoint usage buckets.
                session.append('assistant/message', { message: { content: [] }, usage: { inputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 30 } })
              } else {
                assert.deepEqual([...registered.keys()], ['posture_submit'])
                const tools = [{ name: 'skill' }, { name: 'posture_submit' }]
                assert.deepEqual((await request({ tools })).tools, tools)
                session.append('assistant/message', { message: { content: [{ type: 'text', text: 'candidate text' }] } })
              }
            }
          }, async dispose() {} }
        }
      }
    })
    try {
      const result = await runner.run({ sessionId: 'parent', task, persistent: false, selection: { provider: 'test', model: 'fake' },
        system: 'DIRECTOR COMPLETE PERSONA', messages, tools: [tool], maxToolCalls: 3, onProviderUsage: usage => usages.push(usage),
        onToolCall: () => JSON.stringify(++calls === 1 ? {ok:false,retryable:true,errors:[{message:'Fix beats[0]'}]} : {ok:true}), stopToolsWhen: () => calls === 2, acceptWithoutText: () => calls > 0 })
      const system = completeSystem(sections)
      assert.deepEqual(usages, director ? [{ inputTokens: 330, cacheHitTokens: 200 }] : [])
      if (director) {
        assert.equal(result.text, '')
        assert.equal(system, 'DIRECTOR COMPLETE PERSONA')
        assert.equal(mounted, 1, 'the preset mount is still required for DSH agent wiring')
        assert.equal(prefixes + worldbooks + appended, 0)
        assert.deepEqual(modes, ['native'])
        assert.deepEqual(restrictions, [[]])
        // DSH session listeners require a message source (a missing one broke the live run).
        assert.deepEqual(followed.map(({ id, ...message }) => message), messages.map(message => ({ ...message, source: { kind: 'plugin:dsh-tavern' } })))
      } else {
        assert.equal(result.text, 'candidate text')
        assert.equal(mounted, 1)
        assert.equal(prefixes, 1)
        assert.equal(worldbooks, 1)
        assert.match(system, /GLOBAL APPEND/)
        assert.notEqual(system, 'DIRECTOR COMPLETE PERSONA')
        assert.deepEqual(modes, [])
        assert.deepEqual(restrictions, [['skill', 'read', 'worldbook_list', 'worldbook_grep', 'tavern_read_skill_reference', 'web_search']])
        assert.match(followed[0].content[0].text, /DIRECTOR COMPLETE PERSONA/)
      }
    } finally { await runner.dispose() }
  }
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
    settlementItems: () => createSettlementItems({ plugins: () => pluginSettlement }),
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
    assert.match(texts[0], /## Plugin settlement tasks[\s\S]*Plugin tools available this turn: anchor_submit\. This list is current[\s\S]*parent 第 4 轮记录锚点/)
    assert.match(texts[0], /Plugin tools unavailable this turn \(the player turned off their plugins for this game\): old_tool\. Don't call them this turn\./)

    script = async () => { results.push(await registered.get('anchor_submit').execute({ text: '候选里' })) }
    await runner.run({ sessionId: 'parent', persistent: true, task: 'candidate', selection: { provider: 'test', model: 'test' },
      messages: [], tools: [{ name: 'candidate_submit', parameters: { type: 'object' } }], onToolCall: async () => '{}' })
    assert.match(results.at(-1), /不允许调用 anchor_submit/)
    assert.equal(pluginCalls.length, 1)
    assert.doesNotMatch(texts[1], /Plugin settlement tasks/)
    assert.match(texts[1], /【插件附加的候选要求】[\s\S]*parent 候选多给探索选项/)
  } finally { await runner.dispose() }
})

test('插件后台任务：独立的一次性会话，插件工具注册在这个会话里并交给插件执行，结束后撤销', async () => {
  const registered = new Map(), texts = [], results = [], created = []
  let work = Promise.resolve(), script = async () => {}
  const runner = createBackgroundAgentRunner({
    id: () => 'plugin-task-' + created.length,
    backgroundTools: [{ name: 'posture_submit', parameters: { type: 'object' } }],
    agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        created.push(options)
        await options.setup({
          systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {},
          tools: { restrict() {}, register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } }
        })
        const session = { id: 'plugin-task', events: [], append(type, data) { this.events.push({ type, data }) } }
        return { agent: { session,
          followup(message) { texts.push(message.content[0].text); work = (async () => { await script(); session.append('assistant/message', { message: { content: [{ type: 'text', text: '推演完成' }] } }) })() },
          async whenIdle() { await work } }, async dispose() {} }
      }
    }
  })
  try {
    const calls = []
    script = async () => {
      results.push(await registered.get('world_advance').execute({ days: 15 }))
      results.push(await registered.get('posture_submit').execute({}))
    }
    const result = await runner.run({ sessionId: 'parent', persistent: false, task: 'plugin', pluginName: 'world-sim', selection: { provider: 'test', model: 'test' },
      system: '按日期推进世界', messages: [], tools: [{ name: 'world_advance', description: '推进', parameters: { type: 'object' } }],
      onToolCall: async call => { calls.push(call); return JSON.stringify({ ok: true }) } })
    assert.equal(result.text, '推演完成')
    assert.deepEqual(calls, [{ name: 'world_advance', arguments: { days: 15 } }])
    assert.match(results[1], /不允许调用 posture_submit/)
    assert.match(texts[0], /任务类型：插件任务[\s\S]*【任务要求】\n按日期推进世界/)
    assert.equal(registered.has('world_advance'), false, '任务结束后撤销插件工具')

    // A model that keeps calling a tool this task refuses is stopped, not left to loop until the timeout.
    let concluded = 0
    script = async () => { for (let index = 0; index < 20; index++) results.push(await registered.get('posture_submit').execute({}, { concludeTurn() { concluded++ } })) }
    results.length = 0
    await runner.run({ sessionId: 'parent', persistent: false, task: 'plugin', pluginName: 'world-sim', selection: { provider: 'test', model: 'test' },
      system: '按日期推进世界', messages: [], tools: [{ name: 'world_advance', description: '推进', parameters: { type: 'object' } }], maxToolCalls: 3, onToolCall: async () => '{}' })
    assert.match(results[2], /不允许调用/)
    assert.match(results[3], /多次调用了当前任务不允许的工具，本轮结束/)
    assert.ok(concluded >= 1)
  } finally { await runner.dispose() }
})
