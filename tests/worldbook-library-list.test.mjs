import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

// 世界书库的列表：全局 → 本卡 → 关闭（其他），每本书一行、带本卡视角下的状态。
const source = await readFile(new URL('../tavern-plugin/src/client/features/worldbook-library.js', import.meta.url), 'utf8')
const helpers = source.slice(source.indexOf('function normalizeWorldBookSort('), source.indexOf('const WORLD_BOOK_RECALL_STEPS'))
const raw = vm.runInNewContext(helpers + ';({ worldBookLibraryRows, orderWorldBookLibraryRows, worldBookRowMatches })')
// the VM's arrays are another realm's: compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value))
const lib = {
  worldBookLibraryRows: catalog => plain(raw.worldBookLibraryRows(catalog)),
  orderWorldBookLibraryRows: (rows, mode, rank) => plain(raw.orderWorldBookLibraryRows(rows, mode, rank)),
  worldBookRowMatches: raw.worldBookRowMatches
}

const catalog = {
  standalone: [
    { kind: 'standalone', path: 'worldbooks/old.json', name: '旧书', entryCount: 3, enabledCount: 3, importedAt: 1 },
    { kind: 'standalone', path: 'worldbooks/global.json', name: '全局书', globalEnabled: true, entryCount: 10, enabledCount: 10, importedAt: 2 },
    { kind: 'standalone', path: 'worldbooks/bound.json', name: '绑定书', entryCount: 5, enabledCount: 2, importedAt: 3 },
    { kind: 'standalone', path: 'worldbooks/new.json', name: '新书', entryCount: 1, enabledCount: 1, importedAt: 4 }
  ],
  embedded: [
    { kind: 'card', cardPath: 'cards/other.json', cardName: '别的卡', name: '别的卡的书', entryCount: 2, enabledCount: 2, importedAt: 9 },
    { kind: 'card', cardPath: 'cards/mine.json', cardName: '本卡', name: '本卡的书', entryCount: 4, enabledCount: 4, importedAt: 5 }
  ]
}
const names = rows => rows.map(row => row.name)

test('没有本局人物卡：全局在前，其余按导入时间，独立书在人物卡内置书之前；内置书没有可切的状态', () => {
  const rows = lib.worldBookLibraryRows(catalog)
  assert.deepEqual(names(lib.orderWorldBookLibraryRows(rows, 'newest')), ['全局书', '新书', '绑定书', '旧书', '别的卡的书', '本卡的书'])
  assert.deepEqual(names(lib.orderWorldBookLibraryRows(rows, 'oldest')), ['全局书', '旧书', '绑定书', '新书', '本卡的书', '别的卡的书'])
  assert.deepEqual(rows.find(row => row.name === '新书').options, ['global', 'off'])
  assert.deepEqual(rows.find(row => row.name === '本卡的书').options, [])
})

test('本卡按绑定顺序排在全局之后，第一本是主书；没绑定的本卡自带书落到关闭', () => {
  const sessionBinding = { kind: 'multiple', books: [
    { kind: 'standalone', source: { kind: 'standalone', path: 'worldbooks/bound.json' }, name: '绑定书', available: true },
    { kind: 'embedded', source: { kind: 'card', cardPath: 'cards/other.json' }, name: '别的卡的书', available: true }
  ] }
  const rows = lib.worldBookLibraryRows({ ...catalog, sessionCardPath: 'cards/mine.json', sessionCardName: '本卡', sessionBinding })
  const ordered = lib.orderWorldBookLibraryRows(rows, 'newest')
  assert.deepEqual(names(ordered), ['全局书', '绑定书', '别的卡的书', '新书', '旧书', '本卡的书'])
  assert.deepEqual(ordered.map(row => row.state), ['global', 'card', 'card', 'off', 'off', 'off'])
  assert.equal(ordered[1].primary, true)
  assert.equal(ordered[2].primary, false)
  assert.equal(ordered.at(-1).own, true)
  assert.deepEqual(ordered[0].options, ['global', 'card', 'off'])
  assert.deepEqual(ordered.at(-1).options, ['card', 'off'])
})

test('全局书同时绑在本卡上时留在全局里并标主书；找不到的绑定书仍列出、可以关掉', () => {
  const sessionBinding = { kind: 'multiple', books: [
    { kind: 'standalone', source: { kind: 'standalone', path: 'worldbooks/global.json' }, name: '全局书', available: true },
    { kind: 'standalone', source: { kind: 'standalone', path: 'worldbooks/gone.json' }, name: '', available: false }
  ] }
  const rows = lib.worldBookLibraryRows({ ...catalog, sessionCardPath: 'cards/mine.json', sessionBinding })
  const ordered = lib.orderWorldBookLibraryRows(rows, 'newest')
  assert.equal(ordered[0].name, '全局书')
  assert.equal(ordered[0].state, 'global')
  assert.equal(ordered[0].primary, true)
  assert.equal(ordered[1].available, false)
  assert.equal(ordered[1].state, 'card')
  assert.deepEqual(ordered[1].options, ['card', 'off'])
})

test('人物卡只带自己的书、没有另外绑定时，那本书就是本卡的主书', () => {
  const sessionBinding = { kind: 'embedded', source: { kind: 'card', cardPath: 'cards/mine.json', cardName: '本卡' }, name: '本卡的书', available: true }
  const rows = lib.worldBookLibraryRows({ ...catalog, sessionCardPath: 'cards/mine.json', sessionBinding })
  const mine = rows.find(row => row.name === '本卡的书')
  assert.equal(mine.state, 'card')
  assert.equal(mine.primary, true)
  assert.equal(mine.own, true)
})

test('状态改了以后行留在读取时的位置，直到列表重新读取', () => {
  const rows = lib.worldBookLibraryRows(catalog)
  const rank = new Map(rows.map(row => [row.id, row.rank]))
  const switched = rows.map(row => row.name === '新书' ? { ...row, state: 'global', rank: 0 } : row)
  assert.deepEqual(names(lib.orderWorldBookLibraryRows(switched, 'newest', rank)).slice(0, 2), ['全局书', '新书'])
  assert.deepEqual(names(lib.orderWorldBookLibraryRows(switched, 'oldest', rank)).slice(0, 3), ['全局书', '旧书', '绑定书'])
})

test('搜索书名或人物卡名', () => {
  const rows = lib.worldBookLibraryRows(catalog)
  assert.deepEqual(names(rows.filter(row => lib.worldBookRowMatches(row, '别的'))), ['别的卡的书'])
  assert.equal(rows.filter(row => lib.worldBookRowMatches(row, '  ')).length, rows.length)
})
