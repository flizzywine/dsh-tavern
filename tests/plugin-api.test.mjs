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
      backgroundModel: async () => ({ provider: 'p', model: 'm', reasoningEffort: 'low', extra: 'x' }),
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

  tavern.candidateSection({ name: 'tone', text: ({ gameId }) => gameId + ' 的候选偏向探索' })
  tavern.compactionSection({ name: 'keep', text: '摘要里保留叙事锚点' })
  assert.deepEqual((await h.api.candidate.sections({ gameId: 'game-1' })).map(note => note.text), ['game-1 的候选偏向探索'])
  assert.deepEqual((await h.api.compactionNotes({ gameId: 'game-1' })).map(note => note.text), ['摘要里保留叙事锚点'])
  assert.deepEqual((await h.api.gamePlugins('game-1')).plugins[0].uses.map(use => use.stage + use.mode).sort(), ['上下文添加', '候选添加', '压缩添加', '结算添加'])

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

test('本局插件面板：列出用途，按局关闭后不再参与提示词、结算与通知，错误留给面板', { skip: !cordis }, async t => {
  const h = await harness(t, { data: createPluginData({ store: memoryStore() }) })
  const seen = []
  await h.root.plugin({ name: 'mem', inject: ['tavern'], apply(ctx) {
    ctx.tavern.onTurnSettled(turn => seen.push(turn.turn))
    ctx.tavern.turnSection({ name: 'state', text: '【状态】' })
    ctx.tavern.settlementTool({ name: 'mem_save', description: '保存', parameters: { type: 'object' }, execute: () => 'ok' })
  } })
  await h.root.plugin({ name: 'flaky', inject: ['tavern'], apply(ctx) { ctx.tavern.turnSection({ name: 'x', text: () => { throw new Error('坏了') } }) } })
  await tick()
  const panel = await h.api.gamePlugins('game-1')
  assert.deepEqual(panel.plugins.map(plugin => [plugin.name, plugin.enabled, plugin.uses.map(use => use.stage + use.mode).sort()]),
    [['flaky', true, ['上下文添加']], ['mem', true, ['上下文添加', '生命周期观察', '结算添加']]])
  assert.equal((await h.api.turnContext({ gameId: 'game-1', turn: 3, input: '' })).length, 1)
  assert.deepEqual((await h.api.gamePlugins('game-1')).errors.map(item => [item.plugin, item.stage, item.message]), [['flaky', '本轮上下文段落', '坏了']])

  await h.api.setGamePlugin('game-1', { name: 'mem', enabled: false })
  assert.deepEqual(await h.api.turnContext({ gameId: 'game-1', turn: 3, input: '' }), [])
  assert.match(JSON.parse(await h.api.settlement.calls({ gameId: 'game-1', turn: 3 })('mem_save', {})).error, /关闭了插件 mem，本轮不要调用/)
  assert.deepEqual(await h.api.settlement.toolNames({ gameId: 'game-1' }), { available: [], unavailable: ['mem_save'] })
  await h.api.turnSettled('game-1')
  await tick()
  assert.deepEqual(seen, [], 'a plugin switched off in this game is not notified')
  assert.equal((await h.api.gamePlugins('game-1')).plugins.find(plugin => plugin.name === 'mem').enabled, false)
  await h.api.setGamePlugin('game-1', { name: 'mem', enabled: true })
  assert.equal((await h.api.turnContext({ gameId: 'game-1', turn: 3, input: '' })).length, 1)
  assert.deepEqual(await h.api.settlement.toolNames({ gameId: 'game-1' }), { available: ['mem_save'], unavailable: [] }, 'switched back on, its tools are offered again')
})

test('结算替换：唯一插件自动生效，多个时须玩家选择，返回不合格或出错时退回 Tavern 自己的结算', { skip: !cordis }, async t => {
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
  assert.equal((await h.api.gamePlugins('game-1')).errors.length, 0)
  answer = { posture: '  她坐在窗边  ' }
  answer = {}
  assert.equal(await settle(), null, 'posture is required while posture settlement is on')
  assert.deepEqual(await settle({ posture: false }), { owner: 'anchor', posture: '' })
  answer = () => { throw new Error('模型超时') }
  assert.equal(await settle(), null)
  assert.match((await h.api.gamePlugins('game-1')).errors[0].message, /模型超时/)
  answer = { posture: '躺下' }

  await h.root.plugin({ name: 'rival', inject: ['tavern'], apply(ctx) { ctx.tavern.replaceSettlement({ settle: async () => ({ posture: '对手' }) }) } })
  await tick()
  assert.equal(await settle(), null, 'two candidates and no choice: neither applies')
  assert.equal((await h.api.gamePlugins('game-1')).replacements.settlement.conflict, true)
  await h.api.setGamePlugin('game-1', { replace: { stage: 'settlement', plugin: 'rival' } })
  assert.equal((await settle()).owner, 'rival')
  await h.api.setGamePlugin('game-1', { replace: { stage: 'settlement', plugin: '' } })
  assert.equal(await settle(), null, "'' chooses Tavern's own")
  await h.api.setGamePlugin('game-1', { replace: { stage: 'settlement', plugin: null } })
  await h.api.setGamePlugin('game-1', { name: 'rival', enabled: false })
  assert.equal((await settle()).owner, 'anchor', 'switching one off leaves a single candidate')
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
  assert.equal(await read('presets/tavern/skills/tavern-plugin/references/plugin-recipes.md'), await read('docs/plugin-recipes.md'), '修改 docs/plugin-recipes.md 后同步复制到 Skill')
  const copy = await read('presets/tavern/skills/tavern-plugin/references/example-plugin.md')
  for (const file of ['package.json', 'index.mjs', 'client.js']) {
    const block = new RegExp('## ' + file.replace('.', '\\.') + '\\n\\n```\\w+\\n([\\s\\S]*?)\\n```').exec(copy)?.[1]
    assert.equal(block + '\n', await read('examples/tavern-plugin-hello/' + file), '修改示例插件 ' + file + ' 后同步复制到 Skill')
  }
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

test('tavern 服务：onTurnSettled 与 getTurn 带上这一轮的只读变量', { skip: !cordis }, async t => {
  const h = await harness(t, { readVariables: async material => ({ stat_data: { turn: material.turn } }) })
  const seen = []
  let tavern
  await h.root.plugin({ name: 'world', inject: ['tavern'], apply(ctx) { tavern = ctx.tavern; ctx.tavern.onTurnSettled(turn => seen.push(turn)) } })
  await tick()
  await h.api.turnSettled('game-1')
  await tick()
  assert.deepEqual(seen[0].variables, { stat_data: { turn: 3 } })
  const read = await tavern.getTurn({ gameId: 'game-1', turn: 3 })
  read.variables.stat_data.turn = 9
  assert.deepEqual((await tavern.getTurn({ gameId: 'game-1', turn: 3 })).variables, { stat_data: { turn: 3 } })
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

test('示例插件的重画按钮：callHost 调到宿主侧，按当前正文再挂一张图', { skip: !cordis }, async t => {
  const h = await harness(t)
  await h.root.plugin({ name: 'fake-attachments', apply(ctx) {
    ctx.provide('attachments', { async saveImage(input) { return { attachmentId: 'png-x', mediaType: input.mediaType, bytes: input.data.length, width: 96, height: 64 } } })
  } })
  await h.root.plugin(await import('../examples/tavern-plugin-hello/index.mjs'))
  await tick()
  const { id } = await h.api.callHandler('tavern-plugin-hello/redraw', { gameId: 'game-1', turn: 3 })
  const item = (await h.media.list({ chatId: 'chat-1' })).find(entry => entry.id === id)
  assert.equal(item.status, 'ready')
  await assert.rejects(h.api.callHandler('tavern-plugin-hello/redraw', { gameId: 'game-1', turn: 9 }), /还没写完/)
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
  const panel = await h.api.gamePlugins('game-1')
  assert.deepEqual(panel.plugins[0].uses, [{ stage: '世界书', mode: '添加' }])
  assert.match(panel.errors[0].message, /重复.*bad id.*EJS/)
  await h.api.worldbookPoolEntries({ gameId: 'game-1', turn: 4 })
  assert.equal((await h.api.gamePlugins('game-1')).errors.length, 1, '同一问题每轮多次读取只记一次')
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
  assert.match((await h.api.gamePlugins('game-1')).errors[0].message, /写不进去/)
  await assert.rejects(tavern.runTask({ gameId: 'game-1', prompt: 'x', tools: [{ ...tools[0], name: 'posture_submit' }] }), /已被占用/)
  await assert.rejects(tavern.runTask({ gameId: 'game-1', prompt: ' ' }), /prompt/)
})

test('结算任务：按阶段、按玩家顺序依次运行，每个正文版本一次；可单独关掉，出错只记错误', { skip: !cordis }, async t => {
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
  assert.match((await h.api.gamePlugins('game-1')).errors[0].message, /坏了/)
  await after()
  assert.equal(ran.length, 3, 'once per text version')

  const panel = await h.api.gamePlugins('game-1')
  assert.deepEqual(panel.tasks.settlement.map(task => [task.key, task.phase, task.enabled]), [['alpha:prepare', 'before', true], ['alpha:notes', 'after', true], ['beta:broken', 'after', true]])
  await h.api.setGamePlugin('game-1', { taskOrder: ['beta:broken', 'alpha:notes'] })
  await h.api.setGamePlugin('game-1', { task: { key: 'alpha:prepare', enabled: false } })
  h.setLatest(turnMaterial({ key: 'key-3b' }))
  ran.length = 0
  await h.api.runSettlementTasks({ gameId: 'game-1', phase: 'after' })
  assert.deepEqual(ran, ['beta.broken', 'alpha.notes:after:key-3b'])
  assert.equal((await h.api.gamePlugins('game-1')).tasks.settlement.find(task => task.key === 'alpha:prepare').enabled, false)

  // Stopping aborts the running task and skips the rest, without recording an error.
  const stop = new AbortController()
  await h.root.plugin({ name: 'gamma', inject: ['tavern'], apply(ctx) {
    ctx.tavern.settlementTask({ name: 'slow', run: ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))) })
  } })
  await tick()
  await h.api.setGamePlugin('game-1', { taskOrder: ['gamma:slow', 'beta:broken', 'alpha:notes'] })
  h.setLatest(turnMaterial({ key: 'key-3c' }))
  ran.length = 0
  const errors = (await h.api.gamePlugins('game-1')).errors.length
  const pending = h.api.runSettlementTasks({ gameId: 'game-1', phase: 'after', signal: stop.signal })
  await tick()
  assert.equal(h.api.runningTask('game-1').plugin, 'gamma')
  stop.abort()
  await pending
  assert.deepEqual(ran, [])
  assert.equal((await h.api.gamePlugins('game-1')).errors.length, errors)
  assert.equal(h.api.runningTask('game-1'), null)
})

test('手动任务：玩家或插件启动，带输入，可停止；插件关闭或任务不存在时拒绝', { skip: !cordis }, async t => {
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
  assert.equal((await h.api.gamePlugins('game-1')).errors.length, 0)

  await assert.rejects(h.api.manualTaskFor('game-1', 'alpha:nothing'), /没有这个插件任务/)
  await h.api.setGamePlugin('game-1', { name: 'alpha', enabled: false })
  await assert.rejects(h.api.manualTaskFor('game-1', 'alpha:summary'), /关闭了插件/)
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
  let disabled = []
  const h = await harness(t, {
    readCharacterDesigns: async sessionId => sessionId === 'game-1' ? archive : null,
    saveCharacterDesign: async (sessionId, input) => { saved.push([sessionId, input]); return input.identity ? { ok: true, name: input.name } : { ok: false, error: '人物设计缺少 identity' } },
    data: { readSettings: async () => ({ disabled }), updateSettings: async () => {} }
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
  disabled = ['image-plugin']
  await assert.rejects(tavern.saveCharacterDesign({ gameId: 'game-1', ...person }), /关闭了插件/)
})

test('台词标注与角色素材：插件读取某轮当前版本的标注和卡的人物素材，标注完成时收到通知；本局关闭的插件不通知', { skip: !cordis }, async t => {
  const lines = [{ n: 1, quote: '你好。', speaker: '林曦', emotion: 'joy' }]
  let disabled = []
  const h = await harness(t, {
    readCast: async (sessionId, turn) => turn === 3 ? { turn, textVersion: 'key-3', lines } : null,
    readCastAssets: async () => ({ player: '你', card: { name: 'A', imageUrl: '/card' }, characters: [{ name: '林曦', aliases: [], avatarUrl: '/a', sprites: { joy: '/j' } }] }),
    data: { readSettings: async () => ({ disabled }), updateSettings: async () => {} }
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
  assert.deepEqual((await h.api.gamePlugins('game-1')).plugins[0].uses, [{ stage: '演出', mode: '观察' }])
  disabled = ['director']
  h.api.castAnnotated('game-1', { turn: 3, textVersion: 'key-3', lines })
  await tick()
  assert.equal(seen.length, 1)
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
