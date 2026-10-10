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

function install(log, headers, pluginSettlementProgress) {
  let stream
  const game = { id: 'chat-game', mode: 'story', requestMode: 'dsh' }
  const ctx = { on(name, fn) { if (name === 'llm/stream') stream = fn }, llm: {}, get() {}, logger: () => ({ warn() {} }) }
  registerModelStreamHooks({
    ctx, agentRegistry: { get: () => undefined },
    sessionStore: { get: id => headers[id] && { id, header: headers[id] }, flush() {} },
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined },
    chatForSession: async () => undefined,
    chatHeaderForSession: async id => id === 'session-game' ? game : undefined,
    foregroundStrategies: { projectRequest: () => null, completeRequest() {} },
    fullTemplateRuntime: {}, modelRequestLog: log, pluginSettlementProgress, requestCoordinates: new Map(), str: value => typeof value === 'string' ? value : '',
    sessionStateForSession: async () => null, updateChat: async () => {}, worldbookRecallLog: {}, runtimePrompt: () => '', storyRetention: async () => ({})
  })
  return async sessionId => {
    const chunks = []
    for await (const chunk of stream({ sessionId, messages: [{ role: 'user', content: [{ type: 'text', text: '结算' }] }] }, async function * () { yield { type: 'text-delta', text: '好' }; yield { type: 'finish', reason: { kind: 'stop' } } })) chunks.push(chunk)
    return chunks
  }
}

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
