import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createCardResponseTest } from '../tavern-plugin/lib/domain/card-response-test.js'

function fixture(options = {}) {
  const saved = new Map(), calls = [], events = [], requests = []
  const chat = { id: 'chat', messages: [], settleStatus: 'done' }
  const sessionId = 'test-' + randomUUID()
  let turn = 0, seq = 0
  const api = { async call(method, args) {
    calls.push({ method, args })
    if (method === 'create') return { sessionId, chat, model: args.model, requiresBrowser: options.browser, error: options.createError }
    if (method === 'native') return { events: structuredClone(events) }
    if (method === 'requests') return { requests: structuredClone(requests) }
    if (method === 'state') return { chat: structuredClone(chat), activity: { busy: false } }
    if (method === 'cancel') return { cancelled: true }
    if (method === 'send') {
      turn++
      if (options.hang) return { accepted: true }
      const input = args.input ?? chat.candidates.choices[args.inputFrom.candidate - 1].text
      const text = options.text ?? '她走进花园，向你招手。'
      events.push({ seq: ++seq, type: 'turn/start', data: { turn } }, { seq: ++seq, type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text }] } } }, { seq: ++seq, type: 'turn/end', data: { turn, reason: { kind: options.nativeError ? 'error' : 'completed' } } })
      chat.messages.push({ role: 'user', text: input }, { role: 'assistant', text, turn })
      chat.settleStatus = options.settleError ? 'error' : 'done'
      chat.settleError = options.settleError
      requests.push({ id: 'r' + turn, scope: 'foreground', task: 'story', status: options.nativeError ? 'failed' : 'completed', response: { text, error: options.providerError } })
      return { accepted: true }
    }
    if (method === 'candidates') {
      requests.push({ id: 'c' + turn, scope: 'background', task: 'candidate', status: 'completed', response: { text: options.candidateRefusal ? '我无法提供此类内容。' : '可选行动' } })
      chat.candidates = { requestId: 'c' + turn, messageId: 'm' + turn, choices: [{ type: 'action', text: '走进花园' }] }
      return {}
    }
    throw new Error(method)
  } }
  const store = { readJson: async key => structuredClone(saved.get(key)), writeJson: async (key, value) => saved.set(key, structuredClone(value)) }
  const service = createCardResponseTest({ api, store, chatForSession: async id => ({ mode: id === 'story' ? 'story' : 'card' }), pollMs: 1, timeoutMs: options.timeoutMs ?? 500 })
  const config = { action: 'configure', name: '温和副本试玩', sourceCard: 'gentle.json', provider: 'fixture', model: 'test', steps: [{ input: '你好' }, { input: '继续' }] }
  async function start(overrides = {}) {
    const configured = await service.execute('owner', { ...config, ...overrides })
    assert.equal(calls.length, 0, 'configure must not invoke gameplay')
    return service.execute('owner', { action: 'start', caseId: configured.scenario.caseId })
  }
  return { service, saved, calls, start, config, store }
}

test('候选项生成和选择都通过正式 API，记录实际选择', async () => {
  const f = fixture()
  const started = await f.start({ steps: [{ input: '你好', candidates: true }, { inputFrom: { candidate: 1, type: 'action' } }] })
  const report = await f.service.execute('owner', { action: 'status', sessionId: started.sessionId })
  assert.equal(report.status, 'completed')
  assert.equal(report.rounds[1].input, '走进花园')
  assert.equal(report.rounds[1].selection.requestId, 'c1')
  assert.equal(f.calls.filter(c => c.method === 'candidates').length, 1)
  assert.deepEqual(f.calls.filter(c => c.method === 'send')[1].args.inputFrom, { candidate: 1, type: 'action' })
})

for (const [name, options, status] of [
  ['拒绝证据', { text: '抱歉，我无法帮助完成这个请求。' }, 'refused'],
  ['服务商拒绝', { providerError: 'content_filter' }, 'refused'],
  ['执行失败', { nativeError: true }, 'error'],
  ['空回复', { text: '' }, 'error'],
  ['结算失败', { settleError: '更新失败' }, 'error'],
  ['超时', { hang: true, timeoutMs: 15 }, 'error']
]) test(name + ' 不误报通过并停止剩余轮次', async () => {
  const f = fixture(options)
  const started = await f.start()
  const report = await f.service.execute('owner', { action: 'status', sessionId: started.sessionId })
  assert.equal(report.status, status)
  assert.equal(report.rounds[0].status, status)
  assert.equal(report.skippedRounds, 1)
  assert.equal(f.calls.filter(c => c.method === 'send').length, 1)
})

test('工作台隔离、阻止重复并发，取消和重启均不当成通过', async () => {
  const f = fixture({ hang: true })
  await assert.rejects(f.service.execute('story', f.config), /工作台/)
  const started = await f.start()
  await assert.rejects(f.service.execute('other', { action: 'status', sessionId: started.sessionId }), /不属于/)
  const caseId = started.scenario.caseId
  await assert.rejects(f.service.execute('other', { action: 'start', caseId }), /不属于/)
  await assert.rejects(f.service.execute('owner', { action: 'start', caseId }), /已有测试/)
  assert.equal((await f.service.execute('owner', { action: 'cancel', sessionId: started.sessionId })).status, 'cancelled')
  const key = 'automation/response-' + started.sessionId + '.json'
  await f.store.writeJson(key, { ...started, status: 'running' })
  assert.equal((await f.service.execute('owner', { action: 'status', sessionId: started.sessionId })).status, 'error')
})

test('案例输入完整校验，包括候选依赖', async () => {
  const f = fixture()
  for (const steps of [[], [{ inputFrom: { candidate: 1 } }], [{ input: '' }], [{ input: 'a' }, { inputFrom: { candidate: 1 } }], [{ input: 'a', candidates: 'yes' }], [{ input: 'a', candidates: true }, { input: 'b', inputFrom: { candidate: 1 } }]]) {
    await assert.rejects(f.service.execute('owner', { ...f.config, steps }))
  }
  assert.equal(f.calls.length, 0)
})
