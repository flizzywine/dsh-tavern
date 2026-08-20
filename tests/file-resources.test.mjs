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

test('导入素材同时保存原版和可编辑工作版', async () => {
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

test('人物卡原版保持不变，工作版删除不兼容宏与 HTML 整段', async () => {
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
    assert.doesNotMatch(working.description, /必须更新状态|不要保留/)
    assert.equal(working.description, '普通正文：角色。')
    assert.equal(working.first_mes, '玩家 来到门前。抬头看门。')
    assert.equal(working.character_book.entries[0].content, '')
    assert.doesNotMatch(JSON.stringify(working), /\{\{|<\/?[a-z]/i)
    assert.doesNotMatch(await readFile(path.join(root, 'resources', cardPath), 'utf8'), /setvar|getvar|random|<\/?[a-z]/i)
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

test('人物卡重命名同步移动原版与绑定剧本目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const cardPath = await store.importCard({ name: '旧名.json', text: '{"name":"角色名"}' }, { name: '角色名', description: '' })
    const scriptPath = await store.importText('script', { name: '故事.txt', text: '剧本正文' }, cardPath)
    const renamed = await store.rename(cardPath, '新文件名.json')
    assert.equal(renamed.path, 'cards/新文件名.json')
    assert.equal(renamed.scriptOldPath, scriptPath)
    assert.equal(renamed.scriptPath, 'scripts/新文件名/故事.txt')
    assert.equal((await store.readCard(renamed.path)).name, '角色名')
    assert.equal(await readFile(path.join(root, 'originals/cards/新文件名.json'), 'utf8'), '{"name":"旧名"}'.replace('旧名', '角色名'))
    assert.equal(await readFile(path.join(root, 'originals/scripts/新文件名/故事.txt'), 'utf8'), '剧本正文')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('明确更换剧本会同时替换工作版与原版', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-files-'))
  try {
    const store = createFileResourceStore({ dataRoot: root })
    const cardPath = await store.importCard({ name: '角色.json', text: '{"name":"角色"}' }, { name: '角色' })
    await store.importText('script', { name: '旧剧本.txt', text: '旧正文' }, cardPath)
    const next = await store.replaceScript(cardPath, { name: '新剧本.md', text: '新正文' })
    assert.equal(next, 'scripts/角色/新剧本.md')
    assert.equal(await store.readText(next), '新正文')
    assert.equal(await readFile(path.join(root, 'originals', next), 'utf8'), '新正文')
    await assert.rejects(readFile(path.join(root, 'resources/scripts/角色/旧剧本.txt')), /ENOENT/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
