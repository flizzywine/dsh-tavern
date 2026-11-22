import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCardOrganization } from '../tavern-plugin/lib/domain/card-organization.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-organization-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  return { store, library: createCardOrganization(store) }
}
const cards = ['a', 'b', 'c', 'd'].map(path => ({ path, name: path }))
const paths = cards.map(card => card.path)

test('重命名与删除分组同步卡片归属，删除分组保留星标与人物卡', async t => {
  const { library } = await fixture(t)
  await library.update({ action: 'create', name: '旧组' }, paths)
  await library.update({ action: 'cards', paths: ['a', 'b'], group: '旧组', starred: true }, paths)
  await library.update({ action: 'rename', group: '旧组', name: '新组' }, paths)
  assert.equal((await library.project(cards))[0].group, '新组')
  await library.update({ action: 'delete', group: '新组' }, paths)
  const result = await library.project(cards)
  assert.equal(result.length, 4)
  assert.equal(result[0].starred, true)
  assert.equal(result[0].group, '')
})
