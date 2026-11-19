import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { HISTORY_RECALL_TOOL } from '../tavern-plugin/lib/domain/history-recall.js'

const anchor = { branchId: 'branch-a', turn: 5, textVersion: 'body-v2' }

function fixture({ worldbookSkillsEnabled, webSearchEnabled, enabled = true, sharedStream, readCapability, withHistory = false, onNormalRequest, prepareSharedContext, onRunFinished }) {
  const requests = [], hooks = new Map(), sections = [], registered = new Map()
  let creates = 0, disposed = 0, pending
  const session = { id: 'background', header: {}, events: [], surface: { nodes: [] }, append(type, data, intent) {
    const event = { type, data, seq: this.events.length + 1, ...intent }
    this.events.push(event)
    if (type.endsWith('/message')) this.surface.nodes.push(event.seq)
    return event
  } }
  const provider = async function* (request) {
    const { signal, ...packet } = request
    requests.push(structuredClone(packet))
    if (requests.length > 1 && sharedStream) { yield* sharedStream(request); return }
    yield { type: 'text-delta', index: 0, text: 'not JSON: boundary owns validation' }
    yield { type: 'usage', usage: { inputTokens: 123, outputTokens: 8 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  function stream(request) {
    const list = hooks.get('llm/stream') || []
    const next = i => i === list.length ? provider(request) : list[i](request, () => next(i + 1))
    return next(0)
  }
  const runner = createBackgroundAgentRunner({
    prepareSharedContext, onRunFinished,
    id: () => session.id,
    compactAgent: async () => ({ message: 'compacted' }),
    ...(enabled ? { resolveSharedTaskAnchor: () => anchor } : {}),
    ...(readCapability ? { resolveSharedReadTools: readCapability } : {}),
    ...(withHistory ? { sharedTools: [{ tool: HISTORY_RECALL_TOOL, execute: () => { throw new Error('previous task reader must not be inherited') } }] } : {}),
    resolveWorldbookSkills: () => worldbookSkillsEnabled,
    resolveWebSearch: () => webSearchEnabled,
    resolveStablePrefix: () => 'Fixed character background',
    resolveCurrentWorldbook: () => 'Current worldbook',
    backgroundTools: [{ name: 'posture_submit', parameters: { type: 'object' } }],
    agents: {
      get: () => ({ id: 'parent', session: { header: {} } }),
      async create(options) {
        creates++
        await options.setup({
          llm: { stream },
          on(name, callback) { const list = hooks.get(name) || []; list.push(callback); hooks.set(name, list) },
          systemPrompt: { section(value) { sections.push(value) }, suppressRuntimeContext() {} },
          tools: { restrict() {}, register(tool) { registered.set(tool.name, tool); return () => registered.delete(tool.name) } }
        })
        return { agent: { session,
          followup(message) {
            pending = (async () => {
              const toolNames = ['read', 'worldbook_list', 'worldbook_grep', 'web_search', 'web_fetch', ...registered.keys()]
              let assembly = { sections: [], tools: toolNames.map(name => {
                const tool = registered.get(name)
                return { name, ...(tool?.description ? { description: tool.description } : {}), parameters: tool?.parameters || { type: 'object' } }
              }) }
              for (const hook of hooks.get('system-prompt/assemble') || []) {
                const previous = assembly
                assembly = await hook({}, { agent: { session } }, async () => previous)
              }
              let config = { ...options.agentOptions }
              for (const hook of hooks.get('agent/request') || []) {
                const previous = config
                config = await hook({}, async () => previous)
              }
              const system = sections.filter(s => s.complete).map(s => typeof s.text === 'function' ? s.text() : s.text).join('\n')
              session.append('user/message', message)
              const messages = [{ id: 'system-1', role: 'system', content: [{ type: 'text', text: system }] }, message]
              const toolHistory = { tools: assembly.tools, updates: [] }
              if (onNormalRequest) await onNormalRequest(registered)
              for await (const chunk of stream({ ...config, sessionId: session.id, tools: assembly.tools, toolHistory, messages })) {
                if (chunk.type === 'text-delta') session.append('assistant/message', { message: { content: [{ type: 'text', text: chunk.text }] } })
              }
            })()
          }, async whenIdle() { await pending }
        }, async dispose() { disposed++ } }
      }
    }
  })
  const baseline = (overrides = {}) => runner.run({ sessionId: 'parent', persistent: true, task: 'settlement',
    selection: { provider: 'mock', model: 'model-a' }, system: 'Settlement instructions',
    messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Committed story' }] }], ...overrides
  })
  return { runner, baseline, requests, creates: () => creates, disposed: () => disposed }
}

for (const worldbookSkillsEnabled of [false, true]) for (const webSearchEnabled of [false, true]) {
  test(`shared request preserves DSH-shaped assembly: worldbook=${worldbookSkillsEnabled}, web=${webSearchEnabled}`, async t => {
    const f = fixture({ worldbookSkillsEnabled, webSearchEnabled })
    try {
      await f.baseline()
      const original = f.requests[0]
      const result = await f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'Return JSON text only.' })
      const appended = f.requests[1]
      assert.equal(JSON.stringify({ ...appended, messages: original.messages }), JSON.stringify(original))
      assert.equal(JSON.stringify(appended.messages.slice(0, -1)), JSON.stringify(original.messages))
      assert.equal(appended.messages.at(-1).content[0].text, 'Return JSON text only.')
      assert.equal(original.tools.some(tool => tool.name === 'read'), worldbookSkillsEnabled)
      assert.equal(original.tools.some(tool => tool.name === 'web_search'), webSearchEnabled)
      assert.equal(f.creates(), 1)
      assert.equal(result.output, 'not JSON: boundary owns validation')
      assert.deepEqual(result.usage, { inputTokens: 123, outputTokens: 8 })
      const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
      const system = original.messages.filter(message => message.role === 'system')
      assert.equal(Object.hasOwn(original, 'system'), false)
      assert.ok(system[0].content[0].text.length > 0)
      assert.deepEqual(appended.toolHistory, original.toolHistory)
      assert.equal(result.measurement.scope, 'pre-adapter')
      assert.equal(result.measurement.sections.system, bytes(system))
      assert.equal(result.measurement.sections.messages, bytes(original.messages))
      assert.equal(result.measurement.toolSchemaBytes, bytes(original.tools))
      t.diagnostic(JSON.stringify({ baseline: { system: bytes(system), messages: bytes(original.messages), toolSchemaBytes: bytes(original.tools) }, shared: result.measurement }))
      await assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor: { ...anchor, textVersion: 'stale' }, instruction: 'x' }), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
    } finally { await f.runner.dispose() }
  })
}

function controlledStream() {
  const started = Promise.withResolvers(), aborted = Promise.withResolvers(), resume = Promise.withResolvers(), ended = Promise.withResolvers()
  let requestSignal
  return {
    started: started.promise, aborted: aborted.promise, ended: ended.promise,
    resume: resume.resolve, signal: () => requestSignal,
    async *stream(request) {
      requestSignal = request.signal
      const onAbort = () => aborted.resolve()
      request.signal.addEventListener('abort', onAbort, { once: true })
      started.resolve()
      try {
        await resume.promise
        // A late successful finish must never turn cancellation into success.
        yield { type: 'finish', reason: { kind: 'stop' } }
      } finally {
        request.signal.removeEventListener('abort', onAbort)
        ended.resolve()
      }
    }
  }
}

for (const action of ['cancel', 'releaseFor', 'dispose', 'external']) {
  for (const withSignal of action === 'external' ? [true] : [false, true]) {
    test(`shared stream lifecycle: ${action}, caller signal=${withSignal}`, async () => {
      const stream = controlledStream()
      const f = fixture({ sharedStream: stream.stream })
      const controller = new AbortController()
      try {
        await f.baseline()
        const work = f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'x',
          ...(withSignal ? { signal: controller.signal } : {}) })
        const rejected = assert.rejects(work, { code: 'BACKGROUND_CANCELLED' })
        await stream.started
        assert.ok(f.runner.activeRequestContext('background'))
        await assert.rejects(f.runner.compact({ sessionId: 'background' }), /\u6b63\u5728\u6267\u884c\u4efb\u52a1/)
        const queued = assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'queued' }),
          action === 'dispose' ? /\u7ba1\u7406\u5668\u5df2\u5173\u95ed/ : { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
        let stopping
        if (action === 'cancel') assert.equal(f.runner.cancel('parent'), 1)
        else if (action === 'external') controller.abort()
        else stopping = f.runner[action](...(action === 'releaseFor' ? ['parent'] : []))
        await stream.aborted
        assert.equal(stream.signal().aborted, true)
        stream.resume()
        await Promise.all([rejected, stopping, stream.ended, queued])
        assert.equal(f.runner.activeRequestContext('background'), null)
        assert.equal(f.runner.cancel('parent'), 0)
        assert.equal(f.disposed(), ['releaseFor', 'dispose'].includes(action) ? 1 : 0)
        await assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'stale' }),
          action === 'dispose' ? /\u7ba1\u7406\u5668\u5df2\u5173\u95ed/ : { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
      } finally { stream.resume(); await f.runner.dispose() }
    })
  }
}

for (const action of ['undo', 'cancel', 'releaseFor']) test(`idle snapshot invalidation: ${action}`, async () => {
  const f = fixture({})
  try {
    await f.baseline()
    if (action === 'undo') assert.equal((await f.baseline({ undoLastTask: true })).undone, true)
    else if (action === 'cancel') assert.equal(f.runner.cancel('parent'), 0)
    else await f.runner.releaseFor('parent')
    await assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'stale' }),
      { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
    assert.equal(f.requests.length, 1)
  } finally { await f.runner.dispose() }
})

function capability(overrides = {}) {
  return { generation: 'enabled-1', sources: ['module-log'], readHistory: async () => 'history original',
    readSource: async () => 'source original', ...overrides }
}

const sharedInput = { sessionId: 'parent', anchor, instruction: 'Read original text, then return the result.' }
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')

function* toolCall(name, args, id = 'call-1', index = 0) {
  const text = JSON.stringify(args)
  yield { type: 'tool-call-delta', index, id, name, argumentsDelta: text.slice(0, 4) }
  yield { type: 'tool-call-delta', index, id, argumentsDelta: text.slice(4) }
}

for (const action of ['cancel', 'generation']) test(`read continuation rejects late reader results after ${action}`, async () => {
  const started = Promise.withResolvers(), finish = Promise.withResolvers()
  let current = capability({ readSource: async context => { started.resolve(context); await finish.promise; return 'late original' } })
  const f = fixture({ readCapability: () => current, sharedStream: async function* () {
    yield* toolCall('tavern_read_source', { sourceId: 'module-log', turn: 5 })
    yield { type: 'finish', reason: { kind: 'stop' } }
  } })
  try {
    await f.baseline()
    const work = f.runner.runSharedTask(sharedInput)
    const rejection = assert.rejects(work, { code: action === 'cancel' ? 'BACKGROUND_CANCELLED' : 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
    const context = await started.promise
    if (action === 'cancel') { f.runner.cancel('parent'); assert.equal(context.signal.aborted, true) }
    else current = null
    finish.resolve()
    await rejection
    assert.equal(f.requests.length, 2)
    await assert.rejects(f.runner.runSharedTask(sharedInput), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  } finally { finish.resolve(); await f.runner.dispose() }
})
