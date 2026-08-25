import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'

function clone(value) { return JSON.parse(JSON.stringify(value)) }

function harness() {
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
  const removed = []
  function normalize(path, kind) {
    const value = String(path || '')
    if (!value.startsWith(kind === 'card' ? 'cards/' : 'worldbooks/')) throw new Error('路径类型错误: ' + value)
    return value
  }
  const library = createWorldBookLibrary({
    normalizePath: normalize,
    resources: {
      async list() { return Array.from(files.keys()) },
      async readText(path) { return files.get(path) },
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
        if (value && value.kind === 'embedded') return { kind: 'embedded', cardPath: value.cardPath, available: cards.has(value.cardPath) }
        const path = value && value.kind === 'standalone' ? value.path : value
        return { kind: 'standalone', path, available: files.has(path) }
      },
      async bind(cardPath, locator) {
        if (locator === null) bindings.delete(cardPath)
        else bindings.set(cardPath, locator)
      },
      async unbind(cardPath) { bindings.set(cardPath, null) }
    },
    cards: {
      async listPaths() { return Array.from(cards.keys()) },
      async read(path) { return cards.has(path) ? clone(cards.get(path)) : undefined },
      async update(path, patch) { cards.set(path, Object.assign({}, cards.get(path), clone(patch))) }
    },
    async removeStandalone(path) { files.delete(path); removed.push(path); return { removed: path } }
  })
  return { library, cards, files, bindings, removed }
}

test('World Book Library 用同一 interface 投影独立与人物卡内嵌世界书', async () => {
  const run = harness()
  const catalog = await run.library.catalog()

  assert.deepEqual(catalog.standalone.map(function (book) { return book.name }), ['王都'])
  assert.deepEqual(catalog.embedded.map(function (book) { return book.name }), ['命运世界书'])
  assert.equal((await run.library.get({ kind: 'standalone', path: 'worldbooks/王都.json' })).view.entries[0].ref, 'entry:7')
  assert.equal((await run.library.get({ kind: 'card', cardPath: 'cards/命运.json' })).view.entries[0].ref, 'entry:0')
})

test('World Book Library 隐藏默认内嵌、解绑和独立绑定的存储差异', async () => {
  const run = harness()

  assert.equal((await run.library.binding('cards/命运.json')).kind, 'embedded')
  assert.equal((await run.library.bound('cards/命运.json')).view.displayName, '命运世界书')
  assert.equal((await run.library.unbind('cards/命运.json')).kind, 'none')
  assert.equal(await run.library.bound('cards/命运.json'), null)
  const rebound = await run.library.bind('cards/命运.json', { kind: 'standalone', path: 'worldbooks/王都.json' })
  assert.equal(rebound.kind, 'standalone')
  assert.equal((await run.library.bound('cards/命运.json')).view.displayName, '王都')
})

test('World Book Library 提供世界书视角的一对一人物卡绑定关系', async () => {
  const run = harness()
  const source = { kind: 'standalone', path: 'worldbooks/王都.json' }

  const initial = await run.library.associations(source)
  assert.equal(initial.conflict, false)
  assert.deepEqual(initial.boundCards, [])
  assert.deepEqual(initial.cards.map(function (card) { return [card.name, card.binding.kind] }), [
    ['命运', 'embedded'],
    ['空白', 'none']
  ])

  await run.library.bind('cards/命运.json', source)
  const bound = await run.library.associations(source)
  assert.deepEqual(bound.boundCards.map(function (card) { return card.name }), ['命运'])
  assert.equal(bound.cards.find(function (card) { return card.name === '命运' }).bound, true)

  await assert.rejects(
    run.library.bind('cards/空白.json', source),
    /该世界书已绑定人物卡：命运/
  )
})

test('人物卡内置世界书解绑原主人后可一对一绑定给其他人物卡', async () => {
  const run = harness()
  const source = { kind: 'card', cardPath: 'cards/命运.json' }

  await run.library.unbind('cards/命运.json')
  const available = await run.library.associations(source)
  assert.deepEqual(available.cards.map(function (card) { return card.name }), ['命运', '空白'])
  assert.deepEqual(available.boundCards, [])

  const binding = await run.library.bind('cards/空白.json', source)
  assert.equal(binding.kind, 'embedded')
  assert.equal(binding.source.cardPath, 'cards/命运.json')
  assert.equal((await run.library.bound('cards/空白.json')).view.displayName, '命运世界书')
  await assert.rejects(run.library.bind('cards/命运.json', source), /该世界书已绑定人物卡：空白/)
})

test('历史数据中同一本世界书绑定多张人物卡时只报告冲突，不自动拆除', async () => {
  const run = harness()
  run.bindings.set('cards/命运.json', 'worldbooks/王都.json')
  run.bindings.set('cards/空白.json', 'worldbooks/王都.json')

  const result = await run.library.associations({ kind: 'standalone', path: 'worldbooks/王都.json' })

  assert.equal(result.conflict, true)
  assert.deepEqual(result.boundCards.map(function (card) { return card.name }), ['命运', '空白'])
  assert.equal(run.bindings.size, 2)
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
