import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFileResourceStore, normalizeResourcePath, resourceUri, safeResourceName } from '../tavern-plugin/lib/domain/file-resources.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'

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
  assert.equal(resourceUri('materials/长篇 小说.md'), 'tavern-file:materials%2F%E9%95%BF%E7%AF%87%20%E5%B0%8F%E8%AF%B4.md')
  assert.throws(() => normalizeResourcePath('../cards/x.json'), /路径不合法/)
  assert.throws(() => normalizeResourcePath('materials/x.md', 'card'), /类型不匹配/)
  assert.throws(() => safeResourceName('CON.txt'), /文件名不合法/)
})

test('导入资料同时保存原版和可编辑工作版', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const resourcePath = await store.importText('source', { name: '参考 资料.md', text: '原始正文' })
    assert.equal(resourcePath, 'materials/参考 资料.md')
    assert.equal(await readFile(path.join(root, 'originals', resourcePath), 'utf8'), '原始正文')
    await store.writeWorking(resourcePath, '修改后的正文')
    assert.equal(await readFile(path.join(root, 'resources', resourcePath), 'utf8'), '修改后的正文')
    assert.equal(await readFile(path.join(root, 'originals', resourcePath), 'utf8'), '原始正文')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('导入预设时进入独立目录并保留文件名和原始排版', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const original = '{\r\n  "prompts": ["A", "B"]\r\n}\r\n'
    const resourcePath = await store.importText('preset', {
      name: '酒馆预设-DeepSeek.json',
      text: original.replace(/\r\n?/g, '\n').trim(),
      originalText: original,
    })
    assert.equal(resourcePath, 'presets/酒馆预设-DeepSeek.json')
    assert.equal(await readFile(path.join(root, 'originals', resourcePath), 'utf8'), original)
    assert.equal(await readFile(path.join(root, 'resources', resourcePath), 'utf8'), '{\n  "prompts": ["A", "B"]\n}')
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

test('导入 EPUB 时原版保留二进制，工作版保存抽取正文', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const original = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 1, 2, 3])
    const resourcePath = await store.importText('source', {
      name: '小说.epub',
      text: '抽取后的正文',
      fileB64: original.toString('base64')
    })
    assert.equal(resourcePath, 'materials/小说.epub')
    assert.deepEqual(await readFile(path.join(root, 'originals', resourcePath)), original)
    assert.equal(await readFile(path.join(root, 'resources', resourcePath), 'utf8'), '抽取后的正文')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('人物卡原版和工作版都保持宏与 HTML 不变', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const rawCard = {
      name: '角色',
      description: '<div>{{setvar::combat_driver::}}</div><p>{{setvar::status_format::必须更新状态}}</p><b>你好，{{char}}。</b>{{getvar::status_format}}<style>不要保留</style>普通正文：{{char}}。',
      first_mes: '{{user}} 来到门前。<br>抬头看门。',
      character_book: {
        entries: [{ keys: ['测试'], content: '<section>设定 {{random::甲::乙}} 仍然有效。</section><script>不要执行</script>' }]
      }
    }
    const rawText = JSON.stringify(rawCard)
    const cardPath = await store.importCard({ name: '角色.json', text: rawText }, rawCard)

    assert.equal(await readFile(path.join(root, 'originals', cardPath), 'utf8'), rawText)
    const working = await store.readCard(cardPath)
    assert.deepEqual(working, rawCard)
    assert.equal(await readFile(path.join(root, 'resources', cardPath), 'utf8'), JSON.stringify(rawCard, null, 2))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('读取旧工作区人物卡不会改写其中的宏', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const cardPath = await store.importCard({ name: '旧卡.json', text: '{"name":"旧卡"}' }, { name: '旧卡' })
    const legacyWorking = JSON.stringify({ name: '旧卡', system_prompt: '{{setvar::rule::保留这条规则}} {{getvar::rule}}' })
    await writeFile(path.join(root, 'resources', cardPath), legacyWorking)

    assert.equal((await store.readCard(cardPath)).system_prompt, '{{setvar::rule::保留这条规则}} {{getvar::rule}}')
    assert.match(await readFile(path.join(root, 'resources', cardPath), 'utf8'), /setvar|getvar/)
    assert.equal(await readFile(path.join(root, 'originals', cardPath), 'utf8'), '{"name":"旧卡"}')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('从 JSON 原版恢复人物卡前备份当前工作版', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const cards = createCardPreparation({ id: () => 'restored-card', now: () => 123 })
    const store = createFileResourceStore({ dataRoot: root })
    const original = { name: '原版角色', description: '原始设定', tags: ['原版'] }
    const cardPath = await store.importCard({ name: '角色.json', text: JSON.stringify(original) }, original)
    await store.writeWorking(cardPath, JSON.stringify({ name: '损坏角色', description: '灾难性错误' }))

    const restored = await store.restoreCard(cardPath, function (payload) {
      return cards.create({ kind: 'import', payload })
    })

    assert.equal((await store.readCard(cardPath)).name, '原版角色')
    assert.equal((await store.readCard(cardPath)).description, '原始设定')
    assert.match(await readFile(path.join(root, restored.backupPath), 'utf8'), /灾难性错误/)
    assert.equal(await readFile(path.join(root, 'originals', cardPath), 'utf8'), JSON.stringify(original))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('PNG 原版恢复时重新提取内嵌人物卡数据', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const cards = createCardPreparation({ id: () => 'restored-card', now: () => 456 })
    const store = createFileResourceStore({ dataRoot: root })
    const original = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'PNG角色', description: 'PNG原始设定' } }
    const png = pngCardBuffer(original)
    const imported = cards.create({ kind: 'import', payload: { kind: 'png', b64: Buffer.from(JSON.stringify(original)).toString('base64') } })
    const cardPath = await store.importCard({ kind: 'png', name: 'PNG角色.png', fileB64: png.toString('base64') }, imported)
    await store.writeWorking(cardPath, JSON.stringify({ name: '损坏角色' }))

    await store.restoreCard(cardPath, function (payload) {
      return cards.create({ kind: 'import', payload })
    })

    assert.equal((await store.readCard(cardPath)).name, 'PNG角色')
    assert.equal((await store.readCard(cardPath)).description, 'PNG原始设定')
    assert.deepEqual(await readFile(path.join(root, 'originals/cards/PNG角色.png')), png)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('同名导入拒绝覆盖', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    await store.importText('source', { name: '资料.txt', text: '一' })
    await assert.rejects(store.importText('source', { name: '资料.txt', text: '二' }), /文件已存在/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('人物卡绑定资料只保存路径引用，重命名任一端都会保持绑定', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const cardPath = await store.importCard({ name: '旧名.json', text: '{"name":"角色名"}' }, { name: '角色名', description: '' })
    const materialPath = await store.importText('source', { name: '故事.txt', text: '剧本正文' })
    await store.bindMaterial(cardPath, materialPath)
    assert.equal(await store.scriptForCard(cardPath), materialPath)

    const renamed = await store.rename(cardPath, '新文件名.json')
    assert.equal(renamed.path, 'cards/新文件名.json')
    assert.equal(await store.scriptForCard(renamed.path), materialPath)
    assert.equal((await store.readCard(renamed.path)).name, '角色名')
    assert.equal(await readFile(path.join(root, 'originals/cards/新文件名.json'), 'utf8'), '{"name":"旧名"}'.replace('旧名', '角色名'))

    const renamedMaterial = await store.rename(materialPath, '新故事.txt')
    assert.equal(await store.scriptForCard(renamed.path), renamedMaterial.path)
    await assert.rejects(store.remove(renamedMaterial.path), /仍被人物卡绑定/)
    await store.unbindMaterial(renamed.path)
    assert.equal(await store.scriptForCard(renamed.path), undefined)
    assert.equal(await store.readText(renamedMaterial.path), '剧本正文')
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
