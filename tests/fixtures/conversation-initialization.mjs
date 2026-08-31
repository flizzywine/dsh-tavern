import { createConversationInitialization } from '../../tavern-plugin/lib/domain/conversation-initialization.js'
import { createPlayCardSnapshots } from '../../tavern-plugin/lib/domain/play-card-snapshots.js'
import { createContextPlanner } from '../../tavern-plugin/lib/domain/context-planner.js'
import { createTavernConversationRegistry } from '../../tavern-plugin/lib/domain/tavern-conversation-registry.js'

export function initializationFixture() {
  const saved = new Map(), sessions = new Map(), writes = [], trace = []
  const card = { path: 'cards/one.json', name: '测试角色', first_mes: '{{user}}，你好。', alternate_greetings: ['第二个开场白'], description: '固定描述', personality: '固定性格', scenario: '固定场景', mes_example: '固定示例', system_prompt: '逐轮系统', post_history_instructions: '逐轮后置', customUnknown: { keep: true } }
  const state = { script: undefined, extensions: {}, settings: { compatibilityMode: true }, preset: { planId: 'preset', regexScripts: [], unknown: 'preserved' }, failures: {}, links: {}, index: { chats: [] }, reads: 0, presetReads: 0 }
  let sequence = 0
  async function fail(name, ...args) { const hook = state.failures[name]; if (hook) return hook(...args) }
  async function write(chat, metadata) {
    trace.push(metadata.source)
    await fail('write', chat, metadata)
    saved.set(chat.id, structuredClone(chat)); writes.push({ chat: structuredClone(chat), metadata })
  }
  const registry = createTavernConversationRegistry({ store: {
    readLinks: async () => structuredClone(state.links),
    updateLinks: async fn => { const next = await fn(structuredClone(state.links)); if (next !== undefined) state.links = next },
    readIndex: async () => structuredClone(state.index),
    writeIndex: async value => { await fail('index', value); state.index = structuredClone(value) },
    readChat: async id => saved.has(id) ? structuredClone(saved.get(id)) : undefined,
    writeChat: write, removeChat: async id => saved.delete(id)
  } })
  function session(id = 'session') {
    if (!sessions.has(id)) {
      const object = { id, events: [], durable: [], phase: { kind: 'idle', lastTurn: 0 },
        append(type, data, intent) {
          const hook = state.failures.append
          if (hook) hook(type, data, object)
          this.events.push({ type, data: structuredClone(data), seq: this.events.length, time: 123, ...(intent || {}) })
        }
      }
      sessions.set(id, object)
    }
    return sessions.get(id)
  }
  function make() {
    const snapshots = createPlayCardSnapshots({
      worldBooks: { bound: async () => ({ view: { entries: [{ constant: true, content: '固定世界书' }, { constant: false, content: '动态世界书' }] } }) },
      planner: createContextPlanner({ prompt: () => '' }), readCard: async () => structuredClone(card), writeChat: write
    })
    return createConversationInitialization({
      cards: { read: async path => { state.reads++; await fail('card'); return path === card.path ? structuredClone(card) : undefined }, readChat: async () => structuredClone(card), script: async () => structuredClone(state.script), extensions: async () => structuredClone(state.extensions) },
      chats: { resolve: registry.resolve, publish: registry.publish, write }, snapshots,
      presets: { fullSnapshot: async () => { state.presetReads++; await fail('preset'); return structuredClone(state.preset) } },
      settings: async () => state.settings, cardGreeting: () => '卡片工作台开场白', emptyCardWorkspace: () => ({ mountedResources: [], draft: {} }),
      id: prefix => prefix + '-' + ++sequence, now: () => 123,
      native: {
        async wait(id) { trace.push('wait'); await fail('wait'); const target = session(id); return { session: target, agent: { phase: target.phase } } },
        async ensurePrefix(target, text) { trace.push('prefix'); await fail('prefix'); target.prefix ||= text },
        async flush(target) { trace.push('flush'); await fail('flush', target); target.durable = structuredClone(target.events) },
        selection: () => ({ provider: 'fixture', model: 'text' })
      },
      present: async chat => { await fail('present'); return structuredClone(chat) }, logger: { warn() {} }
    })
  }
  return { make, card, state, sessions, session, saved, writes, trace, registry, input: { cardPath: card.path, sessionId: 'session', mode: 'play', userName: '玩家' } }
}
