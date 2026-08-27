import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

test('Profile 数据存储可在工作区外原子读写并删除 JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const store = createProfileDataStore({ dataRoot: root })
    assert.equal(await store.readJson('chats/chat-1.json'), undefined)

    await store.writeJson('chats/chat-1.json', { id: 'chat-1', turns: [] })
    assert.deepEqual(await store.readJson('chats/chat-1.json'), { id: 'chat-1', turns: [] })
    assert.equal(await readFile(path.join(root, 'chats/chat-1.json'), 'utf8'), '{\n  "id": "chat-1",\n  "turns": []\n}\n')

    await store.writeJson('chats/chat-1.json', { id: 'chat-1', turns: ['updated'] })
    assert.deepEqual(await store.readJson('chats/chat-1.json'), { id: 'chat-1', turns: ['updated'] })

    await store.remove('chats/chat-1.json')
    await assert.rejects(() => access(path.join(root, 'chats/chat-1.json')), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Profile 数据存储用文件版本判断内容是否需要重新读取', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const store = createProfileDataStore({ dataRoot: root })
    assert.equal(await store.version('chats/chat-1.json'), '')

    await store.writeJson('chats/chat-1.json', { id: 'chat-1', turns: [] })
    const first = await store.version('chats/chat-1.json')
    assert.notEqual(first, '')
    assert.equal(await store.version('chats/chat-1.json'), first)

    await store.writeJson('chats/chat-1.json', { id: 'chat-1', turns: ['updated'] })
    assert.notEqual(await store.version('chats/chat-1.json'), first)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Profile 数据存储拒绝绝对路径和目录逃逸', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const store = createProfileDataStore({ dataRoot: root })
    await assert.rejects(() => store.writeJson('../outside.json', {}), /路径不合法/)
    await assert.rejects(() => store.readJson('/tmp/outside.json'), /路径不合法/)
    await assert.rejects(() => store.remove('chats/../../outside.json'), /路径不合法/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows 临时占用目标文件时重试原子替换', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  let renameCalls = 0
  try {
    const store = createProfileDataStore({
      dataRoot: root,
      rename: async (source, target) => {
        renameCalls += 1
        if (renameCalls === 1) {
          const error = new Error('目标文件暂时被占用')
          error.code = 'EPERM'
          throw error
        }
        await rename(source, target)
      },
      sleep: async () => {}
    })

    await store.writeJson('sessions.json', { session: 'chat-1' })

    assert.equal(renameCalls, 2)
    assert.deepEqual(await store.readJson('sessions.json'), { session: 'chat-1' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows 较长时间占用大型聊天文件时持续重试原子替换', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  let renameCalls = 0
  try {
    const store = createProfileDataStore({
      dataRoot: root,
      platform: 'win32',
      rename: async (source, target) => {
        renameCalls += 1
        if (renameCalls <= 6) {
          const error = new Error('目标文件被 Windows 扫描程序占用')
          error.code = 'EPERM'
          throw error
        }
        await rename(source, target)
      },
      sleep: async () => {}
    })

    await store.writeJson('chats/chat-large.json', { text: 'x'.repeat(3 * 1024 * 1024) })

    assert.equal(renameCalls, 7)
    assert.equal((await store.readJson('chats/chat-large.json')).text.length, 3 * 1024 * 1024)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows 持续占用聊天文件时把新版本保存为可读取的 pending snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const initialStore = createProfileDataStore({ dataRoot: root })
    await initialStore.writeJson('chats/chat-locked.json', { text: '旧内容' })
    const store = createProfileDataStore({
      dataRoot: root,
      platform: 'win32',
      rename: async () => {
        const error = new Error('目标文件持续被占用')
        error.code = 'EPERM'
        throw error
      },
      sleep: async () => {}
    })

    await store.writeJson('chats/chat-locked.json', { text: '本轮新内容' })

    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'chats/chat-locked.json'), 'utf8')), { text: '旧内容' })
    assert.deepEqual(await initialStore.readJson('chats/chat-locked.json'), { text: '本轮新内容' })
    const files = await readdir(path.join(root, 'chats'))
    const recovery = files.find((name) => name.startsWith('chat-locked.json.pending-1-'))
    assert.ok(recovery)
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'chats', recovery), 'utf8')), { text: '本轮新内容' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('重新创建 Store 后仍读取 pending，并让 updateJson 基于最新快照更新', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const initial = createProfileDataStore({ dataRoot: root })
    await initial.writeJson('chats/chat-restart.json', { count: 1, source: 'canonical' })
    const locked = createProfileDataStore({
      dataRoot: root,
      platform: 'win32',
      rename: async () => {
        const error = new Error('目标文件持续被占用')
        error.code = 'EPERM'
        throw error
      },
      sleep: async () => {}
    })
    await locked.writeJson('chats/chat-restart.json', { count: 2, source: 'pending' })

    const restarted = createProfileDataStore({
      dataRoot: root,
      platform: 'win32',
      rename: async () => {
        const error = new Error('目标文件持续被占用')
        error.code = 'EPERM'
        throw error
      },
      sleep: async () => {}
    })
    assert.deepEqual(await restarted.readJson('chats/chat-restart.json'), { count: 2, source: 'pending' })
    await restarted.updateJson('chats/chat-restart.json', (value) => Object.assign({}, value, { count: value.count + 1 }))
    assert.deepEqual(await restarted.readJson('chats/chat-restart.json'), { count: 3, source: 'pending' })
    assert.match(await restarted.version('chats/chat-restart.json'), /^pending:2:/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('后续原子替换成功后提升最新 pending 并清理旧快照', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  let locked = true
  try {
    const store = createProfileDataStore({
      dataRoot: root,
      platform: 'win32',
      rename: async (source, target) => {
        if (locked) {
          const error = new Error('目标文件持续被占用')
          error.code = 'EPERM'
          throw error
        }
        await rename(source, target)
      },
      sleep: async () => {}
    })
    await store.writeJson('chats/chat-recover.json', { count: 1 })
    await store.writeJson('chats/chat-recover.json', { count: 2 })
    assert.equal((await readdir(path.join(root, 'chats'))).filter((name) => name.includes('.pending-')).length, 2)

    locked = false
    await store.writeJson('chats/chat-recover.json', { count: 3 })

    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'chats/chat-recover.json'), 'utf8')), { count: 3 })
    assert.equal((await readdir(path.join(root, 'chats'))).filter((name) => name.includes('.pending-')).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('同 revision 的分叉 pending 不会按文件时间静默覆盖', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const directory = path.join(root, 'chats')
    await createProfileDataStore({ dataRoot: root }).writeJson('chats/chat-conflict.json', { count: 0 })
    await Promise.all([
      writeFile(path.join(directory, 'chat-conflict.json.pending-1-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'), '{"count":1}\n'),
      writeFile(path.join(directory, 'chat-conflict.json.pending-1-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'), '{"count":2}\n')
    ])
    const store = createProfileDataStore({ dataRoot: root })
    await assert.rejects(() => store.readJson('chats/chat-conflict.json'), function (error) {
      return error && error.code === 'DSH_TAVERN_PENDING_CONFLICT'
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('两个 Store 同时写同一目标时明确拒绝第二个写者', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  let releaseRename
  let markRenameStarted
  const renameStarted = new Promise((resolve) => { markRenameStarted = resolve })
  const renameGate = new Promise((resolve) => { releaseRename = resolve })
  try {
    const firstStore = createProfileDataStore({
      dataRoot: root,
      rename: async (source, target) => {
        markRenameStarted()
        await renameGate
        await rename(source, target)
      }
    })
    const secondStore = createProfileDataStore({ dataRoot: root })
    const firstWrite = firstStore.writeJson('chats/chat-multi-writer.json', { writer: 1 })
    await renameStarted

    await assert.rejects(
      () => secondStore.writeJson('chats/chat-multi-writer.json', { writer: 2 }),
      function (error) { return error && error.code === 'DSH_TAVERN_WRITE_CONFLICT' }
    )
    releaseRename()
    await firstWrite
    assert.deepEqual(await secondStore.readJson('chats/chat-multi-writer.json'), { writer: 1 })
  } finally {
    releaseRename?.()
    await rm(root, { recursive: true, force: true })
  }
})

test('持锁进程已退出时自动回收遗留写锁', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const directory = path.join(root, 'chats')
    await createProfileDataStore({ dataRoot: root }).writeJson('chats/chat-stale-lock.json', { count: 1 })
    await writeFile(path.join(directory, 'chat-stale-lock.json.write-lock'), '{"pid":99999999,"createdAt":1}\n')

    const store = createProfileDataStore({ dataRoot: root })
    await store.writeJson('chats/chat-stale-lock.json', { count: 2 })
    assert.deepEqual(await store.readJson('chats/chat-stale-lock.json'), { count: 2 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('remove 同时删除 canonical 与 pending snapshots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const initial = createProfileDataStore({ dataRoot: root })
    await initial.writeJson('chats/chat-remove.json', { count: 1 })
    const locked = createProfileDataStore({
      dataRoot: root,
      platform: 'win32',
      rename: async () => {
        const error = new Error('目标文件持续被占用')
        error.code = 'EPERM'
        throw error
      },
      sleep: async () => {}
    })
    await locked.writeJson('chats/chat-remove.json', { count: 2 })
    await locked.remove('chats/chat-remove.json')
    assert.equal(await locked.readJson('chats/chat-remove.json'), undefined)
    assert.deepEqual(await readdir(path.join(root, 'chats')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('并发更新同一个 JSON 文件时不会互相覆盖', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-profile-data-'))
  try {
    const store = createProfileDataStore({ dataRoot: root })
    await store.writeJson('sessions.json', { count: 0 })

    await Promise.all([
      store.updateJson('sessions.json', async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { count: value.count + 1 }
      }),
      store.updateJson('sessions.json', (value) => ({ count: value.count + 1 }))
    ])

    assert.deepEqual(await store.readJson('sessions.json'), { count: 2 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
