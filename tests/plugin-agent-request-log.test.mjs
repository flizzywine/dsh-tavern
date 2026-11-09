import {createPresentationObservers} from '../tavern-plugin/lib/domain/presentation-observers.js'
import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'

function memoryLog() {
  const files = new Map()
  let stamp = 1000
  return createModelRequestLog({
    readJson: async path => { const value = files.get(path); return typeof value === 'string' ? JSON.parse(value) : structuredClone(value) },
    writeJson: async (path, value) => { files.set(path, structuredClone(value)) },
    updateJson: async (path, updater) => { files.set(path, structuredClone(await updater(structuredClone(files.get(path))))) },
    writeText: async (path, text) => { files.set(path, text) },
    remove: async path => { files.delete(path) },
    now: () => ++stamp, id: () => 'r' + stamp
  })
}

function install(log, headers, pluginSettlementProgress, beginReplyObserver, emitted, agentRegistry = { get: () => undefined }, worldbookRecallLog = { requested: async () => {} }) {
  let stream
  const game = { id: 'chat-game', mode: 'story', requestMode: 'sillytavern' }
  const ctx = { on(name, fn) { if (name === 'llm/stream') stream = fn }, llm: {}, get() {}, logger: () => ({ warn() {} }) }
  const observers = createPresentationObservers()
  if (beginReplyObserver) observers.register("test", {beginReply:beginReplyObserver})
  registerModelStreamHooks({
    ctx, agentRegistry,
    sessionStore: { get: id => headers[id] && { id, header: headers[id] }, flush() {} },
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined },
    chatForSession: async () => undefined,
    chatHeaderForSession: async id => id === 'session-game' ? game : undefined,
    foregroundStrategies: { projectRequest: () => null, completeRequest() {} },
    fullTemplateRuntime: {}, modelRequestLog: log, pluginSettlementProgress, openReplyObservers:observers.openReply, requestCoordinates: new Map([['session-game', { turn: 2, step: 1 }]]), str: value => typeof value === 'string' ? value : '',
    sessionStateForSession: async () => null, updateChat: async () => {}, worldbookRecallLog, runtimePrompt: () => '', storyRetention: async () => ({})
  })
  return async (sessionId, signal) => {
    const chunks = []
    for await (const chunk of stream({ sessionId, signal, messages: [{ role: 'user', content: [{ type: 'text', text: '结算' }] }] }, async function * () { if (emitted) yield * emitted(); else { yield { type: 'text-delta', text: '好' }; yield { type: 'finish', reason: { kind: 'stop' } } } })) chunks.push(chunk)
    return chunks
  }
}

test('世界书请求日志关联不抢在模型流启动前拼接提示词', async () => {
  const events = []
  const send = install(memoryLog(), {}, null, null, async function * () {
    events.push('provider-started')
    yield { type: 'text-delta', text: '正文' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }, undefined, { requested: async () => { events.push('recall-log') } })
  await send('session-game')
  assert.deepEqual(events, ['provider-started', 'recall-log'])
})

test('正文等待首字及流中停顿超过 90 秒仍可继续，不被当作用户停止', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const cancellations = []
  let resume, ready
  const paused = new Promise(resolve => { ready = resolve })
  const gate = new Promise(resolve => { resume = resolve })
  let resumeAgain, readyAgain
  const pausedAgain = new Promise(resolve => { readyAgain = resolve })
  const gateAgain = new Promise(resolve => { resumeAgain = resolve })
  const log = memoryLog()
  const send = install(log, {}, null, null, async function * () {
    ready(); await gate
    yield { type: 'text-delta', text: '开头' }
    readyAgain(); await gateAgain
    yield { type: 'text-delta', text: '结尾' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }, { get: () => ({ cancel: reason => cancellations.push(reason) }) })
  const result = send('session-game')
  // Attach immediately so the old watchdog's rejection is observed by the test.
  result.catch(() => {})
  await paused
  t.mock.timers.tick(120000)
  resume()
  // If the stream failed, propagate that failure rather than waiting for its next pause.
  await Promise.race([pausedAgain, result])
  t.mock.timers.tick(120000)
  resumeAgain()
  assert.equal((await result).map(chunk => chunk.text || '').join(''), '开头结尾')
  assert.deepEqual(cancellations, [])
  assert.equal((await log.evidence('chat-game')).requests[0].response.error, null)
})

test('用户主动停止仍能结束不响应的模型流，不必等待接口返回', async () => {
  const controller = new AbortController()
  let resume, ready
  const paused = new Promise(resolve => { ready = resolve })
  const gate = new Promise(resolve => { resume = resolve })
  const send = install(memoryLog(), {}, null, null, async function * () {
    ready(); await gate
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const result = send('session-game', controller.signal)
  result.catch(() => {})
  await paused
  controller.abort()
  try { await assert.rejects(result, /模型请求已停止/) }
  finally { resume() }
})

test('传输截断已有正文时按输出上限收尾，不把已显示的文字丢掉', async () => {
  const cancellations = []
  const send = install(memoryLog(), {}, null, null, async function * () {
    yield { type: 'text-delta', text: '未完成正文' }
  }, { get: () => ({ cancel: reason => cancellations.push(reason) }) })
  const chunks = await send('session-game')
  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'max-tokens')
  assert.equal(chunks.at(-1).reason.recoveredFrom, 'interrupted')
  assert.deepEqual(cancellations, [])
})

test('一个字都没写就缺少结束标记时仍按流中断报错', async () => {
  const send = install(memoryLog(), {}, null, null, async function * () {
    yield { type: 'reasoning-delta', text: '只有思考，没有正文' }
  })
  await assert.rejects(send('session-game'), /未收到完整结束标记/)
})

test('a plugin agent created under a game is logged as that game\'s background request', async () => {
  const log = memoryLog()
  await log.record({ chat: { id: 'chat-game' }, coordinates: { turn: 7 }, options: { sessionId: 'session-game', messages: [] } })
  const events = []
  const send = install(log, { 'na-session-game': { parentSession: 'session-game' }, 'stray': { parentSession: 'elsewhere' } }, { model: (game, event) => events.push(game + ':' + event) })
  assert.equal((await send('na-session-game')).length, 2, 'the response still streams through')
  assert.deepEqual(events, ['session-game:start', 'session-game:output', 'session-game:end'], 'the game\'s plugin settlement progress follows its agent')
  await send('stray')
  const found = await log.latestForSession('na-session-game')
  assert.equal(found.scope, 'background')
  assert.equal(found.task, 'subagent')
  assert.equal(found.turn, 7, 'filed under the game\'s latest turn')
  assert.equal(found.request.messages[0].content[0].text, '结算')
  assert.equal(await log.latestForSession('stray'), null, 'agents outside a game are not logged')
})

test('the real model-stream hook keeps foreground story text when a provider ends with an error', async () => {
  const beginnings = []; let shown = '', cancelled = 0
  const begin = (...args) => { beginnings.push(args.slice(0,2)); return { update: text => { shown = text }, cancel: () => cancelled++, discard() {} } }
  const send = install(memoryLog(), {}, null, begin, async function * () {
    yield { type: 'reasoning-delta', text: 'Reasoning is not story.' }
    yield { type: 'text-delta', text: 'Story.\n' }
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider finish_reason: error', code: 'PI_AI_ERROR' } } }
  })
  const chunks = await send('session-game')
  assert.equal(chunks.length, 3, 'text and reasoning deltas still stream through unchanged')
  assert.equal(chunks.at(-1).reason.kind, 'max-tokens')
  assert.equal(chunks.at(-1).reason.recoveredFrom, 'error')
  assert.deepEqual(beginnings, [['session-game', 2]])
  assert.equal(shown, 'Story.\n')
  assert.equal(cancelled, 0)
  await send('unrelated')
  assert.equal(beginnings.length, 1)
})

test('内容审核掐断仍走失败清理，不把被拦截的半截正文当成完整回复', async () => {
  let cancelled = 0
  const begin = () => ({ update() {}, cancel: () => cancelled++, discard() {} })
  const send = install(memoryLog(), {}, null, begin, async function * () {
    yield { type: 'text-delta', text: '被审核掐断的半截正文' }
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider finish_reason: content_filter', code: 'PI_AI_ERROR' } } }
  })
  const chunks = await send('session-game')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(cancelled, 1)
})

test('a plugin settlement reports which plugin is settling and whether its agent is producing output', async () => {
  const { createPluginSettlementProgress } = await import('../tavern-plugin/lib/domain/plugin-settlement-progress.js')
  let clock = 1000
  const progress = createPluginSettlementProgress({ now: () => clock })
  const finish = progress.begin('session-game', 'anchor')
  assert.deepEqual(progress.snapshot('session-game'), { phase: 'preparing', startedAt: 1000, lastProgressAt: 1000, plugin: 'anchor' })
  clock = 2000; progress.model('session-game', 'start')
  clock = 3000; progress.model('session-game', 'output')
  assert.equal(progress.snapshot('session-game').phase, 'model')
  assert.equal(progress.snapshot('session-game').lastProgressAt, 3000)
  progress.model('session-game', 'end')
  assert.equal(progress.snapshot('session-game').phase, 'tool')
  finish()
  assert.equal(progress.snapshot('session-game'), null)
})

test('a hung presentation initializer cannot hold up the real foreground stream', async () => {
  let resolve, cancelled = 0
  const pending = new Promise(done => { resolve = done })
  const send = install(memoryLog(), {}, null, () => pending)
  const chunks = await send('session-game')
  assert.equal(chunks.map(chunk => chunk.text || '').join(''), '好')
  resolve({update() { assert.fail('finished request must not be revived') }, cancel() { cancelled++ }})
  await new Promise(done => setImmediate(done))
  assert.equal(cancelled, 1)
})
