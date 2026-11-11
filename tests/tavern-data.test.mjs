import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { migrateLegacyTavernData } from '../tavern-plugin/lib/domain/tavern-data.js'

async function json(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

test('旧数据升级时备份并合并索引，冲突文件保留但不覆盖主数据', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-tavern-data-'))
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const oldData = path.join(root, 'old', 'data')
  const newerData = path.join(root, 'newer', 'data')
  const targetRoot = path.join(root, 'home', 'profile-data', 'tavern', 'data')
  const backupRoot = path.join(root, 'backups')

  await json(path.join(oldData, 'index.json'), { schemaVersion: 2, chats: [{ id: 'chat-old', updatedAt: 1 }] })
  await json(path.join(oldData, 'sessions.json'), { 'session-old': 'chat-old' })
  await json(path.join(oldData, '.material-bindings.json'), { 'cards/旧卡.json': 'materials/旧资料.md' })
  await json(path.join(oldData, 'chats/chat-old.json'), { id: 'chat-old' })
  await writeFile(path.join(oldData, 'shared.txt'), '主数据', 'utf8')

  await json(path.join(newerData, 'index.json'), { schemaVersion: 3, chats: [{ id: 'chat-new', updatedAt: 2 }] })
  await json(path.join(newerData, 'sessions.json'), { 'session-new': 'chat-new' })
  await json(path.join(newerData, '.material-bindings.json'), { 'cards/新卡.json': 'materials/新资料.md' })
  await json(path.join(newerData, 'chats/chat-new.json'), { id: 'chat-new' })
  await writeFile(path.join(newerData, 'shared.txt'), '冲突数据', 'utf8')

  await json(path.join(targetRoot,'sessions.json'),{})
  const first = await migrateLegacyTavernData({
    targetRoot,
    backupRoot,
    legacyRoots: [{ path: oldData, label: 'old' }, { path: newerData, label: 'newer' }],
    now: () => 123,
  })

  assert.equal(first.migratedSources, 2)
  assert.equal(first.conflicts, 1)
  assert.equal(await readFile(path.join(targetRoot, 'shared.txt'), 'utf8'), '主数据')
  assert.equal(await readFile(path.join(targetRoot, 'migration-conflicts/newer/shared.txt'), 'utf8'), '冲突数据')
  const index = JSON.parse(await readFile(path.join(targetRoot, 'index.json'), 'utf8'))
  assert.equal(index.schemaVersion, 3)
  assert.deepEqual(index.chats.map((item) => item.id), ['chat-old', 'chat-new'])
  assert.deepEqual(JSON.parse(await readFile(path.join(targetRoot, 'sessions.json'), 'utf8')), {
    'session-old': 'chat-old',
    'session-new': 'chat-new',
  })
  assert.deepEqual(JSON.parse(await readFile(path.join(targetRoot, '.material-bindings.json'), 'utf8')), {
    'cards/旧卡.json': 'materials/旧资料.md',
    'cards/新卡.json': 'materials/新资料.md',
  })
  assert.equal(JSON.parse(await readFile(path.join(targetRoot, '.legacy-data-migration-v1.json'), 'utf8')).sources.length, 2)
  assert.equal(first.sources[0].backup,first.sources[1].backup)
  await assert.rejects(readFile(path.join(backupRoot, '123-legacy-data/data/shared.txt')), {code:'ENOENT'})
  assert.deepEqual(JSON.parse(await readFile(path.join(backupRoot, '123-legacy-data/data/sessions.json'),'utf8')), {})

  const second = await migrateLegacyTavernData({
    targetRoot,
    backupRoot,
    legacyRoots: [{ path: oldData, label: 'old' }, { path: newerData, label: 'newer' }],
    now: () => 456,
  })
  assert.equal(second.migratedSources, 0)
  assert.equal(second.conflicts, 0)
})

test('升级迁移保留旧自定义系统提示词，已有用户修改优先，重复升级不重置', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-prompt-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = path.join(root, 'legacy')
  const targetRoot = path.join(root, 'current')
  const { SYSTEM_PROMPT_NAMES } = await import('../tavern-plugin/lib/prompt-catalog.js')
  const { presentTavernSettings, resolveSystemPrompt } = await import('../tavern-plugin/lib/domain/tavern-settings.js')
  const overrides = Object.fromEntries(SYSTEM_PROMPT_NAMES.map(name => [name, '用户内容：' + name]))
  await json(path.join(legacy, 'tavern-settings.json'), { promptOverrides: overrides, systemAppendEnabled: true })
  await json(path.join(targetRoot, 'tavern-settings.json'), { promptOverrides: { story: '新目录用户修改' }, systemAppendEnabled: false })
  const options = { targetRoot, backupRoot: path.join(root, 'backups'), legacyRoots: [{ path: legacy, label: 'old' }] }
  await migrateLegacyTavernData(options)
  await migrateLegacyTavernData(options)
  const saved = JSON.parse(await readFile(path.join(targetRoot, 'tavern-settings.json'), 'utf8'))
  assert.deepEqual(saved.promptOverrides, { ...overrides, story: '新目录用户修改' })
  assert.equal(saved.systemAppendEnabled, false)
  const defaults = Object.fromEntries(SYSTEM_PROMPT_NAMES.map(name => [name, '新版默认']))
  for (const item of presentTavernSettings(saved, defaults).systemPrompts) {
    assert.equal(item.customized, true)
    assert.equal(item.text, saved.promptOverrides[item.name])
    assert.equal(resolveSystemPrompt(saved, item.name, () => '新版默认'), item.text)
  }
})
