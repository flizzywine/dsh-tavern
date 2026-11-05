import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundAgentSessions } from '../tavern-plugin/lib/background-agent-sessions.js'

// A resident Agent is reused across tasks. DSH 0.2.2 no longer reads the mutable
// selection passed to installModelSelection, so each reuse must record the new
// selection on the Agent before its next step is prepared.
function harness(t, { modern = true } = {}) {
  let sequence = 0
  const agents = new Map(), selections = []
  const parent = { id: 'game', session: { header: {}, events: [], append() {} } }
  const runner = createBackgroundAgentSessions({
    id: () => `child-${++sequence}`,
    agents: {
      get: id => id === 'game' ? parent : agents.get(id),
      create: async ({ sessionId }) => {
        const agent = {
          session: { id: sessionId, header: {}, events: [], append(type, data) { this.events.push({ type, data }) } },
          ...(modern ? { model: { select: selection => selections.push(selection) } } : {})
        }
        agents.set(sessionId, agent)
        return { agent, async dispose() { agents.delete(sessionId) } }
      }
    }
  }, {
    setup: () => () => {},
    execute: async () => 'done'
  })
  t.after(() => runner.dispose())
  return { runner, agents, selections }
}

const base = { sessionId: 'game', task: 'settlement', persistent: true, selection: { provider: 'test', model: 'a' } }

test('DSH 0.2.2 常驻后台 Agent 复用时按新任务重设模型', async t => {
  const h = harness(t)
  assert.equal(await h.runner.run(base), 'done')
  assert.equal(await h.runner.run({ ...base, selection: { provider: 'test', model: 'b' } }), 'done')
  assert.equal(h.agents.size, 1, '同一个常驻 Agent 应被复用')
  assert.deepEqual(h.selections, [
    { provider: 'test', model: 'a' },
    { provider: 'test', model: 'b' }
  ])
})

test('DSH 0.2.1 宿主没有 AgentModel 时复用不报错', async t => {
  const h = harness(t, { modern: false })
  assert.equal(await h.runner.run(base), 'done')
  assert.equal(await h.runner.run({ ...base, selection: { provider: 'test', model: 'b' } }), 'done')
  assert.equal(h.agents.size, 1)
  assert.deepEqual(h.selections, [])
})
