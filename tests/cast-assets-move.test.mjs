import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

test('人物素材迁移在写入中断后可重试，头像、别名、立绘保留', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cast-move-'))
  try {
    const store = createProfileDataStore({ dataRoot: root })
    let fail = false
    const assets = createCastAssets({ store: { ...store, async writeBytes(file, bytes) {
      if (fail) { fail = false; throw new Error('copy failed') }
      return store.writeBytes(file, bytes)
    } } })
    const from = 'cards/old.json', to = 'cards/new.json'
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    await assets.setImage({ cardPath: from, name: '甲', slot: 'avatar', bytes })
    await assets.setImage({ cardPath: from, name: '甲', slot: 'joy', bytes })
    await assets.setCharacter({ cardPath: from, name: '甲', aliases: ['小甲'] })
    const original = await assets.read(from)
    fail = true
    await assert.rejects(assets.movePath(from, to), /copy failed/)
    assert.deepEqual(await assets.read(from), original)
    assert.equal((await assets.read(to)).characters.length, 0)
    await assets.movePath(from, to)
    await assets.movePath(from, to)
    assert.deepEqual(await assets.read(to), original)
    assert.equal((await assets.read(from)).characters.length, 0)
    assert.deepEqual((await assets.readImage(assets.keyOf(to), original.characters[0].avatar)).bytes, bytes)
  } finally { await rm(root, { recursive: true, force: true }) }
})
