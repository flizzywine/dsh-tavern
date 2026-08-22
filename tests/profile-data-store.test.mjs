import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
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
