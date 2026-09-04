import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
let descriptor
vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(() => ({}))

function hostFixture(result = { ok: true, value: 'tavern' }) {
  const calls = []
  const ctx = {
    // alpha.2 separates workspace CRUD, UI navigation, and Remote operations.
    workspaces: { create: async () => ({ workspaceId: 'w1' }) },
    sessions: {
      async create({ workspaceId }) {
        assert.equal(this, ctx.sessions)
        calls.push(['create', workspaceId])
        return 's' + calls.filter(call => call[0] === 'create').length
      }
    },
    uiWorkspace: {
      async connectWorkspace(id) {
        assert.equal(this, ctx.uiWorkspace)
        calls.push(['connect', id])
        return 's1'
      }
    },
    remote: { agentPresets: {
      async select(sessionId, preset) {
        assert.equal(this, ctx.remote.agentPresets)
        calls.push(['preset', sessionId, preset])
        return result
      }
    } }
  }
  return { ctx, calls }
}

test('alpha.2 shared startup adapter creates a fresh Session and selects through Remote', async () => {
  for (const [kind, targetMode, preset] of [['play', 'story', 'tavern'], ['play', 'free', 'tavern'], ['card', 'card', 'tavern']]) {
    const { ctx, calls } = hostFixture()
    const host = client.createConversationHostAdapter(ctx)
    const lifecycle = client.createConversationLifecycleModule({
      archiveCurrent: async () => {}, resolveWorkspace: async () => 'w1',
      connectWorkspace: host.connectWorkspace, ensurePreset: host.ensurePreset,
      waitForSession: async id => calls.push(['ready', id]),
      createChat: async () => calls.push(['chat']), rememberPending: () => {},
      finishOpen: async () => calls.push(['open'])
    })
    const result = await lifecycle.start({ kind, targetMode })
    assert.equal(result.sessionId, 's1')
    assert.deepEqual(calls, [['create', 'w1'], ['ready', 's1'], ['preset', 's1', preset], ['chat'], ['open']])
  }
})

test('alpha.2 prewarm and startup use the same adapter without creating a second Session', async () => {
  const { ctx, calls } = hostFixture()
  const host = client.createConversationHostAdapter(ctx)
  const prewarm = client.createConversationPrewarmModule({
    sessionIds: () => [], resolveWorkspace: async () => 'w1',
    connectWorkspace: host.connectWorkspace, archiveSession: async () => {}
  })
  await prewarm.begin({ key: 'card1' })
  const prepared = await prewarm.claim('card1')
  assert.equal(prepared, 's1')
  const lifecycle = client.createConversationLifecycleModule({
    archiveCurrent: async () => {}, resolveWorkspace: async () => 'w1',
    connectWorkspace: host.connectWorkspace, ensurePreset: host.ensurePreset,
    waitForSession: async () => {}, createChat: async () => {},
    rememberPending: () => {}, finishOpen: async () => {}
  })
  await lifecycle.start({ kind: 'play', preparedSessionId: prepared })
  assert.deepEqual(calls, [['create', 'w1'], ['preset', 's1', 'tavern']])
})

test('two new conversations never reuse a blank Session with an existing Tavern opening', async () => {
  const { ctx, calls } = hostFixture()
  const host = client.createConversationHostAdapter(ctx)
  assert.equal(await host.connectWorkspace('w1'), 's1')
  assert.equal(await host.connectWorkspace('w1'), 's2')
  assert.deepEqual(calls, [['create', 'w1'], ['create', 'w1']])
})

test('workspace selection uses alpha.2 workspaceId and the current Session owner', () => {
  const host = client.createConversationHostAdapter(hostFixture().ctx)
  const snapshot = { items: [{ workspaceId: 'w1', sessionIds: [] }, { workspaceId: 'w2', sessionIds: ['s2'] }] }
  assert.equal(host.workspaceId(snapshot, 's2'), 'w2')
  assert.equal(host.workspaceId(snapshot, undefined), 'w1')
  assert.equal(host.workspaceId({ items: [] }, undefined), '')
})

test('Remote refusal aborts startup before writing a Tavern chat', async () => {
  const { ctx } = hostFixture({ ok: false, error: { message: 'preset refused' } })
  const host = client.createConversationHostAdapter(ctx)
  let written = false
  const lifecycle = client.createConversationLifecycleModule({
    archiveCurrent: async () => {}, resolveWorkspace: async () => 'w1',
    connectWorkspace: host.connectWorkspace, ensurePreset: host.ensurePreset,
    waitForSession: async () => {}, createChat: async () => { written = true },
    rememberPending: () => {}, finishOpen: async () => {}
  })
  await assert.rejects(lifecycle.start({ kind: 'play' }), error => error.message === 'preset refused' && error.phase === '切换到酒馆模式')
  assert.equal(written, false)
})

test('DSHA 1.1 legacy connection API can select the Tavern preset', async () => {
  const calls = []
  const ctx = {
    sessions: { create: async () => 's1' },
    connection: { api: { agentPresets: {
      async select(payload) {
        calls.push(payload)
        return { result: { ok: true, value: { agentPreset: payload.agentPreset } } }
      }
    } } }
  }

  const host = client.createConversationHostAdapter(ctx)
  await host.ensurePreset('s1', { kind: 'play' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, 's1')
  assert.equal(calls[0].agentPreset, 'tavern')
})

test('sidebar and prewarm are wired to the host adapter, with required services injected', () => {
  assert.ok(client.inject.includes('conversation'))
  assert.ok(client.inject.includes('remote'))
  assert.equal(client.inject.includes('uiConversation'), false)
  assert.equal(client.inject.includes('remote.agentPresets'), false)
  assert.match(source, /ctx\.get\("uiConversation"\) \|\| ctx\.get\("conversation"\)/)
  assert.match(source, /conversationHost: createConversationHostAdapter\(ctx\)/)
  assert.equal((source.match(/props\.conversationHost\.connectWorkspace\(targetWorkspaceId\)/g) || []).length, 2)
  assert.match(source, /props\.conversationHost\.ensurePreset\(sessionId, request\)/)
  assert.doesNotMatch(source, /props\.workspaces\.connectWorkspace|props\.connection\.api|noteAgentPreset/)
  const cleanup = source.slice(source.indexOf('async function archiveCurrentBlankSession'), source.indexOf('async function waitForSessionSummary'))
  assert.match(cleanup, /history\.some\(function \(entry\) \{ return entry\.sessionId === current; \}\)/)
})

test('play status tab receives the host conversation service when it is opened', () => {
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props, children } }
  }
  const runtime = descriptor.factory(id => id === 'react' ? React : {})
  const uiConversation = { binding() {} }
  let statusTab
  const ctx = {
    sessions: {},
    remote: { commands: { execute() {} } },
    betterSidebar: {
      registerTab(tab) {
        if (tab.id === 'dsh-tavern:status') statusTab = tab
        return () => {}
      }
    },
    get(id) {
      return id === 'conversation' ? uiConversation : undefined
    },
    effect(start) { return start() }
  }
  const slots = {
    inject(_name, register) { return register() },
    register() { return () => {} }
  }

  runtime.createPlayControlsFeatureModule().register({ ctx, slots })
  const rendered = statusTab.component({ scope: { sessionId: 's1' } })

  assert.equal(rendered.props.uiConversation, uiConversation)
  assert.equal(rendered.props.sessionId, 's1')
})

test('conversation Chat binding adapts both current and DSHA 1.1 read interfaces', () => {
  const modernChat = { subscribe() {}, getSnapshot() { return { legacy: { nodes: ['modern'] } } } }
  const binding = {
    session: {
      subscribe() {},
      getSnapshot() { return { chat: { legacy: { nodes: ['legacy'] } } } }
    }
  }
  const modernConversation = { binding(value) {
    assert.equal(value, binding)
    return { target(name) {
      assert.equal(name, 'chat')
      return modernChat
    } }
  } }

  assert.equal(client.resolveConversationChatBinding(modernConversation, binding), modernChat)
  const legacyChat = client.resolveConversationChatBinding({}, binding)
  assert.deepEqual(legacyChat.getSnapshot().legacy.nodes, ['legacy'])
})
