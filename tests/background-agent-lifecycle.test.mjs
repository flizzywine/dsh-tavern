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
function harness({ work = async () => {}, flush = async () => {}, dispose = async () => {}, compactWork = async () => {}, needsNewBackgroundSession, resume, retirement } = {}) {
  const children = new Map(), starts = [], calls = [], disposals = [], tools = new Map()
  let seq = 0
  const runner = createBackgroundAgentRunner({ id: () => 'child-' + ++seq, flushSession: flush, needsNewBackgroundSession, retirement,
    compactAgent: async agent => { calls.push(['compact', agent.session.id]); await compactWork(); return { message: 'compacted' } },
    agents: {
      ...(resume ? { resume } : {}),
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

test('取消的持久后台会话记录退休状态，重新创建 runner 后也不再恢复它', async t => {
  const retired = new Map()
  const retirement = { retire: async (id, parentId) => retired.set(id, parentId), isRetired: async id => retired.has(id) }
  const controller = new AbortController(), gate = deferred()
  const h = harness({ retirement, work: () => gate.promise })
  t.after(async () => { gate.resolve(); await h.runner.dispose() })
  const running = h.runner.run(h.input({ signal: controller.signal }))
  const rejected = assert.rejects(running)
  await until(() => h.starts.length === 1)
  controller.abort(); await rejected
  assert.equal(retired.get('child-1'), 'game-a')
  // A fresh runner must consult durable retirement, not just its in-memory set.
  const fresh = harness({ retirement, resume: async () => { throw Error('retired session was resumed') } })
  t.after(() => fresh.runner.dispose())
  // Avoid fixture's intentionally repeated id generator colliding with the old id.
  retired.set('old-retired', 'game-a')
  const result = await fresh.runner.run(fresh.input({ persistentSessionId: 'old-retired' }))
  assert.notEqual(result.traceSessionId, 'old-retired')
})
