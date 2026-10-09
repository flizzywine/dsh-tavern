import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
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

test('插件媒体：校验类型、数据大小与附件形状', async () => {
  const media = createPluginMedia({ store: memoryStore() })
  const attach = item => media.attach({ chatId: 'c', sessionId: 's', owner: 'p', turn: 1, key: 'k', currentKey: 'k', item })
  await assert.rejects(attach({ kind: 'Image' }), /kind/)
  await assert.rejects(attach({ kind: 'image', attachment: { attachmentId: 'x', name: 'a.mp4' } }), /图片附件/)
  await assert.rejects(attach({ kind: 'x/y', data: 'a'.repeat(70000) }), /64 KB/)
  await assert.rejects(attach({ kind: 'x/y', progress: 2 }), /progress/)
  const video = await attach({ kind: 'video', attachment: { attachmentId: 'v', name: 'clip.mp4', bytes: 5 } })
  assert.equal(video.attachment.name, 'clip.mp4')
  const custom = await attach({ kind: 'my-plugin/card', data: { a: 1 } })
  assert.deepEqual(custom.data, { a: 1 })
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
  await root.plugin({ name: 'dsh-tavern-test-host', apply(ctx) {
    api = createTavernPluginApi({
      ctx, media, logger: { warn() {} },
      resolveGame: async sessionId => sessionId === 'game-1' ? { chatId: 'chat-1', sessionId } : null,
      currentKey: async () => latest.key,
      readTurn: async (sessionId, turn) => sessionId === 'game-1' && turn === latest.turn ? latest : null,
      readLatestSettledTurn: async () => latest,
      readCardContext: async () => ({ description: 'd', personality: '', scenario: '', lore: [] }),
      backgroundModel: async () => ({ provider: 'p', model: 'm', thinking: 'high' }),
      publish: sessionId => published.push(sessionId),
      ...overrides
    })
    ctx.provide('tavern', api.service)
  } })
  t.after(() => root.registry?.clear?.())
  return { root, api, media, published, setLatest(value) { latest = value } }
}

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
  assert.deepEqual(await tavern.backgroundModel({ gameId: 'game-1' }), { provider: 'p', model: 'm' })
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
    ctx.tavern.worldbookSource({ name: 'session', entries: ({ input }) => [{ title: '支线', content: '与' + input + '有关的线索' }, { content: '  ' }] })
    ctx.tavern.settlementSection({ name: 'anchor', text: ({ turn }) => '第 ' + turn + ' 轮请记录叙事锚点' })
    ctx.tavern.settlementTool({ name: 'anchor_submit', description: '提交叙事锚点', parameters: { type: 'object', properties: { text: { type: 'string' } } },
      execute: async ({ gameId, turn, arguments: args }) => { calls.push([gameId, turn, args.text]); if (args.text === 'bad') throw new Error('写入失败'); return { ok: true } } })
  } })
  await tick()
  assert.equal(tavern.apiVersion, 2)
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

  await fiber.dispose()
  await tick()
  assert.deepEqual(await h.api.turnContext({ gameId: 'game-1', turn: 4, input: '推门' }), [])
  assert.deepEqual(h.api.settlement.tools(), [])
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
  assert.deepEqual(changes, [{ gameId: 'game-1', kind: 'rollback', turn: 3 }])
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
    bindSceneWorldbook({ role: 'assistant', turn: 2, text: '她<b>推开</b>酒馆的门。', swipes: ['她<b>推开</b>酒馆的门。'], swipeId: 0, mvu: { pending: false } }, ref)
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
  await db.update(chat.id, current => { current.messages[2].swipes.push('另一个版本。'); current.messages[2].swipeId = 1; return current })
  assert.notEqual(await reader.currentKey('game-1', 2), latest.key, '换版本后正文版本变化')
  assert.deepEqual((await reader.readCardContext(await reader.readTurn('game-1', 2))).lore, [], '新版本不继承旧版本的世界书快照')
})

test('真实正文请求：插件段落只进入游玩的 system，卡片 Agent 不受影响', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const { createInitializationNative } = await import('./fixtures/conversation-initialization-native.mjs')
  const { registerTurnLifecycleHooks } = await import('../tavern-plugin/lib/hooks/turn-lifecycle.js')
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { assembleStablePrefix: false })
  t.after(() => h.dispose())
  let chat = await h.open().start({ ...h.input, mode: 'card', cardPath: '' })
  let mode = 'story'
  const calls = []
  registerTurnLifecycleHooks({ ctx: h.ctx, hookChatForSession: async () => ({ ...chat, mode }), ensureNativeSystemPrefix: async () => {},
    backgroundAgentRunner: { owns: () => false }, fullTemplateRuntime: { cancel() {} }, clearRuntimePresetRequestState() {},
    userMessageForTurn: () => null, contentText: () => '', foregroundHandoff: { end() {} },
    sessionStore: { flush: session => h.ctx.sessions.flush(session) },
    foregroundStrategies: { assembleSystemPrompt: async assembly => { assembly.sections = [{ name: 'tavern:fixed', text: '卡片设定' }]; return assembly }, endTurn() {} },
    turnOrchestrator: { modeFor: async () => mode },
    pluginPromptSections: async input => { calls.push(input); return [{ name: 'tavern-plugin:image:rules', text: '在段落之间写 image###标签###' }] },
    nativeWorldBookTemplateContext: async () => ({}), readChatCard: async () => ({}),
    publishResourceWorkspace: async () => ({}), runtimePrompt: () => ''
  })
  for (const next of ['story', 'card']) {
    mode = next
    h.target.agent.followup({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'human' } })
    await h.target.agent.whenIdle()
  }
  assert.equal(h.requests.length, 2)
  assert.match(h.requests[0].system, /卡片设定\n\n在段落之间写 image###标签###/)
  assert.doesNotMatch(h.requests[1].system, /image###/)
  assert.equal(calls[0].gameId, h.target.agent.session.id)
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
  const html = extractPluginMarkers('<div class="bar">image###a###</div>', [/image###(.+?)###/])
  assert.equal(html.html, '<div class="bar"></div>')
  assert.equal(html.markers.length, 1)
})

test('示例插件按文档写法运行：先占位，再换成图片', { skip: !cordis }, async t => {
  const h = await harness(t)
  const saved = []
  await h.root.plugin({ name: 'fake-attachments', apply(ctx) {
    ctx.provide('attachments', { async saveImage(input) { saved.push(input); return { attachmentId: 'png-1', mediaType: input.mediaType, bytes: input.data.length, width: 96, height: 64 } } })
  } })
  const example = await import('../examples/tavern-plugin-hello/index.mjs')
  let tavern
  await h.root.plugin(example)
  await h.root.plugin({ name: 'observer', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern } })
  await tick()
  await h.api.turnSettled('game-1')
  for (let index = 0; index < 50 && !saved.length; index++) await tick()
  await tick()
  assert.equal(saved.length, 1)
  assert.deepEqual(await tavern.list({ gameId: 'game-1' }), [], '其他插件看不到示例插件的项')
  const [item] = await h.media.list({ chatId: 'chat-1' })
  assert.equal(item.owner, 'tavern-plugin-hello')
  assert.equal(item.status, 'ready')
  assert.equal(item.anchor, '她推开门。')
  assert.equal(item.attachment.attachmentId, 'png-1')
})

test('内置 Skill 携带的接口文档与示例和正本一致', async () => {
  const { readFile } = await import('node:fs/promises')
  const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
  assert.equal(await read('presets/tavern/skills/tavern-plugin/references/plugin-api.md'), await read('docs/plugin-api.md'), '修改 docs/plugin-api.md 后同步复制到 Skill')
  const example = /```js\n([\s\S]*)```\n$/.exec(await read('presets/tavern/skills/tavern-plugin/references/example-plugin.md'))?.[1]
  assert.equal(example, await read('examples/tavern-plugin-hello/index.mjs'), '修改示例插件后同步复制到 Skill')
})

test('重复读取同一正文版本不再读写媒体记录', async () => {
  const store = memoryStore()
  let reads = 0, writes = 0
  const counted = { ...store, readJson: async path => { reads++; return store.readJson(path) }, updateJson: async (path, fn) => { writes++; return store.updateJson(path, fn) } }
  const media = createPluginMedia({ store: counted })
  await media.issue('c', 2, 'k')
  const after = { reads, writes }
  await media.issue('c', 2, 'k')
  await media.issue('c', 2, 'k')
  assert.deepEqual({ reads, writes }, after)
  assert.equal(after.writes, 1)
  await media.removeChat('c')
  await media.issue('c', 2, 'k')
  assert.equal(writes, 2, '删局后重新登记')
})
