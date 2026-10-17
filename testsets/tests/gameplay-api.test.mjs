import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameplayApi } from '../../tavern-plugin/lib/gameplay-api.js'

function fixture() {
  const saved = new Map(), chats = new Map(), calls = []
  let script = false, busy = false
  const controller = {
    agents: { selectForNextRequest(agent, selected) { calls.push(['selection', selected]) } },
    async create(request) { calls.push(['native-create', request]) },
    async prompt(request) { calls.push(['native-prompt', request]); return { accepted: true } },
    async cancel(request) { calls.push(['cancel', request]) }
  }
  const registry = { get: () => ({}) }
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

test('candidate API uses formal last native message and rejects stale dynamic choices', async () => {
  const f = fixture(), created = await f.api.call('create', config)
  await f.api.call('candidates', { sessionId: created.sessionId })
  assert.equal(f.calls.find(([kind]) => kind === 'submitTask')[1].messageId, 'assistant-1')
  created.chat.candidates = { requestId: 'r1', messageId: 'assistant-1', choices: [{ type: 'action', text: 'Open the letter.' }] }
  await assert.rejects(f.api.call('send', { sessionId: created.sessionId, inputFrom: { candidate: 1 }, previousRequestId: 'stale' }), /已变化/)
  const sent = await f.api.call('send', { sessionId: created.sessionId, inputFrom: { candidate: 1 }, previousRequestId: 'r1' })
  assert.equal(sent.input, 'Open the letter.')
})

test('cancel targets the active background operation instead of leaving it running', async () => {
  const f = fixture(), created = await f.api.call('create', config)
  f.busy()
  await f.api.call('cancel', { sessionId: created.sessionId })
  assert.ok(f.calls.some(([kind]) => kind === 'cancel'))
  assert.equal(f.calls.find(([kind]) => kind === 'stopBackground')[1].operationId, 'bg-operation')
})

test('cancelling a persisted cold test session is idempotent after service restart', async () => {
  const f = fixture(), created = await f.api.call('create', config)
  f.registry.get = () => undefined
  assert.equal((await f.api.call('cancel', { sessionId: created.sessionId })).cancelled, true)
  assert.equal(f.calls.filter(([kind]) => kind === 'cancel').length, 0)
})
