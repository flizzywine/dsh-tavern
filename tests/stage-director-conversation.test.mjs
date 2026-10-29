import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { createStageDirectorStream } from '../tavern-plugin/lib/domain/stage-director-stream.js'
import { stageDirectorFixture } from './helpers/stage-director-fixture.mjs'

const text = 'One.\nTwo.\nThree.\nFour.\nFive.\nSix.\nSeven.'

async function fixture() {
  const sessions = [], traces = [], errors = []
  let current, pending, started
  const runner = createBackgroundAgentRunner({ id: () => 'director-' + (sessions.length + 1),
    agents: { get: () => ({ id: 'game', session: { header: {} } }), async create(options) {
      const tools = new Map()
      await options.setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {},
        tools: { restrict() {}, register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } })
      const session = { id: options.sessionId, events: [], disposed: false, append(type, data) { this.events.push({ type, data }) } }
      sessions.push(session)
      let work
      return { agent: { session, followup(message) {
        const { first, ...seal } = JSON.parse(current.turnContext).window
        session.append('user/message', { message })
        work = (async () => {
          assert.deepEqual(JSON.parse(await tools.get('stage_update').execute(seal)), { ok: true })
          session.append('assistant/message', { message: { content: [{ type: 'text', text: 'Accepted.' }] } })
        })()
      }, async whenIdle() { await work } }, async dispose() { session.disposed = true } }
    } } })
  const h = await stageDirectorFixture({ id: 'story', sessionId: 'game', mode: 'story', timeline: {
    branchId: 'branch', revision: 1, operations: { body: { id: 'body', status: 'running', turn: 2 } }
  }, messages: [{ role: 'assistant', turn: 1, text: 'Opening.' }] }, { cast: [] }, {
    runAgent: input => { current = input; pending = runner.run(input).then(result => { traces.push(result.traceSessionId); return result }); started(); return pending }
  })
  const stream = createStageDirectorStream({ director: h.director, openConversation: () => runner.conversation(),
    source: async () => { const chat = await h.read(); return { chatId: chat.id, operationId: chat.timeline.operations.body.id,
      status: chat.timeline.operations.body.status, branchId: chat.timeline.branchId, revision: chat.timeline.revision } },
    catalog: async () => h.assets, warn: error => errors.push(error) })
  async function first(turn = 2) {
    const observer = await stream.begin('game', turn)
    const ready = new Promise(resolve => { started = resolve })
    observer.append(text)
    await ready
    await pending
    return observer
  }
  async function finish(turn = 2) {
    await h.persistence.update('story', chat => {
      chat.messages.push({ role: 'assistant', turn, text }); chat.timeline.revision++
      chat.timeline.operations.body.status = 'completed'
      chat.timeline.operations[chat.timeline.operations.body.id] = chat.timeline.operations.body; return chat
    })
    await stream.finish(await h.body())
    assert.deepEqual(errors, [])
  }
  async function start(id, turn) {
    await h.persistence.update('story', chat => {
      chat.timeline.operations.body = { id, turn, status: 'running' }; return chat
    })
  }
  return { ...h, sessions, traces, first, finish, start, async dispose() { stream.dispose(); await runner.dispose() } }
}

test('two windows continue one native director session and retain its accepted history', async () => {
  const h = await fixture()
  try {
    await h.first()
    assert.equal(h.sessions.length, 1)
    assert.equal(h.sessions[0].disposed, false)
    await h.finish()
    assert.equal(h.sessions.length, 1)
    assert.deepEqual(h.traces, ['director-1', 'director-1'])
    assert.deepEqual(h.sessions[0].events.filter(event => event.type.endsWith('/message')).map(event => event.type),
      ['user/message', 'assistant/message', 'user/message', 'assistant/message'])
    assert.equal(h.sessions[0].disposed, true)
  } finally { await h.dispose() }
})

test('regenerating a round closes its old director and starts a new session', async () => {
  const h = await fixture()
  try {
    await h.first()
    await h.start('regenerated-2', 2)
    await h.first()
    await h.finish()
    assert.equal(h.sessions.length, 2)
    assert.deepEqual(h.traces, ['director-1', 'director-2', 'director-2'])
    assert.ok(h.sessions.every(session => session.disposed))
  } finally { await h.dispose() }
})

test('the next round starts a new director session instead of accumulating cross-round history', async () => {
  const h = await fixture()
  try {
    await h.first(); await h.finish()
    await h.start('operation-3', 3)
    await h.first(3); await h.finish(3)
    assert.equal(h.sessions.length, 2)
    assert.deepEqual(h.traces, ['director-1', 'director-1', 'director-2', 'director-2'])
    assert.ok(h.sessions.every(session => session.disposed))
  } finally { await h.dispose() }
})
