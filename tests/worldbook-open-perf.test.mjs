// 世界书打开链路：摘要投影、lean 开关、目录与绑定扫描的 I/O 次数、会话头条件读取。
import test from 'node:test'
import assert from 'node:assert/strict'

import { inspectWorldBookDocument, worldBookViewForWire } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { createResourceHandlers } from '../tavern-plugin/lib/rpc/resources.js'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'
import { createChatReads } from '../tavern-plugin/lib/domain/chat-reads.js'

const longBody = '正文'.repeat(4000)

const book = {
  name: '体量验收',
  description: '大书',
  entries: [
    { uid: 1, keys: ['甲'], secondary_keys: ['甲二'], comment: '第一条', content: longBody, enabled: true, insertion_order: 1, constant: true, selective: true, position: 0, extensions: { dsh_tavern_helper_extra: { keep: 'server only' } } },
    { uid: 2, keys: ['乙'], secondary_keys: [], comment: '第二条', content: '正文二', enabled: false, insertion_order: 2, extensions: {} }
  ]
}

function clone(value) { return JSON.parse(JSON.stringify(value)) }

test('摘要投影省掉 raw/rawEntry，wire 摘要只留元数据与正文长度', () => {
  const summary = inspectWorldBookDocument(book, { summaryOnly: true })
  assert.equal(summary.raw, undefined, '摘要视图不复制整本源文档')
  assert.equal(summary.entries[0].rawEntry, undefined, '摘要视图不复制源条目')
  assert.equal(summary.entryCount, 2)
  assert.equal(summary.enabledCount, 1)
  assert.equal(summary.entries[0].content, longBody, '领域层仍持有正文，只是不再复制一份')

  const wire = worldBookViewForWire(summary, { summaryOnly: true })
  assert.equal(wire.raw, undefined)
  assert.equal(typeof wire.entries[0].content, 'string', 'content 保持字符串，旧前端调 includes 不抛')
  assert.equal(wire.entries[0].content, '')
  assert.equal(wire.entries[0].contentOmitted, true)
  assert.equal(wire.entries[0].contentLength, longBody.length)
  assert.equal(wire.entries[0].ref, 'entry:0')
  assert.equal(wire.entries[0].title, '第一条')
  assert.equal(wire.entries[0].enabled, true)
  assert.equal(wire.entries[0].constant, true)
  assert.equal(wire.entries[0].selective, true)
  assert.deepEqual(wire.entries[0].primaryKeys, ['甲'])
  assert.deepEqual(wire.entries[0].secondaryKeys, ['甲二'])
  assert.equal(wire.entries[1].contentLength, 3)
  assert.equal(summary.entries[0].content, longBody, 'wire 投影不改动领域视图')

  // 全量投影仍然剥离 raw/rawEntry，且同一份视图只投影一次。
  const full = inspectWorldBookDocument(book)
  const first = worldBookViewForWire(full)
  assert.equal(first.raw, undefined)
  assert.equal(first.entries[0].rawEntry, undefined)
  assert.equal(first.entries[0].content.length, longBody.length)
  assert.equal(worldBookViewForWire(full), first, '同一视图复用同一份 wire 结果')
  assert.equal(worldBookViewForWire(summary, { summaryOnly: true }), wire, '摘要 wire 同样复用')
})

test('getWorldBook 的 summaryOnly 走摘要视图，带 revision 命中时仍先返回 unchanged', async () => {
  const source = { kind: 'standalone', path: 'worldbooks/大书.json' }
  const view = inspectWorldBookDocument(book)
  const handlers = createResourceHandlers({
    worldBooks: {
      revision: async () => 9,
      get: async () => ({ source, view, globalEnabled: false, revision: 9 })
    }
  })
  const summary = await handlers.getWorldBook({ source, summaryOnly: true })
  assert.equal(summary.summaryOnly, true)
  assert.equal(summary.view.raw, undefined)
  assert.equal(summary.view.entries[0].content, '')
  assert.equal(summary.view.entries[0].contentLength, longBody.length)
  assert.equal(summary.view.entryCount, 2)
  assert.deepEqual(await handlers.getWorldBook({ source, ifRevision: 9, summaryOnly: true }), { unchanged: true, source, revision: 9 })
  const full = await handlers.getWorldBook({ source })
  assert.equal(full.summaryOnly, undefined)
  assert.equal(full.view.entries[0].content.length, longBody.length, '不传 summaryOnly 时正文照常回传')
  assert.ok(view.entries[0].rawEntry, '服务端视图仍带着 rawEntry')
})

function libraryHarness(extra = {}) {
  const cards = new Map([
    ['cards/有书.json', { name: '有书', character_book: { name: '有书世界书', entries: [{ id: 0, comment: '钟楼', content: '钟楼只在午夜开放。', keys: ['钟楼'] }] } }],
    ['cards/无书一.json', { name: '无书一' }],
    ['cards/无书二.json', { name: '无书二' }]
  ])
  const files = new Map([['worldbooks/王都.json', JSON.stringify({ name: '王都', entries: { 7: { uid: 7, comment: '城门', content: '城门日落关闭。', disable: false, key: ['城门'] } } })]])
  const counts = { readText: 0, cardReads: new Map(), cardMetadata: 0, standaloneMetadata: 0, setGlobal: 0 }
  const globals = new Set()
  const library = createWorldBookLibrary({
    ...extra,
    normalizePath: path => String(path),
    resources: {
      async globalSources() { return [...globals].map(path => ({ kind: 'standalone', path })) },
      async setGlobal(path, enabled) { counts.setGlobal += 1; if (enabled) globals.add(path); else globals.delete(path) },
      async list() { return Array.from(files.keys()) },
      async readText(path) { counts.readText += 1; return files.get(path) },
      async metadata() { counts.standaloneMetadata += 1; return { importedAt: 100, updatedAt: 200 } },
      async bindingForCard() { return { kind: 'default' } }
    },
    cards: {
      async listPaths() { return Array.from(cards.keys()) },
      async read(path) {
        counts.cardReads.set(path, (counts.cardReads.get(path) || 0) + 1)
        return cards.has(path) ? clone(cards.get(path)) : undefined
      },
      async metadata() { counts.cardMetadata += 1; return { importedAt: 300, updatedAt: 400 } }
    },
    async removeStandalone() {}
  })
  return { library, cards, files, counts, globals }
}

test('setGlobal 的 lean 返回复用已解析记录，不再读盘也不再序列化整本视图', async () => {
  const run = libraryHarness()
  const source = { kind: 'standalone', path: 'worldbooks/王都.json' }
  const opened = await run.library.get(source)
  assert.equal(opened.view.entryCount, 1)
  assert.equal(run.counts.readText, 1)

  const lean = await run.library.setGlobal(source, true, { lean: true })
  assert.deepEqual(lean, { source, revision: 200, globalEnabled: true })
  assert.equal(run.counts.readText, 1, '开启全局生效复用版本缓存，不重读磁盘')
  assert.equal(lean.view, undefined, 'lean 不返回整本视图')

  const handlers = createResourceHandlers({ worldBooks: { setGlobal: async (locator, enabled, options) => {
    const result = await run.library.setGlobal(locator, enabled, options)
    return result
  } } })
  const rpcLean = await handlers.setGlobalWorldBook({ source, enabled: false, lean: true })
  assert.deepEqual(rpcLean, { source, revision: 200, globalEnabled: false, lean: true })
  assert.equal(run.counts.readText, 1)

  // 不开 lean 的旧调用保持原样：回整本视图与 globalEnabled。
  await run.library.setGlobal(source, true)
  const full = await handlers.setGlobalWorldBook({ source, enabled: true })
  assert.equal(full.view.entryCount, 1)
  assert.equal(full.globalEnabled, true)
  assert.equal(full.lean, undefined)
})

test('目录对没有内置世界书的人物卡不探卡片元数据，并发目录请求合并为一次', async () => {
  const run = libraryHarness()
  const [first, second] = await Promise.all([run.library.catalog(), run.library.catalog()])
  assert.deepEqual(first, second)
  assert.equal(run.counts.cardMetadata, 1, '只有真有内置书的那张卡才读元数据')
  assert.deepEqual(first.embedded.map(row => row.cardName), ['有书'])
  assert.equal(first.embedded[0].name, '有书世界书')
  assert.equal(first.standalone[0].name, '王都')
  assert.equal(run.counts.standaloneMetadata, 1)
})

test('关联扫描每张卡只读一次，并把已读到的卡交给绑定解析', async () => {
  const run = libraryHarness()
  const source = { kind: 'card', cardPath: 'cards/有书.json' }
  const result = await run.library.associations(source)
  assert.equal(result.cards.length, 3)
  for (const [path, count] of run.counts.cardReads) assert.equal(count, 1, '卡片只读一次: ' + path)
  assert.deepEqual(result.boundCards, [{ path: 'cards/有书.json', name: '有书' }])
  const row = result.cards.find(card => card.path === 'cards/有书.json')
  assert.equal(row.binding.kind, 'embedded')
  assert.equal(row.binding.name, '有书世界书')
  const plain = result.cards.find(card => card.path === 'cards/无书一.json')
  assert.equal(plain.binding.kind, 'none')
  assert.equal(plain.bound, false)
})

test('指定头部字段的会话头读取不回退全量读档', async () => {
  let wholeReads = 0
  const links = async () => ({ 'session-1': 'chat-1', 'session-2': 'chat-2' })
  const persistence = {
    async readSlice(chatId, indices, fields) {
      // 老存档：没有任何配置版本标记。
      return { chat: { id: chatId, sessionId: chatId === 'chat-1' ? 'session-1' : 'session-2', mode: 'story', cardPath: 'cards/有书.json', cardName: '有书' } }
    }
  }
  const reads = createChatReads({ links, persistence, whole: async () => { wholeReads += 1; return { id: 'chat-1', sessionId: 'session-1', cardPath: 'cards/整本.json' } } })
  const header = await reads.header('session-1', ['cardPath', 'cardName'])
  assert.deepEqual(header, { id: 'chat-1', sessionId: 'session-1', mode: 'story', cardPath: 'cards/有书.json', cardName: '有书' })
  assert.equal(wholeReads, 0, '显式头部字段足够，不整本读档')
  // 没点名字段时仍按原逻辑补配置。
  await reads.header('session-2', [])
  assert.equal(wholeReads, 1)
  // 存档已经带标记时本来就是条件读取。
  const upgraded = createChatReads({ links, persistence: { async readSlice() { return { chat: { id: 'chat-1', sessionId: 'session-1', mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1 } } } }, whole: async () => { wholeReads += 1 } })
  assert.equal((await upgraded.header('session-1', ['cardPath'])).id, 'chat-1')
  assert.equal(wholeReads, 1)
})
