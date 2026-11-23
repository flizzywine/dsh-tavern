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

test('展示名与分组和星标一起保存，保留人物名称并可清除', async t => {
  const { library, store } = await fixture(t)
  await store.writeJson('card-organization.json', { version: 1, groups: ['常玩'], cards: { a: { starred: true, group: '常玩' } } })
  await library.update({ action: 'cards', paths: ['a'], displayName: '  自定名称  ' }, paths)
  await library.update({ action: 'cards', paths: ['a'], starred: false }, paths)
  const reopened = createCardOrganization(store)
  assert.deepEqual((await reopened.project(cards))[0], { path: 'a', name: 'a', starred: false, group: '常玩', displayName: '自定名称' })
  await assert.rejects(library.update({ action: 'cards', paths: ['a'], displayName: 'a'.repeat(121) }, paths), /展示名最多/)
  await library.movePath('a', 'renamed')
  assert.equal((await library.read()).cards.renamed.displayName, '自定名称')
  await library.update({ action: 'cards', paths: ['renamed'], displayName: '' }, ['renamed'])
  assert.deepEqual((await library.read()).cards.renamed, { starred: false, group: '常玩' })
})
