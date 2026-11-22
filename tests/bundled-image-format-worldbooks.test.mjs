import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createFormatWorldbooks, normalizeFormatWorldbook, structuredWorldbookDefaults, FORMAT_WORLDBOOK_GROUPS } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/format-worldbooks.js'
import { selectPlannerContext } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner-context.js'

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'dsh-format-worldbooks-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}
const main = {
  name: '我的生图规则', customMetadata: { keep: true }, entries: [
    { uid: 7, comment: '关闭', content: '不要启用这条', enabled: false, backends: ['tags'] },
    { uid: 8, comment: '常驻', content: '旧规则常驻', enabled: true, constant: true },
    { uid: 9, comment: '按需', content: '仅窗边', enabled: true, activation: 'keywords', keywords: ['窗'], andKeywords: ['雨'], backends: ['natural', 'structured'] },
  ],
}
const outfits = { name: '服装规则', entries: [{ comment: '服装', content: '只描述当前衣服', enabled: true }] }
async function seedLegacy(root, a = main, b = outfits) {
  const text = JSON.stringify(a, null, 3) + '\n\n', outfitText = JSON.stringify(b)
  await fs.writeFile(join(root, 'worldbook.json'), text)
  await fs.writeFile(join(root, 'worldbook-outfits.json'), outfitText)
  return { text, outfitText }
}
const pathFor = (root, mode, key = 'main') => join(root, 'format-worldbooks', mode, key === 'main' ? 'worldbook.json' : 'worldbook-outfits.json')

test('first migration copies custom old books into three formats and backs up exact original bytes', async t => {
  const root = await fixture(t), { text, outfitText } = await seedLegacy(root)
  const store = createFormatWorldbooks({ root })
  const result = await store.ensure()
  assert.equal(result.created.length, 8)
  assert.equal(await fs.readFile(join(root, 'worldbook.json'), 'utf8'), text)
  assert.equal(await fs.readFile(join(root, 'worldbook-outfits.json'), 'utf8'), outfitText)
  assert.equal(await fs.readFile(join(result.backupFolder, 'worldbook.json'), 'utf8'), text)
  assert.equal(await fs.readFile(join(result.backupFolder, 'worldbook-outfits.json'), 'utf8'), outfitText)
  for (const mode of ['tags', 'natural', 'mixed']) {
    const book = await store.readBook(mode, 'main')
    assert.equal(book.name, main.name)
    assert.deepEqual(book.customMetadata, { keep: true })
    assert.equal(book.entries[0].enabled, false)
    assert.equal(book.entries[0].uid, 7)
    assert.deepEqual(book.entries[2].backends, ['natural', 'structured'])
    assert.deepEqual(book.entries[2].andKeywords, ['雨'])
    assert.equal((await store.readBook(mode, 'outfits')).name, outfits.name)
  }
  const structured = await store.readFormat('structured')
  assert.match(structured.entries.map(e => e.content).join('\n'), /结构化中文自然语言/)
  assert.doesNotMatch(structured.entries.map(e => e.content).join('\n'), /旧规则常驻|画面任务/)
  assert.deepEqual(structured.books.map(book => book.key), ['main', 'outfits'])
})

async function bundledLegacySeeds() {
  const directory = new URL('../tavern-plugin/packages/dsh-tavern-image-bundled/', import.meta.url)
  return Promise.all(['世界书-通用生图规则.json', '世界书-角色与服装库.json'].map(async file => JSON.parse(await fs.readFile(new URL(file, directory), 'utf8'))))
}

test('natural migration backs up pristine legacy rules and preserves edited books and mixed bytes', async t => {
  const root = await fixture(t)
  const legacy = await bundledLegacySeeds()
  await seedLegacy(root, ...legacy)
  const first = createFormatWorldbooks({ root })
  await first.ensure()
  legacy[1].entries[0].content = '保留用户修改过的服装规则'
  const [oldMain, editedOutfits] = legacy.map(book => JSON.stringify(normalizeFormatWorldbook(book), null, 3) + '\n\n')
  await fs.writeFile(pathFor(root, 'natural'), oldMain)
  await fs.writeFile(pathFor(root, 'natural', 'outfits'), editedOutfits)
  const mixedPath = pathFor(root, 'mixed')
  const mixedBytes = await fs.readFile(mixedPath, 'utf8')
  const restart = createFormatWorldbooks({ root })
  const result = await restart.ensure()
  const upgrades = result.upgrades.filter(upgrade => upgrade.format === 'natural')
  assert.equal(upgrades.length, 1)
  assert.equal(upgrades[0].key, 'main')
  assert.equal(await fs.readFile(upgrades[0].backupFile, 'utf8'), oldMain)
  assert.equal((await restart.readBook('natural', 'main')).name, '自然语言 · 生图规则')
  assert.equal(await fs.readFile(pathFor(root, 'natural', 'outfits'), 'utf8'), editedOutfits)
  assert.equal(await fs.readFile(mixedPath, 'utf8'), mixedBytes)
  assert.equal((await createFormatWorldbooks({ root }).ensure()).upgrades.some(upgrade => upgrade.format === 'natural'), false)
})

test('readFormat provides stable global indexes plus original group indexes and keeps enabled activation', async t => {
  const root = await fixture(t)
  await seedLegacy(root)
  const store = createFormatWorldbooks({ root })
  const loaded = await store.readFormat('natural')
  assert.deepEqual(loaded.entries.map(e => [e.index, e.book, e.bookIndex]), [[0, 'main', 0], [1, 'main', 1], [2, 'main', 2], [3, 'outfits', 0]])
  const context = selectPlannerContext({ entries: loaded.entries, promptMode: 'natural', text: '雨中窗边' })
  assert.doesNotMatch(context.staticRules, /不要启用这条/)
  assert.match(context.staticRules, /旧规则常驻|只描述当前衣服/)
  assert.match(context.dynamicRules, /仅窗边/)
  const listed = await store.listBooks('natural')
  assert.equal(listed[0].count, 3)
  assert.equal(listed[0].enabled, 2)
  assert.equal(listed[0].file, 'format-worldbooks/natural/worldbook.json')
  assert.deepEqual(listed[1].entries.map(e => e.index), [0])
})

test('each format/group is independently editable; reads are fresh and empty edits survive restart', async t => {
  const root = await fixture(t)
  await seedLegacy(root)
  const store = createFormatWorldbooks({ root })
  await store.ensure()
  await store.writeBook('natural', 'main', { name: '自然语言新规则', entries: [] })
  await store.writeBook('structured', 'outfits', { name: '自定义服装规则', entries: [{ content: '【我的章节】可自行改名', enabled: false }] })
  assert.equal((await store.readBook('tags', 'main')).name, main.name)
  assert.equal((await store.readBook('mixed', 'main')).name, main.name)
  assert.equal((await store.readBook('natural', 'outfits')).name, outfits.name)
  const restart = createFormatWorldbooks({ root })
  assert.equal((await restart.ensure()).created.length, 0)
  assert.deepEqual((await restart.readBook('natural', 'main')).entries, [])
  assert.equal((await restart.readBook('structured', 'outfits')).entries[0].enabled, false)
  // An external edit also becomes visible: there is no stale merged-book cache.
  await fs.writeFile(pathFor(root, 'tags'), JSON.stringify({ name: '外部编辑', entries: [] }))
  assert.equal((await store.readBook('tags', 'main')).name, '外部编辑')
  const backups = await fs.readdir(join(root, 'backups', 'format-worldbooks-edits'))
  assert.equal(backups.length, 2)
})

test('partial migration restart uses pinned snapshot even if legacy sources changed, and never overwrites an existing edit', async t => {
  const root = await fixture(t)
  await seedLegacy(root)
  let fail = true
  const injected = { ...fs, link: async (from, to) => {
    if (fail && to === pathFor(root, 'natural')) { fail = false; throw Object.assign(new Error('simulated interruption'), { code: 'EIO' }) }
    return fs.link(from, to)
  } }
  await assert.rejects(createFormatWorldbooks({ root, io: injected }).ensure(), /simulated interruption/)
  await fs.writeFile(pathFor(root, 'tags'), JSON.stringify({ name: '已编辑的标签规则', entries: [] }))
  await fs.writeFile(join(root, 'worldbook.json'), JSON.stringify({ name: '迁移后改动的旧数据', entries: [] }))
  const restarted = createFormatWorldbooks({ root })
  await restarted.ensure()
  assert.equal((await restarted.readBook('tags', 'main')).name, '已编辑的标签规则')
  assert.equal((await restarted.readBook('natural', 'main')).name, main.name)
  assert.equal((await restarted.readBook('mixed', 'main')).name, main.name)
  assert.equal(JSON.parse(await fs.readFile(join(root, 'worldbook.json'), 'utf8')).name, '迁移后改动的旧数据')
})

test('same-instance retry after transient migration failure is possible and concurrent initializers do not overwrite winners', async t => {
  const root = await fixture(t)
  await seedLegacy(root)
  let fail = true
  const store = createFormatWorldbooks({ root, io: { ...fs, link: async (from, to) => {
    if (fail && to.includes('format-worldbooks-v1')) { fail = false; throw new Error('backup unavailable') }
    return fs.link(from, to)
  } } })
  await assert.rejects(store.ensure(), /backup unavailable/)
  const [a, b] = await Promise.all([store.ensure(), createFormatWorldbooks({ root }).ensure()])
  assert.equal(a.created.length + b.created.length, 8)
  assert.deepEqual((await store.readBook('natural', 'main')).entries.map(e => e.enabled), [false, true, true])
})

test('save snapshots invocation data, serializes same-file writes, and preserves the original on atomic replace failure', async t => {
  const root = await fixture(t)
  await seedLegacy(root)
  let fail = false
  const store = createFormatWorldbooks({ root, io: { ...fs, rename: async (from, to) => {
    if (fail) throw new Error('replace denied')
    return fs.rename(from, to)
  } } })
  await store.ensure()
  const draft = { name: 'first', entries: [{ content: 'first' }] }
  const first = store.writeBook('tags', 'main', draft)
  draft.name = 'caller mutation'
  const second = store.writeBook('tags', 'main', { name: 'second', entries: [] })
  assert.equal((await first).name, 'first')
  await second
  assert.equal((await store.readBook('tags', 'main')).name, 'second')
  fail = true
  await assert.rejects(store.writeBook('tags', 'main', { name: 'must not replace', entries: [] }), /replace denied/)
  assert.equal((await store.readBook('tags', 'main')).name, 'second')
  assert.equal((await fs.readdir(join(root, 'format-worldbooks', 'tags'))).some(name => name.includes('.tmp-')), false)
})

test('upgrade retry rechecks the source and preserves a concurrent edit', async t => {
  const { root } = await installedV1(t, books => { books.main.entries = [] })
  let raceOnRename = true
  const file = pathFor(root, 'structured')
  const concurrent = JSON.stringify({ name: '并发编辑', entries: [] })
  const store = createFormatWorldbooks({ root, io: { ...fs, rename: async (from, to) => {
    if (raceOnRename && to === file) {
      raceOnRename = false
      await fs.writeFile(file, concurrent)
      throw Object.assign(new Error('temporary sharing violation'), { code: 'EPERM' })
    }
    return fs.rename(from, to)
  } } })
  const status = await store.getUpgradeStatus('main')
  await assert.rejects(store.applyDefaultUpgrade('main', { expectedFingerprint: status.fingerprint, entryIds: ['structured-prose'] }), { code: 'WORLDBOOK_UPGRADE_STALE' })
  assert.equal(await fs.readFile(file, 'utf8'), concurrent)
})

async function installedVersion(t, version, change = () => {}) {
  const root = await fixture(t)
  await createFormatWorldbooks({ root }).ensure()
  const books = structuredWorldbookDefaults(version)
  change(books)
  // Create the historical fixture on its own inode instead of editing a just-published seed in place.
  for (const key of FORMAT_WORLDBOOK_GROUPS) {
    const file = pathFor(root, 'structured', key)
    await fs.unlink(file)
    await fs.writeFile(file, JSON.stringify(books[key], null, 3) + '\n\n', { flag: 'wx' })
  }
  return { root, books }
}
const installedV1 = (t, change) => installedVersion(t, 1, change)

test('untouched v2 groups upgrade to v3 with exact-byte backups and remain idempotent', async t => {
  const { root } = await installedVersion(t, 2)
  const before = Object.fromEntries(await Promise.all(FORMAT_WORLDBOOK_GROUPS.map(async key => [key, await fs.readFile(pathFor(root, 'structured', key), 'utf8')])))
  const otherModes = await Promise.all(['tags', 'natural', 'mixed'].flatMap(mode => FORMAT_WORLDBOOK_GROUPS.map(async key => ({ mode, key, text: await fs.readFile(pathFor(root, mode, key), 'utf8') }))))
  const store = createFormatWorldbooks({ root })
  const result = await store.ensure()
  for (const key of FORMAT_WORLDBOOK_GROUPS) {
    const upgraded = result.upgrades.find(item => item.key === key)
    assert.equal(await fs.readFile(upgraded.backupFile, 'utf8'), before[key])
    assert.deepEqual(await store.readBook('structured', key), structuredWorldbookDefaults(3)[key])
    assert.equal(upgraded.version, 3)
    assert.equal(upgraded.available, false)
  }
  for (const { mode, key, text } of otherModes) assert.equal(await fs.readFile(pathFor(root, mode, key), 'utf8'), text)
  const backups = await fs.readdir(join(root, 'backups', 'format-worldbooks-upgrades'))
  assert.equal(backups.length, 2)
  await createFormatWorldbooks({ root }).ensure()
  assert.deepEqual(await fs.readdir(join(root, 'backups', 'format-worldbooks-upgrades')), backups)
})

test('v2 upgrade protects custom content, activation, metadata, disabled entries, deletions and ordering', async t => {
  for (const key of FORMAT_WORLDBOOK_GROUPS) for (const scenario of ['edited', 'disabled', 'deleted', 'activation', 'metadata', 'reordered', 'extended', 'title', 'duplicate', 'forged-fingerprint']) {
    await t.test(key + ': ' + scenario, async t => {
      const { root, books } = await installedVersion(t, 2, books => {
        const b = books[key]
        if (scenario === 'edited' || scenario === 'forged-fingerprint') b.entries[0].content = '用户正文不可覆盖'
        if (scenario === 'disabled') b.entries[0].enabled = false
        if (scenario === 'deleted') b.entries.splice(0, 1)
        if (scenario === 'activation') { b.entries[0].activation = 'keywords'; b.entries[0].keywords = ['触发词'] }
        if (scenario === 'metadata') b.entries[0].customMetadata = { keep: true }
        if (scenario === 'reordered') b.entries.reverse()
        if (scenario === 'extended') b.entries.push({ id: 'mine', content: '用户规则' })
        if (scenario === 'title') { b.name = '我的标题'; b.customMetadata = { keep: true } }
        if (scenario === 'duplicate') b.entries.push({ ...b.entries[0], content: '同标识用户规则' })
        if (scenario === 'forged-fingerprint') {
          // A user-controlled stored fingerprint cannot authorize replacement.
          const entry = b.entries[0]
          b.defaultSeed.fingerprints[entry.id] = createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(entry).sort().map(k => [k, entry[k]])))).digest('hex')
        }
      })
      const old = normalizeFormatWorldbook(books[key])
      const store = createFormatWorldbooks({ root })
      const result = await store.readBook('structured', key)
      assert.deepEqual(result.entries.map(e => e.id), old.entries.map(e => e.id))
      assert.equal(result.name, old.name)
      assert.deepEqual(result.customMetadata, old.customMetadata)
      const originalId = structuredWorldbookDefaults(2)[key].entries[0].id
      if (['edited', 'disabled', 'activation', 'metadata', 'duplicate', 'forged-fingerprint'].includes(scenario)) {
        assert.deepEqual(result.entries.filter(e => e.id === originalId), old.entries.filter(e => e.id === originalId))
      }
      const unchangedId = structuredWorldbookDefaults(2)[key].entries[1].id
      assert.deepEqual(result.entries.find(e => e.id === unchangedId), structuredWorldbookDefaults()[key].entries.find(e => e.id === unchangedId))
      if (scenario === 'extended') assert.deepEqual(result.entries.at(-1), old.entries.at(-1))
      const restart = createFormatWorldbooks({ root })
      assert.deepEqual(await restart.readBook('structured', key), result)
    })
  }
})

test('v2 empty or wholly customized groups retain exact bytes and old seed metadata', async t => {
  for (const scenario of ['empty', 'custom', 'all-disabled']) await t.test(scenario, async t => {
    const { root } = await installedVersion(t, 2, books => {
      for (const book of Object.values(books)) {
        if (scenario === 'empty') book.entries = []
        if (scenario === 'custom') book.entries = [{ id: 'mine', content: '完全自定义' }]
        if (scenario === 'all-disabled') book.entries.forEach(entry => { entry.enabled = false })
      }
    })
    const before = await Promise.all(FORMAT_WORLDBOOK_GROUPS.map(key => fs.readFile(pathFor(root, 'structured', key), 'utf8')))
    await createFormatWorldbooks({ root }).ensure()
    await createFormatWorldbooks({ root }).ensure()
    for (const [index, key] of FORMAT_WORLDBOOK_GROUPS.entries()) assert.equal(await fs.readFile(pathFor(root, 'structured', key), 'utf8'), before[index])
    await assert.rejects(fs.readdir(join(root, 'backups', 'format-worldbooks-upgrades')), { code: 'ENOENT' })
  })
})

test('untouched v1 groups upgrade with exact-byte backups and restart is idempotent', async t => {
  const { root } = await installedV1(t)
  const before = await fs.readFile(pathFor(root, 'structured'), 'utf8')
  const tags = await fs.readFile(pathFor(root, 'tags'), 'utf8')
  const store = createFormatWorldbooks({ root })
  const result = await store.ensure()
  const upgraded = result.upgrades.find(item => item.key === 'main')
  assert.equal(await fs.readFile(upgraded.backupFile, 'utf8'), before)
  assert.deepEqual(await store.readBook('structured', 'main'), structuredWorldbookDefaults().main)
  assert.equal(await fs.readFile(pathFor(root, 'tags'), 'utf8'), tags)
  const backups = await fs.readdir(join(root, 'backups', 'format-worldbooks-upgrades'))
  const restart = createFormatWorldbooks({ root })
  await restart.ensure()
  assert.deepEqual(await fs.readdir(join(root, 'backups', 'format-worldbooks-upgrades')), backups)
  assert.equal((await restart.getUpgradeStatus('main')).available, false)
})

test('edited, disabled, deleted, reordered and extended v1 groups never receive new defaults automatically', async t => {
  for (const scenario of ['edited', 'disabled', 'deleted', 'reordered', 'extended', 'title']) await t.test(scenario, async t => {
    const { root, books } = await installedV1(t, books => {
      const b = books.main
      if (scenario === 'edited') b.entries[0].content = '用户正文不可覆盖'
      if (scenario === 'disabled') b.entries[0].enabled = false
      if (scenario === 'deleted') b.entries.splice(0, 1)
      if (scenario === 'reordered') b.entries.reverse()
      if (scenario === 'extended') b.entries.push({ id: 'mine', content: '用户规则' })
      if (scenario === 'title') b.name = '我的标题'
    })
    const store = createFormatWorldbooks({ root })
    const result = await store.readBook('structured', 'main')
    assert.deepEqual(result.entries.map(e => e.id), books.main.entries.map(e => e.id))
    const first = result.entries.find(e => e.id === 'structured-prose')
    if (scenario === 'edited') assert.equal(first.content, '用户正文不可覆盖')
    if (scenario === 'disabled') { assert.equal(first.enabled, false); assert.equal(first.content, books.main.entries[0].content) }
    const other = result.entries.find(e => e.id === 'structured-story')
    assert.equal(other.content, structuredWorldbookDefaults().main.entries[1].content, 'unchanged old entries can update independently')
    const restart = createFormatWorldbooks({ root })
    assert.deepEqual((await restart.readBook('structured', 'main')).entries, result.entries)
  })
})

test('empty and wholly custom groups stay byte-for-byte unchanged across initialization and restart', async t => {
  for (const entries of [[], [{ id: 'mine', content: '完全自定义' }]]) {
    const { root } = await installedV1(t, books => { books.main = { name: '自定义', entries } })
    const before = await fs.readFile(pathFor(root, 'structured'), 'utf8')
    await createFormatWorldbooks({ root }).ensure()
    await createFormatWorldbooks({ root }).ensure()
    assert.equal(await fs.readFile(pathFor(root, 'structured'), 'utf8'), before)
  }
})

test('explicit upgrade restores only selected entries, preserves disabled state, backs up and rejects stale previews', async t => {
  const { root } = await installedV1(t, books => {
    books.main.entries[0].content = '用户改过'
    books.main.entries[1].enabled = false
  })
  const store = createFormatWorldbooks({ root })
  const status = await store.getUpgradeStatus('main')
  assert.equal(status.entries[0].state, 'customized')
  assert.equal(status.entries[1].state, 'disabled')
  assert.equal(status.entries[2].state, 'missing')
  assert.equal(status.entries[2].current, null)
  const before = await fs.readFile(pathFor(root, 'structured'), 'utf8')
  const updated = await store.applyDefaultUpgrade('main', { expectedFingerprint: status.fingerprint, entryIds: ['structured-prose', 'structured-story', 'structured-people'] })
  assert.equal(await fs.readFile(updated.backupFile, 'utf8'), before)
  const book = await store.readBook('structured', 'main')
  assert.equal(book.entries.length, 3)
  assert.equal(book.entries[1].enabled, false)
  assert.equal(book.entries[0].content, status.entries[0].proposed.content)
  assert.equal((await store.getUpgradeStatus('main')).fingerprint, updated.fingerprint)
  await assert.rejects(store.applyDefaultUpgrade('main', { expectedFingerprint: status.fingerprint, entryIds: ['structured-space'] }), { code: 'WORLDBOOK_UPGRADE_STALE' })
  assert.deepEqual((await createFormatWorldbooks({ root }).readBook('structured', 'main')).entries, book.entries)
})

test('upgrade previews detect concurrent edits and compare-and-write after backup', async t => {
  const { root } = await installedV1(t, books => { books.main.entries = [] })
  let editDuringBackup = false
  const store = createFormatWorldbooks({ root, io: { ...fs, link: async (from, to) => {
    const result = await fs.link(from, to)
    if (editDuringBackup && to.includes('format-worldbooks-upgrades')) {
      editDuringBackup = false
      await fs.writeFile(pathFor(root, 'structured'), JSON.stringify({ name: '外部并发修改', entries: [] }))
    }
    return result
  } } })
  const status = await store.getUpgradeStatus('main')
  editDuringBackup = true
  await assert.rejects(store.applyDefaultUpgrade('main', { expectedFingerprint: status.fingerprint, entryIds: ['structured-story'] }), { code: 'WORLDBOOK_UPGRADE_STALE' })
  assert.equal((await store.readBook('structured', 'main')).name, '外部并发修改')
  const fresh = await store.getUpgradeStatus('main')
  const second = createFormatWorldbooks({ root })
  await second.ensure()
  const results = await Promise.allSettled([
    store.applyDefaultUpgrade('main', { expectedFingerprint: fresh.fingerprint, entryIds: ['structured-story'] }),
    second.applyDefaultUpgrade('main', { expectedFingerprint: fresh.fingerprint, entryIds: ['structured-visible'] }),
  ])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'WORLDBOOK_UPGRADE_STALE')
})
