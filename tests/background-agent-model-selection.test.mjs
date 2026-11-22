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

test('DSH 0.2.1 宿主没有 AgentModel 时复用不报错', async t => {
  const h = harness(t, { modern: false })
  assert.equal(await h.runner.run(base), 'done')
  assert.equal(await h.runner.run({ ...base, selection: { provider: 'test', model: 'b' } }), 'done')
  assert.equal(h.agents.size, 1)
  assert.deepEqual(h.selections, [])
})

test('持久后台会话校验失败（stored session failed validation）时自动放弃并重建干净会话', async t => {
  let sequence = 0
  const resumedIds = []
  const createdIds = []
  const agents = new Map()
  const parent = { id: 'game', session: { header: {}, events: [], append() {} } }
  const runner = createBackgroundAgentSessions({
    id: () => `background-fresh-${++sequence}`,
    agents: {
      get: id => id === 'game' ? parent : agents.get(id),
      resume: async ({ resumeSessionId }) => {
        resumedIds.push(resumeSessionId)
        throw new Error(`stored session "${resumeSessionId}" failed validation: Error: session event at seq 16 message must have role "user"`)
      },
      create: async ({ sessionId }) => {
        createdIds.push(sessionId)
        const agent = {
          session: { id: sessionId, header: { id: sessionId }, events: [], append(type, data) { this.events.push({ type, data }) } }
        }
        agents.set(sessionId, agent)
        return { agent, async dispose() { agents.delete(sessionId) } }
      }
    }
  }, {
    setup: () => () => {},
    execute: async ({ traceSessionId }) => ({ ok: true, traceSessionId })
  })
  t.after(() => runner.dispose())

  const first = await runner.run({ ...base, persistentSessionId: 'background-corrupted-1' })
  assert.equal(first.ok, true)
  assert.equal(first.traceSessionId, 'background-fresh-1')
  assert.deepEqual(resumedIds, ['background-corrupted-1'])
  assert.deepEqual(createdIds, ['background-fresh-1'])

  // 即使上游仍传入旧的损坏 ID，也不应再反复尝试 resume 它
  const second = await runner.run({ ...base, persistentSessionId: 'background-corrupted-1' })
  assert.equal(second.ok, true)
  assert.deepEqual(resumedIds, ['background-corrupted-1'])
})
