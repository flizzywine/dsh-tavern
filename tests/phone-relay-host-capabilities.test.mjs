import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createContextHost, projectContextHistory } from '../tavern-plugin/lib/index.js'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { HISTORY_RECALL_TOOL, createHistoryRecall, renderHistoryRecall } from '../tavern-plugin/lib/domain/history-recall.js'
import { createPlainSettlementEngine } from '../tavern-plugin/lib/domain/plain-settlement-engine.js'
import { createPostureItem } from '../tavern-plugin/lib/domain/background-pipeline.js'
import { POSTURE_SUBMIT_TOOL } from '../tavern-plugin/lib/domain/posture-submission.js'
import { createCandidateGenerator, CANDIDATE_SUBMIT_TOOL } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createModelCalls } from '../tavern-plugin/lib/domain/model-calls.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'
import { createStoryEvents } from '../tavern-plugin/lib/domain/story-events.js'
const require = createRequire(process.env.DSH_BOOT_MODULE || import.meta.url)
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const anchor = { branchId: 'branch-a', turn: 2, textVersion: '4' }
const baseChat = () => ({ id: 'chat-1', sessionId: 'parent', cardId: 'card-1', mode: 'story',
  timeline: { schemaVersion: 1, branchId: 'branch-a', revision: 4, operations: {}, participants: {}, checkpoints: [] },
  messages: [{ role: 'assistant', turn: 1, text: 'Earlier rain.' }, { role: 'user', turn: 2, text: 'Open.' },
    { role: 'assistant', turn: 2, text: 'Visible.\n\nSecret.' }] })
function fixture({ host, worldbookSkillsEnabled, webSearchEnabled, enabled = true, sharedStream, readCapability, withHistory = false, onNormalRequest, onNormalFinish, onRunFinished, afterSetup, runnerFactory = createBackgroundAgentRunner }) {
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
  const runner = runnerFactory({
    prepareSharedContext: host.prepareSharedContext,
    onRunFinished,
    id: () => session.id,
    compactAgent: async () => ({ message: 'compacted' }),
    resolveSharedTaskAnchor: host.resolveSharedTaskAnchor,
    resolveSharedReadTools: host.resolveSharedReadTools,
    ...(withHistory ? { sharedTools: [{ tool: HISTORY_RECALL_TOOL, execute: () => { throw new Error('previous task reader must not be inherited') } }] } : {}),
    resolveWorldbookSkills: () => worldbookSkillsEnabled,
    resolveWebSearch: () => webSearchEnabled,
    resolveStablePrefix: () => 'Fixed character background',
    resolveCurrentWorldbook: () => 'Current worldbook',
    backgroundTools: [POSTURE_SUBMIT_TOOL, CANDIDATE_SUBMIT_TOOL],
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
        await afterSetup?.(registered)
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
              await onNormalFinish?.()
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

async function capabilityHarness(t, { callModel = async () => 'unused', onFinished } = {}) {
  const root = new Context(), seen = [], recalls = [], storyEvents = createStoryEvents()
  const identities = new Map([['reader-a', { runtimeName: 'reader-a', origin: 'global' }]])
  let chat = baseChat(), api, declaration, runner
  await root.plugin({ name: 'test-host', apply(ctx) {
    api = createTavernPluginApi({ ctx, runningUserPlugins: identities, storyEvents,
      resolveGame: async sessionId => sessionId === 'parent' ? { sessionId, chatId: chat.id } : null })
    ctx.provide('tavern', api.service)
  } })
  const definition = enabled => ({ sources: [{ name: 'raw', readRaw: context => { seen.push(context); return 'Private archive for actor-7' } }],
    authorize: ({ consumer, scope }) => enabled && consumer.id === 'worker' && scope.contact === 'actor-7' })
  await root.plugin({ name: 'reader-a', inject: ['tavern'], apply(ctx) {
    declaration = ctx.tavern.readCapability({ name: 'archive', ...definition(true) })
    if (onFinished) ctx.tavern.on('task-finished', onFinished)
  } })
  const host = createContextHost({ pluginApi: api, chatForSession: async () => structuredClone(chat), callModel, runner: () => runner,
    recallHistoryForSession: async (sessionId, args, scope, audience, binding) => {
      recalls.push({ sessionId, args, scope })
      return createHistoryRecall().recall({ ...args, scope, audience, chat: projectContextHistory(chat, binding,
        { projections: [{ turn: 2, body: { displayUnits: [{ text: 'Visible.' }, { text: 'Secret.' }] } }] }) })
    } })
  t.after(async () => { host.dispose(); await runner?.dispose(); await root.fiber.dispose() })
  const bind = overrides => host.bind({ owner: 'reader-a', name: 'archive', sessionId: 'parent', consumer: { id: 'worker' },
    anchor, scope: { contact: 'actor-7' }, ...overrides })
  return { host, bind, seen, recalls, storyEvents, setRunner(value) { runner = value }, chat: () => structuredClone(chat),
    change(fn) { fn(chat) }, replace(value) { chat = structuredClone(value) }, update: enabled => declaration.update(definition(enabled)), revoke: () => declaration.revoke() }
}

const providerSpec = { owner: 'reader-a', name: 'archive', consumer: { id: 'worker' }, scope: { contact: 'actor-7' } }
const creation = { chatId: 'chat-1', branchId: 'branch-a', revision: 4, turn: 2 }

if (!process.env.P4C_HOST_CHILD) {
  test('shared preparation precedes freezing and real capture; public completion can enqueue without recursion', async t => {
    const started = Promise.withResolvers(), resume = Promise.withResolvers(), finished = Promise.withResolvers()
    const heard = [], order = []
    let f
    const h = await capabilityHarness(t, { onFinished: async event => {
      heard.push(event)
      if (!event.data?.sharedContext) return
      order.push('finished')
      try { finished.resolve(await f.runner.runSharedTask({ sessionId: event.gameId, anchor: event.data.sharedContext.anchor, instruction: 'Summarize.' })) }
      catch (error) { finished.reject(error) }
    } })
    const unregister = h.host.registerSharedProvider({ prepare: async input => {
      assert.deepEqual(input.requestAnchor, creation)
      order.push('prepare'); started.resolve(); await resume.promise
      order.push('bind'); return providerSpec
    } })
    assert.deepEqual(h.host.requestAnchor(h.chat(), { basedOn: { branchId: 'branch-a', revision: 4 } }), { requestAnchor: creation })
    f = fixture({ host: h.host, withHistory: true, onRunFinished: event => h.storyEvents.emit('task-finished', event),
      onNormalRequest: tools => { order.push('capture'); assert.ok(tools.has('tavern_read_source')) } })
    h.setRunner(f.runner)
    const run = f.baseline({ requestAnchor: creation })
    await started.promise
    assert.equal(f.creates(), 0); assert.equal(f.requests.length, 0)
    resume.resolve(); await run
    assert.equal((await finished.promise).output, 'not JSON: boundary owns validation')
    assert.deepEqual(order, ['prepare', 'bind', 'capture', 'finished'])
    assert.deepEqual(heard[0].data.sharedContext.anchor, anchor)
    assert.equal(heard.length, 1)
    assert.equal(JSON.stringify(f.requests[1].tools), JSON.stringify(f.requests[0].tools))
    unregister()
    await assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'Old' }), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  })

  test('disabled, failed and stale preparation preserve baseline bytes without false readiness', async t => {
    const packets = []
    for (const mode of ['absent', 'disabled', 'failure', 'old-revision', 'old-branch']) {
      const h = await capabilityHarness(t), events = []
      if (mode !== 'absent') h.host.registerSharedProvider({ prepare: ({ requestAnchor }) => {
        if (mode === 'old-revision' || mode === 'old-branch') Object.assign(requestAnchor, creation)
        if (mode === 'failure') throw new Error('optional provider failed')
        return mode === 'disabled' ? null : providerSpec
      } })
      const f = fixture({ host: h.host, onRunFinished: event => events.push(event) }); h.setRunner(f.runner)
      await f.baseline({ requestAnchor: { ...creation, ...(mode === 'old-revision' ? { revision: 3 } : {}), ...(mode === 'old-branch' ? { branchId: 'old' } : {}) } })
      assert.equal(events.length, 1); assert.equal(events[0].data, undefined)
      assert.equal(await h.host.resolveSharedReadTools({ sessionId: 'parent' }), null)
      await assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'No snapshot' }), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
      packets.push(JSON.stringify({ ...f.requests[0], messages: f.requests[0].messages.map(({ id, ...message }) => message) }))
    }
    for (const packet of packets) assert.equal(packet, packets[0])
  })

  test('authorization revoked after tool freezing degrades before anchor resolution without stale tools or readiness', async t => {
    const packets = []
    for (const action of ['absent', 'revoke', 'unregister']) {
      const h = await capabilityHarness(t), events = []
      const unregister = action === 'absent' ? null : h.host.registerSharedProvider({ prepare: () => providerSpec })
      const f = fixture({ host: h.host, onRunFinished: event => events.push(event),
        afterSetup: tools => {
          assert.equal(tools.has('tavern_read_source'), action !== 'absent')
          if (action === 'revoke') h.revoke()
          if (action === 'unregister') unregister()
        },
        onNormalRequest: tools => {
          assert.equal(tools.has('tavern_read_source'), false)
          assert.ok(tools.has(POSTURE_SUBMIT_TOOL.name))
        } })
      h.setRunner(f.runner)
      await f.baseline({ requestAnchor: creation })
      assert.equal(events.length, 1)
      assert.equal(events[0].status, 'completed')
      assert.equal(events[0].data, undefined)
      assert.equal(await h.host.resolveSharedReadTools({ sessionId: 'parent' }), null)
      await assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'No revoked snapshot' }), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
      packets.push(JSON.stringify({ ...f.requests[0], messages: f.requests[0].messages.map(({ id, ...message }) => message) }))
    }
    for (const packet of packets) assert.equal(packet, packets[0])
  })

  test('provider unregister and cancellation discard pending preparation; failure and no capture never reuse readiness', async t => {
    for (const action of ['unregister', 'signal', 'cancel']) {
      const h = await capabilityHarness(t), started = Promise.withResolvers(), resume = Promise.withResolvers(), events = []
      const unregister = h.host.registerSharedProvider({ prepare: async ({ signal }) => {
        started.resolve(signal); await resume.promise; return providerSpec
      } })
      const f = fixture({ host: h.host, onRunFinished: event => events.push(event) }); h.setRunner(f.runner)
      const controller = new AbortController()
      const pending = f.baseline({ requestAnchor: creation, signal: controller.signal })
      const signal = await started.promise
      const rejection = action === 'unregister' ? null : assert.rejects(pending, { name: 'AbortError' })
      if (action === 'unregister') unregister()
      else if (action === 'signal') controller.abort()
      else assert.equal(f.runner.cancel('parent'), 1)
      assert.equal(signal.aborted, true)
      resume.resolve()
      if (rejection) await rejection; else await pending
      assert.equal(events[0].data, undefined)
      assert.equal(await h.host.resolveSharedReadTools({ sessionId: 'parent' }), null)
      assert.equal(f.creates(), action === 'unregister' ? 1 : 0)
    }
    const h = await capabilityHarness(t), events = []
    let fail = false
    h.host.registerSharedProvider({ prepare: () => providerSpec })
    const f = fixture({ host: h.host, onRunFinished: event => events.push(event), onNormalFinish: () => { if (fail) throw new Error('normal failure') } })
    h.setRunner(f.runner)
    await f.baseline({ requestAnchor: creation })
    assert.deepEqual(events[0].data.sharedContext.anchor, anchor)
    await f.baseline({ requestAnchor: creation, undoLastTask: true })
    assert.equal(events[1].data, undefined)
    fail = true
    await assert.rejects(f.baseline({ requestAnchor: creation }), /normal failure/)
    assert.equal(events[2].status, 'failed'); assert.equal(events[2].data, undefined)
  })

  test('warm disable, preparation error and post-capture unload never retain old readiness', async t => {
    const h = await capabilityHarness(t), events = []
    let mode = 'enabled', unloadAfterCapture = false
    const unregister = h.host.registerSharedProvider({ prepare: () => {
      if (mode === 'error') throw new Error('prepare failed after prior success')
      return mode === 'disabled' ? null : providerSpec
    } })
    const f = fixture({ host: h.host, onRunFinished: event => events.push(event),
      onNormalFinish: () => { if (unloadAfterCapture) unregister() } })
    h.setRunner(f.runner)
    for (const next of ['enabled', 'disabled', 'enabled', 'error', 'enabled']) {
      mode = next
      await f.baseline({ requestAnchor: creation })
      assert.equal(Boolean(events.at(-1).data?.sharedContext), mode === 'enabled')
      assert.equal(f.requests.at(-1).tools.some(tool => tool.name === 'tavern_read_source'), mode === 'enabled')
    }
    await f.baseline()
    assert.equal(events.at(-1).data, undefined)
    assert.equal(f.requests.at(-1).tools.some(tool => tool.name === 'tavern_read_source'), false)
    unloadAfterCapture = true
    await f.baseline({ requestAnchor: creation })
    assert.equal(events.at(-1).status, 'completed')
    assert.equal(events.at(-1).data, undefined)
    await assert.rejects(f.runner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'No old capability' }), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
  })

  test('real producers preserve creation authority through index resolution and P2 capture', async t => {
    const h = await capabilityHarness(t)
    const binding = await h.bind({ shared: true })
    let task = 'settlement'
    const f = fixture({ host: h.host, withHistory: true, onNormalRequest: async tools => {
      if (task === 'settlement') await tools.get('posture_submit').execute({ posture: 'At the door.' })
      else await tools.get('candidate_submit_choices').execute({ actions: ['Look at the quiet street', 'Ask about the distant bell', 'Check the wet footprints', 'Follow the empty alley'], scene: 'At the clock tower' })
    } })
    h.setRunner(f.runner)
    const inputs = []
    const run = async input => { inputs.push(input); return f.runner.run(input) }
    const deps = { requestAnchor: h.host.requestAnchor, pluginApi: { replaceSettlement: async () => null },
      backgroundModelSelection: () => ({ provider: 'mock', model: 'model-a' }),
      postureItem: createPostureItem({ prompt: () => 'Posture', tool: POSTURE_SUBMIT_TOOL }),
      backgroundAgentRunner: { run }, agentRegistry: new Map(), sessionStore: new Map() }
    const turn = { snapshot: h.chat(), taskRun: { basedOn: { branchId: 'branch-a', revision: 4 }, bindSession() {}, participantRequest: { rewindTo: 0 } },
      card: { name: 'Actor' }, trace: { sessionId: '' }, backgroundTasksSettings: { posture: true } }
    await createPlainSettlementEngine(deps).run(turn)
    assert.deepEqual(inputs[0].requestAnchor, { chatId: 'chat-1', branchId: 'branch-a', revision: 4, turn: 2 })
    assert.equal((await binding.runSharedTask({ instruction: 'Return JSON.' })).output, 'not JSON: boundary owns validation')
    assert.equal(JSON.stringify(f.requests).includes('requestAnchor'), false)
    const store = { chatForSession: async () => h.chat(), readChat: async () => h.chat(), readCard: async () => ({ name: 'Actor' }), writeChat: async chat => h.replace(chat),
      updateChat: async (_id, fn) => { const result = await fn(h.chat()); if (result) h.replace(result); return h.chat() } }
    const timeline = createStoryTimeline()
    const candidates = createCandidateGenerator({ requestAnchor: h.host.requestAnchor, store, timeline,
      tasks: createBackgroundTaskCoordinator({ store, timeline }), model: { selection: deps.backgroundModelSelection, runCandidate: run },
      planner: { plan: async () => ({ taskText: 'Choose', stableText: 'Stable', dynamicText: 'Dynamic' }) },
      backgroundTasks: async () => ({ characterDesign: false }), prompt, logger: { error() {}, warn() {} } })
    const prepared = await candidates.prepare({ sessionId: 'parent', messageId: 'm' })
    assert.equal(h.chat().timeline.branchId, anchor.branchId)
    assert.equal(h.chat().timeline.revision, 4)
    task = 'candidate'
    await prepared.execute()
    assert.deepEqual(inputs[1].requestAnchor, inputs[0].requestAnchor)
    assert.equal(JSON.stringify(h.chat()).includes('requestAnchor'), false)
    assert.equal(h.chat().timeline.operations[prepared.operationId].status, 'completed')
    assert.equal(h.chat().timeline.revision, 4)
    assert.equal((await binding.runSharedTask({ instruction: 'Again.' })).output, 'not JSON: boundary owns validation')
    for (const change of [chat => { chat.timeline.revision++ }, chat => { chat.timeline.branchId = 'branch-b' }]) {
      const before = h.chat(); h.change(change)
      for (const input of inputs) await assert.rejects(h.host.resolveSharedTaskAnchor(input), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
      h.replace(before)
    }
    // Rebind the same text/turn to a new revision: queued requests retain the old creation version.
    binding.release()
    h.replace(timeline.apply({ chat: h.chat(), intent: { kind: 'body.edit', turn: 2, patch: { text: 'Visible.\n\nSecret.' } } }).chat)
    const newer = await h.bind({ shared: true, anchor: { ...anchor, textVersion: '5' } })
    for (const input of inputs) await assert.rejects(h.host.resolveSharedTaskAnchor(input), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
    await assert.rejects(newer.runSharedTask({ instruction: 'Cannot borrow old snapshot.' }), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
    newer.release()
    assert.deepEqual(h.host.requestAnchor(turn.snapshot, turn.taskRun), {})
    assert.equal(await h.host.resolveSharedReadTools({ sessionId: 'parent' }), null)
    assert.equal(await h.host.resolveSharedTaskAnchor(inputs[0]), null)
  })

  test('trusted P4r bindings execute bounded history/source readers and revoke old generations', async t => {
    const h = await capabilityHarness(t)
    const bound = await h.bind({ anchor: { ...anchor, para: 1 } })
    const text = await bound.readHistory({ args: { turn: 2, radius: 0 } })
    assert.match(text, /Visible/); assert.doesNotMatch(text, /Secret/)
    for (const args of [{ turn: 3 }, { turn: 1, chatId: 'evil' }, { turn: 1, branchId: 'evil' }, { turn: 1, contact: 'evil' }]) {
      await assert.rejects(bound.readHistory({ args }), /scope/)
    }
    await assert.rejects(h.bind({ scope: { chatId: 'other', contact: 'actor-7' } }))
    await assert.rejects(h.bind({ scope: { contact: 'other' } }))
    const shared = await h.bind({ shared: true })
    const view = await h.host.resolveSharedReadTools({ sessionId: 'parent' })
    assert.deepEqual(view.sources, ['reader-a:archive:raw'])
    assert.equal(await view.readSource({ args: { sourceId: view.sources[0], turn: 1 } }), 'Private archive for actor-7')
    assert.equal(h.seen[0].scope.contact, 'actor-7')
    assert.equal(h.seen[0].sessionId, 'parent')
    for (const args of [{ sourceId: 'Private archive', turn: 1 }, { sourceId: view.sources[0], turn: 3 },
      { sourceId: view.sources[0], turn: 1, contact: 'other' }]) await assert.rejects(async () => view.readSource({ args }))
    h.update(false)
    await assert.rejects(bound.readHistory({ args: { turn: 1 } }))
    await assert.rejects(view.readSource({ args: { sourceId: view.sources[0], turn: 1 } }))
    h.update(true)
    await assert.rejects(bound.readHistory({ args: { turn: 1 } }))
    shared.release(); bound.release()
    const fresh = await h.bind()
    await fresh.readHistory({ args: { turn: 1 } })
    fresh.release()
    await assert.rejects(fresh.readHistory({ args: { turn: 1 } }))
    const last = await h.bind(); h.revoke()
    await assert.rejects(last.readHistory({ args: { turn: 1 } }))
  })

  test('P3 receives real read-only tool results without sending tool JSON to onText', async t => {
    const requests = [], text = []
    const tool = (name, args) => ({ type: 'block-end', index: 0, block: { type: 'tool-call', id: name, name, arguments: JSON.stringify(args) } })
    const rounds = [ [tool('tavern_recall_history', { turn: 1, radius: 0 })],
      [tool('tavern_read_source', { sourceId: 'reader-a:archive:raw', turn: 1 })], [{ type: 'text-delta', index: 0, text: 'Final answer.' }] ]
    const { callModel } = createModelCalls({ llm: { async prepareCall(config) {
      const chunks = rounds.shift(); let used = false
      return { config, async *stream(options) { assert.equal(used, false); used = true; requests.push(structuredClone(options));
        yield* chunks; yield { type: 'finish', reason: { kind: 'stop' } } } }
    } }, agents: () => new Map(), agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'fixed' }) } })
    const h = await capabilityHarness(t, { callModel }), bound = await h.bind()
    assert.equal(await bound.callWithTools({ messages: [], system: 'Talk', onText: value => text.push(value), sessionId: 'evil',
      tools: [{ name: 'evil' }], onToolCall: () => { throw new Error('Caller tool handler must not execute') } }), 'Final answer.')
    assert.deepEqual(text, ['Final answer.'])
    assert.equal(h.recalls[0].sessionId, 'parent')
    assert.equal(h.seen.length, 1)
    assert.match(JSON.stringify(requests[2].messages), /Private archive for actor-7/)
    assert.deepEqual(requests[0].tools.map(row => row.name), ['tavern_recall_history', 'tavern_read_source'])
  })

  test('production apply passes the live factory to stage and uses its real recall reader', async () => {
    const home = await mkdtemp(join(tmpdir(), 'p4c-host-'))
    try {
      const child = spawnSync(process.execPath, ['--import', new URL('./fixtures/host-session-patch-preload.mjs', import.meta.url).href, fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 90000,
        env: { ...process.env, DSH_HOME: home, P4C_HOST_CHILD: '1' } })
      assert.equal(child.status, 0, child.stdout + child.stderr)
    } finally { await rm(home, { recursive: true, force: true }) }
  })
} else {
  const { createPluginHost } = await import('./fixtures/plugin-host.mjs')
  const { createProfileDataStore } = await import('../tavern-plugin/lib/profile-data-store.js')
  const { resolveTavernDataRoot } = await import('../tavern-plugin/lib/domain/tavern-data.js')
  const { registerRunningUserPlugin } = await import('../tavern-plugin/lib/domain/user-plugins.js')
  const store = createProfileDataStore({ dataRoot: resolveTavernDataRoot() })
  await store.writeJson('sessions.json', { parent: 'chat-1' })
  await store.writeJson('chats/chat-1.json', { ...baseChat(), backgroundConfigVersion: 1, conversationFeaturesVersion: 1 })
  const releaseIdentity = registerRunningUserPlugin('reader-a', { folder: 'reader-a', runtimeName: 'reader-a', origin: 'global', bound: false, cardIds: [] })
  const app = await createPluginHost({ config: { stage: false } })
  try {
    let core
    await app.services.get('tavernStageControl').enable(async () => ({ createStageRuntime: () => ({
      cards: () => ({}), foreground: () => ({}), start: value => { core = value }, services() {}, requests() {}, dispose() {} }) }))
    assert.equal(typeof core.contextHost.bind, 'function')
    const plugin = Object.create(app.services.get('tavern'))
    plugin.ctx = { fiber: { name: 'reader-a' }, effect: fn => fn() }
    const registration = plugin.readCapability({ name: 'archive', sources: [{ name: 'raw', readRaw: () => 'Production raw' }], authorize: () => true })
    const bound = await core.contextHost.bind({ owner: 'reader-a', name: 'archive', sessionId: 'parent', consumer: 'worker', anchor, shared: true })
    const text = await bound.readHistory({ args: { turn: 1, radius: 0 } })
    assert.match(text, /Earlier rain/)
    const sources = await core.contextHost.resolveSharedReadTools({ sessionId: 'parent' })
    assert.equal(await sources.readSource({ args: { sourceId: sources.sources[0], turn: 1 } }), 'Production raw')
    await assert.rejects(core.backgroundAgentRunner.runSharedTask({ sessionId: 'parent', anchor, instruction: 'No default session' }), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
    bound.release()
    const ready = Promise.withResolvers(), heard = []
    plugin.on('task-finished', async event => {
      heard.push(event)
      if (!event.data?.sharedContext) return
      try { ready.resolve(await core.backgroundAgentRunner.runSharedTask({ sessionId: event.gameId,
        anchor: event.data.sharedContext.anchor, instruction: 'Production shared followup.' })) }
      catch (error) { ready.reject(error) }
    })
    let prepared = false
    const unregister = core.contextHost.registerSharedProvider({ prepare: ({ requestAnchor }) => {
      assert.deepEqual(requestAnchor, creation); prepared = true
      return { owner: 'reader-a', name: 'archive', consumer: 'worker' }
    } })
    core.backgroundTaskPolicies.set('test-shared', { cardContext: false, ownModel: true, webSearch: false })
    app.services.get('agentPresets').mount = async () => {}
    app.services.get('sessions').flush = async () => {}
    const f = fixture({ host: core.contextHost, runnerFactory: options => {
      Object.assign(app.services.get('agents'), options.agents)
      return core.backgroundAgentRunner
    }, onNormalRequest: tools => { assert.equal(prepared, true); assert.ok(tools.has('tavern_read_source')) } })
    await f.baseline({ task: 'test-shared', requestAnchor: creation })
    assert.equal((await ready.promise).output, 'not JSON: boundary owns validation')
    assert.deepEqual(heard[0].data.sharedContext.anchor, anchor)
    assert.equal(heard.length, 1)
    unregister(); registration.revoke()
  } finally { await app.dispose(); releaseIdentity() }
}