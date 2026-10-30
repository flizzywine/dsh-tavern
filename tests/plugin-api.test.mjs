import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createPluginMedia, pluginMediaRange, pluginMediaSession, slicePluginMediaStream, pluginFileMediaType } from '../tavern-plugin/lib/domain/plugin-media.js'
import { createTavernPluginApi, TAVERN_PLUGIN_API_VERSION } from '../tavern-plugin/lib/plugin-api.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'

function memoryStore() {
  const files = new Map()
  return {
    files,
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, updater) {
      const next = await updater(files.has(path) ? structuredClone(files.get(path)) : undefined)
      if (next !== undefined) files.set(path, structuredClone(next))
      return next
    },
    async remove(path) { files.delete(path) },
    async version(path) { return files.has(path) ? 1 : undefined },
    async writeJson(path, value) { files.set(path, structuredClone(value)) }
  }
}

const image = { attachmentId: 'a1', mediaType: 'image/png', bytes: 10, width: 2, height: 2 }

test('插件媒体：只接受本轮发出过的正文版本，按插件隔离修改与删除', async () => {
  const store = memoryStore()
  const media = createPluginMedia({ store, now: () => 1, id: () => 'u1' })
  await assert.rejects(media.attach({ chatId: 'c', sessionId: 's', owner: 'p', turn: 2, key: 'old', currentKey: 'cur', item: { kind: 'image', attachment: image } }), /不属于这一轮/)
  await media.issue('c', 2, 'old')
  const record = await media.attach({ chatId: 'c', sessionId: 's', owner: 'p', turn: 2, key: 'old', currentKey: 'cur', item: { kind: 'image', status: 'pending', anchor: '她推开门。' } })
  assert.equal(pluginMediaSession(record.id), 's')
  assert.equal(record.status, 'pending')
  await assert.rejects(media.patch({ chatId: 'c', owner: 'other', itemId: record.id, changes: { status: 'failed' } }), /不属于本插件/)
  await assert.rejects(media.patch({ chatId: 'c', owner: 'p', itemId: record.id, changes: { status: 'ready' } }), /必须带 attachment/)
  await assert.rejects(media.patch({ chatId: 'c', owner: 'p', itemId: record.id, changes: { turn: 3 } }), /不能修改/)
  const ready = await media.patch({ chatId: 'c', owner: 'p', itemId: record.id, changes: { status: 'ready', attachment: image, progress: 1 } })
  assert.equal(ready.anchor, '她推开门。', '补丁未提到的字段保留')
  assert.equal(await media.remove({ chatId: 'c', owner: 'other', itemId: record.id }), false)
  assert.equal(await media.remove({ chatId: 'c', owner: 'p', itemId: record.id }), true)
  assert.deepEqual(await media.list({ chatId: 'c' }), [])
})

test('插件媒体：Range 与文件类型', async () => {
  assert.deepEqual(pluginMediaRange('bytes=2-4', 10), { start: 2, end: 4 })
  assert.deepEqual(pluginMediaRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.deepEqual(pluginMediaRange('bytes=8-', 10), { start: 8, end: 9 })
  assert.equal(pluginMediaRange('bytes=12-', 10).invalid, true)
  assert.equal(pluginMediaRange(undefined, 10), null)
  async function * chunks() { yield Buffer.from('abc'); yield Buffer.from('defg'); yield Buffer.from('hij') }
  const parts = []
  for await (const part of slicePluginMediaStream(chunks(), 2, 7)) parts.push(Buffer.from(part).toString())
  assert.equal(parts.join(''), 'cdefgh')
  assert.equal(pluginFileMediaType('a.MP4'), 'video/mp4')
  assert.equal(pluginFileMediaType('evil.html'), 'application/octet-stream')
})

async function loadCordis() {
  if (!process.env.DSH_BOOT_MODULE) return null
  const require = createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE))
  return await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
}
const cordis = await loadCordis()
const tick = () => new Promise(resolve => setTimeout(resolve, 20))

function turnMaterial(overrides = {}) {
  return { chatId: 'chat-1', sessionId: 'game-1', turn: 3, index: 5, key: 'key-3', sourceDigest: 'd', source: '<b>她</b>推开门。', text: '她推开门。', card: { path: '/cards/a.json', name: 'A' }, ...overrides }
}

async function harness(t, overrides = {}) {
  const root = new cordis.Context()
  const store = memoryStore()
  const media = createPluginMedia({ store })
  const published = []
  let latest = turnMaterial()
  let api
  const warnings = []
  await root.plugin({ name: 'dsh-tavern-test-host', apply(ctx) {
    api = createTavernPluginApi({
      ctx, media, logger: { warn(message) { warnings.push(message) } },
      resolveGame: async sessionId => sessionId === 'game-1' ? { chatId: 'chat-1', sessionId } : null,
      currentKey: async () => latest.key,
      readTurn: async (sessionId, turn) => sessionId === 'game-1' && turn === latest.turn ? latest : null,
      readLatestSettledTurn: async () => latest,
      readCardContext: async () => ({ description: 'd', personality: '', scenario: '', lore: [] }),
      backgroundModel: async () => ({ provider: 'p', model: 'm', reasoningEffort: 'low', extra: 'x' }),
      publish: sessionId => published.push(sessionId),
      ...overrides
    })
    ctx.provide('tavern', api.service)
  } })
  t.after(() => root.registry?.clear?.())
  // Plugin failures are logged; newest first, like the old per-game panel.
  const errors = () => warnings.map(line => line.match(/^dsh-tavern: 插件 (.+?) 在「(.+?)」出错: ([\s\S]*)$/)).filter(Boolean)
    .map(([, plugin, stage, message]) => ({ plugin, stage, message })).reverse()
  return { root, api, media, published, errors, setLatest(value) { latest = value } }
}

test('provider APIs：capabilities、克隆输入、卡绑定筛选与 Cordis 卸载撤销', { skip: !cordis }, async t => {
  let cardPath = '/cards/a.json'
  const h = await harness(t, {
    cardScope: async () => new Map([['card-provider', { cards: ['/cards/a.json'] }]]),
    cardPathOf: async () => cardPath,
    readPendingTurn: async () => turnMaterial()
  })
  let tavern
  const seen = []
  const fiber = await h.root.plugin({ name: 'card-provider', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.mvuSettlementProvider({ name: 'state', settle: async input => {
      seen.push(input)
      input.currentVariables.stat_data.hp = 0
      return { operations: [{ op: 'replace', path: '/stat_data/hp', valueJson: '2' }] }
    } })
  } })
  await tick()
  assert.equal(tavern.apiVersion, 6)
  assert.deepEqual(tavern.capabilities, { mvuSettlementProvider: 1, worldbookStrategy: 1 })
  assert.equal(Object.isFrozen(tavern.capabilities), true)
  assert.equal(tavern.mvuProviderRegistered, undefined, 'registration guard is internal, not a plugin service method')
  assert.equal(h.api.mvuProviderRegistered('card-provider'), true)
  const input = { gameId: 'game-1', turn: 3, textVersion: 'caller-version', currentVariables: { stat_data: { hp: 10 } }, signal: new AbortController().signal }
  assert.deepEqual(await h.api.mvuProvider(input), { owner: 'card-provider', operations: [{ op: 'replace', path: '/stat_data/hp', valueJson: '2' }] })
  assert.equal(input.currentVariables.stat_data.hp, 10, 'provider only mutates its structured clone')
  assert.equal(seen[0].signal, input.signal, 'callback receives the active cancellation signal')
  assert.equal(seen[0].textVersion, 'key-3', 'provider sees the same canonical version as getTurn')
  cardPath = '/cards/other.json'
  assert.equal(await h.api.mvuProvider(input), null, 'a plugin bound to another card is not a candidate')
  cardPath = '/cards/a.json'
  await fiber.dispose()
  await tick()
  assert.equal(h.api.mvuProviderRegistered('card-provider'), false)
  assert.equal(await h.api.mvuProvider(input), null, 'Cordis dispose revokes registration')
})

test('provider APIs：未绑定、多候选與迟到卸载结果均不接管；异常与主动 decline 分开', { skip: !cordis }, async t => {
  let owners = new Map([['one-provider', { cards: ['/cards/a.json'] }], ['two-provider', { cards: ['/cards/a.json'] }]])
  const h = await harness(t, { cardScope: async () => owners, cardPathOf: async () => '/cards/a.json', readPendingTurn: async () => turnMaterial() })
  let resolveSlow
  const slow = new Promise(resolve => { resolveSlow = resolve })
  const fibers = []
  for (const name of ['one-provider', 'two-provider']) {
    fibers.push(await h.root.plugin({ name, inject: ['tavern'], apply(ctx) {
      ctx.tavern.mvuSettlementProvider({ name: 'state', settle: () => name === 'one-provider' ? slow : null })
    } }))
  }
  await tick()
  const input = { gameId: 'game-1', turn: 3, textVersion: 'v1' }
  assert.equal(await h.api.mvuProvider(input), null, 'multiple candidates are never chosen randomly')
  owners = new Map()
  assert.equal(await h.api.mvuProvider(input), null, 'an unbound provider is ignored')

  owners = new Map([['one-provider', { cards: ['/cards/a.json'] }]])
  const pending = h.api.mvuProvider(input)
  await tick()
  await fibers[0].dispose()
  resolveSlow({ operations: [] })
  assert.equal(await pending, null, 'unload during callback invalidates late results')
  assert.equal(h.errors().some(item => /多个卡内提供器候选/.test(item.message)), true)
  await fibers[1].dispose()
})

test('provider APIs：取消信号终止正在等待的插件回调', { skip: !cordis }, async t => {
  const h = await harness(t, {
    cardScope: async () => new Map([['cancel-provider', { cards: ['/cards/a.json'] }]]),
    cardPathOf: async () => '/cards/a.json', readPendingTurn: async () => turnMaterial()
  })
  let fiber
  await h.root.plugin({ name: 'cancel-provider', inject: ['tavern'], apply(ctx) {
    ctx.tavern.mvuSettlementProvider({ name: 'wait', settle: () => new Promise(() => {}) })
  } }).then(value => { fiber = value })
  await tick()
  const controller = new AbortController()
  const pending = h.api.mvuProvider({ gameId: 'game-1', turn: 3, signal: controller.signal })
  controller.abort(new Error('cancelled'))
  await assert.rejects(pending, /cancelled/)
  await fiber.dispose()
})

test('MVU provider：decline为null，异常保持为异常，正文版本变化使迟到结果失效', { skip: !cordis }, async t => {
  let latest = turnMaterial()
  let settleNow = () => null
  let resolveStarted
  let resolveLate
  const started = new Promise(resolve => { resolveStarted = resolve })
  const late = new Promise(resolve => { resolveLate = resolve })
  const h = await harness(t, {
    cardScope: async () => new Map([['version-provider', { cards: ['/cards/a.json'] }]]),
    cardPathOf: async () => '/cards/a.json',
    readPendingTurn: async () => latest
  })
  let fiber
  fiber = await h.root.plugin({ name: 'version-provider', inject: ['tavern'], apply(ctx) {
    ctx.tavern.mvuSettlementProvider({ name: 'state', settle(input) {
      resolveStarted(input.textVersion)
      return settleNow()
    } })
  } })
  await tick()
  const input = { gameId: 'game-1', turn: 3 }
  assert.equal(await h.api.mvuProvider(input), null, 'null is an intentional decline')
  assert.equal(await started, 'key-3')
  settleNow = () => { throw new Error('provider failed') }
  await assert.rejects(h.api.mvuProvider(input), /provider failed/, 'exception is not treated as decline')
  settleNow = () => late
  const pending = h.api.mvuProvider(input)
  await tick()
  latest = turnMaterial({ key: 'key-3b' })
  resolveLate({ operations: [] })
  assert.equal(await pending, null, 'a changed canonical key invalidates the late result')
  await fiber.dispose()
})

test('tavern 服务：按调用插件识别归属，插件卸载后自动撤销监听与提示词段落', { skip: !cordis }, async t => {
  const h = await harness(t)
  const seen = []
  let tavern
  const fiber = await h.root.plugin({ name: 'image-plugin', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.onTurnSettled(turn => seen.push(turn))
    ctx.tavern.promptSection({ name: 'rules', text: ({ gameId }) => '为 ' + gameId + ' 配图' })
  } })
  await tick()
  assert.equal(tavern.apiVersion, TAVERN_PLUGIN_API_VERSION)
  await h.api.turnSettled('game-1')
  await h.api.turnSettled('game-1')
  await tick()
  assert.equal(seen.length, 1, '同一正文版本只通知一次')
  assert.equal(seen[0].textVersion, 'key-3')
  assert.equal(seen[0].card.name, 'A')
  assert.equal(seen[0].rawText, '<b>她</b>推开门。')
  assert.equal(seen[0].variables, null, '没有提供变量读取时为 null')
  assert.deepEqual(await h.api.promptSections({ gameId: 'game-1' }), [{ name: 'tavern-plugin:image-plugin:rules', text: '为 game-1 配图' }])

  const { id } = await tavern.attach({ gameId: 'game-1', turn: 3, textVersion: seen[0].textVersion, item: { kind: 'image', status: 'pending' } })
  assert.deepEqual(h.published, ['game-1'])
  const listed = await tavern.list({ gameId: 'game-1' })
  assert.equal(listed[0].owner, 'image-plugin')
  assert.equal(listed[0].current, true)
  const updated = await tavern.update(id, { status: 'ready', attachment: image })
  assert.equal(updated.status, 'ready')

  let other
  await h.root.plugin({ name: 'other-plugin', inject: ['tavern'], apply(ctx) { other = ctx.tavern } })
  await tick()
  assert.deepEqual(await other.list({ gameId: 'game-1' }), [], '只看得到自己挂的项')
  await assert.rejects(other.update(id, { caption: 'x' }), /不属于本插件/)
  assert.equal(await other.remove(id), false)

  await fiber.dispose()
  await tick()
  h.setLatest(turnMaterial({ key: 'key-3b' }))
  await h.api.turnSettled('game-1')
  await tick()
  assert.equal(seen.length, 1, '卸载后不再通知')
  assert.deepEqual(await h.api.promptSections({ gameId: 'game-1' }), [])
})

test('tavern 服务：读取接口与错误隔离', { skip: !cordis }, async t => {
  const h = await harness(t)
  let tavern
  await h.root.plugin({ name: 'reader', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.onTurnSettled(() => { throw new Error('插件自己的错误') })
    ctx.tavern.promptSection({ name: 'broken', text: () => { throw new Error('boom') } })
  } })
  await tick()
  await h.api.turnSettled('game-1')
  await tick()
  assert.deepEqual(await h.api.promptSections({ gameId: 'game-1' }), [], '段落出错时跳过，不影响正文')
  assert.equal((await tavern.getTurn({ gameId: 'game-1', turn: 3 })).text, '她推开门。')
  assert.equal(await tavern.getTurn({ gameId: 'game-1', turn: 9 }), null)
  assert.deepEqual(await tavern.backgroundModel({ gameId: 'game-1' }), { provider: 'p', model: 'm', reasoningEffort: 'low' })
  assert.equal((await tavern.getCardContext({ gameId: 'game-1', turn: 3 })).description, 'd')
  await assert.rejects(tavern.getCardContext({ gameId: 'game-1', turn: 9 }), /还没写完/)
  await assert.rejects(tavern.attach({ gameId: 'game-1', turn: 3, textVersion: 'never-issued', item: { kind: 'x/y' } }), /不属于这一轮/)
  const { attach } = tavern
  await assert.rejects(attach({ gameId: 'game-1', turn: 3, textVersion: 'key-3', item: { kind: 'x/y' } }), /tavern\.方法名/)
})

test('tavern 服务 v2：本轮上下文、世界书来源、结算说明与结算工具，出错只丢自己这一份，卸载后撤销', { skip: !cordis }, async t => {
  const h = await harness(t, { reservedToolNames: ['posture_submit'] })
  const calls = []
  let tavern
  const fiber = await h.root.plugin({ name: 'memory-plugin', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.turnSection({ name: 'state', text: ({ gameId, turn, input }) => '【当前状态】' + gameId + '/' + turn + '/' + input })
    ctx.tavern.turnSection({ name: 'broken', text: () => { throw new Error('boom') } })
    assert.throws(() => ctx.tavern.turnSection({ name: 'odd', text: 'x', position: 'middle' }), /position/)
    ctx.tavern.worldbookSource({ name: 'session', entries: ({ input }) => [{ title: '支线', content: '与' + input + '有关的线索' }, { content: '  ' }] })
    ctx.tavern.settlementSection({ name: 'anchor', text: ({ turn }) => '第 ' + turn + ' 轮请记录叙事锚点' })
    ctx.tavern.settlementTool({ name: 'anchor_submit', description: '提交叙事锚点', parameters: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async ({ gameId, turn, arguments: args }) => { calls.push([gameId, turn, args.text]); if (args.text === 'bad') throw new Error('写入失败'); return { ok: true } } })
  } })
  await tick()
  assert.equal(tavern.apiVersion, TAVERN_PLUGIN_API_VERSION)
  assert.throws(() => tavern.settlementTool({ name: 'posture_submit', description: 'x', parameters: { type: 'object' }, execute() {} }), /Tavern 自己的工具/)
  assert.throws(() => tavern.settlementTool({ name: 'anchor_submit', description: 'x', parameters: { type: 'object' }, execute() {} }), /已被注册/)
  assert.throws(() => tavern.settlementTool({ name: 'Bad-Name', description: 'x', parameters: { type: 'object' }, execute() {} }), /工具名/)

  const context = await h.api.turnContext({ gameId: 'game-1', turn: 4, input: '推门' })
  assert.deepEqual(context.map(section => [section.name, section.worldbook === true, section.text]), [
    ['tavern-plugin:memory-plugin:state', false, '【当前状态】game-1/4/推门'],
    ['tavern-plugin:memory-plugin:session', true, '[支线] 与推门有关的线索']
  ], 'the failing section is skipped, the others stay')

  assert.deepEqual(h.api.settlement.tools().map(tool => tool.name), ['anchor_submit'])
  assert.deepEqual((await h.api.settlement.sections({ gameId: 'game-1', turn: 4 })).map(section => section.text), ['第 4 轮请记录叙事锚点'])
  const call = h.api.settlement.calls({ gameId: 'game-1', turn: 4 })
  assert.deepEqual(JSON.parse(await call('anchor_submit', { text: '门' })), { ok: true })
  assert.match(JSON.parse(await call('anchor_submit', { text: 'bad' })).error, /写入失败/, 'a plugin error is returned to the model, not thrown')
  assert.deepEqual(calls, [['game-1', 4, '门'], ['game-1', 4, 'bad']])
  for (let index = 0; index < 6; index++) await call('anchor_submit', { text: 'x' })
  assert.match(JSON.parse(await call('anchor_submit', { text: 'x' })).error, /上限/)

  tavern.candidateSection({ name: 'tone', text: ({ gameId }) => gameId + ' 的候选偏向探索' })
  tavern.compactionSection({ name: 'keep', text: '摘要里保留叙事锚点' })
  assert.deepEqual((await h.api.candidate.sections({ gameId: 'game-1' })).map(note => note.text), ['game-1 的候选偏向探索'])
  assert.deepEqual((await h.api.compactionNotes({ gameId: 'game-1' })).map(note => note.text), ['摘要里保留叙事锚点'])

  await fiber.dispose()
  await tick()
  assert.deepEqual(await h.api.turnContext({ gameId: 'game-1', turn: 4, input: '推门' }), [])
  assert.deepEqual(h.api.settlement.tools(), [])
  assert.deepEqual(await h.api.compactionNotes({ gameId: 'game-1' }), [])
  assert.match(JSON.parse(await call('anchor_submit', {})).error, /不可用/)
})

test('插件存档数据：按轮数据绑定正文版本，回退与重新生成后自然读不到旧版本，撤销后恢复；整局数据不随剧情变', { skip: !cordis }, async t => {
  const store = memoryStore()
  // The story line: turn -> the text version currently shown.
  const shown = new Map([[1, 'v1'], [2, 'v2'], [3, 'v3']])
  const h = await harness(t, { data: createPluginData({ store }), currentKey: async (_sessionId, turn) => shown.get(turn) ?? null })
  const changes = []
  let mem, other
  await h.root.plugin({ name: 'memory', inject: ['tavern'], apply(ctx) { mem = ctx.tavern; ctx.tavern.onTimelineChanged(change => changes.push(change)) } })
  await h.root.plugin({ name: 'other', inject: ['tavern'], apply(ctx) { other = ctx.tavern } })
  await tick()
  assert.deepEqual(await mem.saveTurnData({ gameId: 'game-1', turn: 2, data: { hp: 8 } }), { turn: 2, textVersion: 'v2' })
  await mem.saveTurnData({ gameId: 'game-1', turn: 3, textVersion: 'v3', data: { hp: 5 } })
  await assert.rejects(mem.saveTurnData({ gameId: 'game-1', turn: 3, textVersion: 'old', data: {} }), /当前显示/)
  await assert.rejects(mem.saveTurnData({ gameId: 'game-1', turn: 9, data: {} }), /不存在/)
  await assert.rejects(mem.saveTurnData({ gameId: 'game-1', turn: 2, data: { big: 'x'.repeat(70000) } }), /64 KB/)
  assert.deepEqual(await mem.readTurnData({ gameId: 'game-1', turn: 3 }), { turn: 3, textVersion: 'v3', data: { hp: 5 } })
  assert.deepEqual(await mem.readTurnData({ gameId: 'game-1', turn: 1 }), null)
  assert.equal(await other.readTurnData({ gameId: 'game-1', turn: 3 }), null, 'each plugin sees only its own data')

  shown.set(3, 'v3-regenerated')
  assert.deepEqual(await mem.readTurnData({ gameId: 'game-1', turn: 3 }), { turn: 2, textVersion: 'v2', data: { hp: 8 } }, 'regenerated: the old version is not read')
  shown.delete(3)
  assert.equal((await mem.readTurnData({ gameId: 'game-1', turn: 5 })).turn, 2, 'rolled back')
  shown.set(3, 'v3')
  assert.deepEqual((await mem.readTurnData({ gameId: 'game-1', turn: 3 })).data, { hp: 5 }, 'undo restores it without any sync')
  await mem.saveTurnData({ gameId: 'game-1', turn: 3, data: null })
  assert.equal((await mem.readTurnData({ gameId: 'game-1', turn: 3 })).turn, 2, 'null clears the turn')

  await mem.saveGameData({ gameId: 'game-1', data: { seen: 3 } })
  shown.delete(2)
  assert.deepEqual(await mem.readGameData({ gameId: 'game-1' }), { seen: 3 })
  assert.equal(await other.readGameData({ gameId: 'game-1' }), null)
  await assert.rejects(mem.saveGameData({ gameId: 'missing', data: {} }), /不存在/)

  h.api.timelineChanged('game-1', { kind: 'rollback', turn: 3 })
  h.api.timelineChanged('game-1', { kind: 'not-a-kind' })
  await tick()
  assert.deepEqual(changes, [{ gameId: 'game-1', kind: 'rollback', turn: 3, textVersion: 'v3' }])
})

test('分叉：可见的插件数据与媒体按新游戏的正文版本带过去，旧版本与分叉点之后的不带', { skip: !cordis }, async t => {
  const store = memoryStore()
  const data = createPluginData({ store })
  const media = createPluginMedia({ store })
  await data.saveTurn({ chatId: 'chat-1', owner: 'memory', turn: 2, key: 'v2', data: { hp: 8 } })
  await data.saveTurn({ chatId: 'chat-1', owner: 'memory', turn: 2, key: 'v2-old', data: { hp: 1 } })
  await data.saveTurn({ chatId: 'chat-1', owner: 'memory', turn: 4, key: 'v4', data: { hp: 2 } })
  await data.saveGame({ chatId: 'chat-1', owner: 'memory', data: { seen: 1 } })
  await media.issue('chat-1', 2, 'v2')
  await media.attach({ chatId: 'chat-1', sessionId: 'game-1', owner: 'img', turn: 2, key: 'v2', currentKey: 'v2', item: { kind: 'x/y', data: 1 } })
  const h = await harness(t, { data, media })
  assert.deepEqual(await h.api.forkTurns('chat-1'), [2, 4])
  const copied = await h.api.gameForked({ sourceChatId: 'chat-1', targetChatId: 'chat-2', targetSessionId: 'game-2', keyMap: new Map([['2\u0000v2', 'f2']]) })
  assert.deepEqual(copied, { data: 1, media: 1 })
  assert.deepEqual((await data.turnsUpTo({ chatId: 'chat-2', owner: 'memory', turn: 9 })).map(item => [item.turn, item.key, item.data]), [[2, 'f2', { hp: 8 }]])
  assert.deepEqual(await data.readGame({ chatId: 'chat-2', owner: 'memory' }), { seen: 1 })
  const forkedMedia = await media.list({ chatId: 'chat-2' })
  assert.equal(forkedMedia[0].key, 'f2')
  assert.match(forkedMedia[0].id, /^Z2FtZS0y\./, 'new ids belong to the new game')
  assert.equal((await media.list({ chatId: 'chat-1' })).length, 1, 'the source game keeps its own')
})

test('插件出错只丢自己那一份上下文，并记进日志', { skip: !cordis }, async t => {
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }) })
  const seen = []
  await h.root.plugin({ name: 'mem', inject: ['tavern'], apply(ctx) {
    ctx.tavern.onTurnSettled(turn => seen.push(turn.turn))
    ctx.tavern.turnSection({ name: 'state', text: '【状态】' })
    ctx.tavern.settlementTool({ name: 'mem_save', description: '保存', parameters: { type: 'object' }, execute: () => 'ok' })
  } })
  await h.root.plugin({ name: 'flaky', inject: ['tavern'], apply(ctx) { ctx.tavern.turnSection({ name: 'x', text: () => { throw new Error('坏了') } }) } })
  await tick()
  assert.equal((await h.api.turnContext({ gameId: 'game-1', turn: 3, input: '' })).length, 1)
  assert.deepEqual(h.errors().map(item => [item.plugin, item.stage, item.message]), [['flaky', '本轮上下文段落', '坏了']])

  assert.deepEqual(await h.api.settlement.toolNames({ gameId: 'game-1' }), { available: ['mem_save'], unavailable: [] })
  await h.api.turnSettled('game-1')
  await tick()
  assert.deepEqual(seen, [3], 'the other plugin is still notified')
})

test('结算替换：唯一插件自动生效，多个时都不生效，返回不合格或出错时退回 Tavern 自己的结算', { skip: !cordis }, async t => {
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }) })
  const inputs = []
  let answer = { posture: '  她坐在窗边  ' }
  await h.root.plugin({ name: 'anchor', inject: ['tavern'], apply(ctx) { ctx.tavern.replaceSettlement({ settle: async input => { inputs.push(input); return typeof answer === 'function' ? answer() : answer } }) } })
  await tick()
  const settle = (tasks = { posture: true }) => h.api.replaceSettlement({ gameId: 'game-1', turn: 3, text: '她推开门。', posture: '站着', tasks })
  assert.deepEqual(await settle(), { owner: 'anchor', posture: '她坐在窗边' })
  const { signal, ...fields } = inputs[0]
  assert.deepEqual(fields, { gameId: 'game-1', turn: 3, text: '她推开门。', posture: '站着', tasks: { posture: true } })
  assert.equal(signal.aborted, false, 'settle receives an AbortSignal')
  // Stopping the settlement aborts settle's signal and stops waiting, without falling back or recording an error.
  const stop = new AbortController(), started = []
  answer = () => new Promise(() => {})
  const pending = h.api.replaceSettlement({ gameId: 'game-1', turn: 3, text: '', posture: '', tasks: { posture: true }, signal: stop.signal, onStart: owner => { started.push(owner); return () => started.push('done') } })
  await tick()
  stop.abort(new Error('玩家停止'))
  await assert.rejects(pending, /玩家停止/)
  assert.equal(inputs.at(-1).signal.aborted, true)
  assert.deepEqual(started, ['anchor', 'done'])
  assert.equal(h.errors().length, 0)
  answer = { posture: '  她坐在窗边  ' }
  answer = {}
  assert.equal(await settle(), null, 'posture is required while posture settlement is on')
  assert.deepEqual(await settle({ posture: false }), { owner: 'anchor', posture: '' })
  answer = () => { throw new Error('模型超时') }
  assert.equal(await settle(), null)
  assert.match(h.errors()[0].message, /模型超时/)
  answer = { posture: '躺下' }

  await h.root.plugin({ name: 'rival', inject: ['tavern'], apply(ctx) { ctx.tavern.replaceSettlement({ settle: async () => ({ posture: '对手' }) }) } })
  await tick()
  assert.equal(await settle(), null, 'two candidates and no choice: neither applies')
})

test('tavern 服务：删局通知', { skip: !cordis }, async t => {
  const h = await harness(t)
  const removed = []
  await h.root.plugin({ name: 'cleaner', inject: ['tavern'], apply(ctx) { ctx.tavern.onGameRemoved(event => removed.push(event.gameId)) } })
  await tick()
  h.api.gameRemoved('game-1')
  await tick()
  assert.deepEqual(removed, ['game-1'])
})

test('插件轮次读取：真实存储下与生图共用正文版本，未结算的最新一轮不可读', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createChatJournalStore } = await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const { createChatPersistence } = await import('../tavern-plugin/lib/domain/chat-persistence.js')
  const { sceneTarget } = await import('../tavern-plugin/lib/domain/scene-illustration.js')
  const { createSceneWorldbooks, bindSceneWorldbook } = await import('../tavern-plugin/lib/domain/scene-worldbook.js')
  const { createPluginTurnReader } = await import('../tavern-plugin/lib/domain/plugin-turns.js')
  const root = await mkdtemp(join(tmpdir(), 'plugin-turns-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  const db = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const worldbooks = createSceneWorldbooks({ store: memoryStore() })
  const ref = await worldbooks.capture({ worldBook: { view: { entries: [{ ref: 'e1', title: '酒馆', primaryKeys: ['酒馆'], content: '酒馆在城东。' }] } }, chat: {}, card: { name: 'A' } })
  const messages = [
    { role: 'assistant', greeting: true, turn: 1, text: '开场。', swipes: ['开场。'], swipeId: 0 },
    { role: 'user', turn: 2, text: '进门' },
    bindSceneWorldbook({ role: 'assistant', turn: 2, text: '她<b>推开</b>酒馆的门。', swipes: ['她<b>推开</b>酒馆的门。'], swipeId: 0, mvu: { pending: false }, variables: [{ stat_data: { 日期: '初五' } }] }, ref)
  ]
  const chat = await db.write({ id: 'chat-1', sessionId: 'game-1', mode: 'story', cardPath: '/cards/a.json', cardName: 'A', settleStatus: 'pending', messages })
  const reader = createPluginTurnReader({
    sessionState: async () => db.readSessionState(chat.id),
    sceneState: (_sessionId, turns) => db.readSceneImageState(chat.id, { turns }),
    header: async (_sessionId, fields) => (await db.readSlice(chat.id, [], fields))?.chat,
    slice: (_sessionId, indices) => db.readSlice(chat.id, indices),
    fullChat: () => db.read(chat.id),
    readChatCard: async () => ({ name: 'A', description: '{{char}}是酒馆老板。', scenario: '雨夜' }),
    worldbooks
  })
  assert.equal(await reader.readLatestSettledTurn('game-1'), null, '结算完成前不通知')
  assert.equal((await reader.readTurn('game-1', 1)).text, '开场。', '开场白随时可读')
  await db.update(chat.id, current => { current.settleStatus = 'done'; return current })
  const latest = await reader.readLatestSettledTurn('game-1')
  assert.equal(latest.turn, 2)
  assert.equal(latest.key, sceneTarget(await db.read(chat.id), 2).key, '与内置生图同一正文版本')
  assert.equal(latest.text, '她推开酒馆的门。')
  assert.equal(latest.card.name, 'A')
  const context = await reader.readCardContext(latest)
  assert.equal(context.description, 'A是酒馆老板。')
  assert.deepEqual(context.lore, [{ title: '酒馆', keys: ['酒馆'], constant: false, content: '酒馆在城东。' }])
  assert.deepEqual(await reader.readVariables(latest), { stat_data: { 日期: '初五' } }, '结算后的消息变量只读可得')
  assert.equal(await reader.readVariables(await reader.readTurn('game-1', 1)), null, '没有变量时为 null')
  await db.update(chat.id, current => { current.messages[2].swipes.push('另一个版本。'); current.messages[2].swipeId = 1; current.messages[2].variables.push({ stat_data: { 日期: '二十' } }); return current })
  assert.deepEqual(await reader.readVariables(await reader.readTurn('game-1', 2)), { stat_data: { 日期: '二十' } }, '按当前显示的版本读变量')
  assert.notEqual(await reader.currentKey('game-1', 2), latest.key, '换版本后正文版本变化')
  assert.deepEqual((await reader.readCardContext(await reader.readTurn('game-1', 2))).lore, [], '新版本不继承旧版本的世界书快照')
  await db.update(chat.id, current => { current.settleStatus = 'idle'; return current })
  assert.equal((await reader.readLatestSettledTurn('game-1')).turn, 2, '编辑正文或回退后没有待结算的任务，最新一轮仍然可读')
  await db.update(chat.id, current => { current.settleStatus = 'running'; return current })
  assert.equal(await reader.readLatestSettledTurn('game-1'), null, '结算进行中不可读')
})

test('正文切分：标记换成插件元素，锚点媒体放在所在段落之后，找不到的不放', async () => {
  const { segmentPluginText, extractPluginMarkers } = await import('../tavern-plugin/lib/domain/plugin-text-segments.js')
  const text = '她**推开**了门，\n风灌进来。\n\n第二段 image###rain, night### 收尾。\n\n第三段。'
  const result = segmentPluginText(text, { markers: [/image###(.+?)###/g], anchors: [{ id: 'a', anchor: '她推开了门，风灌进来。' }, { id: 'missing', anchor: '没有这句' }, { id: 'c', anchor: '第三段。' }] })
  assert.deepEqual(result.placed, ['a', 'c'])
  assert.deepEqual(result.segments.map(segment => segment.kind), ['text', 'media', 'text', 'marker', 'text', 'media'])
  assert.equal(result.segments[0].text, '她**推开**了门，\n风灌进来。')
  assert.deepEqual(result.segments[3].match, ['image###rain, night###', 'rain, night'])
  assert.equal(result.segments.filter(segment => segment.kind === 'text').map(segment => segment.text).join('') + 'image###rain, night###', text.replace('image###rain, night###', '') + 'image###rain, night###')
  assert.deepEqual(segmentPluginText('abc', { markers: [/x*/] }).segments, [{ kind: 'text', text: 'abc' }], '空匹配不会死循环')
  const crlf = '第一段。\r\n\r\n她推开了门。\r\n\r\n第三段。'
  const crlfResult = segmentPluginText(crlf, { anchors: [{ id: 'door', anchor: '她推开了门。' }] })
  assert.deepEqual(crlfResult.segments.map(segment => segment.kind), ['text', 'media', 'text'], 'Windows 换行的空行也算段落分界')
  assert.equal(crlfResult.segments[0].text, '第一段。\r\n\r\n她推开了门。')
  const html = extractPluginMarkers('<div class="bar">image###a###</div>', [/image###(.+?)###/])
  assert.equal(html.html, '<div class="bar"></div>')
  assert.equal(html.markers.length, 1)
})

test('tavern 服务：handle 注册的处理函数供浏览器侧 callHost 调用，插件卸载后撤销', { skip: !cordis }, async t => {
  const h = await harness(t)
  const fiber = await h.root.plugin({ name: 'drawer', inject: ['tavern'], apply(ctx) {
    ctx.tavern.handle('drawer/draw', async ({ gameId, turn }) => ({ gameId, turn, ok: true }))
    ctx.tavern.handle('drawer/fail', async () => { throw new Error('出错了') })
  } })
  await tick()
  assert.deepEqual(await h.api.callHandler('drawer/draw', { gameId: 'game-1', turn: 3 }), { gameId: 'game-1', turn: 3, ok: true })
  await assert.rejects(h.api.callHandler('drawer/fail', {}), /出错了/)
  await assert.rejects(h.api.callHandler('nobody/draw', {}), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
  await assert.rejects(h.root.plugin({ name: 'other', inject: ['tavern'], apply(ctx) { ctx.tavern.handle('drawer/draw', () => 1) } }).then(tick), /已被注册/)
  fiber.dispose()
  await tick()
  await assert.rejects(h.api.callHandler('drawer/draw', {}), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
})

test('tavern 服务：worldbookEntries 的条目经校验后交给世界书召回，坏条目记入插件错误', { skip: !cordis }, async t => {
  const h = await harness(t, { data: { readSettings: async () => ({ disabled: [] }), updateSettings: async () => {} } })
  const seen = []
  const fiber = await h.root.plugin({ name: 'narrative-anchor', inject: ['tavern'], apply(ctx) {
    ctx.tavern.worldbookEntries({ name: 'session', entries: async context => { seen.push(context); return [
      { id: 'letter', title: '未署名的信', content: '  信是周姨写的。 ', keys: ['那封信', 3], force: true },
      { id: 'letter', content: '重复' },
      { id: 'bad id', content: 'x' },
      { id: 'tpl', content: '<%= 1 %>' },
      { id: 'empty', content: '  ' },
    ] } })
    assert.throws(() => ctx.tavern.worldbookEntries({ name: 'session', entries: () => [] }), /已注册/)
  } })
  await tick()
  const entries = await h.api.worldbookPoolEntries({ gameId: 'game-1', turn: 4 })
  assert.deepEqual(seen, [{ gameId: 'game-1', turn: 4 }])
  assert.deepEqual(entries, [{ owner: 'narrative-anchor', source: 'session', id: 'letter', content: '信是周姨写的。', title: '未署名的信', keys: ['那封信'], secondaryKeys: [], constant: false, force: true }])
  assert.match(h.errors()[0].message, /重复.*bad id.*EJS/)
  await h.api.worldbookPoolEntries({ gameId: 'game-1', turn: 4 })
  assert.equal(h.errors().length, 1, '同一问题每轮多次读取只记一次')
  fiber.dispose()
  await tick()
  assert.deepEqual(await h.api.worldbookPoolEntries({ gameId: 'game-1', turn: 4 }), [])
})

test('tavern 服务：getCard、getHistory 只读；setVariables、editTurn 只改最新一轮的当前版本', { skip: !cordis }, async t => {
  const writes = [], edits = [], ranges = []
  const h = await harness(t, {
    readCard: async sessionId => ({ name: 'A', description: '海边小镇', sessionId }),
    readCardImage: async sessionId => sessionId === 'game-1' ? { url: '/api/dsh-tavern/card-image?path=cards%2Fa.json', mediaType: 'image/png' } : null,
    readHistory: async (sessionId, first, last) => { ranges.push([first, last]); return [{ turn: first, input: '你好', text: '她推开门。', rawText: '<b>她</b>推开门。' }] },
    writeVariables: async (material, variables) => writes.push([material.turn, variables]),
    editText: async (material, text) => edits.push([material.turn, text]),
    readTurn: async (sessionId, turn) => sessionId === 'game-1' ? turnMaterial({ turn, key: 'key-' + turn }) : null,
    data: { readSettings: async () => ({ disabled: [] }), updateSettings: async () => {} },
  })
  let tavern
  await h.root.plugin({ name: 'state-plugin', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await tick()
  const card = await tavern.getCard({ gameId: 'game-1' })
  card.name = '改了'
  assert.equal((await tavern.getCard({ gameId: 'game-1' })).name, 'A', '拿到的是副本')
  assert.deepEqual(await tavern.getCardImage({ gameId: 'game-1' }), { url: '/api/dsh-tavern/card-image?path=cards%2Fa.json', mediaType: 'image/png' })
  await tavern.getHistory({ gameId: 'game-1', from: 2 })
  await tavern.getHistory({ gameId: 'game-1', from: 1, to: 500 })
  assert.deepEqual(ranges, [[2, 51], [1, 50]], '一次最多 50 轮')
  await assert.rejects(tavern.getHistory({ gameId: 'game-1', from: 5, to: 2 }), /to 不能小于 from/)

  assert.deepEqual(await tavern.setVariables({ gameId: 'game-1', turn: 3, textVersion: 'key-3', variables: { stat_data: { 日期: '初五' } } }), { turn: 3, textVersion: 'key-3' })
  assert.deepEqual(writes, [[3, { stat_data: { 日期: '初五' } }]])
  await assert.rejects(tavern.setVariables({ gameId: 'game-1', turn: 3, textVersion: 'old', variables: {} }), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
  await assert.rejects(tavern.setVariables({ gameId: 'game-1', turn: 3, textVersion: 'key-3', variables: [] }), /对象/)
  await tavern.editTurn({ gameId: 'game-1', turn: 3, textVersion: 'key-3', text: '她轻轻推开门。' })
  assert.deepEqual(edits, [[3, '她轻轻推开门。']])

  h.setLatest(turnMaterial({ turn: 4, index: 7, key: 'key-4' }))
  await assert.rejects(tavern.setVariables({ gameId: 'game-1', turn: 3, textVersion: 'key-3', variables: {} }), { code: 'TAVERN_PLUGIN_TURN_UNAVAILABLE' }, '不是最新一轮')
})

test('tavern 服务：runTask 校验工具，模型调用的工具交给插件执行，失败记入插件错误', { skip: !cordis }, async t => {
  let request
  const h = await harness(t, {
    reservedToolNames: ['posture_submit'],
    data: { readSettings: async () => ({ disabled: [] }), updateSettings: async () => {} },
    runTask: async input => {
      request = input
      const ok = await input.call('note_save', { text: '记下' })
      const bad = await input.call('note_fail', {})
      const missing = await input.call('nobody', {})
      return { text: [ok, bad, missing].join('|') }
    },
  })
  let tavern
  await h.root.plugin({ name: 'world-plugin', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await tick()
  const tools = [
    { name: 'note_save', description: '保存', parameters: { type: 'object' }, execute: async ({ text }) => ({ ok: true, text }) },
    { name: 'note_fail', description: '失败', parameters: { type: 'object' }, execute: async () => { throw new Error('写不进去') } },
  ]
  const result = await tavern.runTask({ gameId: 'game-1', prompt: '  推演这十天  ', tools })
  assert.equal(request.prompt, '推演这十天')
  assert.equal(request.owner, 'world-plugin')
  assert.deepEqual(request.tools.map(tool => tool.name), ['note_save', 'note_fail'])
  assert.equal(request.tools[0].execute, undefined, '只把定义交给模型')
  assert.match(result.text, /"text":"记下"/)
  assert.match(result.text, /写不进去/)
  assert.match(result.text, /没有这个工具/)
  assert.match(h.errors()[0].message, /写不进去/)
  await assert.rejects(tavern.runTask({ gameId: 'game-1', prompt: 'x', tools: [{ ...tools[0], name: 'posture_submit' }] }), /已被占用/)
  await assert.rejects(tavern.runTask({ gameId: 'game-1', prompt: ' ' }), /prompt/)
})

test('结算任务：按阶段依次运行，每个正文版本一次，出错只记错误', { skip: !cordis }, async t => {
  const started = []
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }), readPendingTurn: async () => turnMaterial(),
    startManualTask: async input => { started.push(input); return { started: true } },
    runTask: async input => ({ text: input.owner + ':' + input.prompt }) })
  const ran = []
  let agentText = ''
  await h.root.plugin({ name: 'alpha', inject: ['tavern'], apply(ctx) {
    ctx.tavern.settlementTask({ name: 'notes', title: '笔记', run: async input => { ran.push('alpha.notes:' + input.phase + ':' + input.textVersion); agentText = (await input.runAgent({ prompt: '记一下' })).text } })
    ctx.tavern.settlementTask({ name: 'prepare', phase: 'before', run: async () => { ran.push('alpha.prepare') } })
  } })
  await h.root.plugin({ name: 'beta', inject: ['tavern'], apply(ctx) {
    ctx.tavern.settlementTask({ name: 'broken', title: '会出错', run: async () => { ran.push('beta.broken'); throw new Error('坏了') } })
  } })
  await tick()
  assert.throws(() => h.api.service.settlementTask({ name: 'x', phase: 'during', run() {} }))
  const after = () => h.api.runSettlementTasks({ gameId: 'game-1', phase: 'after' })
  await h.api.runSettlementTasks({ gameId: 'game-1', phase: 'before' })
  await after()
  assert.deepEqual(ran, ['alpha.prepare', 'alpha.notes:after:key-3', 'beta.broken'])
  assert.equal(agentText, 'alpha:记一下', 'runAgent runs as the task\'s plugin')
  assert.match(h.errors()[0].message, /坏了/)
  await after()
  assert.equal(ran.length, 3, 'once per text version')

  // Stopping aborts the running task (the last, by plugin name), without recording an error.
  const stop = new AbortController()
  await h.root.plugin({ name: 'gamma', inject: ['tavern'], apply(ctx) {
    ctx.tavern.settlementTask({ name: 'slow', run: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))) })
  } })
  await tick()
  h.setLatest(turnMaterial({ key: 'key-3c' }))
  ran.length = 0
  const pending = h.api.runSettlementTasks({ gameId: 'game-1', phase: 'after', signal: stop.signal })
  while (h.api.runningTask('game-1')?.plugin !== 'gamma') await tick()
  stop.abort()
  await pending
  assert.deepEqual(ran, ['alpha.notes:after:key-3c', 'beta.broken'])
  assert.ok(!h.errors().some(item => item.plugin === 'gamma'), 'stopping is not an error')
  assert.equal(h.api.runningTask('game-1'), null)
})

test('手动任务：玩家或插件启动，带输入，可停止；任务不存在时拒绝', { skip: !cordis }, async t => {
  const started = []
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }), startManualTask: async input => { started.push(input); return { started: true } } })
  const inputs = []
  let release
  let tavern
  await h.root.plugin({ name: 'alpha', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.manualTask({ name: 'summary', title: '总结', description: '总结到目前为止的剧情', input: { label: '侧重点', placeholder: '例如：人物关系' },
      run: async input => { inputs.push(input); await new Promise(resolve => { release = resolve }) } })
  } })
  await tick()
  assert.throws(() => tavern.manualTask({ name: 'bad', input: {}, run() {} }), /input/)
  const panel = await h.api.gamePlugins('game-1')
  assert.deepEqual(panel.tasks.manual, [{ key: 'alpha:summary', plugin: 'alpha', title: '总结', description: '总结到目前为止的剧情', input: { label: '侧重点', placeholder: '例如：人物关系' } }])
  assert.deepEqual(await tavern.startTask({ gameId: 'game-1', name: 'summary', input: '人物' }), { started: true })
  assert.deepEqual(started, [{ gameId: 'game-1', key: 'alpha:summary', input: '人物' }])

  const done = h.api.runManualTask({ gameId: 'game-1', key: 'alpha:summary', input: '  人物关系  ' })
  await tick()
  assert.equal(inputs[0].input, '人物关系')
  assert.equal(inputs[0].turn, 3)
  assert.equal((await h.api.gamePlugins('game-1')).tasks.running.title, '总结')
  await assert.rejects(h.api.manualTaskFor('game-1', 'alpha:summary'), /正在运行/)
  release()
  assert.equal(await done, true)

  const stopped = h.api.runManualTask({ gameId: 'game-1', key: 'alpha:summary' })
  await tick()
  assert.equal(h.api.stopTasks('game-1'), true)
  assert.equal(await stopped, false)
  assert.equal(h.errors().length, 0)

  await assert.rejects(h.api.manualTaskFor('game-1', 'alpha:nothing'), /没有这个插件任务/)
})

test('tavern 服务：getTurnState 给出最新一轮、正文版本、是否在写或在结算；开场白带 greeting', { skip: !cordis }, async t => {
  let pending = turnMaterial({ turn: 4, key: 'key-4' }), settled = turnMaterial(), activity = { generating: false, settling: true }
  const h = await harness(t, {
    readPendingTurn: async () => pending, readLatestSettledTurn: async () => settled, readActivity: async () => activity
  })
  let tavern
  await h.root.plugin({ name: 'battle', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await tick()
  assert.deepEqual(await tavern.getTurnState({ gameId: 'game-1' }),
    { gameId: 'game-1', turn: 4, textVersion: 'key-4', greeting: false, generating: false, settling: true, busy: true, settled: false })
  settled = pending; activity = { generating: false, settling: false }
  const state = await h.api.turnState('game-1')
  assert.equal(state.settled, true); assert.equal(state.busy, false)
  pending = settled = turnMaterial({ turn: 1, key: 'key-1', greeting: true })
  assert.equal((await tavern.getTurnState({ gameId: 'game-1' })).greeting, true)
  await assert.rejects(tavern.getTurnState({ gameId: 'missing' }), /不存在/)
  h.setLatest(turnMaterial({ turn: 1, key: 'key-1', greeting: true }))
  assert.equal((await tavern.getTurn({ gameId: 'game-1', turn: 1 })).greeting, true)
})

test('导入存档：插件数据与媒体按新游戏的正文版本写入，文件引用换成新存的，存不下的媒体项不带', async () => {
  const store = memoryStore()
  const data = createPluginData({ store, now: () => 1 }), media = createPluginMedia({ store, id: () => 'n' })
  await data.saveTurn({ chatId: 'src', owner: 'p', turn: 2, key: 'old2', data: { hp: 3 } })
  await data.saveTurn({ chatId: 'src', owner: 'p', turn: 3, key: 'gone', data: { hp: 1 } })
  await data.saveGame({ chatId: 'src', owner: 'p', data: { level: 4 } })
  await media.issue('src', 2, 'old2')
  await media.attach({ chatId: 'src', sessionId: 's', owner: 'p', turn: 2, key: 'old2', currentKey: 'old2', item: { kind: 'audio', status: 'ready', attachment: { attachmentId: 'a', name: 'x.mp3' } } })
  await media.attach({ chatId: 'src', sessionId: 's', owner: 'p', turn: 2, key: 'old2', currentKey: 'old2', item: { kind: 'video', status: 'ready', attachment: { attachmentId: 'lost', name: 'y.mp4' } } })
  const api = createTavernPluginApi({ ctx: undefined, media, data, logger: { warn() {} } })
  const saved = await api.exportGame('src')
  assert.equal(await api.exportGame('empty'), null)
  const keyMap = new Map([['2\u0000old2', 'new2']])
  const imported = await api.importGame({ targetChatId: 'dst', targetSessionId: 't', keyMap, ...structuredClone(saved),
    attachment: ref => ref.attachmentId === 'a' ? { ...ref, attachmentId: 'a2' } : null })
  assert.deepEqual(imported, { data: 1, media: 1 })
  const turns = await data.turnsUpTo({ chatId: 'dst', owner: 'p', turn: 9 })
  assert.equal(turns.length, 1); assert.equal(turns[0].key, 'new2'); assert.deepEqual(turns[0].data, { hp: 3 })
  assert.deepEqual(await data.readGame({ chatId: 'dst', owner: 'p' }), { level: 4 })
  const items = await media.list({ chatId: 'dst' })
  assert.equal(items.length, 1); assert.equal(items[0].key, 'new2'); assert.equal(items[0].attachment.attachmentId, 'a2')
})

test('人物卡库、改卡、工具可见范围与 Skill：插件不用读写 Tavern 文件', { skip: !cordis }, async t => {
  const raw = { spec: 'chara_card_v2', data: { name: 'A', extensions: {} } }
  const updates = [], skills = new Map([['debug-card', { name: 'debug-card', source: 'builtin', description: '内置', content: '---' }]]), removed = []
  const h = await harness(t, {
    listCards: async () => [{ path: 'cards/a.json', name: 'A', hasImage: true, script: null, group: '常玩', starred: true }, { path: 'cards/b.json', name: 'B', hasImage: false, script: { title: '剧本' }, readError: '坏了' }],
    readCardRaw: async card => card === 'cards/a.json' ? raw : null,
    updateCardRaw: async (card, operations, owner) => { updates.push({ card, operations, owner }); return true },
    isControlledTool: name => name === 'tavern_read_variables',
    skills: {
      list: async () => [...skills.values()],
      read: async name => skills.get(name) || null,
      referenceFiles: async () => [{ path: 'references/a.md', content: '旧' }],
      write: async input => { const overwritten = skills.has(input.name); skills.set(input.name, { name: input.name, source: 'user', description: input.description, content: input.body }); return { name: input.name, overwritten } },
      remove: async name => { removed.push(name); skills.delete(name) }
    }
  })
  let tavern
  const fiber = await h.root.plugin({ name: 'wrongbook', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await tick()

  assert.deepEqual(await tavern.listCards(), [
    { id: 'cards/a.json', name: 'A', fileName: 'a.json', imageUrl: '/api/dsh-tavern/card-image?path=cards%2Fa.json', script: null, group: '常玩', starred: true, error: '' },
    { id: 'cards/b.json', name: 'B', fileName: 'b.json', imageUrl: '', script: { title: '剧本' }, group: '', starred: false, error: '坏了' }])
  const copy = await tavern.readCardRaw({ card: 'cards/a.json' })
  copy.data.name = '改了'
  assert.equal(raw.data.name, 'A', '读到的是副本')
  await assert.rejects(tavern.readCardRaw({ card: 'cards/none.json' }), /不存在/)

  const scripts = [{ name: '通用脚本', content: 'x' }]
  assert.deepEqual(await tavern.updateCardRaw({ card: 'cards/a.json', operations: [{ op: 'set', path: '/data/extensions/tavern_helper/scripts', value: scripts }, { op: 'delete', path: '/data/extensions/old' }] }), { changed: true })
  assert.deepEqual(updates, [{ card: 'cards/a.json', owner: 'wrongbook', operations: [{ op: 'set', path: '/data/extensions/tavern_helper/scripts', value: scripts }, { op: 'delete', path: '/data/extensions/old' }] }])
  await assert.rejects(tavern.updateCardRaw({ card: 'cards/a.json', operations: [] }), /operations/)
  await assert.rejects(tavern.updateCardRaw({ card: 'cards/a.json', operations: [{ op: 'move', path: '/a' }] }), /set 或 delete/)
  await assert.rejects(tavern.updateCardRaw({ card: 'cards/a.json', operations: [{ op: 'set', path: 'data' , value: 1 }] }), /JSON Pointer/)

  tavern.toolModes({ name: 'wrongbook_lookup', modes: ['card'] })
  assert.deepEqual(h.api.toolModesFor('wrongbook_lookup'), ['card'])
  assert.equal(h.api.toolModesFor('narrative_anchor_read'), null, '没声明的插件工具保持原样')
  assert.throws(() => tavern.toolModes({ name: 'tavern_read_variables', modes: ['card'] }), /插件自己注册/)
  assert.throws(() => tavern.toolModes({ name: 'x_tool', modes: ['story'] }), /play、card/)

  assert.deepEqual(await tavern.listSkills(), [{ name: 'debug-card', source: 'builtin', description: '内置' }])
  assert.deepEqual(await tavern.saveSkill({ name: 'my-notes', description: '踩坑', body: '先读参考', references: [{ path: 'references/错题.md', content: '…' }] }), { name: 'my-notes', overwritten: false })
  assert.equal((await tavern.readSkill({ name: 'my-notes' })).references[0].content, '旧')
  await assert.rejects(tavern.removeSkill({ name: 'debug-card' }), /内置 Skill 不能删除/)
  await tavern.removeSkill({ name: 'my-notes' })
  assert.deepEqual(removed, ['my-notes'])

  fiber.dispose()
  await tick()
  assert.equal(h.api.toolModesFor('wrongbook_lookup'), null, '插件卸载后可见范围撤销')
})

test('人物设计档案：插件读取本局档案，并能按结算同样的规则保存人物', { skip: !cordis }, async t => {
  const archive = { revision: 2, updatedAt: 1, characters: [{ name: '林岚', aliases: ['阿岚'], identity: '镖师', narrativeRole: '护送', updatedAt: 1, sections: [{ key: 'appearance', label: '外貌', text: '黑发' }] }] }
  const saved = []
  const h = await harness(t, {
    readCharacterDesigns: async sessionId => sessionId === 'game-1' ? archive : null,
    saveCharacterDesign: async (sessionId, input) => { saved.push([sessionId, input]); return input.identity ? { ok: true, name: input.name } : { ok: false, error: '人物设计缺少 identity' } },
    data: { readSettings: async () => ({}), updateSettings: async () => {} }
  })
  let tavern
  await h.root.plugin({ name: 'image-plugin', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await tick()
  const read = await tavern.getCharacterDesigns({ gameId: 'game-1' })
  read.characters[0].name = '改了'
  assert.equal(archive.characters[0].name, '林岚', '读到的是副本')
  await assert.rejects(tavern.getCharacterDesigns({ gameId: 'nope' }), /不存在/)

  const person = { name: '林岚', aliases: ['阿岚'], identity: '镖师', personality: '冷静', appearance: '黑发、左眉有疤', speechStyle: '简短', narrativeRole: '护送' }
  assert.deepEqual(await tavern.saveCharacterDesign({ gameId: 'game-1', ...person }), { name: '林岚' })
  assert.deepEqual(saved, [['game-1', person]])
  await assert.rejects(tavern.saveCharacterDesign({ gameId: 'game-1', name: '无名' }), /缺少 identity/)
  await assert.rejects(tavern.saveCharacterDesign({ gameId: 'game-1', ...person, aliases: '阿岚' }), /aliases/)
})

test('台词标注与角色素材：插件读取某轮当前版本的标注和卡的人物素材，标注完成时收到通知', { skip: !cordis }, async t => {
  const lines = [{ n: 1, quote: '你好。', speaker: '林曦', emotion: 'joy' }]
  const h = await harness(t, {
    readCast: async (sessionId, turn) => turn === 3 ? { turn, textVersion: 'key-3', lines } : null,
    readCastAssets: async () => ({ player: '你', card: { name: 'A', imageUrl: '/card' }, characters: [{ name: '林曦', aliases: [], avatarUrl: '/a', sprites: { joy: '/j' } }] })
  })
  const seen = []
  let tavern
  await h.root.plugin({ name: 'director', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern; ctx.tavern.onCastAnnotated(event => seen.push(event)) } })
  await tick()
  assert.deepEqual(await tavern.getCast({ gameId: 'game-1', turn: 3 }), { turn: 3, textVersion: 'key-3', lines })
  assert.equal(await tavern.getCast({ gameId: 'game-1', turn: 4 }), null)
  await assert.rejects(tavern.getCast({ gameId: 'nope', turn: 3 }), /不存在/)
  assert.equal((await tavern.getCastAssets({ gameId: 'game-1' })).characters[0].sprites.joy, '/j')
  h.api.castAnnotated('game-1', { turn: 3, textVersion: 'key-3', lines })
  await tick()
  assert.deepEqual(seen, [{ gameId: 'game-1', turn: 3, textVersion: 'key-3', lines }])
})

test('角色素材来源：插件交出的人物经校验后并入本局角色素材；坏来源记入插件错误', { skip: !cordis }, async t => {
  const h = await harness(t)
  const seen = []
  const fiber = await h.root.plugin({ name: 'card-figure', inject: ['tavern'], apply(ctx) {
    ctx.tavern.castAssetSource({ name: 'figure', characters: async context => { seen.push(context); return [
      { name: ' 大肥鱼 ', aliases: ['肥鱼', 3], avatarUrl: '/calm', avatars: { joy: '/joy', shy: 'javascript:alert(1)' }, sprites: { joy: 'https://x/joy.png' } },
      { name: '' },
    ] } })
    ctx.tavern.castAssetSource({ name: 'broken', characters: async () => { throw new Error('读不到素材包') } })
    assert.throws(() => ctx.tavern.castAssetSource({ name: 'figure', characters: () => [] }), /已注册/)
    assert.throws(() => ctx.tavern.castAssetSource({ name: 'x' }), /characters 必须是函数/)
  } })
  await tick()
  assert.deepEqual(await h.api.castAssetSources({ gameId: 'game-1' }), [
    { name: '大肥鱼', aliases: ['肥鱼'], avatarUrl: '/calm', avatars: { joy: '/joy' }, sprites: { joy: 'https://x/joy.png' }, plugin: 'card-figure' }])
  assert.deepEqual(seen, [{ gameId: 'game-1' }])
  assert.match(h.errors()[0].message, /读不到素材包/)
  fiber.dispose()
  await tick()
  assert.deepEqual(await h.api.castAssetSources({ gameId: 'game-1' }), [])
})

test('配音渠道：插件注册的渠道带上归属，合成超时或出错记入插件错误；synthesizeSpeech 按本局人物声音合成', { skip: !cordis }, async t => {
  const lines = []
  const h = await harness(t, { synthesizeSpeech: async (sessionId, line) => { lines.push([sessionId, line]); return line.narration ? { skip: true } : { url: '/api/dsh-tavern/speech-audio?id=x.mp3', mediaType: 'audio/mpeg' } } })
  let tavern
  await h.root.plugin({ name: 'edge-tts', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.speechProvider({ id: 'edge', label: 'Edge 朗读', voices: ['zh-CN-XiaoxiaoNeural'], synthesize: async ({ text }) => {
      if (text === 'boom') throw new Error('服务挂了')
      return { data: new Uint8Array([1]), mediaType: 'audio/mpeg' }
    } })
  } })
  await tick()
  const [entry] = h.api.speechProviders()
  assert.equal(entry.id, 'edge-tts/edge')
  assert.equal(entry.owner, 'edge-tts')
  assert.deepEqual(await entry.synthesize({ text: '你好' }), { data: new Uint8Array([1]), mediaType: 'audio/mpeg' })
  await assert.rejects(entry.synthesize({ text: 'boom' }), /服务挂了/)
  assert.throws(() => tavern.speechProvider({ id: 'edge', label: '重复', synthesize() {} }), /已注册/)
  assert.throws(() => tavern.speechProvider({ id: 'Bad', label: 'x', synthesize() {} }), /name/)

  assert.deepEqual(await tavern.synthesizeSpeech({ gameId: 'game-1', speaker: '林曦', text: '你好', emotion: 'joy' }), { url: '/api/dsh-tavern/speech-audio?id=x.mp3', mediaType: 'audio/mpeg' })
  assert.deepEqual(lines[0], ['game-1', { speaker: '林曦', text: '你好', emotion: 'joy', narration: false }])
  assert.equal(await tavern.synthesizeSpeech({ gameId: 'game-1', text: '夜深了。', narration: true }), null)
  await assert.rejects(tavern.synthesizeSpeech({ gameId: 'game-1', text: ' ' }), /text/)
})

test('生图渠道：插件注册的出图能力带上归属，状态被规整，出错记入插件错误', { skip: !cordis }, async t => {
  const h = await harness(t)
  let tavern
  await h.root.plugin({ name: 'painter', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.imageProvider({ id: 'online', label: '配图', status: () => ({ ready: true, model: 'gpt-image', maxReferences: 4.5 }),
      generate: async ({ prompt }) => {
        if (prompt === 'boom') throw Object.assign(new Error('渠道挂了'), { requestMayHaveSucceeded: false })
        return { data: new Uint8Array([1]), mediaType: 'image/png' }
      } })
  } })
  await tick()
  const [entry] = h.api.imageProviders()
  assert.equal(entry.id, 'painter/online')
  assert.equal(entry.label, '配图')
  assert.deepEqual(await entry.status(), { ready: true, reason: '', model: 'gpt-image', maxReferences: 0 })
  assert.deepEqual(await entry.generate({ prompt: 'a' }), { data: new Uint8Array([1]), mediaType: 'image/png' })
  await assert.rejects(entry.generate({ prompt: 'boom' }), error => error.requestMayHaveSucceeded === false)
  assert.throws(() => tavern.imageProvider({ id: 'online', label: '重复', status() {}, generate() {} }), /已注册/)
  assert.throws(() => tavern.imageProvider({ id: 'other', label: 'x', generate() {} }), /status/)
})

test('卡内插件只在所属人物卡的局里出现：回调不触发、调用被拒、人物卡列表只剩本卡、本局插件面板不列出', { skip: !cordis }, async t => {
  let cardOfGame = 'cards/other.json'
  const settled = []
  const h = await harness(t, {
    data: createPluginData({ store: memoryStore() }),
    cardScope: async () => new Map([['fish-plugin', { cards: ['cards/fish.json'], folder: 'card-x-fish' }]]),
    cardPathOf: async () => cardOfGame,
    listCards: async () => [{ path: 'cards/fish.json', name: '鱼' }, { path: 'cards/other.json', name: '别的' }],
    readCardRaw: async () => ({ data: {} })
  })
  let tavern
  await h.root.plugin({ name: 'fish-plugin', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern; ctx.tavern.onTurnSettled(turn => settled.push(turn.turn)); ctx.tavern.promptSection({ name: 'fish', text: '鱼的规则' }) } })
  await tick()
  await h.api.turnSettled('game-1')
  await tick()
  assert.deepEqual(settled, [], '别的卡的局不通知')
  assert.deepEqual(await h.api.promptSections({ gameId: 'game-1' }), [])
  await assert.rejects(tavern.getTurn({ gameId: 'game-1', turn: 3 }), /只能用于它所在的人物卡/)
  await assert.rejects(tavern.readCardRaw({ card: 'cards/other.json' }), /只能用于它所在的人物卡/)
  assert.deepEqual((await tavern.listCards()).map(card => card.id), ['cards/fish.json'])

  cardOfGame = 'cards/fish.json'
  h.setLatest(turnMaterial({ key: 'key-3c' }))
  await h.api.turnSettled('game-1')
  await tick()
  assert.deepEqual(settled, [3], '本卡的局照常通知')
  assert.equal((await tavern.getTurn({ gameId: 'game-1', turn: 3 })).text, '她推开门。')
  assert.deepEqual((await h.api.promptSections({ gameId: 'game-1' })).map(item => item.text), ['鱼的规则'])
  assert.deepEqual((await h.api.promptSections({ gameId: 'game-1' })).map(item => item.text), ['鱼的规则'])
})

test('本局配置项：插件声明字段，Tavern 画在本局设置并按局保存；不合法的值被拒绝，改动通知插件', { skip: !cordis }, async t => {
  const changed = [], seen = []
  const data = createPluginData({ store: memoryStore() })
  const h = await harness(t, { data, settingsChanged: (gameId, plugin) => changed.push([gameId, plugin]) })
  let tavern
  await h.root.plugin({ name: 'director', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    assert.throws(() => ctx.tavern.gameSettings({ fields: [{ key: '1x', type: 'boolean', label: 'x' }] }), /key/)
    assert.throws(() => ctx.tavern.gameSettings({ fields: [{ key: 'pace', type: 'select', label: '节奏', options: [] }] }), /options/)
    ctx.tavern.gameSettings({ title: '导演', fields: [
      { key: 'music', type: 'boolean', label: '自动换音乐', default: true },
      { key: 'pace', type: 'select', label: '换装频率', options: [{ value: 'low', label: '少' }, { value: 'high', label: '多' }] },
      { key: 'lines', type: 'number', label: '每幕句数', min: 1, max: 9, default: 3 }
    ] })
    assert.throws(() => ctx.tavern.gameSettings({ fields: [{ key: 'x', type: 'text', label: 'x' }] }), /已声明过/)
    ctx.tavern.onGameSettingsChanged(event => seen.push(event))
  } })
  await tick()
  assert.deepEqual(await tavern.getGameSettings({ gameId: 'game-1' }), { music: true, pace: 'low', lines: 3 }, '没改过时用默认值')
  const panel = await h.api.gamePlugins('game-1')
  assert.deepEqual(panel.settings.map(entry => [entry.plugin, entry.title, entry.fields.map(field => field.key)]), [['director', '导演', ['music', 'pace', 'lines']]])
  await assert.rejects(h.api.setGamePlugin('game-1', { setting: { plugin: 'director', key: 'lines', value: 12 } }), /不符合要求/)
  await assert.rejects(h.api.setGamePlugin('game-1', { setting: { plugin: 'director', key: 'nope', value: 1 } }), /没有这个插件配置项/)
  const after = await h.api.setGamePlugin('game-1', { setting: { plugin: 'director', key: 'pace', value: 'high' } })
  assert.deepEqual(after.settings[0].values, { music: true, pace: 'high', lines: 3 })
  await tick()
  assert.deepEqual(seen, [{ gameId: 'game-1', values: { music: true, pace: 'high', lines: 3 } }])
  assert.deepEqual(changed, [['game-1', 'director']])
  assert.deepEqual(await tavern.getGameSettings({ gameId: 'game-1' }), { music: true, pace: 'high', lines: 3 })
  assert.deepEqual(await h.api.pluginGameSettings('game-1', 'director'), { music: true, pace: 'high', lines: 3 }, '页面侧读到同样的值')
  assert.equal((await data.snapshot('chat-1')).settings.values.director.pace, 'high', '值存在这一局的插件数据里，随分叉和导出带走')
})

test('版本失效信号：versionSignal 在正文版本被替换或删局时中止；结算任务的 signal 也跟着中止', { skip: !cordis }, async t => {
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }), readPendingTurn: async () => turnMaterial() })
  let tavern
  const seen = []
  await h.root.plugin({ name: 'director', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.onTimelineChanged(change => seen.push(change))
  } })
  await tick()
  assert.equal(tavern.apiVersion, 6)
  assert.equal((await tavern.versionSignal({ gameId: 'game-1', turn: 3, textVersion: 'old' })).aborted, true, '不是当前版本时立即中止')
  const signal = await tavern.versionSignal({ gameId: 'game-1', turn: 3, textVersion: 'key-3' })
  h.api.timelineChanged('game-1', { kind: 'edit', turn: 3 })
  await tick()
  assert.equal(signal.aborted, false, '版本没变时不中止')
  h.setLatest(turnMaterial({ key: 'key-3b' }))
  h.api.timelineChanged('game-1', { kind: 'regenerate', turn: 3 })
  await tick()
  assert.equal(signal.aborted, true)
  assert.equal(signal.reason.code, 'TAVERN_PLUGIN_STALE_VERSION')
  assert.equal(seen.at(-1).textVersion, 'key-3b', 'onTimelineChanged 带上这一轮当前的版本')
  const removed = await tavern.versionSignal({ gameId: 'game-1', turn: 3, textVersion: 'key-3b' })
  h.api.gameRemoved('game-1')
  await tick()
  assert.equal(removed.aborted, true)

  // A settlement task's signal stops once its version is replaced while it runs.
  let taskSignal
  await h.root.plugin({ name: 'slow', inject: ['tavern'], apply(ctx) {
    ctx.tavern.settlementTask({ name: 'wait', run: ({ signal }) => { taskSignal = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) } })
  } })
  await tick()
  const pending = h.api.runSettlementTasks({ gameId: 'game-1', phase: 'after' })
  await tick()
  h.setLatest(turnMaterial({ key: 'key-3c' }))
  await h.api.checkVersions('game-1')
  await pending
  assert.equal(taskSignal.aborted, true)
})

test('并行结算任务：phase parallel 读结算前的这一轮，不能改变量', { skip: !cordis }, async t => {
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }), readPendingTurn: async () => turnMaterial({ key: 'pending-3' }) })
  const ran = []
  await h.root.plugin({ name: 'director', inject: ['tavern'], apply(ctx) {
    ctx.tavern.settlementTask({ name: 'stage', phase: 'parallel', run: async input => {
      ran.push(input.phase + ':' + input.textVersion)
      await assert.rejects(ctx.tavern.setVariables({ gameId: 'game-1', turn: 3, textVersion: 'key-3', variables: {} }))
    } })
  } })
  await tick()
  await h.api.runSettlementTasks({ gameId: 'game-1', phase: 'parallel' })
  assert.deepEqual(ran, ['parallel:pending-3'])
})

test('publishState：插件给自己的浏览器侧发布最新状态，按插件、按局隔离；关闭的插件读不到，删局后清除', { skip: !cordis }, async t => {
  const signals = []
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }), publishState: (...args) => signals.push(args) })
  let director
  await h.root.plugin({ name: 'director', inject: ['tavern'], apply(ctx) { director = ctx.tavern } })
  await tick()
  await director.publishState({ gameId: 'game-1', name: 'stage', data: { scene: '酒馆' } })
  assert.deepEqual(signals, [['game-1', 'director', 'stage']])
  assert.deepEqual(await h.api.pluginState('game-1', 'director', 'stage'), { scene: '酒馆' })
  assert.equal(await h.api.pluginState('game-1', 'other', 'stage'), null)
  await assert.rejects(director.publishState({ gameId: 'game-1', name: 'Bad', data: 1 }), /name/)
  await assert.rejects(director.publishState({ gameId: 'game-1', name: 'big', data: 'x'.repeat(300000) }), /256 KB/)
  h.api.gameRemoved('game-1')
  assert.equal(await h.api.pluginState('game-1', 'director', 'stage'), null)
})

test('getRequestContext：读这一轮正文请求用到的各段上下文，标明来自 Tavern、预设还是哪个插件', async () => {
  const { createForegroundFrameBuilder, foregroundRequestContext } = await import('../tavern-plugin/lib/domain/agent-input-frame.js')
  const { foregroundFrameInputs } = await import('../tavern-plugin/lib/domain/turn-orchestration.js')
  const build = (operationId, turn, branchId, worldbook) => createForegroundFrameBuilder().build({ chatId: 'c', branchId, operationId, turn, basedOnRevision: 1,
    inputs: foregroundFrameInputs({ sections: [{ kind: 'world-book', text: worldbook }, { kind: 'posture', text: '在酒馆' }] }, '你好', '你好', null, {},
      [{ owner: 'memory', name: 'recent', text: '上次说到钟楼' }]) })
  const chat = { timeline: { branchId: 'b2' }, foregroundFrames: { o1: build('o1', 3, 'b2', '旧世界书'), o2: build('o2', 3, 'b1', '别的分支'), o3: build('o3', 3, 'b2', '钟楼：……'), o4: build('o4', 4, 'b2', 'x') } }
  const context = foregroundRequestContext(chat, 3)
  assert.equal(context.input, '你好')
  assert.deepEqual(context.sections, [
    { slot: 'activeWorldbook', origin: 'tavern:world-book', text: '钟楼：……' },
    { slot: 'currentStateProjection', origin: 'tavern:posture', text: '在酒馆' },
    { slot: 'currentStateProjection', origin: 'plugin', plugin: 'memory', name: 'recent', text: '上次说到钟楼' }
  ])
  assert.equal(foregroundRequestContext(chat, 9), null)
})

test('改卡带版本：expectedRevision 在卡的编辑队列里比对，不一致时报冲突、不改卡；onCardChanged 只告诉卡内插件它自己的卡', { skip: !cordis }, async t => {
  const { createCardEditor } = await import('../tavern-plugin/lib/domain/card-editor.js')
  let revision = 4
  const writes = []
  const updateCard = createCardEditor({
    readCardWorkspace: async () => ({ data: {} }),
    cardPreparation: { update: () => ({ changed: true, card: { data: { x: 1 } }, view: {} }), present: () => ({}) },
    fileResources: { writeWorking: async (path, text) => writes.push(path) },
    bumpCardProjectionRevision: async () => { revision += 1 },
    syncCardName: async () => {},
    cardRevision: async () => revision
  })
  await updateCard('cards/a.json', {}, {}, [], { expectedRevision: 4 })
  await assert.rejects(updateCard('cards/a.json', {}, {}, [], { expectedRevision: 4 }), error => error.code === 'REVISION_CONFLICT')
  assert.equal(writes.length, 1)

  const passed = []
  const h = await harness(t, {
    updateCardRaw: async (card, operations, owner, options) => { passed.push(options); if (options.expectedRevision === 1) throw Object.assign(new Error('冲突'), { code: 'REVISION_CONFLICT' }); return { changed: true, revision: 6 } },
    cardRevision: async () => 5,
    cardScope: async () => new Map([['card-own', { cards: ['cards/b.json'] }]])
  })
  const heard = []
  let tavern
  await h.root.plugin({ name: 'workbench', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern; ctx.tavern.onCardChanged(change => heard.push(['workbench', change])) } })
  await h.root.plugin({ name: 'card-own', inject: ['tavern'], apply(ctx) { ctx.tavern.onCardChanged(change => heard.push(['card-own', change])) } })
  await tick()
  assert.equal(await tavern.cardRevision({ card: 'cards/a.json' }), 5)
  const operations = [{ op: 'set', path: '/data/x', value: 1 }]
  assert.deepEqual(await tavern.updateCardRaw({ card: 'cards/a.json', operations, expectedRevision: 5 }), { changed: true, revision: 6 })
  await assert.rejects(tavern.updateCardRaw({ card: 'cards/a.json', operations, expectedRevision: 1 }), error => error.code === 'TAVERN_PLUGIN_REVISION_CONFLICT')
  await assert.rejects(tavern.updateCardRaw({ card: 'cards/a.json', operations, expectedRevision: 'x' }), /expectedRevision/)
  assert.deepEqual(passed[0], { expectedRevision: 5 })
  await h.api.cardChanged('cards/a.json', 6)
  await tick()
  assert.deepEqual(heard, [['workbench', { card: 'cards/a.json', revision: 6 }]])
})

test('写角色素材与素材包：按人物卡写，走 Tavern 自己的素材存储；卡内插件只能写自己的卡', { skip: !cordis }, async t => {
  const calls = []
  const cast = new Proxy({}, { get: (_target, method) => async input => { calls.push([method, input]) } })
  const h = await harness(t, {
    editCast: async (card, change) => change(cast, card),
    saveCardPack: async (card, input) => { calls.push(['saveCardPack', card, input.id, input.files.length]); return { id: input.id, contentHash: 'h' } },
    removeCardPack: async (card, id) => id === 'bg',
    cardScope: async () => new Map([['card-own', { cards: ['cards/b.json'] }]])
  })
  let tavern, own
  await h.root.plugin({ name: 'painter', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await h.root.plugin({ name: 'card-own', inject: ['tavern'], apply(ctx) { own = ctx.tavern } })
  await tick()
  await tavern.setCastImage({ card: 'cards/a.json', name: '林岚', slot: 'joy', data: new Uint8Array([1, 2]) })
  await assert.rejects(tavern.setCastImage({ card: 'cards/a.json', name: '林岚', slot: 'joy', data: 'x' }), /Uint8Array/)
  await tavern.setCastVoice({ card: 'cards/a.json', name: '林岚', provider: 'painter/edge', voice: 'v' })
  await tavern.setCastCharacter({ card: 'cards/a.json', name: '林岚', aliases: ['岚'] })
  await tavern.removeCastImage({ card: 'cards/a.json', name: '林岚', slot: 'joy' })
  await tavern.removeCastCharacter({ card: 'cards/a.json', name: '林岚' })
  assert.deepEqual(calls.map(call => call[0]), ['setImage', 'setVoice', 'setCharacter', 'removeImage', 'removeCharacter'])
  assert.equal(calls[0][1].cardPath, 'cards/a.json')
  assert.deepEqual(await tavern.saveCardPack({ card: 'cards/a.json', id: 'bg', files: [{ path: 'a.png', data: new Uint8Array([1]) }] }), { id: 'bg', contentHash: 'h' })
  await assert.rejects(tavern.saveCardPack({ card: 'cards/a.json', id: 'bg', files: [] }), /files/)
  assert.equal(await tavern.removeCardPack({ card: 'cards/a.json', id: 'bg' }), true)
  await assert.rejects(own.setCastCharacter({ card: 'cards/a.json', name: 'x' }), error => error.code === 'TAVERN_PLUGIN_SCOPE')
})

test('插件导入器：按扩展名接管 Tavern 不认识的人物卡文件，原生格式不能接管；交回的卡经校验，收尾出错不影响导入', { skip: !cordis }, async t => {
  const h = await harness(t, { cardScope: async () => new Map([['card-own', { cards: ['cards/b.json'] }]]) })
  const done = []
  let tavern, own
  await h.root.plugin({ name: 'vn-import', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.cardImporter({ id: 'vn', label: '视觉小说包', extensions: ['.VNPACK'],
      convert: async ({ name, data }) => name.startsWith('bad') ? { card: 'x' } : ({ card: { spec: 'chara_card_v3', data: { name: String(data.length) } }, files: { 'cover.png': new Uint8Array([1]) }, packs: [{ id: 'bg', files: [{ path: 'a.png', data: new Uint8Array([2]) }] }] }),
      imported: async ({ card }) => { done.push(card); throw new Error('收尾失败') } })
  } })
  await h.root.plugin({ name: 'card-own', inject: ['tavern'], apply(ctx) { own = ctx.tavern } })
  await tick()
  assert.throws(() => tavern.cardImporter({ id: 'png', label: 'x', extensions: ['.png'], convert() {} }), /Tavern 自己导入/)
  assert.throws(() => tavern.cardImporter({ id: 'again', label: 'x', extensions: ['.vnpack'], convert() {} }), /已由插件/)
  assert.throws(() => tavern.cardImporter({ id: 'bad', label: 'x', extensions: ['vn'], convert() {} }), /\.xxx/)
  own.cardImporter({ id: 'own', label: '卡内', extensions: ['.own'], convert: async () => ({ card: {} }) })
  assert.equal(await h.api.cardImporterFor('story.own'), null, '卡内插件不导入别的卡')
  assert.equal(await h.api.cardImporterFor('a.png'), null)
  assert.deepEqual(await h.api.cardImporterFor('林岚.vnpack'), { owner: 'vn-import', id: 'vn', label: '视觉小说包' })
  const converted = await h.api.convertCard('林岚.vnpack', Buffer.from('abc'))
  assert.equal(converted.card.data.name, '3')
  assert.deepEqual([...converted.files.keys()], ['cover.png'])
  assert.equal(converted.packs[0].id, 'bg')
  await assert.rejects(h.api.convertCard('bad.vnpack', Buffer.from('x')), /不合格/)
  await h.api.cardImported(converted, 'cards/林岚.png')
  assert.deepEqual(done, ['cards/林岚.png'])
})

test('skillSource：插件登记自己的 Skill 目录，卸载时撤销；卡内插件不能添加', { skip: !cordis }, async t => {
  const roots = []
  const h = await harness(t, {
    addSkillRoot: entry => { roots.push(entry); return () => roots.splice(roots.indexOf(entry), 1) },
    cardScope: async () => new Map([['card-own', { cards: ['cards/b.json'] }]])
  })
  const fiber = await h.root.plugin({ name: 'director', inject: ['tavern'], apply(ctx) {
    assert.throws(() => ctx.tavern.skillSource({ dir: 'skills' }), /绝对路径/)
    assert.throws(() => ctx.tavern.skillSource({ dir: '/x', role: 'image' }), /role/)
    ctx.tavern.skillSource({ dir: '/plugins/director/skills', role: 'background' })
  } })
  await h.root.plugin({ name: 'card-own', inject: ['tavern'], apply(ctx) { ctx.tavern.skillSource({ dir: '/plugins/own/skills' }) } })
  await tick()
  assert.deepEqual(roots, [{ owner: 'director', dir: resolvePath('/plugins/director/skills'), role: 'background' }])
  await fiber.dispose()
  assert.deepEqual(roots, [])
})

test('插件数据：不跟某一局走，每个插件只读写自己的那一份，256 KB 上限，null 清除', { skip: !cordis }, async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = (await import('node:path')).default
  const { createPluginDataStore } = await import('../tavern-plugin/lib/domain/plugin-data-store.js')
  const root = await mkdtemp(path.join(tmpdir(), 'plugin-data-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const h = await harness(t, { pluginData: createPluginDataStore({ dataRoot: root }) })
  let image, other
  await h.root.plugin({ name: 'dsh-tavern-image', inject: ['tavern'], apply(ctx) { image = ctx.tavern } })
  await h.root.plugin({ name: 'other', inject: ['tavern'], apply(ctx) { other = ctx.tavern } })
  await tick()
  assert.equal(await image.readPluginData(), null)
  await image.savePluginData({ data: { endpoint: 'http://127.0.0.1:8188' } })
  assert.deepEqual(await image.readPluginData(), { endpoint: 'http://127.0.0.1:8188' })
  assert.equal(await other.readPluginData(), null, '各插件互不可见')
  await assert.rejects(image.savePluginData({}), /不能省略/)
  await assert.rejects(image.savePluginData({ data: 'x'.repeat(300 * 1024) }), /256 KB/)
  await image.savePluginData({ data: null })
  assert.equal(await image.readPluginData(), null)
})

test('插件联网声明随卸载释放，不能覆盖原生工具或重复声明', { skip: !cordis }, async t => {
  const h = await harness(t, { reservedToolNames: ['web_search'] })
  let service
  const fiber = await h.root.plugin({ name: 'network-plugin', inject: ['tavern'], apply(ctx) {
    service = ctx.tavern
    service.toolNetwork({ name: 'reference_lookup', capability: 'search' })
  } })
  await tick()
  assert.equal(h.api.toolNetworkFor('reference_lookup'), 'search')
  assert.throws(() => service.toolNetwork({ name: 'web_search' }), /自己的工具/)
  assert.throws(() => service.toolNetwork({ name: 'reference_lookup' }), /已被声明/)
  assert.throws(() => service.toolNetwork({ name: 'other', capability: 'anything' }), /search 或 fetch/)
  await fiber.dispose()
  await tick()
  assert.equal(h.api.toolNetworkFor('reference_lookup'), undefined)
})

// #394 附带：配图插件的生成记录要和对话里的图同进同退。
test('玩家删图只通知图的主人，带上被删每张图的插件数据；插件自己按版本删不触发', { skip: !cordis }, async t => {
  const { createPluginMediaViews } = await import('../tavern-plugin/lib/domain/plugin-media-views.js')
  const h = await harness(t)
  const views = createPluginMediaViews({ pluginMedia: h.media, sessionSignals: { publish() {} }, attachments: () => null, mediaRemoved: h.api.mediaRemoved,
    pluginTurns: { resolveGame: async sessionId => sessionId === 'game-1' ? { chatId: 'chat-1', sessionId } : null, currentKey: async () => 'key-3' } })
  const heard = { mine: [], other: [] }
  let tavern
  await h.root.plugin({ name: 'image-plugin', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern; ctx.tavern.onMediaRemoved(event => heard.mine.push(event)) } })
  await h.root.plugin({ name: 'other-plugin', inject: ['tavern'], apply(ctx) { ctx.tavern.onMediaRemoved(event => heard.other.push(event)) } })
  await tick()
  const draw = async jobs => {
    const { id } = await tavern.attach({ gameId: 'game-1', turn: 3, textVersion: 'key-3', item: { kind: 'image', attachment: { ...image, attachmentId: jobs[0] }, data: { jobId: jobs[0] } } })
    for (const job of jobs.slice(1)) await tavern.update(id, { attachment: { ...image, attachmentId: job }, data: { jobId: job } })
    return id
  }
  const first = await draw(['j1', 'j2', 'j3'])
  await views.removePluginMediaVersion('game-1', first, 0)
  await views.removePluginMediaVersion('game-1', first, null)
  await tick()
  assert.deepEqual(heard.mine.map(event => [event.itemRemoved, event.pictures.map(picture => picture.data.jobId)]), [[false, ['j1']], [false, ['j3']]])
  assert.equal((await tavern.list({ gameId: 'game-1' }))[0].data.jobId, 'j2', '上一版顶上时带回它的数据')
  await views.removePluginGalleryItems('game-1', [first])
  await tick()
  assert.deepEqual(heard.mine.at(-1), { gameId: 'game-1', itemId: first, kind: 'image', turn: 3, textVersion: 'key-3', itemRemoved: true,
    pictures: [{ caption: '', prompt: '', createdAt: heard.mine.at(-1).pictures[0].createdAt, data: { jobId: 'j2' } }] })

  const second = await draw(['k1', 'k2'])
  assert.equal(await tavern.remove(second, { version: 0 }), true)
  assert.equal(await tavern.remove(second, { version: 'current' }), true)
  assert.deepEqual(await tavern.list({ gameId: 'game-1' }), [], '最后一张删掉整项')
  await tick()
  assert.equal(heard.mine.length, 3, '插件自己删不再通知自己')
  assert.deepEqual(heard.other, [], '别的插件听不到')
})

test('台账整理替换：交回的增量先过校验；不合格、出错或放弃时退回 Tavern 自己整理；停止后台时中止', { skip: !cordis }, async t => {
  const h = await harness(t)
  let mode = 'ok', seen
  await h.root.plugin({ name: 'ledger-plugin', inject: ['tavern'], apply(ctx) {
    ctx.tavern.replaceLedger({ async consolidate(input) {
      seen = input
      if (mode === 'throw') throw new Error('炸了')
      if (mode === 'decline') return null
      if (mode === 'wait') return await new Promise((_, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason)))
      return { delta: mode === 'bad' ? { npcs: { update: [{ name: '无名' }] } } : { items: { add: [{ name: '钥匙', qty: 1 }] } } }
    } })
  } })
  await tick()
  const input = { gameId: 'game-1', from: 1, through: 2, text: '正文', ledger: { items: [] }, rules: '规则', tool: { name: 'ledger_submit' },
    apply: delta => { if (delta.npcs) throw new Error('不能更新尚未登记的条目：无名') } }
  assert.deepEqual(await h.api.replaceLedger(input), { owner: 'ledger-plugin', delta: { items: { add: [{ name: '钥匙', qty: 1 }] } } })
  assert.deepEqual([seen.from, seen.through, seen.text, seen.rules, seen.tool.name, typeof seen.apply], [1, 2, '正文', '规则', 'ledger_submit', 'undefined'], '插件拿不到 apply')
  for (mode of ['bad', 'throw', 'decline']) assert.equal(await h.api.replaceLedger(input), null, mode)
  assert.deepEqual(h.errors().map(error => error.message), ['炸了', '不能更新尚未登记的条目：无名'])
  mode = 'wait'
  const running = h.api.replaceLedger(input)
  await tick()
  assert.equal(h.api.stopTasks('game-1'), true)
  await assert.rejects(running, /停止了台账整理/)
})

test('插件成员：注册后任务可以挂上去，在它的常驻会话里跑；只能用自己的成员；插件卸载时成员一起移除', { skip: !cordis }, async t => {
  const { listMembers } = await import('../tavern-plugin/lib/domain/background-members.js')
  const requests = []
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }), readPendingTurn: async () => turnMaterial(),
    runTask: async input => { requests.push(input); return { text: 'ok' } } })
  let tavern
  const fork = await h.root.plugin({ name: 'npc-plugin', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.member({ name: 'luna', title: '露娜' })
    ctx.tavern.settlementTask({ name: 'diary', title: '露娜日记', member: 'luna', run: async input => { await input.runAgent({ prompt: '写日记' }) } })
  } })
  await tick()
  assert.ok(listMembers().some(member => member.id === 'plugin:npc-plugin:luna' && member.name === '露娜' && member.plugin === 'npc-plugin'))
  assert.deepEqual(h.api.taskCatalog().map(item => [item.task, item.name, item.plugin, item.member, item.lane]),
    [['plugin:npc-plugin:diary', '露娜日记', 'npc-plugin', 'plugin:npc-plugin:luna', 'resident']])
  await tavern.runTask({ gameId: 'game-1', prompt: '回忆', member: 'luna' })
  assert.equal(requests.at(-1).member, 'plugin:npc-plugin:luna')
  await tavern.runTask({ gameId: 'game-1', prompt: '一次性' })
  assert.equal(requests.at(-1).member, '', 'without member: a fresh one-off')
  await assert.rejects(tavern.runTask({ gameId: 'game-1', prompt: 'x', member: 'nobody' }), /没有注册成员/)
  assert.throws(() => tavern.member({ name: 'luna' }), /已注册/)
  await h.api.runSettlementTasks({ gameId: 'game-1', phase: 'after' })
  assert.equal(requests.at(-1).member, 'plugin:npc-plugin:luna', 'a task registered on a member runs there')
  fork.dispose?.()
  await tick()
  assert.ok(!listMembers().some(member => member.id === 'plugin:npc-plugin:luna'))
})

test('插件成员可以有自己的前缀：系统提示词和工具固定在成员上，任务只送一条工单、不能再带工具；工具调用回到插件', { skip: !cordis }, async t => {
  const { listMembers, pluginMemberPrefix } = await import('../tavern-plugin/lib/domain/background-members.js')
  const requests = [], rolled = []
  const h = await harness(t, { runTask: async input => { requests.push(input); return { text: await input.call('roll_dice', { sides: 6 }) } } })
  let tavern
  await h.root.plugin({ name: 'dice-plugin', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.member({ name: 'dealer', title: '荷官', system: '你是赌场荷官，只用 roll_dice 掷骰。',
      tools: [{ name: 'roll_dice', description: '掷骰', parameters: { type: 'object', properties: { sides: { type: 'integer' } } },
        execute: async ({ sides }) => { rolled.push(sides); return { value: 4 } } }] })
    ctx.tavern.member({ name: 'plain', title: '普通' })
  } })
  await tick()
  assert.ok(listMembers().some(member => member.id === 'plugin:dice-plugin:dealer' && member.ownPrefix === true))
  assert.equal(pluginMemberPrefix('plugin:dice-plugin:plain'), null)
  const { text } = await tavern.runTask({ gameId: 'game-1', member: 'dealer', prompt: '这一局掷一次' })
  assert.equal(text, '{"value":4}')
  assert.deepEqual(rolled, [6])
  const sent = requests.at(-1)
  assert.deepEqual([sent.member, sent.system, sent.prompt, sent.tools.map(tool => tool.name)],
    ['plugin:dice-plugin:dealer', '你是赌场荷官，只用 roll_dice 掷骰。', '这一局掷一次', ['roll_dice']])
  await assert.rejects(tavern.runTask({ gameId: 'game-1', member: 'dealer', prompt: 'x',
    tools: [{ name: 'other_tool', description: 'd', parameters: { type: 'object' }, execute() {} }] }), /不能再传 tools/)
  await tavern.runTask({ gameId: 'game-1', member: 'plain', prompt: '普通任务' })
  assert.equal(requests.at(-1).system, undefined, 'a member without system keeps Tavern\'s background prefix')
  assert.throws(() => tavern.member({ name: 'x', tools: [] }), /先给它 system/)
  assert.throws(() => tavern.member({ name: 'y', system: '' }), /system 必须是/)
  assert.throws(() => tavern.member({ name: 'z', system: 's', tools: [{ name: 'Bad', description: 'd', parameters: { type: 'object' }, execute() {} }] }), /工具名/)
})

test('tavern.on：插件挂到事件表上，出现在触发关系里；别的卡自带的插件不触发；出错只记错误', { skip: !cordis }, async t => {
  const { createStoryEvents } = await import('../tavern-plugin/lib/domain/story-events.js')
  const storyEvents = createStoryEvents({ logger: { warn() {} } })
  let cards = ['cards/other.json']
  const h = await harness(t, { storyEvents, data: { readSettings: async () => ({ disabled: [] }), updateSettings: async () => {} },
    cardScope: async () => new Map([['npc-plugin', { cards }]]), cardPathOf: async () => 'cards/this.json' })
  const heard = []
  let tavern
  cards = ['cards/this.json']
  await h.root.plugin({ name: 'npc-plugin', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.on('reply-committed', payload => { heard.push(payload) })
    ctx.tavern.on('turn-discarded', () => { throw new Error('坏了') })
  } })
  await tick()
  assert.throws(() => tavern.on('whenever', () => {}), /event 只能是/)
  assert.deepEqual(storyEvents.table().find(row => row.event === 'reply-committed').followers, ['插件「npc-plugin」'])
  storyEvents.emit('reply-committed', { sessionId: 'game-1' })
  storyEvents.emit('turn-discarded', { sessionId: 'game-1', turn: 4 })
  await tick()
  assert.deepEqual(heard, [{ event: 'reply-committed', gameId: 'game-1' }])
  assert.match(h.errors()[0].message, /坏了/)
  // A card plugin of another card stays out of this game.
  cards = ['cards/other.json']
  storyEvents.emit('reply-committed', { sessionId: 'game-1' })
  await tick()
  assert.equal(heard.length, 1, 'another card\'s plugin: not heard')
})

test('地图 → 手机：地图插件发布产出并发出自己的事件，手机插件挂上去、读到产出；内置的任务完成事件也能挂', { skip: !cordis }, async t => {
  const { createStoryEvents } = await import('../tavern-plugin/lib/domain/story-events.js')
  const storyEvents = createStoryEvents({ logger: { warn() {} } })
  const h = await harness(t, { storyEvents, data: createPluginData({ store: memoryStore() }) })
  let map
  const calls = [], finished = []
  await h.root.plugin({ name: 'map-plugin', inject: ['tavern'], apply(ctx) { map = ctx.tavern } })
  await h.root.plugin({ name: 'phone-plugin', inject: ['tavern'], apply(ctx) {
    ctx.tavern.on('map-plugin:signal-changed', async ({ gameId, from, data }) => {
      const signal = await ctx.tavern.readOutput({ gameId, plugin: from, name: 'signal' })
      calls.push(signal.value.strength === 0 ? '信号为零，打不通' : '接通 ' + data.turn)
    })
    ctx.tavern.on('task-finished', payload => { finished.push([payload.task, payload.status, payload.plugin || '']) })
  } })
  await tick()
  await map.publishOutput({ gameId: 'game-1', turn: 3, name: 'signal', value: { strength: 0 } })
  await map.emit('signal-changed', { gameId: 'game-1', data: { turn: 3 } })
  await tick()
  assert.deepEqual(calls, ['信号为零，打不通'])
  assert.deepEqual(storyEvents.table().find(row => row.event === 'map-plugin:signal-changed').followers, ['插件「phone-plugin」'])
  // An output belongs to the turn and text version it was made for.
  assert.equal((await map.readOutput({ gameId: 'game-1', turn: 3, plugin: 'map-plugin', name: 'signal' })).value.strength, 0)
  h.setLatest({ ...turnMaterial(), key: 'key-3-regenerated' })
  assert.equal(await map.readOutput({ gameId: 'game-1', plugin: 'map-plugin', name: 'signal' }), null)
  storyEvents.emit('task-finished', { sessionId: 'game-1', task: 'settlement', status: 'completed', member: 'background', turn: 3 })
  await tick()
  assert.deepEqual(finished, [['settlement', 'completed', '']])
  await assert.rejects(map.emit('Bad Name', { gameId: 'game-1' }), /事件名/)
  await assert.rejects(map.emit('big', { gameId: 'game-1', data: 'x'.repeat(9000) }), /8 KB/)
})

test('tavern.job 声明的任务进任务表：按事件和条件运行，列在触发关系和任务目录里，出错记在插件名下', { skip: !cordis }, async t => {
  const { createStoryEvents } = await import('../tavern-plugin/lib/domain/story-events.js')
  const { createWorkflow } = await import('../tavern-plugin/lib/domain/workflow.js')
  const storyEvents = createStoryEvents({ logger: { warn() {} } })
  const workflow = createWorkflow({ events: storyEvents })
  const h = await harness(t, { storyEvents, workflow })
  const ran = []
  let tavern
  await h.root.plugin({ name: 'map-plugin', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.member({ name: 'surveyor', title: '测绘员' })
    ctx.tavern.job({ name: 'locate', title: '定位', description: '判断主角在哪。', member: 'surveyor', on: 'task-finished',
      if: ({ task, status }) => task === 'settlement' && status === 'completed',
      run: async ({ gameId, turn }) => { ran.push([gameId, turn]); if (turn === 9) throw new Error('定位坏了') } })
  } })
  await tick()
  storyEvents.emit('task-finished', { sessionId: 'game-1', task: 'candidate', status: 'completed', turn: 3 })
  storyEvents.emit('task-finished', { sessionId: 'game-1', task: 'settlement', status: 'completed', turn: 3 })
  await tick()
  assert.deepEqual(ran, [['game-1', 3]])
  assert.deepEqual(storyEvents.table().find(row => row.event === 'task-finished').followers, ['插件「map-plugin」定位'])
  const listed = workflow.table().find(job => job.id === 'plugin:map-plugin:locate')
  assert.equal(listed.task, 'plugin:map-plugin:locate')
  const catalog = h.api.taskCatalog().find(item => item.task === 'plugin:map-plugin:locate')
  assert.deepEqual([catalog.name, catalog.member, catalog.lane, catalog.does], ['定位', 'plugin:map-plugin:surveyor', 'resident', '判断主角在哪。'])
  storyEvents.emit('task-finished', { sessionId: 'game-1', task: 'settlement', status: 'completed', turn: 9 })
  await tick(); await tick()
  assert.match(h.errors()[0].message, /定位坏了/)
  assert.throws(() => tavern.job({ name: 'x', on: 'nope', run() {} }), /on 只能是/)
  assert.throws(() => tavern.job({ name: 'x', on: 'reply-committed', member: 'ghost', run() {} }), /还没有用 tavern.member/)
  assert.throws(() => tavern.job({ name: 'x', on: 'reply-committed' }), /run 函数/)
})

test('tavern.job 的 needs：等别的插件任务这一轮做完再跑，读到它的产出；任务目录写出先后', { skip: !cordis }, async t => {
  const { createStoryEvents } = await import('../tavern-plugin/lib/domain/story-events.js')
  const { createWorkflow } = await import('../tavern-plugin/lib/domain/workflow.js')
  const { describeTasks } = await import('../tavern-plugin/lib/domain/background-tasks.js')
  const storyEvents = createStoryEvents({ logger: { warn() {} } })
  const workflow = createWorkflow({ events: storyEvents, logger: { warn() {} } })
  const h = await harness(t, { storyEvents, workflow })
  const calls = []
  await h.root.plugin({ name: 'map-plugin', inject: ['tavern'], apply(ctx) {
    ctx.tavern.job({ name: 'locate', title: '定位', on: 'task-finished', run: async ({ turn }) => ({ place: '花店', signal: turn === 4 ? 0 : 2 }) })
  } })
  let phone
  await h.root.plugin({ name: 'phone-plugin', inject: ['tavern'], apply(ctx) {
    phone = ctx.tavern
    ctx.tavern.job({ name: 'call', title: '来电', needs: 'map-plugin:locate', if: ({ needs }) => needs['map-plugin:locate'].signal > 0,
      run: async ({ turn, needs }) => { calls.push([turn, needs['map-plugin:locate'].place]) } })
  } })
  await tick()
  storyEvents.emit('task-finished', { sessionId: 'game-1', task: 'settlement', status: 'completed', turn: 3 })
  storyEvents.emit('task-finished', { sessionId: 'game-1', task: 'settlement', status: 'completed', turn: 4 })
  for (let i = 0; i < 6; i++) await tick()
  assert.deepEqual(calls, [[3, '花店']], 'no signal on turn 4: its condition keeps it from running')
  const lines = describeTasks(h.api.taskCatalog(), workflow.table(), event => event)
  const call = lines.find(item => item.task === 'plugin:phone-plugin:call')
  assert.equal(call.trigger, '定位完成后')
  assert.equal(call.waits, '等定位完成')
  assert.throws(() => phone.job({ name: 'x', run() {} }), /需要 on 或 needs/)
  assert.throws(() => phone.job({ name: 'x', needs: 'Bad', run() {} }), /插件名:任务名/)
})
