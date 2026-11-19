import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createPluginMedia, pluginMediaRange, pluginMediaSession, slicePluginMediaStream, pluginFileMediaType } from '../tavern-plugin/lib/domain/plugin-media.js'
import { createTavernPluginApi, TAVERN_PLUGIN_API_VERSION } from '../tavern-plugin/lib/plugin-api.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'

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
  const require = createRequire(process.env.DSH_BOOT_MODULE ? pathToFileURL(process.env.DSH_BOOT_MODULE) : import.meta.url)
  let entry
  try { entry = require.resolve('@deepseek-ai/cordis') }
  catch (error) { if (process.env.DSH_BOOT_MODULE) throw error; return null }
  return await import(pathToFileURL(entry).href)
}
const cordis = await loadCordis()
const tick = () => new Promise(resolve => setTimeout(resolve, 20))

function turnMaterial(overrides = {}) {
  return { chatId: 'chat-1', sessionId: 'game-1', turn: 3, index: 5, key: 'key-3', sourceDigest: 'd', source: '<b>她</b>推开门。', text: '她推开门。', card: { path: '/cards/a.json', name: 'A' }, ...overrides }
}

async function harness(t, overrides = {}) {
  const root = new cordis.Context()
  // Test installation is the trusted source, independent of production API inference.
  const identities = new Map()
  const cardOwners = await overrides.cardScope?.() || new Map()
  const install = root.plugin.bind(root)
  root.plugin = (plugin, ...args) => {
    identities.set(plugin.name, { runtimeName: plugin.name, origin: cardOwners.has(plugin.name) ? 'card' : 'global' })
    return install(plugin, ...args)
  }
  const store = memoryStore()
  const media = createPluginMedia({ store })
  const published = []
  let latest = turnMaterial()
  let api
  const warnings = []
  await root.plugin({ name: 'dsh-tavern-test-host', apply(ctx) {
    api = createTavernPluginApi({
      ctx, media, runningUserPlugins: identities, logger: { warn(message) { warnings.push(message) } },
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
  assert.equal(tavern.apiVersion, TAVERN_PLUGIN_API_VERSION)
  assert.deepEqual(tavern.capabilities, { gameMode: 1, hostBehavior: 1, controlInput: 1, mvuSettlementProvider: 1, worldbookStrategy: 1, galleryProvider: 1, pricingProvider: 1, imageModels: 1, imageLibrary: 1, bodyGeneration: 1, bodyProjection: 1, stContractService: 1 })
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

test('tavern 服务：修改玩家称呼校验输入、隔离默认与本局，拒绝忙碌及越界写入', { skip: !cordis }, async t => {
  let defaultName = '默认', playerName = '本局', activity = {}
  const writes = []
  const h = await harness(t, {
    readDefaultPlayerName: async () => defaultName,
    readPlayerName: async () => playerName,
    writeDefaultPlayerName: async name => { writes.push(['default', name]); return defaultName = name },
    writePlayerName: async (id, name) => { writes.push([id, name]); return playerName = name },
    readActivity: async () => activity,
    cardScope: async () => new Map([['card-plugin', { cards: ['/cards/a.json'] }]]),
    cardPathOf: async gameId => gameId === 'game-1' ? '/cards/a.json' : '/cards/other.json',
  })
  let tavern, cardTavern
  await h.root.plugin({ name: 'identity-plugin', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await h.root.plugin({ name: 'card-plugin', inject: ['tavern'], apply(ctx) { cardTavern = ctx.tavern } })
  await tick()
  assert.equal(await tavern.setDefaultPlayerName({ playerName: ' 新默认 ' }), '新默认')
  assert.equal(await tavern.getPlayerName({ gameId: 'game-1' }), '本局')
  assert.equal(await tavern.setPlayerName({ gameId: 'game-1', playerName: ' 新称呼 ' }), '新称呼')
  assert.equal(await tavern.getDefaultPlayerName(), '新默认')
  assert.equal(await tavern.getPlayerName({ gameId: 'game-1' }), '新称呼')
  assert.equal(await tavern.setDefaultPlayerName({ playerName: '' }), '你')
  assert.equal(await cardTavern.setPlayerName({ gameId: 'game-1', playerName: '  ' }), '你')
  const before = writes.length
  for (const invalid of [undefined, null, 123, {}, '长'.repeat(81)]) {
    await assert.rejects(tavern.setDefaultPlayerName({ playerName: invalid }), /80/)
    await assert.rejects(tavern.setPlayerName({ gameId: 'game-1', playerName: invalid }), /80/)
  }
  await assert.rejects(tavern.setPlayerName({ gameId: 'missing', playerName: '新名' }), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
  await assert.rejects(cardTavern.setDefaultPlayerName({ playerName: '新名' }), { code: 'TAVERN_PLUGIN_SCOPE' })
  await assert.rejects(cardTavern.setPlayerName({ gameId: 'other-game', playerName: '新名' }), { code: 'TAVERN_PLUGIN_SCOPE' })
  for (const busy of [{ generating: true }, { settling: true }]) {
    activity = busy
    await assert.rejects(tavern.setPlayerName({ gameId: 'game-1', playerName: '新名' }), { code: 'TAVERN_PLUGIN_BUSY' })
  }
  assert.equal(writes.length, before, '拒绝的请求没有写入')
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
  tavern.toolSkills({ name: 'wrongbook_lookup', skills: ['wrongbook', 'wrongbook'] })
  assert.deepEqual(h.api.toolSkillsFor('wrongbook_lookup'), ['wrongbook'])
  assert.equal(h.api.toolSkillsFor('narrative_anchor_read'), null, '没声明的插件工具始终提供')
  assert.throws(() => tavern.toolSkills({ name: 'tavern_read_variables', skills: ['x'] }), /插件自己注册/)
  assert.throws(() => tavern.toolSkills({ name: 'x_tool', skills: ['Bad Name'] }), /Skill 名称/)

  assert.deepEqual(await tavern.listSkills(), [{ name: 'debug-card', source: 'builtin', description: '内置' }])
  assert.deepEqual(await tavern.saveSkill({ name: 'my-notes', description: '踩坑', body: '先读参考', references: [{ path: 'references/错题.md', content: '…' }] }), { name: 'my-notes', overwritten: false })
  assert.equal((await tavern.readSkill({ name: 'my-notes' })).references[0].content, '旧')
  await assert.rejects(tavern.removeSkill({ name: 'debug-card' }), /内置 Skill 不能删除/)
  await tavern.removeSkill({ name: 'my-notes' })
  assert.deepEqual(removed, ['my-notes'])

  fiber.dispose()
  await tick()
  assert.equal(h.api.toolModesFor('wrongbook_lookup'), null, '插件卸载后可见范围撤销')
  assert.equal(h.api.toolSkillsFor('wrongbook_lookup'), null, '插件卸载后解锁 Skill 撤销')
})

test('配音渠道：插件注册的渠道带上归属并通知语音服务接入，合成超时或出错记入插件错误；synthesizeSpeech 经语音服务合成', { skip: !cordis }, async t => {
  const lines = []
  let changes = 0
  const h = await harness(t, { speechProvidersChanged: () => { changes++ }, synthesizeSpeech: async (sessionId, line) => { lines.push([sessionId, line]); return line.narration ? { skip: true, reason: 'narration' } : { url: 'audio:t1', mediaType: 'audio/wav' } } })
  let tavern
  const fiber = await h.root.plugin({ name: 'edge-tts', inject: ['tavern'], apply(ctx) {
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
  assert.equal(changes, 1)
  assert.deepEqual(await entry.synthesize({ text: '你好' }), { data: new Uint8Array([1]), mediaType: 'audio/mpeg' })
  await assert.rejects(entry.synthesize({ text: 'boom' }), /服务挂了/)
  assert.throws(() => tavern.speechProvider({ id: 'edge', label: '重复', synthesize() {} }), /已注册/)
  assert.throws(() => tavern.speechProvider({ id: 'Bad', label: 'x', synthesize() {} }), /name/)

  assert.deepEqual(await tavern.synthesizeSpeech({ gameId: 'game-1', speaker: '林曦', text: '你好', emotion: 'joy' }), { url: 'audio:t1', mediaType: 'audio/wav' })
  assert.deepEqual(lines[0], ['game-1', { speaker: '林曦', text: '你好', emotion: 'joy', narration: false }])
  assert.equal(await tavern.synthesizeSpeech({ gameId: 'game-1', text: '夜深了。', narration: true }), null)
  await assert.rejects(tavern.synthesizeSpeech({ gameId: 'game-1', text: ' ' }), /text/)
  await fiber.dispose(); await tick()
  assert.equal(changes, 2, '卸载插件后语音服务移除它的渠道')
})

test('价格提供方：getModelPricing 问插件报价，没有提供方就不可用，卸载即撤销', { skip: !cordis }, async t => {
  const h = await harness(t)
  const selections = new Map([['game-1', { provider: 'router', model: 'opus', reasoningEffort: 'low' }]])
  const settings = createSettingsHandlers({ modelSelection: sessionId => selections.get(sessionId) || null, pluginApi: h.api })
  assert.equal((await settings.getModelPricing({ sessionId: 'game-1' })).available, false, 'no provider, no figure')
  const seen = []
  let tavern
  const fiber = await h.root.plugin({ name: 'gateway-prices', inject: ['tavern'], apply(ctx) {
    tavern = ctx.tavern
    ctx.tavern.pricingProvider({ quote(selection) {
      seen.push(selection)
      if (!selection) return { available: false, reason: 'no model' }
      if (selection.model === 'boom') throw new Error('gateway down')
      selection.model = 'changed'
      return { available: true, rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } }
    } })
  } })
  await tick()
  assert.equal(tavern.capabilities.pricingProvider, 1)
  assert.deepEqual(await settings.getModelPricing({ sessionId: 'game-1' }), { available: true, rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } })
  assert.deepEqual(seen[0], { provider: 'router', model: 'changed', reasoningEffort: 'low' })
  assert.equal(selections.get('game-1').model, 'opus', 'the provider only changes its own copy')
  assert.deepEqual(await settings.getModelPricing({ sessionId: 'other' }), { available: false, reason: 'no model' })
  selections.set('game-1', { provider: 'router', model: 'boom' })
  await assert.rejects(settings.getModelPricing({ sessionId: 'game-1' }), /gateway down/)
  assert.deepEqual(h.errors()[0], { plugin: 'gateway-prices', stage: '价格', message: 'gateway down' })
  assert.throws(() => tavern.pricingProvider({ quote() {} }), /已提供价格/)
  assert.throws(() => tavern.pricingProvider({}), /quote/)
  await fiber.dispose()
  await tick()
  assert.equal(h.api.pricingProviders().length, 0)
  assert.equal((await settings.getModelPricing({ sessionId: 'game-1' })).available, false)
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
  assert.equal(tavern.apiVersion, TAVERN_PLUGIN_API_VERSION)
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

test('managed mods wait for their optional host and rebind after stage restart', {skip:!cordis}, async t => {
  const h = await harness(t)
  let active=0, registrations=0
  const mod=await h.root.plugin({name:'optional-mod',inject:['tavern'],apply(ctx){
    ctx.get('tavern').registerMod({id:'test.mod'}, {})
  }})
  await tick()
  const install=()=>h.root.plugin({name:'optional-mod-host',apply(ctx){
    ctx.provide('tavernManagedModules',{apiVersion:1,register(){active++;registrations++;return()=>{active--}}})
  }})
  const first=await install();await tick()
  assert.equal(active,1)
  await first.dispose();await tick();assert.equal(active,0)
  const second=await install();await tick();assert.equal(active,1);assert.equal(registrations,2)
  await mod.dispose();await tick();assert.equal(active,0)
  await second.dispose()
})


test('正文生成器通过 Cordis 注册、按卡隔离，卸载后停止可用性', { skip: !cordis }, async t => {
  const h = await harness(t, { cardScope: async () => new Map([['body-plugin', { cards: ['/cards/a.json'] }]]), cardPathOf: async () => '/cards/a.json' })
  const fiber = await h.root.plugin({ name: 'body-plugin', inject: ['tavern'], apply(ctx) {
    ctx.tavern.bodyGenerator({ name: 'body', title: '正文', generate: async ({ materials }) => { materials.input.raw = 'changed'; return { text: '完整正文' } } })
  } })
  await tick()
  const list = await h.api.bodyGenerators.list('game-1')
  assert.deepEqual(list.map(item => item.id), ['body-plugin:body'])
  const materials = { gameId: 'game-1', input: { raw: '原输入' } }
  assert.equal((await h.api.bodyGenerators.generate(list[0].id, { materials })).text, '完整正文')
  assert.equal(materials.input.raw, '原输入')
  await fiber.dispose(); await tick()
  assert.deepEqual(await h.api.bodyGenerators.list('game-1'), [])
  await assert.rejects(h.api.bodyGenerators.generate(list[0].id, { materials }), /不可用/)
})


test('owner-bound read declarations revoke snapshots on update, unregister and fiber unload', { skip: !cordis }, async t => {
  const h = await harness(t)
  const seen = []
  const trusted = { owner: 'reader-a', name: 'archive', sessionId: 'game-1', consumer: { id: 'worker' },
    anchor: { branchId: 'branch-a', turn: 3, para: 2 }, scope: { chatId: 'chat-1', contact: 'actor-7' },
    readHistory: async context => context }
  assert.equal(await h.api.resolveReadCapability(trusted), null)
  assert.equal(h.api.service.resolveReadCapability, undefined)
  let a, b, service
  const definition = enabled => ({ sources: [{ name: 'raw', readRaw: async context => { seen.push(context); return 'raw' } }],
    authorize: ({ sessionId, consumer, scope }) => enabled && sessionId === 'game-1' && consumer.id === 'worker' && scope.contact === 'actor-7' })
  const first = await h.root.plugin({ name: 'reader-a', inject: ['tavern'], apply(ctx) {
    service = ctx.tavern
    a = service.readCapability({ name: 'archive', ...definition(true) })
    assert.throws(() => service.readCapability({ name: 'archive', ...definition(true) }), /already registered/)
  } })
  await h.root.plugin({ name: 'reader-b', inject: ['tavern'], apply(ctx) {
    b = ctx.tavern.readCapability({ name: 'archive', ...definition(true) })
    assert.throws(() => ctx.tavern.readCapability({ name: 'reader-a:archive', ...definition(true) }))
  } })
  const view = await h.api.resolveReadCapability(trusted)
  const other = await h.api.resolveReadCapability({ ...trusted, owner: 'reader-b' })
  assert.deepEqual(view.sources, ['reader-a:archive:raw'])
  assert.deepEqual(other.sources, ['reader-b:archive:raw'])
  const query = { args: { sourceId: view.sources[0], turn: 3, para: 2 } }
  assert.equal(await view.readSource({ ...query, sessionId: 'evil', consumer: { id: 'evil' }, anchor: { turn: 99 }, scope: {} }), 'raw')
  assert.deepEqual(seen[0], { sessionId: trusted.sessionId, anchor: trusted.anchor, scope: trusted.scope, args: query.args, signal: undefined })
  assert.throws(() => other.readSource(query), /not authorized/)
  assert.throws(() => view.readSource({ args: { ...query.args, consumer: 'evil' } }), /unsupported/)
  assert.throws(() => view.readSource({ args: { ...query.args, turn: 4 } }), /anchor/)
  assert.throws(() => view.readSource({ args: { ...query.args, para: 3 } }), /anchor/)
  assert.equal(await h.api.resolveReadCapability({ ...trusted, consumer: { id: 'stranger' } }), null)
  assert.equal(await h.api.resolveReadCapability({ ...trusted, scope: { contact: 'other' } }), null)
  assert.equal(seen.length, 1)
  assert.equal((await view.readHistory({ args: { query: 'hello' }, sessionId: 'evil' })).sessionId, 'game-1')
  a.update(definition(false))
  a.update(definition(true)) // No resolver observes the intermediate disabled state.
  await assert.rejects(view.readSource(query), { code: 'TAVERN_PLUGIN_READ_REVOKED' })
  await assert.rejects(view.readHistory({ args: {} }), { code: 'TAVERN_PLUGIN_READ_REVOKED' })
  const reopened = await h.api.resolveReadCapability(trusted)
  assert.notEqual(reopened.generation, view.generation)
  a.update(definition(false))
  assert.equal(await h.api.resolveReadCapability(trusted), null)
  a.update(definition(true))
  const beforeRevoke = await h.api.resolveReadCapability(trusted)
  a.revoke()
  await assert.rejects(beforeRevoke.readSource(query), { code: 'TAVERN_PLUGIN_READ_REVOKED' })
  assert.throws(() => a.update(definition(true)), { code: 'TAVERN_PLUGIN_READ_REVOKED' })
  a = service.readCapability({ name: 'archive', ...definition(true) })
  const registeredAgain = await h.api.resolveReadCapability(trusted)
  assert.notEqual(registeredAgain.generation, beforeRevoke.generation)
  await first.dispose(); await tick()
  assert.equal(await h.api.resolveReadCapability(trusted), null)
  await assert.rejects(registeredAgain.readSource(query), { code: 'TAVERN_PLUGIN_READ_REVOKED' })
  assert.equal(await other.readSource({ args: { sourceId: other.sources[0], turn: 1 } }), 'raw')
  b.revoke()
})

test('read declaration update rejects in-flight results and pending authorizations', { skip: !cordis }, async t => {
  const h = await harness(t)
  let handle, finish, allow
  const input = { owner: 'reader', name: 'archive', sessionId: 'game-1', consumer: 'worker', anchor: { turn: 3 }, scope: {}, readHistory: async () => 'history' }
  const sources = [{ name: 'raw', readRaw: () => new Promise(resolve => { finish = resolve }) }]
  await h.root.plugin({ name: 'reader', inject: ['tavern'], apply(ctx) {
    handle = ctx.tavern.readCapability({ name: 'archive', sources, authorize: () => true })
  } })
  const view = await h.api.resolveReadCapability(input)
  const pending = view.readSource({ args: { sourceId: view.sources[0], turn: 1 } })
  handle.update({ sources, authorize: () => new Promise(resolve => { allow = resolve }) })
  finish('late')
  await assert.rejects(pending, { code: 'TAVERN_PLUGIN_READ_REVOKED' })
  const resolving = h.api.resolveReadCapability(input)
  await tick()
  handle.revoke()
  allow(true)
  assert.equal(await resolving, null)
})
test('beforeImagePlan / beforeImageGenerate: the host’s 自动素材 releases a turn and each picture; a picture waits only for linked people without a 参考图', async () => {
  let settled = 0
  const api = createTavernPluginApi({ logger: { warn() {} }, imageCharactersSettled: async () => { settled++ }, cardScope: async () => new Map(),
    runningUserPlugins: new Map([['dsh-tavern-image', { runtimeName: 'dsh-tavern-image', origin: 'global' }]]) })
  const tavern = Object.assign(Object.create(api.service), { ctx: { fiber: { name: 'dsh-tavern-image' }, effect(setup) { return setup() } } })
  const records = [
    { id: 'c-own', name: '林月', figureId: 'f-own', figurePackId: 'p', referenceImage: { id: 'r' } },
    { id: 'c-new', name: '阿新', figureId: 'f-new', figurePackId: 'p' },
    { id: 'c-free', name: '路人' },
  ]
  const find = ({ characterId }) => records.find(c => c.id === characterId) || (() => { throw Object.assign(new Error('none'), { code: 'NOT_FOUND' }) })()
  tavern.registerImageLibrary({ id: 'definitions', label: '人物库', schemaVersion: 4, characters: () => [],
    getCharacter: input => ({ version: 4, character: structuredClone(find(input)) }), async patchCharacter() {}, async createCharacter() {}, async putReferenceImage() {} })
  const subjects = ['c-own', 'c-new', 'c-free', 'c-gone'].map(characterId => ({ characterId }))
  await tavern.beforeImagePlan({ gameId: 'g', turn: 2 })
  assert.deepEqual(await tavern.beforeImageGenerate({ gameId: 'g', subjects }), {}, 'nothing to wait for without the stage')
  await assert.rejects(tavern.beforeImagePlan({ gameId: 'g', turn: '2' }), TypeError)
  await assert.rejects(tavern.beforeImageGenerate({ gameId: 'g', subjects: {} }), TypeError)
  const asked = []
  let unavailable = []
  const off = api.imageGates({ async beforePlan(input) { asked.push(['plan', input.gameId, input.turn]) },
    async awaitReferences(input) { asked.push(['refs', input.figures]); return { unavailable } } })
  await tavern.beforeImagePlan({ gameId: 'g', turn: 3 })
  assert.equal(settled, 1, 'the people the turn cast have their records before the plugin plans')
  assert.deepEqual(await tavern.beforeImageGenerate({ gameId: 'g', subjects }), {})
  assert.deepEqual(asked, [['plan', 'g', 3], ['refs', [{ packId: 'p', figureId: 'f-new' }]]], 'only the linked person without a 参考图 is waited for')
  assert.equal(settled, 2, 'the reference is on the record before the plugin draws')
  unavailable = [{ packId: 'p', figureId: 'f-new' }]
  assert.deepEqual(await tavern.beforeImageGenerate({ gameId: 'g', subjects }), { skip: true, reason: '「阿新」的人设图没有画出来，有他们的图这次没有出' })
  assert.deepEqual(await tavern.beforeImageGenerate({ gameId: 'g', subjects: [{ characterId: 'c-own' }] }), {})
  assert.equal(asked.length, 3, 'a picture of people who all have a 参考图 does not ask')
  off()
  await tavern.beforeImagePlan({ gameId: 'g', turn: 4 })
  assert.equal(asked.length, 3)
})
test('决策模型开放接口：capability 探测、卡内作用域限制、全链路判定与错误码映射', { skip: !cordis }, async t => {
  const { createNarrativeDamper, defaultNarrativeDamperConfig } = await import('../tavern-plugin/lib/domain/narrative-damper.js')

  // 未注入 decisionJudge 时的降级表现
  const bare = await harness(t)
  let barePlugin
  await bare.root.plugin({ name: 'bare-plugin', inject: ['tavern'], apply(ctx) { barePlugin = ctx.tavern } })
  await tick()
  assert.equal(barePlugin.capabilities.decisionJudge, undefined)
  const unavailableStatus = await barePlugin.decisionJudgeStatus()
  assert.equal(unavailableStatus.available, false)
  assert.equal(unavailableStatus.reason, 'UNAVAILABLE')
  await assert.rejects(
    () => barePlugin.judgeDecision({ input: '尝试撬锁', questions: [{ id: 'q1', instructions: '难吗？' }] }),
    err => err.code === 'TAVERN_PLUGIN_NOT_FOUND'
  )

  // 注入完整 narrativeDamper 后的集成链路
  let damperConfig = {
    ...defaultNarrativeDamperConfig(),
    enabled: false,
    provider: 'gemini-compatible',
    model: 'gemini-decision-1',
    baseUrl: 'https://internal-damper.example.com/v1beta',
    timeoutMs: 2500
  }
  const secretValue = 'secret-damper-api-key-999'
  let mockFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        answers: {
          difficulty: { type: 'choice', choice: 'hard', probabilities: { easy: 0.1, hard: 0.9 }, confidence: 0.87 }
        },
        usage: { total_input_tokens: 45, total_output_tokens: 12 }
      }
    }
  })
  const damper = createNarrativeDamper({
    getConfig: async () => damperConfig,
    credentials: () => ({ async resolve() { return { value: secretValue, source: 'file' } } }),
    fetch: (url, init) => mockFetch(url, init)
  })
  const cardByGame = new Map([['game-a', '/cards/a.json'], ['game-b', '/cards/b.json']])
  const h = await harness(t, {
    cardScope: async () => new Map([['card-dice', { cards: ['/cards/a.json'] }]]),
    cardPathOf: async gameId => cardByGame.get(gameId) || null,
    resolveGame: async gameId => cardByGame.has(gameId) ? { sessionId: gameId, chatId: 'chat-' + gameId, cardPath: cardByGame.get(gameId) } : null,
    decisionJudge: {
      status: () => damper.judgeStatus(),
      judge: input => damper.judge(input)
    }
  })
  const services = {}
  for (const name of ['global-dice', 'card-dice']) {
    await h.root.plugin({ name, inject: ['tavern'], apply(ctx) { services[name] = ctx.tavern } })
  }
  await tick()

  assert.equal(services['global-dice'].capabilities.decisionJudge, 1)
  const status = await services['global-dice'].decisionJudgeStatus()
  assert.deepEqual(status, {
    available: true,
    provider: 'gemini-compatible',
    model: 'gemini-decision-1',
    capabilities: { noul: true, choice: true, score: true }
  })
  assert.equal(JSON.stringify(status).includes(secretValue), false)
  assert.equal(JSON.stringify(status).includes('internal-damper.example.com'), false)

  const sampleQuestions = [{
    id: 'difficulty',
    type: 'choice',
    instructions: '评定本次行动难度档位',
    criteria: { easy: '简单', hard: '困难' }
  }]

  // 全局插件可省略 gameId
  const globalRes = await services['global-dice'].judgeDecision({ input: '赤手空拳正面迎战武装守卫', questions: sampleQuestions })
  assert.equal(globalRes.answers.difficulty.choice, 'hard')
  assert.deepEqual(globalRes.usage, { inputTokens: 45, outputTokens: 12 })

  // 卡内插件未传 gameId 或访问其他人物卡会话将被 TAVERN_PLUGIN_SCOPE 拦截
  await assert.rejects(
    () => services['card-dice'].judgeDecision({ input: '尝试说服她', questions: sampleQuestions }),
    err => err.code === 'TAVERN_PLUGIN_SCOPE'
  )
  await assert.rejects(
    () => services['card-dice'].judgeDecision({ gameId: 'game-b', input: '尝试说服她', questions: sampleQuestions }),
    err => err.code === 'TAVERN_PLUGIN_SCOPE'
  )
  const cardRes = await services['card-dice'].judgeDecision({ gameId: 'game-a', input: '尝试说服她', questions: sampleQuestions })
  assert.equal(cardRes.answers.difficulty.choice, 'hard')

  // 输入预校验与错误码映射
  await assert.rejects(
    () => services['global-dice'].judgeDecision({ input: '   ', questions: sampleQuestions }),
    err => err.code === 'TAVERN_PLUGIN_DECISION_INVALID_INPUT'
  )
  await assert.rejects(
    () => services['global-dice'].judgeDecision({ input: '测试', questions: sampleQuestions, timeoutMs: -10 }),
    err => err.code === 'TAVERN_PLUGIN_DECISION_INVALID_INPUT'
  )

  mockFetch = async () => ({
    ok: false,
    status: 400,
    async json() { return { error: { code: 'prohibited_content', message: 'blocked by safety' } } }
  })
  await assert.rejects(
    () => services['global-dice'].judgeDecision({ input: '敏感内容测试', questions: sampleQuestions }),
    err => err.code === 'TAVERN_PLUGIN_DECISION_SAFETY_BLOCKED'
  )

  damperConfig = { ...damperConfig, provider: 'jev', model: 'jev-1.13.0', baseUrl: '' }
  await assert.rejects(
    () => services['global-dice'].judgeDecision({ input: '常规检查', questions: sampleQuestions }),
    err => err.code === 'TAVERN_PLUGIN_DECISION_UNSUPPORTED_QUESTION_TYPE'
  )
})
test('叙事阻尼器联动：附加题收集过滤与上限、合并答案零延迟读取、真骰配额回灌', { skip: !cordis }, async t => {
  const { createNarrativeDamper, defaultNarrativeDamperConfig } = await import('../tavern-plugin/lib/domain/narrative-damper.js')
  const config = {
    ...defaultNarrativeDamperConfig(),
    enabled: true,
    provider: 'gemini-compatible',
    model: 'gemini-decision-1',
    baseUrl: 'https://damper.example.com/v1beta',
    timeoutMs: 2500
  }
  const sent = []
  const damper = createNarrativeDamper({
    getConfig: async () => config,
    credentials: () => ({ async resolve() { return { value: 'damper-key', source: 'file' } } }),
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body)
      sent.push(body)
      return {
        ok: true,
        status: 200,
        async json() {
          const answers = {
            godmode_outcome: { noul: 0.1 },
            unfounded_retcon: { noul: 0.1 },
            epistemic_violation: { noul: 0.1 },
            leverage_score: { score: 2 },
            ruling_tier: { type: 'choice', choice: 'conflicted_half_step' },
            mvu_delta_budget: { type: 'choice', choice: 'micro_step' }
          }
          // 同一份响应里按题目类型逐个回答案：合并请求的每个 plg_ 题都能拿到答案
          for (const [id, question] of Object.entries(body.questions)) {
            if (!id.startsWith('plg_')) continue
            answers[id] = question.type === 'noul'
              ? { type: 'noul', noul: 0.42 }
              : question.type === 'score'
                ? { type: 'score', score: 2 }
                : { type: 'choice', choice: Object.keys(question.criteria)[0], probabilities: {} }
          }
          return { answers }
        }
      }
    }
  })

  const h = await harness(t, {
    cardScope: async () => new Map([['card-dice', { cards: ['/cards/a.json'] }], ['other-card', { cards: ['/cards/b.json'] }]]),
    cardPathOf: async gameId => gameId === 'game-1' ? '/cards/a.json' : '/cards/b.json',
    narrativeDamper: {
      turnContextForPlugin: (...a) => damper.turnContextForPlugin(...a),
      applyDiceOutcomeShift: (...a) => damper.applyDiceOutcomeShift(...a)
    }
  })
  const services = {}
  const asked = []
  const make = (name, count, type = 'noul') => Array.from({ length: count }, (_, i) => ({
    id: 'q' + (i + 1),
    type,
    instructions: name + ' 的第 ' + (i + 1) + ' 题',
    ...(type === 'score' ? { criteria: ['低', '中', '高'] } : {})
  }))
  // 抛错的插件：只记日志，不影响其他插件
  await h.root.plugin({ name: 'aaa-broken', inject: ['tavern'], apply(ctx) {
    ctx.tavern.damperTurnQuestions({ name: 'check', questions: () => { throw new Error('boom') } })
  } })
  await h.root.plugin({ name: 'bbb-greedy', inject: ['tavern'], apply(ctx) {
    services.greedy = ctx.tavern
    ctx.tavern.damperTurnQuestions({ name: 'check', questions: input => { asked.push(input); return make('greedy', 9) } })
  } })
  await h.root.plugin({ name: 'card-dice', inject: ['tavern'], apply(ctx) {
    services.card = ctx.tavern
    ctx.tavern.damperTurnQuestions({ name: 'check', questions: () => [
      { id: 'card_mood', type: 'noul', instructions: '她的心情如何？' },
      { id: 'card_score', type: 'score', instructions: '张力评分', criteria: ['低', '高'] }
    ] })
  } })
  await h.root.plugin({ name: 'other-card', inject: ['tavern'], apply(ctx) {
    ctx.tavern.damperTurnQuestions({ name: 'check', questions: () => make('other', 2) })
  } })
  let seenContext = null
  let shiftResult = null
  await h.root.plugin({ name: 'ccc-dice', inject: ['tavern'], apply(ctx) {
    services.dice = ctx.tavern
    ctx.tavern.damperTurnQuestions({ name: 'check', questions: () => [
      { id: 'difficulty', type: 'choice', instructions: '评定难度', criteria: { easy: '简单', hard: '困难' } },
      { id: 'risk', type: 'noul', instructions: '有额外风险吗？' },
      { id: 'weight', type: 'score', instructions: '权重', criteria: ['低', '高'] }
    ] })
    // 插件本轮段落：零延迟读合并答案，并把真骰结果回灌配额
    ctx.tavern.turnSection({ name: 'dice', text: async () => {
      seenContext = await ctx.tavern.getDamperTurnContext({ gameId: 'game-1', turn: 3 })
      shiftResult = await ctx.tavern.applyDamperDiceShift({ gameId: 'game-1', turn: 3, tier: 'critical', check: '潜行开锁', summary: 'd20=19' })
      return '骰子段落'
    } })
  } })
  await tick()

  assert.equal(services.dice.capabilities.narrativeDamper, 1)
  // 注册校验
  assert.throws(() => services.dice.damperTurnQuestions({ name: 'Bad Name', questions: () => [] }))
  assert.throws(() => services.dice.damperTurnQuestions({ name: 'ok', questions: [] }), TypeError)

  const prep = await damper.turnPrepStatus()
  const extraQuestions = await h.api.collectDamperQuestions({
    gameId: 'game-1', turn: 3, input: '我推门进去。', protocol: prep.protocol, capabilities: prep.capabilities,
    stateSnapshot: { kind: 'plain', data: { 好感: 30 } }, posture: '走廊'
  })
  // 本局越权卡内插件（other-card）被过滤，抛错插件被跳过，单插件 6 题、总计 10 题封顶
  assert.deepEqual(extraQuestions.map(batch => batch.owner), ['bbb-greedy', 'card-dice', 'ccc-dice'])
  assert.deepEqual(extraQuestions.map(batch => batch.questions.length), [6, 2, 2])
  assert.deepEqual(extraQuestions[2].questions.map(q => q.id), ['difficulty', 'risk'])
  assert.equal(asked.length, 1)
  assert.equal(asked[0].protocol, 'gemini')
  assert.equal(asked[0].capabilities.choice, true)
  assert.equal(asked[0].posture, '走廊')
  assert.equal(asked[0].turn, 3)
  assert.equal(h.errors().some(row => row.plugin === 'aaa-broken' && row.stage === '阻尼器附加题'), true)

  const chat = {
    id: 'chat-1', mode: 'story', posture: '走廊尽头，她站在门口。', timeline: { branchId: 'main' },
    messages: [{ role: 'assistant', swipeId: 0, swipes: ['她推开走廊尽头那扇门。'], variables: [{ stat_data: { 好感: 30 } }] }]
  }
  const evaluated = await damper.evaluateTurn({ chat, card: { name: 'A' }, turn: 3, userText: '我抬手敲了敲门。', extraQuestions })
  // 一趟请求同时拿到阻尼裁定与全部插件答案
  assert.equal(sent.length, 1)
  const merged = sent[0].questions
  assert.ok(merged.godmode_outcome && merged.ruling_tier, '阻尼器自身题目仍在同一请求里')
  assert.ok(merged.plg_0_q1 && merged.plg_2_difficulty, '附加题按 plg_<批次>_<id> 合入同一 questions map')
  assert.equal(evaluated.ruling.rulingTier, 'conflicted_half_step')
  assert.equal(evaluated.pluginAnswers['bbb-greedy'].q1.probability, 0.42)
  assert.deepEqual(evaluated.pluginAnswers['card-dice'].card_score, { type: 'score', score: 2 })
  assert.equal(evaluated.pluginAnswers['ccc-dice'].difficulty.choice, 'easy')
  assert.equal(evaluated.pluginAnswers['ccc-dice'].risk.probability, 0.42)
  assert.equal('weight' in evaluated.pluginAnswers['ccc-dice'], false, '超出总题数上限的题目不进请求')
  assert.equal('other-card' in evaluated.pluginAnswers, false)

  // 宿主时序：先 collect + evaluate，再跑插件 turnSection（可读上下文并回灌真骰）
  const sections = await h.api.turnContext({ gameId: 'game-1', turn: 3, input: '我抬手敲了敲门。' })
  assert.equal(sections.some(section => section.text === '骰子段落'), true)
  assert.equal(seenContext.active, true)
  assert.equal(seenContext.turn, 3)
  assert.equal(seenContext.posture, chat.posture)
  assert.equal(seenContext.answers.difficulty.choice, 'easy')
  assert.equal(seenContext.outcome.rulingTier, 'conflicted_half_step')
  assert.equal(shiftResult.applied, true)
  assert.equal(shiftResult.ruling.rulingTier, 'full_accept')
  assert.equal(shiftResult.ruling.deltaBudget, 'breakthrough')
  assert.deepEqual(shiftResult.ruling.diceShift, {
    owner: 'ccc-dice', tier: 'critical', check: '潜行开锁', summary: 'd20=19',
    prevRulingTier: 'conflicted_half_step', prevDeltaBudget: 'micro_step'
  })
  // 宿主随后从 activeRuling 取到已被真骰修正的配额与裁定文本
  const finalDamper = damper.activeRuling('chat-1', 3)
  assert.equal(finalDamper.outcome.rulingTier, 'full_accept')
  assert.equal(finalDamper.outcome.deltaBudget, 'breakthrough')
  assert.deepEqual(finalDamper.outcome.diceShift, shiftResult.ruling.diceShift)
  assert.match(finalDamper.rulingText, /命运检定联动：本轮「潜行开锁」真骰裁定为【大成功】/)
  assert.match(finalDamper.rulingText, /（full_accept \/ breakthrough）/)

  // 作用域与禁用检查
  await assert.rejects(() => services.card.getDamperTurnContext({ gameId: 'game-2', turn: 3 }), err => err.code === 'TAVERN_PLUGIN_SCOPE')
  await assert.rejects(() => services.card.applyDamperDiceShift({ gameId: 'game-2', turn: 3, tier: 'critical' }), err => err.code === 'TAVERN_PLUGIN_SCOPE')
  await assert.rejects(() => services.dice.getDamperTurnContext({ gameId: 'game-9', turn: 3 }), err => err.code === 'TAVERN_PLUGIN_NOT_FOUND')
  assert.equal(await services.card.getDamperTurnContext({ gameId: 'game-1', turn: 3 }) !== null, true)
  assert.equal(await services.dice.getDamperTurnContext({ gameId: 'game-1', turn: 99 }), null)
})
