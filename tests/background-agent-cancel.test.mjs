import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundAgentSessions } from '../tavern-plugin/lib/background-agent-sessions.js'

// Runs that wait until their agent is cancelled; `cancelled` lists the tasks whose agent was.
function harness(t) {
  let sequence = 0
  const agents = new Map(), cancelled = [], started = new Map()
  const runner = createBackgroundAgentSessions({
    id: () => `child-${++sequence}`,
    agents: {
      get: id => id === 'game' ? { id, session: { header: {} } } : agents.get(id),
      create: async ({ sessionId }) => {
        let stop
        const stopped = new Promise(resolve => { stop = resolve })
        const agent = { session: { id: sessionId, header: {}, events: [], append(type, data) { this.events.push({ type, data }) } }, stopped, stop,
          cancel() { cancelled.push(agent.task); stop() } }
        agents.set(sessionId, agent)
        return { agent, async dispose() { agents.delete(sessionId) } }
      }
    }
  }, {
    setup: () => () => {},
    execute: async ({ agent }, input) => {
      agent.task = input.task
      started.get(input.task)?.(agent)
      await agent.stopped
      return input.task
    }
  })
  t.after(() => runner.dispose())
  // Resolves once the run is inside its model turn, with its agent and the run itself.
  async function start(task) {
    const ready = new Promise(resolve => started.set(task, resolve))
    const run = runner.run({ sessionId: 'game', task, persistent: false, selection: { provider: 'test', model: 'test' } })
    run.catch(() => {})
    return { agent: await ready, run }
  }
  return { runner, cancelled, start }
}

test('停止选项与打断回合只停自己的任务；不带任务时停掉除手机外的全部', async t => {
  const h = harness(t)
  const runs = []
  for (const task of ['candidate', 'stage-director', 'polish', 'phone']) runs.push(await h.start(task))
  assert.equal(h.runner.cancel('game', { task: 'candidate' }), 1)
  assert.deepEqual(h.cancelled, ['candidate'])
  assert.equal(h.runner.cancel('game', { task: 'stage-director' }), 1)
  assert.deepEqual(h.cancelled, ['candidate', 'stage-director'])
  // Stopped runs end first; then the rest of the game but the phone.
  await Promise.allSettled([runs[0].run, runs[1].run])
  assert.equal(h.runner.cancel('game'), 1)
  assert.deepEqual(h.cancelled, ['candidate', 'stage-director', 'polish'])
  runs[3].agent.stop()
  await Promise.allSettled(runs.map(item => item.run))
})
