import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function harness(extra = {}) {
  const cards = new Map([
    ['cards/命运.json', {
      name: '命运',
      character_book: {
        name: '命运世界书',
        entries: [{ id: 0, comment: '钟楼', content: '钟楼只在午夜开放。', enabled: true, keys: ['钟楼'] }]
      }
    }],
    ['cards/空白.json', { name: '空白' }]
  ])
  const files = new Map([
    ['worldbooks/王都.json', JSON.stringify({
      name: '王都',
      entries: { 7: { uid: 7, comment: '城门', content: '城门日落关闭。', disable: false, key: ['城门'] } }
    })]
  ])
  const bindings = new Map()
  const globals = new Set()
  const removed = []
  function normalize(path, kind) {
    const value = String(path || '')
    if (!value.startsWith(kind === 'card' ? 'cards/' : 'worldbooks/')) throw new Error('路径类型错误: ' + value)
    return value
  }
  const library = createWorldBookLibrary({
    ...extra,
    normalizePath: normalize,
    resources: {
      async globalSources() { return [...globals].map(path => ({ kind: 'standalone', path })) },
      async setGlobal(path, enabled) { if (enabled) globals.add(path); else globals.delete(path) },
      async list() { return Array.from(files.keys()) },
      async readText(path) { return files.get(path) },
      async metadata() { return { importedAt: 100, updatedAt: 200 } },
      async import(prepared, working) {
        const path = 'worldbooks/' + prepared.name
        files.set(path, JSON.stringify(working))
        return path
      },
      async write(path, text) { files.set(path, text) },
      async bindingForCard(cardPath) {
        if (!bindings.has(cardPath)) return { kind: 'default' }
        const value = bindings.get(cardPath)
        if (value === null) return { kind: 'none' }
        if (Array.isArray(value)) return { kind: 'multiple', sources: value.map(source => ({ ...source, available: source.kind === 'embedded' ? cards.has(source.cardPath) : files.has(source.path) })) }
        if (value && value.kind === 'embedded') return { kind: 'embedded', cardPath: value.cardPath, available: cards.has(value.cardPath) }
        const path = value && value.kind === 'standalone' ? value.path : value
        return { kind: 'standalone', path, available: files.has(path) }
      },
      async bind(cardPath, locator) {
        if (locator === null) bindings.delete(cardPath)
        else bindings.set(cardPath, locator)
      },
      async bindMany(cardPath, sources) { bindings.set(cardPath, clone(sources)) },
      async unbind(cardPath) { bindings.set(cardPath, null) }
    },
    cards: {
      async listPaths() { return Array.from(cards.keys()) },
      async read(path) { return cards.has(path) ? clone(cards.get(path)) : undefined },
      async metadata() { return { importedAt: 300, updatedAt: 400 } },
      async update(path, patch) { cards.set(path, Object.assign({}, cards.get(path), clone(patch))) }
    },
    async removeStandalone(path) { files.delete(path); removed.push(path); return { removed: path } }
  })
  return { library, cards, files, bindings, removed }
}

test('单本世界书或人物卡损坏时目录保留正常项目并返回诊断', async () => {
  const library = createWorldBookLibrary({
    normalizePath(path) { return path },
    resources: {
      async list() { return ['worldbooks/正常.json', 'worldbooks/损坏.json'] },
      async readText(path) { return path.endsWith('正常.json') ? JSON.stringify({ name: '正常', entries: {} }) : 'not-json' },
      async bindingForCard() { return { kind: 'none' } }
    },
    cards: {
      async listPaths() { return ['cards/正常.json', 'cards/损坏.json'] },
      async read(path) {
        if (path.endsWith('损坏.json')) throw new Error('人物卡 JSON 损坏')
        return { name: '正常人物', character_book: { name: '正常内置书', entries: [] } }
      }
    },
    async removeStandalone() {}
  })

  const catalog = await library.catalog()

  assert.deepEqual(catalog.standalone.map(function (book) { return book.name }), ['正常'])
  assert.deepEqual(catalog.embedded.map(function (book) { return book.name }), ['正常内置书'])
  assert.deepEqual(catalog.diagnostics.map(function (item) { return item.path }), ['worldbooks/损坏.json', 'cards/损坏.json'])
})

test('World Book Library 通过来源 adapter 原子编辑、导入、导出和删除', async () => {
  const run = harness()

  await run.library.update({ kind: 'card', cardPath: 'cards/命运.json' }, {
    operations: { op: 'update', ref: 'entry:0', patch: { content: '钟楼永不开放。' } }
  })
  assert.equal(run.cards.get('cards/命运.json').character_book.entries[0].content, '钟楼永不开放。')

  await run.library.update({ kind: 'standalone', path: 'worldbooks/王都.json' }, {
    operations: { op: 'update', ref: 'entry:7', patch: { content: '城门永不关闭。' } }
  })
  assert.equal(JSON.parse(run.files.get('worldbooks/王都.json')).entries['7'].content, '城门永不关闭。')

  const imported = await run.library.import({
    name: '海港.json',
    text: JSON.stringify({ name: '海港', entries: { 1: { uid: 1, comment: '码头', content: '潮汐决定船期。' } } })
  })
  assert.equal(imported.path, 'worldbooks/海港.json')
  assert.equal((await run.library.export({ kind: 'standalone', path: imported.path })).name, '海港')
  assert.deepEqual(await run.library.remove(imported.path), { removed: 'worldbooks/海港.json' })
  assert.deepEqual(run.removed, ['worldbooks/海港.json'])
})

test('删除内置世界书清理所有引用并保留其他世界书和人物卡内容', async () => {
  const run = harness()
  const source = { kind: 'card', cardPath: 'cards/命运.json' }
  const before = clone(run.cards.get(source.cardPath))
  await run.library.bind('cards/空白.json', source)
  await run.library.bind('cards/空白.json', { kind: 'standalone', path: 'worldbooks/王都.json' })
  await run.library.remove(source)
  assert.deepEqual(run.cards.get(source.cardPath), { ...before, character_book: null })
  assert.deepEqual((await run.library.catalog()).embedded, [])
  assert.equal((await run.library.binding(source.cardPath)).kind, 'none')
  assert.equal((await run.library.bound('cards/空白.json')).view.displayName, '王都')
  assert.equal(run.files.has('worldbooks/王都.json'), true)
  assert.deepEqual(run.removed, [])
})

// Character design must be visible through the same library used by the editor.
import { applyCharacterDesignWorldbook, createCharacterDesignPublisher } from '../tavern-plugin/lib/domain/character-design-worldbook.js'
import { worldbookContentDigest } from '../tavern-plugin/lib/domain/worldbook-version.js'
import { cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'
const designedCharacter = { name: '季闻笙', aliases: ['听潮人'], design: { identity: '成年修船师', personality: '爽朗', appearance: '灰色工装', speechStyle: '简短', narrativeRole: '可能修好渡船' } }
async function publishFixture(run, cardPath) {
  const card = clone(run.cards.get(cardPath)), record = await run.library.bound(cardPath, card)
  const chat = { cardPath, cardDefinitionSnapshot: card, cardContentDigest: cardContentDigest(card), worldbookLibraryDigest: worldbookContentDigest(record), characterDesignTask: {}, openingWorldbookSnapshot: { version: 1, source: record?.source ?? null, libraryDigest: worldbookContentDigest(record), document: clone(record?.document ?? null) } }
  applyCharacterDesignWorldbook(chat, designedCharacter)
  return { chat, publish: createCharacterDesignPublisher({ worldBooks: run.library, readCard: async path => clone(run.cards.get(path)) }) }
}
for (const kind of ['embedded', 'standalone', 'none', 'multiple', 'global-only']) test('人物设计写入库并自动同步：' + kind, async () => {
  const run = harness(), path = ['none', 'global-only'].includes(kind) ? 'cards/空白.json' : 'cards/命运.json'
  if (kind === 'global-only') await run.library.setGlobal({ kind: 'standalone', path: 'worldbooks/王都.json' }, true)
  if (kind === 'standalone') await run.library.setBindings(path, [{ kind: 'standalone', path: 'worldbooks/王都.json' }])
  if (kind === 'multiple') await run.library.setBindings(path, [{ kind: 'standalone', path: 'worldbooks/王都.json' }, { kind: 'card', cardPath: path }])
  const { chat, publish } = await publishFixture(run, path)
  const original = clone(chat.openingWorldbookSnapshot.document)
  await publish(chat, [designedCharacter])
  const source = (await run.library.binding(path)).source
  const entry = (await run.library.get(source)).view.entries.find(e => e.primaryKeys.includes('季闻笙'))
  assert.ok(entry, '世界书编辑器能读取新增人物')
  assert.equal(entry.constant, false)
  assert.deepEqual(chat.openingWorldbookSnapshot.document, original, '不整本替换本局世界书')
  assert.equal(chat.worldbookLibraryDigest, worldbookContentDigest(await run.library.bound(path)))
  assert.equal(chat.cardContentDigest, cardContentDigest(run.cards.get(path)))
  await publish(chat, [designedCharacter])
  assert.equal((await run.library.get(source)).view.entries.filter(e => e.primaryKeys.includes('季闻笙')).length, 1)
})

test('全局世界书覆盖无绑定的新卡、与本地合并并按来源去重，不修改或导出到卡', async () => {
  const { library, cards } = harness()
  const source = { kind: 'standalone', path: 'worldbooks/王都.json' }
  const before = clone([...cards])
  await library.setGlobal(source, true)
  assert.equal((await library.get(source)).globalEnabled, true)
  assert.equal((await library.catalog()).standalone[0].globalEnabled, true)
  assert.equal((await library.bound('cards/空白.json')).view.entryCount, 1)
  const { createOpeningPreparation } = await import('../tavern-plugin/lib/domain/opening-preparation.js')
  const preparation = createOpeningPreparation({ readCard: async path => cards.get(path), worldBooks: library })
  const opening = await preparation.create('cards/空白.json')
  assert.equal(opening.worldbook.entries.length, 1)
  assert.match(JSON.stringify(opening.worldbook), /城门日落关闭/)
  assert.equal((await library.bound('cards/命运.json')).view.entryCount, 2)
  assert.equal((await library.characterBookForCard('cards/命运.json')).entries.length, 1)
  assert.deepEqual([...cards], before)
  await library.bind('cards/命运.json', source)
  assert.equal((await library.bound('cards/命运.json')).view.entryCount, 2)
  await library.setGlobal(source, false)
  assert.equal(await library.bound('cards/空白.json'), null)
  assert.equal((await library.bound('cards/命运.json')).view.entryCount, 2)
  await assert.rejects(library.setGlobal({ kind: 'card', cardPath: 'cards/命运.json' }, true), /独立世界书/)
  await assert.rejects(library.setGlobal(source, 'true'), /布尔值/)
})

for (const source of [{ kind: 'standalone', path: 'worldbooks/王都.json' }, { kind: 'card', cardPath: 'cards/命运.json' }]) {
  test('同一世界书并发新增保留双方条目，失败后仍可更新：' + source.kind, async () => {
    const { library } = harness()
    await Promise.all(['甲', '乙'].map(name => library.update(source, { operations: [{ op: 'add', entry: { comment: name, content: name, primaryKeys: [name] } }] })))
    const entries = (await library.get(source)).view.entries
    assert.ok(entries.some(entry => entry.content === '甲'))
    assert.ok(entries.some(entry => entry.content === '乙'))
    await assert.rejects(library.update(source, { operations: [{ op: 'delete', ref: 'entry:9999' }] }))
    await library.update(source, { operations: [{ op: 'add', entry: { content: '丙' } }] })
    assert.ok((await library.get(source)).view.entries.some(entry => entry.content === '丙'))
  })
}
