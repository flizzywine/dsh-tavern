import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createFileResourceStore, normalizeResourcePath, resourceUri, safeResourceName } from '../tavern-plugin/lib/domain/file-resources.js'

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

test('人物卡原版保持不变，工作版清理宏但完整保留 HTML', async () => {
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
    assert.equal(working.description, '<div></div><p></p><b>你好，角色。</b><style>不要保留</style>普通正文：角色。')
    assert.equal(working.first_mes, '玩家 来到门前。<br>抬头看门。')
    assert.equal(working.character_book.entries[0].content, '<section>设定  仍然有效。</section><script>不要执行</script>')
    assert.doesNotMatch(JSON.stringify(working), /\{\{/)
    assert.match(await readFile(path.join(root, 'resources', cardPath), 'utf8'), /<b>你好，角色。<\/b>|<script>不要执行<\/script>/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('读取旧工作区人物卡时就地清理遗留宏，不修改原版', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const cardPath = await store.importCard({ name: '旧卡.json', text: '{"name":"旧卡"}' }, { name: '旧卡' })
    const legacyWorking = JSON.stringify({ name: '旧卡', system_prompt: '{{setvar::rule::保留这条规则}} {{getvar::rule}}' })
    await writeFile(path.join(root, 'resources', cardPath), legacyWorking)

    assert.equal((await store.readCard(cardPath)).system_prompt, ' ')
    assert.doesNotMatch(await readFile(path.join(root, 'resources', cardPath), 'utf8'), /setvar|getvar/)
    assert.equal(await readFile(path.join(root, 'originals', cardPath), 'utf8'), '{"name":"旧卡"}')
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
    assert.equal(marker.schemaVersion, 3)
    assert.equal(await store.scriptForCard(cardPath), materialPath)
    assert.equal(await store.readText(materialPath), '资料正文')
    await assert.rejects(readFile(path.join(root, 'resources', legacyPath)), /ENOENT/)
    assert.equal(await readFile(path.join(root, 'legacy-id-storage/script-copies/角色/故事.txt'), 'utf8'), '旧副本正文')
  } finally { await rm(root, { recursive: true, force: true }) }
})
