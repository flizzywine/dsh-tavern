import { createChatHistoryImportService } from '../../tavern-plugin/lib/domain/chat-history-import-service.js'
import { createImportContextPreparation } from '../../tavern-plugin/lib/domain/import-context-preparation.js'
import { sessionEvents, appendSessionEvent } from '../../tavern-plugin/lib/domain/session-events.js'
import { projectRuntimePresetRequest } from '../../tavern-plugin/lib/domain/runtime-preset-lifecycle.js'
// Production initialization, Chat journal and installed DSH Session/Agent loop.
// All files are temporary and the text model is scripted; no paid requests.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createConversationInitialization } from '../../tavern-plugin/lib/domain/conversation-initialization.js'
import { createPlayCardSnapshots } from '../../tavern-plugin/lib/domain/play-card-snapshots.js'
import { createContextPlanner } from '../../tavern-plugin/lib/domain/context-planner.js'
import { createTavernConversationRegistry } from '../../tavern-plugin/lib/domain/tavern-conversation-registry.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, sessionStablePrefixSections } from '../../tavern-plugin/lib/domain/session-stable-prefix.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'

export async function createInitializationNative(bootPath, { preset, contextWindow = 2000, modelStream, cardOverrides, userPreferenceProfile, assembleStablePrefix = true } = {}) {
  const bootUrl = pathToFileURL(bootPath)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { Session } = await import(new URL('../../dsh-session/lib/index.js', bootUrl))
  const root = await mkdtemp(join(tmpdir(), 'tavern-initialization-native-'))
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-commands', 'dsh-agent-loop']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href + '\n').join(''))
  const ctx = await boot('initialization-native-test', config)
  if (preset) {
    const projected = new WeakSet()
    ctx.on('llm/stream', (request, next) => {
      if (projected.has(request)) return next()
      const adapted = projectRuntimePresetRequest(request, preset)
      projected.add(adapted)
      return ctx.llm.stream(adapted)
    })
  }
  if (assembleStablePrefix) ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    assembly.sections = sessionStablePrefixSections(context.agent.session)
    return assembly
  })
  ctx.baseUrl = bootUrl.href
  const requests = [], state = { failMarker: false, failFlush: false }, handles = new Set()
  const selection = { provider: 'initialization-fixture', model: 'text' }
  const sessionId = 'opening-session'
  const worldBooks = { bound: async () => ({ view: { entries: [
    { ref: 'constant', enabled: true, constant: true, content: 'Fixture constant worldbook' },
    { ref: 'dynamic', enabled: true, primaryKeys: ['走到花店'], content: 'Fixture recalled worldbook' }
  ] } }) }
  let target, persistence, importer
  const card = { path: 'cards/test.json', name: '角色', first_mes: '{{user}}，你好。', description: '不可丢失的固定背景', system_prompt: 'Fixture card special instruction', post_history_instructions: 'Fixture card writing constraint', ...cardOverrides }
  const data = createProfileDataStore({ dataRoot: root })
  let storage = createSessionStablePrefixStorage(join(root, 'prefix'))
  const eventsPath = join(root, 'native-events.json')
  async function flush(session) {
    if (state.failFlush && sessionEvents(session).some(e => e.type === 'assistant/message')) throw Error('native flush failure')
    await writeFile(eventsPath, JSON.stringify({ header: session.header, inheritedEventCount: session.inheritedEventCount ?? 0, events: sessionEvents(session) }))
  }
  ctx.on('session/flush', flush)
  class FixtureModel extends LlmAdapter {
    async resolveModel(provider, id) { return { provider, id, name: id, context: { contextWindow } } }
    async *stream(input) {
      if (modelStream) { yield* modelStream(input); return }
      requests.push(structuredClone({ system: input.messages.filter(message => message.role === 'system').flatMap(message => message.content).map(block => block.text || '').join('\n\n'), messages: input.messages, purpose: input.purpose }))
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '继续故事。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter([selection.provider], new FixtureModel())
  async function createAgent(seed) {
    const handle = await ctx.agents.create({ sessionId, seed, agentOptions: selection })
    handles.add(handle)
    target = { agent: handle.agent, session: handle.agent.session }
    return handle
  }
  await createAgent()
  function open() {
    persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, legacyData: data }) })
    const registry = createTavernConversationRegistry({ store: {
      readLinks: () => data.readJson('sessions.json'), updateLinks: fn => data.updateJson('sessions.json', fn),
      readIndex: async () => await data.readJson('index.json') || { chats: [] }, updateIndex: updater => data.updateJson('index.json', updater),
      readChat: persistence.read, writeChat: persistence.write, removeChat: persistence.remove
    } })
    const write = async (chat, metadata) => {
      if (state.failMarker && metadata.source === 'opening.native-append') throw Error('marker failure')
      return persistence.write(chat, metadata)
    }
    const snapshots = createPlayCardSnapshots({ worldBooks, planner: createContextPlanner({ prompt: () => '' }), readCard: async () => card, writeChat: write, userPreferenceProfile })
    const timeline = createStoryTimeline({ id: () => randomUUID() })
    const initialization = createConversationInitialization({
      cards: { read: async () => card, readChat: async () => card, script: async () => undefined, extensions: async () => ({}) },
      chats: { resolve: registry.resolve, publish: registry.publish, write }, snapshots, timeline, userPreferenceProfile,
      presets: { fullSnapshot: async () => null }, settings: async () => ({}),
      logger: { warn() {} }, emptyCardWorkspace: () => ({}), id: () => randomUUID(), present: async chat => structuredClone(chat),
      native: { wait: async () => target, selection: () => selection, ensurePrefix: (session, text) => ensureSessionStablePrefix(session, text, storage),
        flush: session => target.agent ? ctx.sessions.flush(session) : flush(session) }
    })
    importer = createChatHistoryImportService({ initialization, cards: { read: async () => card }, worldBooks, store: data,
      planner: createContextPlanner({ prompt: () => 'Native fixture writing rules' }),
      chats: { resolve: registry.resolve, publish: registry.publish, read: persistence.read, readRevision: persistence.readRevision, write: persistence.write },
      native: { wait: async () => target, ensurePrefix: (session, text) => ensureSessionStablePrefix(session, text, storage), flush } })
    return initialization
  }
  return {
    ctx,
    importHistory: async input => { open(); return importer.import(input) },
    open, state, requests, input: { cardPath: card.path, sessionId, mode: 'play', userName: '玩家' },
    get target() { return target }, get persistence() { return persistence },
    async restoreDetached() {
      // Recreate the native Session from only persisted JSON, including its header.
      const saved = await readFile(eventsPath, 'utf8').then(JSON.parse).catch(error => {
        if (error && error.code === 'ENOENT') return null
        throw error
      })
      target = { session: saved === null
        ? Session.create(sessionId)
        : Session.fromRestore(sessionId, saved.events, saved.header, saved.inheritedEventCount ?? 0) }
      storage = createSessionStablePrefixStorage(join(root, 'prefix'))
    },
    async checkpoint() { await flush(target.session) },
    async verifyImportContextCompaction() {
      const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', bootUrl))
      const compaction = new BasicCompactionEngine(ctx, { auto: false })
      const chatId = (await data.readJson('sessions.json'))[sessionId]
      const session = target.session
      session.append('request/header', { header: { config: selection }, reason: 'initial' })
      const request = { ...selection, sessionId, system: sessionStablePrefixSections(session).map(s => s.text).join('\n'), maxTokens: 256, messages: session.deriveMessages() }
      const prepare = createImportContextPreparation({
        readChat: () => persistence.read(chatId), updateChat: persistence.update, getSession: () => session, flush,
        modelInfo: r => ctx.llm.resolveModelInfo(r.provider, r.model), estimateMessage: m => ctx.tokenMeter.estimateMessage(m)
      })
      const projected = await prepare.prepare(request)
      const afterPreparation = ctx.tokenMeter.measure(session).totalTokens
      const signal = new AbortController().signal
      const firstPressure = await compaction.compactIfNeeded(target.agent, 'pressure', signal)
      const summaryCallsBeforeGrowth = requests.filter(r => r.purpose === 'compaction').length
      const turn = 50
      session.append('user/message', { id: 'later-input', role: 'user', content: [{ type: 'text', text: 'L'.repeat(2500) }], source: { kind: 'user' } }, { surfaceOp: 'append' })
      session.append('turn/start', { turn })
      session.append('step/start', { turn, step: 1 })
      appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'later-body', role: 'assistant', content: [{ type: 'text', text: 'Later body' }], source: { kind: 'model', ...selection } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
      session.append('turn/start', { turn: 51 })
      const result = await compaction.compactIfNeeded(target.agent, 'pressure', signal)
      session.append('turn/end', { turn: 51, reason: { kind: 'completed' } })
      return { projected, afterPreparation, firstPressure, summaryCallsBeforeGrowth, result, afterCompaction: ctx.tokenMeter.measure(session).totalTokens,
        chat: await persistence.read(chatId), events: sessionEvents(session) }
    },
    async continueWithAgent() {
      const seed = JSON.parse(await readFile(eventsPath, 'utf8')).events
      for (const handle of handles) await handle.dispose()
      handles.clear()
      await createAgent(seed)
      // Promote any legacy prefix before first request, as the host opening boundary does.
      await ensureSessionStablePrefix(target.session, '', storage)
      target.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '继续。' }], source: { kind: 'human' } })
      await target.agent.whenIdle()
    },
    // Continue on the SAME live Agent, as an open workbench does: rebuilding the
    // Agent from disk would re-read the turn boundary and hide a turn number the
    // live Agent never learned.
    async continueInPlace() {
      target.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '继续。' }], source: { kind: 'human' } })
      await target.agent.whenIdle()
    },
    async dispose() { for (const handle of handles) await handle.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  }
}
