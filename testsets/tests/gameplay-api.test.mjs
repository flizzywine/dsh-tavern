import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameplayApi } from '../../tavern-plugin/lib/gameplay-api.js'

function fixture({ modern = false } = {}) {
  const saved = new Map(), chats = new Map(), calls = []
  let script = false, busy = false
  // 0.2.2 removes selectForNextRequest and selects through the Agent instead.
  const controller = {
    ...(modern ? {} : { agents: { selectForNextRequest(agent, selected) { calls.push(['selection', selected]) } } }),
    async create(request) { calls.push(['native-create', request]) },
    async prompt(request) { calls.push(['native-prompt', request]); return { accepted: true } },
    async cancel(request) { calls.push(['cancel', request]) }
  }
  const registry = { get: () => modern
    ? { model: { select: selected => calls.push(['agent-model-select', selected]) } }
    : {} }
  const api = createGameplayApi({ controller: () => controller, registry,
    llm: { resolveCallConfig: async model => model }, dataRoot: '/formal/data',
    store: { readJson: async key => saved.get(key), writeJson: async (key, value) => saved.set(key, value) },
    listCards: async () => [{ path: 'cards/public.json', name: 'Public' }],
    chatForSession: async id => chats.get(id),
    requiresBrowser: async () => script,
    requestIndex: async () => [{ sessionId: 'child-1' }], native: async id => [{ id }],
    async dispatch(method, args) {
      calls.push([method, args])
      if (method === 'startChat') chats.set(args.sessionId, { id: 'chat', sessionId: args.sessionId, mode: 'story', messages: [] })
      if (method === 'getSessionActivity') return { activity: { busy, operationId: busy ? 'bg-operation' : '' } }
      if (method === 'getSession') return { view: { latestAssistantMessageId: 'assistant-1' } }
      return {}
    }
  })
  return { api, calls, chats, registry, script: () => { script = true }, busy: () => { busy = true } }
}
const config = { sourceCard: 'public.json', model: { provider: 'test', model: 'model', reasoningEffort: 'high' } }

test('script runtimes, busy sessions and unrelated evidence cannot be silently bypassed', async () => {
  const f = fixture(), created = await f.api.call('create', config)
  await assert.rejects(f.api.call('send', { sessionId: 'ordinary-user-session', input: 'x' }), /独立会话/)
  await assert.rejects(f.api.call('native', { sessionId: created.sessionId, nativeSessionId: 'other-private' }), /不属于/)
  assert.deepEqual((await f.api.call('native', { sessionId: created.sessionId, nativeSessionId: 'child-1' })).events, [{ id: 'child-1' }])
  f.busy()
  await assert.rejects(f.api.call('send', { sessionId: created.sessionId, input: 'x' }), /尚未完成/)
  f.script()
  await assert.rejects(f.api.call('send', { sessionId: created.sessionId, input: 'x' }), /浏览器脚本运行时/)
  assert.equal(f.calls.filter(([kind]) => kind === 'native-prompt').length, 0)
})

test('DSH 0.2.2 hosts select through agent.model on create and send', async () => {
  const f = fixture({ modern: true })
  const created = await f.api.call('create', config)
  assert.equal(created.error, undefined, created.error)
  const selections = f.calls.filter(([kind]) => kind === 'agent-model-select')
  assert.equal(selections.length, 1)
  assert.deepEqual(selections[0][1], config.model)
  const sent = await f.api.call('send', { sessionId: created.sessionId, input: '继续' })
  assert.equal(sent.accepted, true)
  assert.equal(f.calls.filter(([kind]) => kind === 'agent-model-select').length, 2)
  assert.equal(f.calls.some(([kind]) => kind === 'selection'), false)
})

test('0.2.1 hosts still select through the session controller', async () => {
  const f = fixture()
  const created = await f.api.call('create', config)
  assert.equal(created.error, undefined, created.error)
  assert.equal(f.calls.filter(([kind]) => kind === 'selection').length, 1)
})
