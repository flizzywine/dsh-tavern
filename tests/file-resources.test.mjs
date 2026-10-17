import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFileResourceStore, normalizeResourcePath, safeResourceName, stripPngTextChunks } from '../tavern-plugin/lib/domain/file-resources.js'

function pngCardBuffer(card) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const payload = Buffer.from('chara\0' + Buffer.from(JSON.stringify(card), 'utf8').toString('base64'), 'latin1')
  const chunk = Buffer.alloc(12 + payload.length)
  chunk.writeUInt32BE(payload.length, 0)
  chunk.write('tEXt', 4, 4, 'ascii')
  payload.copy(chunk, 8)
  chunk.writeUInt32BE(0, 8 + payload.length)
  const end = Buffer.alloc(12)
  end.writeUInt32BE(0, 0)
  end.write('IEND', 4, 4, 'ascii')
  return Buffer.concat([signature, chunk, end])
}

test('资源相对路径就是身份，并拒绝目录逃逸', () => {
  assert.equal(normalizeResourcePath('cards/阿芙拉.json', 'card'), 'cards/阿芙拉.json')
  assert.equal(normalizeResourcePath('materials/长篇 小说.md', 'source'), 'materials/长篇 小说.md')
  assert.throws(() => normalizeResourcePath('../cards/x.json'), /路径不合法/)
  assert.throws(() => normalizeResourcePath('materials/x.md', 'card'), /类型不匹配/)
  assert.throws(() => safeResourceName('CON.txt'), /文件名不合法/)
})

test('人物卡或世界书重命名与删除会同步绑定关系', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-worldbook-binding-moves-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const cardPath = await store.importCard({ name: '角色.json', text: '{}' }, { name: '角色' })
    const worldBookPath = await store.importWorldBook({ name: '旧世界书.json', originalText: '{"entries":{}}' }, { name: '旧世界书', entries: {} })
    await store.bindWorldBook(cardPath, worldBookPath)

    const renamedCard = (await store.rename(cardPath, '新角色')).path
    const renamedWorldBook = (await store.rename(worldBookPath, '新世界书')).path
    assert.deepEqual(await store.worldBookBindingForCard(renamedCard), { kind: 'standalone', path: renamedWorldBook, available: true })

    await store.remove(renamedWorldBook)
    assert.deepEqual(await store.worldBookBindingForCard(renamedCard), { kind: 'none' })
    await store.bindWorldBook(renamedCard, null)
    await store.remove(renamedCard)
    assert.deepEqual(JSON.parse(await readFile(path.join(root, '.worldbook-bindings.json'), 'utf8')), {})
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('标准酒馆预设从资料库迁移到预设库并同步对话引用', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const presetText = JSON.stringify({ prompts: [{ identifier: 'main', name: '主提示词', role: 'system', content: '正文' }], prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }] })
    const oldPath = await store.importText('source', { name: '旧预设.json', text: presetText })
    await store.importText('source', { name: '普通数据.json', text: '{"items":[1,2]}' })
    await writeFile(path.join(root, '.file-resources-v1.json'), JSON.stringify({ schemaVersion: 3 }))
    const chat = { id: 'chat-1', workspace: { sourcePaths: [oldPath], mountedResources: [{ kind: 'source', path: oldPath, label: '旧预设' }] } }

    const marker = await store.migrateLegacy({ chats: [{ id: chat.id }] }, async function () {}, async function () {}, async function () { return chat }, async function (next) { Object.assign(chat, next) })

    assert.equal(marker.schemaVersion, 4)
    assert.equal(await store.readText('presets/旧预设.json'), presetText)
    assert.equal(await store.readText('materials/旧预设.json'), undefined)
    assert.equal(await store.readText('materials/普通数据.json'), '{"items":[1,2]}')
    assert.deepEqual(chat.workspace.sourcePaths, [])
    assert.deepEqual(chat.workspace.mountedResources, [{ kind: 'preset', path: 'presets/旧预设.json', label: '旧预设' }])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('旧 scripts 副本迁移为资料引用，同名资料优先且旧副本可恢复', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const cardPath = await store.importCard({ name: '角色.json', text: '{"name":"角色"}' }, { name: '角色' })
    const materialPath = await store.importText('source', { name: '故事.txt', text: '资料正文' })
    const legacyPath = await store.importText('script', { name: '故事.txt', text: '旧副本正文' }, cardPath)
    await writeFile(path.join(root, '.file-resources-v1.json'), JSON.stringify({ schemaVersion: 2 }))

    const marker = await store.migrateLegacy({ chats: [] }, async function () {}, async function () {}, async function () {}, async function () {})
    assert.equal(marker.schemaVersion, 4)
    assert.equal(await store.scriptForCard(cardPath), materialPath)
    assert.equal(await store.readText(materialPath), '资料正文')
    await assert.rejects(readFile(path.join(root, 'resources', legacyPath)), /ENOENT/)
    assert.equal(await readFile(path.join(root, 'legacy-id-storage/script-copies/角色/故事.txt'), 'utf8'), '旧副本正文')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('人物卡副本保留当前工作数据和大写 PNG，独立 ID 且重名不覆盖', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-copy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createFileResourceStore({ dataRoot: root })
  await store.ensure()
  const card = { kind: 'tavern-card-workspace', version: 1, meta: { id: 'source-id' }, raw: { name: 'source', data: { name: 'source', description: 'current edits', extensions: { preserved: true } } } }
  await store.writeWorking('cards/source.json', JSON.stringify(card))
  const image = pngCardBuffer({ name: 'old original' })
  await writeFile(path.join(root, 'originals/cards/source.PNG'), image)
  const copied = await store.copyCard('cards/source.json', 'copy')
  assert.equal(copied.imageCopied, true)
  assert.deepEqual(await store.readCardImage(copied.path), image)
  const preview = await store.cardImagePreview(copied.path)
  assert.match(preview.revision, /^"[0-9a-z]+-[0-9a-z]+"$/)
  const thumbnail = await preview.read()
  assert.deepEqual(thumbnail, stripPngTextChunks(image))
  assert.ok(thumbnail.length < image.length)
  assert.equal(thumbnail.includes(Buffer.from('chara')), false)
  assert.equal(thumbnail.subarray(-8, -4).toString('ascii'), 'IEND')
  const saved = await store.readCard(copied.path)
  assert.notEqual(saved.meta.id, card.meta.id)
  assert.equal(saved.raw.data.name, 'copy')
  assert.equal(saved.raw.data.description, 'current edits')
  assert.deepEqual(await store.readCard('cards/source.json'), card)
  await assert.rejects(store.copyCard('cards/source.json', 'copy'), /已存在/)
  assert.deepEqual(await store.readCard(copied.path), saved)
  const results = await Promise.allSettled([store.copyCard('cards/source.json', 'race'), store.copyCard('cards/source.json', 'race')])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
})

test('无图人物卡复制不伪造图片，孤立原版也阻止覆盖', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-copy-json-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createFileResourceStore({ dataRoot: root })
  await store.importCard({ name: 'source.json' }, { name: 'source', description: 'text' })
  const copied = await store.copyCard('cards/source.json', 'copy')
  assert.equal(copied.imageCopied, false)
  assert.equal(await store.hasCardImage(copied.path), false)
  await writeFile(path.join(root, 'originals/cards/occupied.PNG'), 'existing')
  await assert.rejects(store.copyCard('cards/source.json', 'occupied'), /已存在/)
  assert.equal(await readFile(path.join(root, 'originals/cards/occupied.PNG'), 'utf8'), 'existing')
  await assert.rejects(store.copyCard('../source.json', 'escape'), /路径不合法/)
})

for (const kind of ['worldbook', 'json', 'png']) {
  test('重命名保留导入和更新时间：' + kind, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-rename-time-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const store = createFileResourceStore({ dataRoot: root })
    const resource = kind === 'worldbook'
      ? await store.importWorldBook({ name: 'old.json' }, { entries: {} })
      : await store.importCard({ name: 'old.' + kind, kind, fileB64: Buffer.from('image').toString('base64') }, { name: 'old', character_book: { entries: [] } })
    const original = kind === 'png' ? 'cards/old.png' : resource
    await utimes(path.join(root, 'originals', original), 1600000000, 1600000000)
    await utimes(path.join(root, 'resources', resource), 1600000100, 1600000100)
    const before = await store.metadata(resource)
    const renamed = await store.rename(resource, 'new')
    assert.deepEqual(await store.metadata(renamed.path), before)
    await rm(path.join(root, 'originals', kind === 'png' ? 'cards/new.png' : renamed.path))
    const fallback = await store.metadata(renamed.path)
    const again = await store.rename(renamed.path, 'again')
    assert.deepEqual(await store.metadata(again.path), fallback)
  })
}

test('全局世界书选择持久化，重命名跟随、删除清理并保留人物卡绑定', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-global-books-'))
  try {
    let store = createFileResourceStore({ dataRoot: root })
    const book = await store.importWorldBook({ name: '通用.json', originalText: '{"entries":{}}' }, { name: '通用', entries: {} })
    const card = await store.importCard({ name: '人物.json', text: '{}' }, { name: '人物' })
    await Promise.all([store.bindWorldBook(card, book), store.setGlobalWorldBook(book, true)])
    assert.equal((await store.worldBookBindingForCard(card)).path, book)
    await store.setGlobalWorldBook(book, true)
    store = createFileResourceStore({ dataRoot: root })
    assert.deepEqual(await store.globalWorldBookSources(), [{ kind: 'standalone', path: book }])
    const renamed = (await store.rename(book, '新通用')).path
    assert.deepEqual(await store.globalWorldBookSources(), [{ kind: 'standalone', path: renamed }])
    await store.setGlobalWorldBook(renamed, false)
    assert.equal((await store.worldBookBindingForCard(card)).path, renamed)
    await store.setGlobalWorldBook(renamed, true)
    await store.remove(renamed)
    assert.deepEqual(await store.globalWorldBookSources(), [])
    await assert.rejects(store.setGlobalWorldBook(renamed, true), /世界书不存在/)
    await assert.rejects(store.setGlobalWorldBook('../bad', true), /路径/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('并发剧本绑定和解绑不覆盖其他卡，独占约束在提交时检查', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'material-bindings-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const a = await store.importCard({ name: 'a.json', text: '{}' }, {})
    const b = await store.importCard({ name: 'b.json', text: '{}' }, {})
    const x = await store.importText('source', { name: 'x.txt', text: 'X' })
    const y = await store.importText('source', { name: 'y.txt', text: 'Y' })
    await Promise.all([store.bindMaterial(a, x), store.bindMaterial(b, y)])
    assert.equal(await store.scriptForCard(a), x)
    assert.equal(await store.scriptForCard(b), y)
    await Promise.all([store.unbindMaterial(a), store.bindMaterial(b, y)])
    assert.equal(await store.scriptForCard(a), undefined)
    assert.equal(await store.scriptForCard(b), y)
    await store.unbindMaterial(b)
    const attempts = await Promise.allSettled([store.bindMaterial(a, x), store.bindMaterial(b, x)])
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal((await store.cardsForMaterial(x)).length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('同名剧本按内容导入，相同内容跨卡也保持独立绑定', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'script-import-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const a = await store.importCard({ name: 'a.json', text: '{}' }, {})
    const b = await store.importCard({ name: 'b.json', text: '{}' }, {})
    const old = await store.importText('source', { name: 'story.txt', text: 'OLD' })
    const current = await store.importBoundScript(a, { name: 'story.txt', text: 'NEW' })
    assert.notEqual(current, old)
    assert.equal(await store.readText(current), 'NEW')
    assert.equal(await store.readText(old), 'OLD')
    assert.equal(await store.importBoundScript(a, { name: 'story.txt', text: 'OLD' }), old)
    const copy = await store.importBoundScript(b, { name: 'story.txt', text: 'OLD' })
    assert.notEqual(copy, old)
    assert.equal(await store.scriptForCard(a), old)
    assert.equal(await store.scriptForCard(b), copy)
    await assert.rejects(store.importBoundScript('cards/missing.json', { name: 'lost.txt', text: 'lost' }))
    assert.equal((await store.list('source')).some(path => path.includes('lost')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
