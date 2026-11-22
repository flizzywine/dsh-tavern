import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'

function presetMessage(phase, text) {
  return {
    role: 'system',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', sections: [{ name: 'tavern:runtime-preset-' + phase, text }] }
  }
}

function storageFixture() {
  const files = new Map()
  const operations = []
  let stamp = 1000
  const adapters = {
    readJson: async path => {
      operations.push(['read', path])
      return structuredClone(files.get(path))
    },
    writeJson: async (path, value) => {
      operations.push(['write', path])
      files.set(path, structuredClone(value))
    },
    updateJson: async (path, updater) => {
      files.set(path, structuredClone(await updater(structuredClone(files.get(path)))))
    },
    now: () => stamp,
    id: () => 'fixture'
  }
  return { files, operations, adapters, advance: () => { stamp += 250 } }
}

test('并发请求的完成结果互不串写，缺少状态文件仍可查看正文', async () => {
  const fixture = storageFixture()
  let sequence = 0
  const log = createModelRequestLog({ ...fixture.adapters, id: () => String(++sequence) })
  const first = await log.record({ chat: { id: 'chat' }, options: { messages: [presetMessage('back', '一')] } })
  const second = await log.record({ chat: { id: 'chat' }, options: { messages: [presetMessage('front', '二')] } })
  await Promise.all([
    log.complete({ chatId: 'chat', id: second.id, text: '结果二' }),
    log.complete({ chatId: 'chat', id: first.id, text: '结果一' })
  ])
  assert.deepEqual((await log.evidence('chat')).requests.map(item => item.response.text), ['结果一', '结果二'])
  fixture.files.delete('model-requests/chat/' + first.id + '.result.json')
  const evidence = await log.evidence('chat')
  assert.equal(evidence.requests[0].status, 'running')
  assert.equal(evidence.requests[0].phases.back[0].content[0].text, '一')
  await log.complete({ chatId: 'chat', id: first.id, text: '恢复结果' })
  assert.equal((await log.evidence('chat')).requests[0].response.text, '恢复结果')
})

test('结果记录用量（含缓存写入的 TTL 分段）、计时和中断状态', async () => {
  const fixture = storageFixture()
  let sequence = 0
  const log = createModelRequestLog({ ...fixture.adapters, id: () => String(++sequence) })
  const context = { scope: 'background', task: 'stage-director', turn: 2, window: { first: 3, through: 7, extra: true } }
  const done = await log.record({ chat: { id: 'chat' }, context, coordinates: { frame: { name: 'f' } }, options: { sessionId: 's' } })
  const cut = await log.record({ chat: { id: 'chat' }, context: { task: 'compaction' }, options: { sessionId: 's' } })
  const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 30, cacheWrite1hTokens: 20, cacheWrite5mTokens: 10, costUsd: 0.1 }
  await log.complete({ chatId: 'chat', id: done.id, text: '好', finish: { kind: 'stop' }, usage, timing: { firstTokenMs: 12 } })
  await log.complete({ chatId: 'chat', id: cut.id, text: '半' })
  const [first, second] = (await log.evidence('chat')).requests
  assert.equal(first.status, 'completed')
  assert.deepEqual(first.usage, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 30, cacheWrite1hTokens: 20, cacheWrite5mTokens: 10 })
  assert.deepEqual(first.timing, { firstTokenMs: 12 })
  assert.deepEqual(first.window, { first: 3, through: 7 })
  assert.equal(first.task, 'stage-director')
  assert.deepEqual((await log.list('chat'))[0].window, { first: 3, through: 7 })
  assert.equal(second.task, 'compaction')
  assert.equal(second.status, 'interrupted')
  assert.match(second.response.error, /中断/)
})

test('请求凭据脱敏不修改原请求或提示词内容', async () => {
  let stored
  const log = createModelRequestLog({ readJson: async () => undefined, writeJson: async (path, value) => { if (value.request) stored = value }, updateJson: async (_path, fn) => fn(undefined) })
  const options = { sessionId: 's', apiKey: 'secret-a', headers: new Headers({ Authorization: 'Bearer secret-b', 'X-Api-Key': 'secret-c', Accept: 'application/json' }), config: { access_token: 'secret-d' }, messages: [{ role: 'user', content: '不要改写 apiKey 这段文字' }] }
  await log.record({ chat: { id: 'chat' }, options })
  for (const secret of ['secret-a', 'secret-b', 'secret-c', 'secret-d']) assert.equal(JSON.stringify(stored).includes(secret), false)
  assert.equal(stored.request.headers.accept, 'application/json')
  assert.deepEqual(stored.request.messages, options.messages)
  assert.equal(options.apiKey, 'secret-a')
  assert.equal(options.headers.get('Authorization'), 'Bearer secret-b')
})

test('同一轮的大量请求原文按每局大小上限清理，并可整理已有记录', async () => {
  const files = new Map(), removed = []
  const adapters = {
    readJson: async path => structuredClone(files.get(path)),
    writeJson: async (path, value) => files.set(path, structuredClone(value)),
    updateJson: async (path, fn) => files.set(path, fn(structuredClone(files.get(path)))),
    remove: async path => { removed.push(path); files.delete(path) },
    size: async path => files.has(path) ? JSON.stringify(files.get(path)).length : 0
  }
  const log = createModelRequestLog(adapters)
  const big = 'x'.repeat(3 * 1024 * 1024)
  const ids = []
  for (let step = 1; step <= 8; step++) {
    const item = await log.record({ chat: { id: 'c' }, coordinates: { turn: 1, step }, options: { sessionId: 's', messages: [{ role: 'user', content: [{ type: 'text', text: big + step }] }] } })
    ids.push(item.id)
  }
  const index = await log.list('c')
  // About 3 MB each: the newest two fit in 8 MB, the older six go.
  assert.deepEqual(index.filter(entry => entry.pruned).map(entry => entry.step), [1, 2, 3, 4, 5, 6])
  assert.equal((await log.detail('c', ids[7])).request.messages[0].content[0].text, big + 8)
  // Rows written before sizes were recorded are measured by the maintenance pass.
  await adapters.updateJson('model-requests/c/index.json', value => ({ ...value, requests: value.requests.map(({ bytes, ...entry }) => entry) }))
  for (const id of ids.slice(0, 6)) files.set('model-requests/c/' + id + '.json', { request: big })
  await adapters.updateJson('model-requests/c/index.json', value => ({ ...value, requests: value.requests.map(entry => ({ ...entry, pruned: false })) }))
  const result = await log.prune('c')
  assert.equal(result.pruned, 6)
  assert.equal((await log.list('c')).filter(entry => entry.pruned).length, 6)
})

test('latestForSession 附带同会话上一条请求的 cacheDiff，并在状态从 running 变为 completed 时返回新结果', async () => {
  const fixture = storageFixture()
  let sequence = 0
  const log = createModelRequestLog({ ...fixture.adapters, id: () => String(++sequence) })
  const r1 = await log.record({
    chat: { id: 'c1' },
    coordinates: { turn: 1, step: 1 },
    options: { sessionId: 's1', model: 'claude-sonnet', system: 'sys', messages: [{ role: 'user', content: 'u1' }] }
  })
  await log.complete({ chatId: 'c1', id: r1.id, text: 'a1', finish: { kind: 'stop' } })

  const r2 = await log.record({
    chat: { id: 'c1' },
    coordinates: { turn: 2, step: 1 },
    options: { sessionId: 's1', model: 'claude-sonnet', system: 'sys', messages: [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }] }
  })
  const runningView = await log.latestForSession('s1')
  assert.equal(runningView.id, r2.id)
  assert.equal(runningView.status, 'running')
  assert.equal(runningView.cacheDiff.compareStatus, 'compared')
  assert.equal(runningView.cacheDiff.baseline.id, r1.id)
  assert.equal(runningView.cacheDiff.sectionStatus['field:system'], 'hit')
  assert.equal(runningView.cacheDiff.sectionStatus['msg:0'], 'hit')
  assert.equal(runningView.cacheDiff.sectionStatus['msg:1'], 'appended')

  // 仍在 running 时传相同 id + status 返回 unchanged
  assert.deepEqual(await log.latestForSession('s1', r2.id, undefined, { knownStatus: 'running' }), { unchanged: true, id: r2.id })

  // 完成后传旧 status 会拿到带 usage 的最新记录
  await log.complete({ chatId: 'c1', id: r2.id, text: 'a2', finish: { kind: 'stop' }, usage: { inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 10 } })
  const completedView = await log.latestForSession('s1', r2.id, undefined, { knownStatus: 'running' })
  assert.equal(completedView.status, 'completed')
  assert.equal(completedView.cacheDiff.usage.hitRate, 0.8)
})

test('latestForSession 忽略压缩请求、后台 scope 与历史零轮次杂项请求，不误报前台模型切换', async () => {
  const fixture = storageFixture()
  let sequence = 0
  const log = createModelRequestLog({ ...fixture.adapters, id: () => String(++sequence) })

  const r1 = await log.record({
    chat: { id: 'c1' },
    coordinates: { turn: 1, step: 1 },
    options: { sessionId: 's1', model: 'claude-sonnet', system: 'sys', messages: [{ role: 'user', content: 'u1' }] }
  })
  await log.complete({ chatId: 'c1', id: r1.id, text: 'a1', finish: { kind: 'stop' } })

  // 压缩请求使用独立压缩模型，但复用前台 sessionId
  const compact = await log.record({
    chat: { id: 'c1' },
    context: { task: 'compaction', turn: 1 },
    coordinates: { turn: 1 },
    options: { sessionId: 's1', model: 'bg-compact-model', system: 'compact', messages: [{ role: 'user', content: 'summarize' }] }
  })
  await log.complete({ chatId: 'c1', id: compact.id, text: 'summary', finish: { kind: 'stop' } })

  // 后台 scope 或旧版生图规划误带前台 sessionId（turn=0, agentTurn=0）
  const bgSameSession = await log.record({
    chat: { id: 'c1' },
    context: { scope: 'background', task: 'stage-director', turn: 1 },
    options: { sessionId: 's1', model: 'bg-director-model', system: 'director', messages: [{ role: 'user', content: 'direct' }] }
  })
  await log.complete({ chatId: 'c1', id: bgSameSession.id, text: 'ok', finish: { kind: 'stop' } })

  const legacyPlanner = await log.record({
    chat: { id: 'c1' },
    coordinates: {},
    options: { sessionId: 's1', model: 'claude-sonnet', system: '图图', messages: [{ role: 'user', content: 'plan' }] }
  })
  await log.complete({ chatId: 'c1', id: legacyPlanner.id, text: '<image/>', finish: { kind: 'stop' }, usage: { inputTokens: 215, cacheReadTokens: 25344 } })

  // 下一轮开始前查看前台完整上下文，应停留在 r1 而非压缩/后台/零轮次请求
  const beforeTurn2 = await log.latestForSession('s1', '', undefined, { scope: 'foreground' })
  assert.equal(beforeTurn2.id, r1.id)
  assert.equal(beforeTurn2.cacheDiff.compareStatus, 'no-previous')

  const r2 = await log.record({
    chat: { id: 'c1' },
    coordinates: { turn: 2, step: 1 },
    options: { sessionId: 's1', model: 'claude-sonnet', system: 'sys', messages: [{ role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }] }
  })
  const turn2View = await log.latestForSession('s1', '', undefined, { scope: 'foreground' })
  assert.equal(turn2View.id, r2.id)
  assert.equal(turn2View.cacheDiff.compareStatus, 'compared')
  assert.equal(turn2View.cacheDiff.baseline.id, r1.id)
  assert.equal(turn2View.cacheDiff.modelChanged, false)
  assert.equal(turn2View.cacheDiff.breakPoint, null)
  assert.equal(turn2View.cacheDiff.sectionStatus['field:system'], 'hit')
  assert.equal(turn2View.cacheDiff.sectionStatus['msg:0'], 'hit')
  assert.equal(turn2View.cacheDiff.sectionStatus['msg:1'], 'appended')
})

test('runPlanner 对游戏 sessionId 加命名空间，不与前台会话串用导致误记为前台请求', async () => {
  const { runPlanner } = await import('../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner.js')
  const seen = []
  const fakeLlm = {
    async * stream(req) {
      seen.push(req.sessionId)
      yield { type: 'text-delta', text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  await runPlanner(fakeLlm, { provider: 'p', model: 'bg-model', system: 's', text: 't', sessionId: 'game-session-1' })
  await runPlanner(fakeLlm, { provider: 'p', model: 'bg-model', system: 's', text: 't', sessionId: 'dsh-image-workbench' })
  assert.deepEqual(seen, ['dsh-image-planner:game-session-1', 'dsh-image-workbench'])
})
