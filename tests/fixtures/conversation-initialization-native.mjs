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
import { createSessionStablePrefixStorage, ensureSessionStablePrefix, readSessionStablePrefix, projectSessionStablePrefix } from '../../tavern-plugin/lib/domain/session-stable-prefix.js'

export async function createInitializationNative(bootPath) {
  const bootUrl = pathToFileURL(bootPath)
  const { boot } = await import(bootUrl.href)
  const { LlmAdapter } = await import(new URL('../../dsh-llm/lib/index.js', bootUrl))
  const { Session } = await import(new URL('../../dsh-session/lib/index.js', bootUrl))
  const root = await mkdtemp(join(tmpdir(), 'tavern-initialization-native-'))
  const config = join(root, 'host.yml')
  const packages = ['dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-llm', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-agent-loop']
  await writeFile(config, packages.map(name => '- id: ' + name + '\n  name: ' + new URL('../../' + name + '/lib/index.js', bootUrl).href + '\n').join(''))
  const ctx = await boot('initialization-native-test', config)
  ctx.baseUrl = bootUrl.href
  const requests = [], state = { failMarker: false, failFlush: false }, handles = new Set()
  const selection = { provider: 'initialization-fixture', model: 'text' }
  const sessionId = 'opening-session'
  let target, persistence
  const card = { path: 'cards/test.json', name: '角色', first_mes: '{{user}}，你好。', description: '不可丢失的固定背景' }
  const data = createProfileDataStore({ dataRoot: root })
  let storage = createSessionStablePrefixStorage(join(root, 'prefix'))
  const eventsPath = join(root, 'native-events.json')
  async function flush(session) {
    if (state.failFlush && session.events.some(e => e.type === 'assistant/message')) throw Error('native flush failure')
    await writeFile(eventsPath, JSON.stringify({ header: session.header, events: session.events }))
  }
  ctx.on('session/flush', flush)
  class FixtureModel extends LlmAdapter {
    async *stream(input) {
      requests.push(structuredClone({ system: input.system, messages: input.messages }))
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '继续故事。' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter([selection.provider], new FixtureModel())
  async function createAgent(seed) {
    const handle = await ctx.agents.create({ sessionId, seed, agentOptions: selection,
      setup: async agentCtx => {
        const projected = new WeakSet()
        agentCtx.on('llm/stream', (request, next) => {
          if (projected.has(request)) return next()
          const withPrefix = projectSessionStablePrefix(request, readSessionStablePrefix(target?.session))
          projected.add(withPrefix)
          return agentCtx.llm.stream(withPrefix)
        })
      }
    })
    handles.add(handle)
    target = { agent: handle.agent, session: handle.agent.session }
    return handle
  }
  await createAgent()
  function open() {
    persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, legacyData: data }) })
    const registry = createTavernConversationRegistry({ store: {
      readLinks: () => data.readJson('sessions.json'), updateLinks: fn => data.updateJson('sessions.json', fn),
      readIndex: async () => await data.readJson('index.json') || { chats: [] }, writeIndex: value => data.writeJson('index.json', value),
      readChat: persistence.read, writeChat: persistence.write, removeChat: persistence.remove
    } })
    const write = async (chat, metadata) => {
      if (state.failMarker && metadata.source === 'opening.native-append') throw Error('marker failure')
      return persistence.write(chat, metadata)
    }
    const snapshots = createPlayCardSnapshots({ worldBooks: { bound: async () => null }, planner: createContextPlanner({ prompt: () => '' }), readCard: async () => card, writeChat: write })
    return createConversationInitialization({
      cards: { read: async () => card, readChat: async () => card, script: async () => undefined, extensions: async () => ({}) },
      chats: { resolve: registry.resolve, publish: registry.publish, write }, snapshots,
      presets: { fullSnapshot: async () => null }, settings: async () => ({}),
      logger: { warn() {} }, cardGreeting: () => '工作台', emptyCardWorkspace: () => ({}), id: () => randomUUID(), present: async chat => structuredClone(chat),
      native: { wait: async () => target, selection: () => selection, ensurePrefix: (session, text) => ensureSessionStablePrefix(session, text, storage),
        flush: session => target.agent ? ctx.sessions.flush(session) : flush(session) }
    })
  }
  return {
    open, state, requests, input: { cardPath: card.path, sessionId, mode: 'play', userName: '玩家' },
    get target() { return target }, get persistence() { return persistence },
    async restoreDetached() {
      // Recreate the native Session from only persisted JSON, including its header.
      const saved = JSON.parse(await readFile(eventsPath, 'utf8'))
      target = { session: Session.fromRestore(sessionId, saved.events, saved.header) }
      storage = createSessionStablePrefixStorage(join(root, 'prefix'))
    },
    async checkpoint() { await flush(target.session) },
    async continueWithAgent() {
      const seed = JSON.parse(await readFile(eventsPath, 'utf8')).events
      for (const handle of handles) await handle.dispose()
      handles.clear()
      await createAgent(seed)
      // Reconnect saved prefix before first request, as the host opening boundary does.
      await ensureSessionStablePrefix(target.session, '', storage)
      target.agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '继续。' }], source: { kind: 'human' } })
      await target.agent.whenIdle()
    },
    async dispose() { for (const handle of handles) await handle.dispose(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  }
}
