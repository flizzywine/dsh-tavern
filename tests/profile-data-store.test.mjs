import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
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
