import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorldbookFilter, WORLD_BOOK_FILTER_TOOLS } from '../tavern-plugin/lib/domain/worldbook-filter.js'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'

const selection = { provider: 'test', model: 'scripted' }
const candidates = Array.from({ length: 6 }, (_, n) => ({ ref: 'entry:' + n, text: '候选资料' + n, tokenCost: 1100 }))

function harness(runnerOptions = {}) {
  let value = { id: 'game', sessionId: 'parent', mode: 'story', cardPath: 'card.json', messages: [], _storageRevision: 1 }
  const persistence = createChatPersistence({ data: {
    remove: async () => {},
    readJson: async () => structuredClone(value),
    updateJson: async (_path, update) => { value = await update(structuredClone(value)); return structuredClone(value) }
  } })
  const store = { readChat: () => persistence.read('game'), chatForSession: () => persistence.read('game'),
    writeChat: (chat, meta) => persistence.write(chat, meta), updateChat: (id, update, meta) => persistence.update(id, update, meta),
    readCard: async () => ({ name: '测试人物' }) }
  let sequence = 0, fail = false, blocked = false, beforeSubmit = async () => {}
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + ++sequence })
  const tasks = createBackgroundTaskCoordinator({ store, timeline, blocked: () => blocked })
  const sessions = new Map(), created = [], resumed = [], calls = [], setupRuns = [], disposed = []
  async function handle(session, setup) {
    setupRuns.push(session.id)
    const tools = new Map()
    await setup({ systemPrompt: { section() {}, suppressRuntimeContext() {} }, on() {},
      tools: { restrict() {}, register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } })
    let work
    const agent = { session, followup(message) {
      calls.push({ sessionId: session.id, message, tools: [...tools.keys()] })
      session.append('user/message', message)
      work = (async () => {
        await beforeSubmit()
        if (fail) throw Error('模型失败')
        if (tools.has('worldbook_filter_submit')) await tools.get('worldbook_filter_submit').execute({ selected: ['entry:0'] })
        session.append('assistant/message', { message: { id: 'answer-' + session.events.length, role: 'assistant', content: [{ type: 'text', text: '完成' }], source: { kind: 'model', provider: 'test', model: 'scripted' } } })
      })()
    }, whenIdle: () => work }
    return { agent, dispose: async () => { disposed.push(session.id) } }
  }
  const agents = { get: id => id === 'parent' ? { id, session: { header: {} } } : undefined,
    async create(input) {
      created.push(input.sessionId)
      const session = { id: input.sessionId, header: input.meta, events: [], surface: { nodes: [] },
        append(type, data, meta = {}) {
          const seq = this.events.length
          this.events.push({ type, data, seq, ...meta })
          if (meta.surfaceOp?.op === 'replace') this.surface.nodes = this.surface.nodes.filter(n => n < meta.surfaceOp.start || n > meta.surfaceOp.end)
          if (type.endsWith('/message')) this.surface.nodes.push(seq)
        } }
      sessions.set(session.id, session)
      return handle(session, input.setup)
    },
    async resume(input) { resumed.push(input.resumeSessionId); return handle(sessions.get(input.resumeSessionId), input.setup) }
  }
  const makeRunner = () => createBackgroundAgentRunner({ ...runnerOptions, agents, id: () => 'background-' + ++sequence,
    needsNewBackgroundSession: async () => (await store.readChat()).timeline?.participants.background?.status === 'needs-session' })
  let runner = makeRunner()
  const filter = createWorldbookFilter({ selection: () => selection, runAgent: input => runner.run(input),
    beginTask: chat => tasks.begin(chat, 'worldbook-filter') })
  async function runTask(role) {
    const task = await tasks.begin(await store.readChat(), role)
    const result = await runner.run({ sessionId: 'parent', task: role, persistent: true, selection,
      persistentSessionId: task.participantRequest.sessionId, rewindTo: task.participantRequest.rewindTo,
      onPersistentSessionReady: id => task.bindSession(id), messages: [], tools: [] })
    await task.commit({ participant: task.participant(result) })
    return result
  }
  return { store, timeline, tasks, filter, runTask, sessions, created, resumed, calls, setupRuns, disposed,
    input: async () => ({ chat: await store.readChat(), userText: '查看资料', candidates }),
    fail: flag => { fail = flag }, block: flag => { blocked = flag }, beforeSubmit: callback => { beforeSubmit = callback },
    restart: async () => { await runner.dispose(); runner = makeRunner() }, dispose: () => runner.dispose() }
}

test('回退后筛选沿用后台 Session 并遮蔽废弃任务；压缩过也沿用同一个 Session，原地清空任务历史', async t => {
  for (const compacted of [false, true]) {
    const h = harness(); t.after(h.dispose)
    const initial = await h.filter(await h.input())
    const before = await h.store.readChat()
    const begun = h.timeline.apply({ chat: before, intent: { kind: 'body.begin', turn: 1, userText: '旧行动' } })
    await h.store.writeChat(h.timeline.complete({ chat: begun.chat, operationId: begun.value.operationId,
      basedOn: begun.value.basedOn, outcome: { status: 'success' } }).chat)
    await h.runTask('settlement')
    await h.filter({ ...await h.input(), userText: '即将废弃的行动' })
    if (compacted) await h.store.updateChat('game', chat => {
      chat.timeline.participants.background.requiresNewSessionOnRewind = true
      return chat
    })
    const rolled = h.timeline.apply({ chat: await h.store.readChat(), intent: { kind: 'turn.rollback', beforeChat: before } })
    await h.store.writeChat(rolled.chat)
    const result = await h.filter(await h.input())
    assert.deepEqual(Object.keys((await h.store.readChat()).timeline.participants), ['background'])
    assert.equal(result.traceSessionId, initial.traceSessionId)
    const session = h.sessions.get(initial.traceSessionId)
    assert.ok(session.events.some(event => event.surfaceOp?.op === 'replace'))
    assert.ok(!session.surface.nodes.some(seq => JSON.stringify(session.events[seq]).includes('即将废弃的行动')))
  }
})

for (const provider of ['dsh-tavern-background', 'dsh-tavern-background-tools-v1', 'dsh-tavern-background-tools-v2', 'dsh-tavern-background-tools-v3']) {
  test(`恢复 ${provider} 后重建的会话首轮保留筛选和共享工具`, async t => {
    const h = harness({
      backgroundTools: WORLD_BOOK_FILTER_TOOLS,
      sharedTools: [{
        tool: { name: 'worldbook_search', description: '搜索世界书', parameters: { type: 'object' } },
        allowDuringWorldbookFilter: true, execute: async () => '[]'
      }]
    })
    t.after(h.dispose)
    const first = await h.filter(await h.input())
    await h.restart()
    const old = h.sessions.get(first.traceSessionId)
    old.events.find(event => event.type === 'subagent/descriptor').data.provider = provider
    const setupStart = h.setupRuns.length
    const callStart = h.calls.length
    const disposeStart = h.disposed.length

    const filtered = await h.filter(await h.input())

    assert.notEqual(filtered.traceSessionId, first.traceSessionId)
    assert.deepEqual(h.setupRuns.slice(setupStart), [first.traceSessionId, filtered.traceSessionId])
    assert.deepEqual(h.disposed.slice(disposeStart), [first.traceSessionId])
    assert.equal(h.calls[callStart].sessionId, filtered.traceSessionId)
    assert.deepEqual(h.calls[callStart].tools, ['worldbook_candidate_read', 'worldbook_filter_submit', 'worldbook_search'])
    assert.deepEqual(filtered.selected, ['entry:0'])
    assert.equal((await h.store.readChat()).timeline.participants.background.sessionId, filtered.traceSessionId)
    assert.deepEqual(h.created, [first.traceSessionId, filtered.traceSessionId])
  })
}
