import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function until(condition) {
  for (let n = 0; n < 100; n++) { if (condition()) return; await new Promise(resolve => setImmediate(resolve)) }
  throw new Error('Agent 未到达预期阶段')
}
function harness({ work = async () => {}, flush = async () => {}, dispose = async () => {} } = {}) {
  const children = new Map(), starts = [], calls = [], disposals = [], tools = new Map()
  let seq = 0
  const runner = createBackgroundAgentRunner({ id: () => 'child-' + ++seq, flushSession: flush,
    compactAgent: async agent => { calls.push(['compact', agent.session.id]); return { message: 'compacted' } },
    agents: {
      get(id) { if (id.startsWith('game-')) return { id, session: { header: {} } } },
      async create(options) {
        calls.push(['create', options.sessionId])
        const activeTools = new Map(); tools.set(options.sessionId, activeTools)
        await options.setup({ systemPrompt: { section() {}, variable() {}, suppressRuntimeContext() {} },
          tools: { restrict() {}, register(definition) { activeTools.set(definition.name, definition); return () => activeTools.delete(definition.name) } }, on() {} })
        const session = { id: options.sessionId, header: options.meta, events: [], append(type, data) { this.events.push({ type, data }) } }
        let idle = Promise.resolve(), cancellation
        const child = { session,
          followup(message) {
            const call = { id: session.id, text: message.content[0].text, tools: [...activeTools.keys()] }; starts.push(call)
            cancellation = deferred()
            idle = Promise.race([work(call), cancellation.promise]).then(() => { session.append('assistant/message', { message: { content: [{ type: 'text', text: '完成 ' + starts.length }] } }) })
          },
          whenIdle: () => idle,
          cancel() { calls.push(['cancel', session.id]); cancellation?.resolve() }
        }
        children.set(session.id, child)
        return { agent: child, async dispose() { disposals.push(session.id); await dispose(session) } }
      }
    }
  })
  const input = (extra = {}) => ({ sessionId: 'game-a', task: 'candidate', persistent: true,
    selection: { provider: 'test', model: 'scripted' }, system: '任务规则', messages: [], tools: [], ...extra })
  return { runner, input, calls, starts, tools, children, disposals }
}

test('同游戏任务串行、不同游戏可独立执行；失败后下一任务复用会话且不继承旧工具', async t => {
  const gate = deferred()
  const h = harness({ work: call => call.text.includes('第一任务') ? gate.promise : Promise.resolve() })
  t.after(() => h.runner.dispose())
  const first = h.runner.run(h.input({ turnContext: '第一任务', tools: [{ name: 'first-tool', parameters: {} }], onToolCall: async () => '{}' }))
  const failure = assert.rejects(first, error => error.message.includes('第一任务失败') && error.traceSessionId === 'child-1')
  await until(() => h.starts.length === 1)
  const second = h.runner.run(h.input({ task: 'settlement', turnContext: '第二任务' }))
  const other = await h.runner.run(h.input({ sessionId: 'game-b', turnContext: '其他游戏' }))
  assert.equal(h.starts.length, 2)
  assert.notEqual(other.traceSessionId, 'child-1')
  await assert.rejects(h.runner.compact({ sessionId: 'child-1' }), /正在执行任务/)
  gate.reject(new Error('第一任务失败'))
  await failure
  const result = await second
  assert.equal(result.traceSessionId, 'child-1')
  assert.deepEqual(h.starts[2].tools, [])
  assert.equal(h.tools.get('child-1').size, 0)
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 2)
  assert.equal(h.disposals.length, 0)
  assert.equal(h.runner.requestContext('child-1').task, 'settlement')
  assert.equal(h.runner.requestSession('child-1'), h.children.get('child-1').session)
  assert.deepEqual(await h.runner.compact({ sessionId: 'child-1' }), { message: 'compacted' })
})

test('一次性任务取消后释放Agent、工具与请求上下文，不污染下次执行', async t => {
  const gate = deferred(), controller = new AbortController()
  const h = harness({ work: call => call.text.includes('取消任务') ? gate.promise : Promise.resolve() })
  t.after(() => h.runner.dispose())
  const task = h.runner.run(h.input({ persistent: false, turnContext: '取消任务', signal: controller.signal,
    tools: [{ name: 'temporary', parameters: {} }], onToolCall: async () => '{}' }))
  const rejection = assert.rejects(task, error => error.traceSessionId === 'child-1')
  await until(() => h.starts.length === 1)
  assert.equal(h.runner.owns('child-1'), true)
  controller.abort()
  await rejection
  assert.equal(h.runner.owns('child-1'), false)
  assert.equal(h.runner.requestContext('child-1'), null)
  assert.equal(h.runner.requestSession('child-1'), null)
  assert.equal(h.tools.get('child-1').size, 0)
  assert.deepEqual(h.disposals, ['child-1'])
  assert.equal((await h.runner.run(h.input({ persistent: false }))).traceSessionId, 'child-2')
})

test('会话保存失败不发布编号或执行模型；重试复用同一常驻会话，工具已撤下', async t => {
  let fail = true, published = 0
  const h = harness({ flush: async () => { if (fail) throw new Error('disk unavailable') } })
  t.after(() => h.runner.dispose())
  const input = h.input({ onPersistentSessionReady: async () => { published++ }, tools: [{ name: 'save-tool', parameters: {} }] })
  await assert.rejects(h.runner.run(input), /disk unavailable/)
  assert.equal(published, 0); assert.equal(h.starts.length, 0)
  assert.equal(h.tools.get('child-1').size, 0)
  fail = false
  assert.equal((await h.runner.run(input)).traceSessionId, 'child-1')
  assert.equal(published, 1); assert.equal(h.calls.filter(call => call[0] === 'create').length, 1)
})

test('释放所有常驻会话时汇总错误并清空所有权，可重复释放', async () => {
  const h = harness({ dispose: async session => { if (session.id === 'child-1') throw new Error('dispose failure') } })
  await h.runner.run(h.input())
  await h.runner.run(h.input({ sessionId: 'game-b' }))
  await assert.rejects(h.runner.dispose(), AggregateError)
  assert.deepEqual(h.disposals.sort(), ['child-1', 'child-2'])
  assert.equal(h.runner.owns('child-1'), false); assert.equal(h.runner.owns('child-2'), false)
  assert.equal(h.runner.requestContext('child-2'), null)
  await h.runner.dispose()
  assert.equal(h.disposals.length, 2)
})

test('公共Runner缺少宿主时保留原有错误', () => {
  for (const input of [undefined, null, {}]) assert.throws(() => createBackgroundAgentRunner(input), /缺少 DSH Agent 运行环境/)
})
