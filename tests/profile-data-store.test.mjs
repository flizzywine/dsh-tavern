import assert from 'node:assert/strict'
import { mkdtemp, rm } from "node:fs/promises"
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

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
