import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { createCardStorage } from '../tavern-plugin/lib/card-storage.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { cardAssetWorkspaceRevision } from '../tavern-plugin/lib/card-asset-bindings.js'

test('readers share one frozen card per file version; a write is read again', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-storage-')), profileData = createProfileDataStore({dataRoot:root})
  t.after(() => rm(root, {recursive:true, force:true}))
  let reads = 0
  const counted = {...profileData, readJson:relative => { reads++; return profileData.readJson(relative) }}
  const storage = createCardStorage({dataRoot:root, profileData:counted})
  await profileData.writeJson('resources/cards/a.json', {meta:{id:'card-a'}, raw:{data:{name:'甲'}}})
  const [first, again] = await Promise.all([storage.readWorkspace('cards/a.json'), storage.readWorkspace('cards/a.json')])
  assert.equal(first, again)
  assert.equal(await storage.readWorkspace('cards/a.json'), first)
  assert.equal(reads, 1)
  assert.ok(Object.isFrozen(first.raw.data))
  assert.equal(cardAssetWorkspaceRevision(first), cardAssetWorkspaceRevision(structuredClone(first)))
  await profileData.writeJson('resources/cards/a.json', {meta:{id:'card-a'}, raw:{data:{name:'乙'}}})
  const written = await storage.readWorkspace('cards/a.json')
  assert.equal(written.raw.data.name, '乙')
  assert.notEqual(cardAssetWorkspaceRevision(written), cardAssetWorkspaceRevision(first))
  assert.equal(reads, 2)
  assert.equal(await storage.readWorkspace('cards/missing.json'), undefined)
})
