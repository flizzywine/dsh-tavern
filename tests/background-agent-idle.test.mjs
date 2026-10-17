import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundAgentSessions } from '../tavern-plugin/lib/background-agent-sessions.js'

function harness(t, extra = {}) {
  let time = 0, sequence = 0
  const disk = new Map(), live = new Map(), calls = []
  async function handle(id, session) {
    live.set(id, session)
    return { agent: { session }, async dispose() { calls.push(['dispose', id]); live.delete(id) } }
  }
  const runner = createBackgroundAgentSessions({
    now: () => time, residentIdleMs: 1000, maxResidentSessions: 2, id: () => `idle-${++sequence}`,
    agents: {
      get: id => id.startsWith('parent') ? { id, session: { header: {} } } : undefined,
      create: async ({ sessionId, meta }) => {
        calls.push(['create', sessionId])
        return handle(sessionId, { id: sessionId, header: meta, events: [], append(type, data) { this.events.push({ type, data }) } })
      },
      resume: async ({ resumeSessionId }) => {
        calls.push(['resume', resumeSessionId])
        const saved = structuredClone(disk.get(resumeSessionId))
        assert.ok(saved, 'release must persist before resume')
        return handle(resumeSessionId, { ...saved, append(type, data) { this.events.push({ type, data }) } })
      }
    },
    flushSession: async session => {
      await extra.flush?.()
      disk.set(session.id, structuredClone({ id: session.id, header: session.header, events: session.events }))
    },
    compactAgent: async () => extra.compact?.(),
    ...extra.options
  }, {
    setup: () => () => {},
    execute: async ({ agent, traceSessionId }, input) => {
      await extra.work?.(input)
      agent.session.append('system/message', { text: input.text || 'task' })
      return traceSessionId
    }
  })
  t.after(() => runner.dispose())
  return { runner, live, disk, calls, tick: n => { time += n }, run: (parent = 'parent-a', text) => runner.run({ sessionId: parent, task: 'candidate', persistent: true, selection: { provider: 'test', model: 'test' }, text }) }
}

test('failed persistence retains instance and backs off before retry', async t => {
  let fail = true, attempts = 0
  const h = harness(t, { flush: async () => { attempts++; if (fail) throw new Error('disk unavailable') } })
  const id = await h.run(); h.tick(1000)
  await h.runner.reapIdle(); assert.equal(h.runner.owns(id), true)
  await h.runner.reapIdle(); assert.equal(attempts, 1)
  fail = false; h.tick(60000); await h.runner.reapIdle()
  assert.equal(h.runner.owns(id), false); assert.equal(attempts, 2)
})
