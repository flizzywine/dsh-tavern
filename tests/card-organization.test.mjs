import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCardOrganization } from '../tavern-plugin/lib/domain/card-organization.js'
import { lastPlayedByCard } from '../tavern-plugin/lib/domain/card-list-order.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-organization-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  return { store, library: createCardOrganization(store) }
}
const cards = ['a', 'b', 'c', 'd'].map(path => ({ path, name: path }))
const paths = cards.map(card => card.path)

test('一张卡可以有多个标签；改名、删除标签同步到每张卡，删除只去掉标签', async t => {
  const { library } = await fixture(t)
  await library.update({ action: 'create', name: '同人' }, paths)
  await library.update({ action: 'create', name: '待玩' }, paths)
  await library.update({ action: 'cards', paths: ['a', 'b'], tags: ['同人', '待玩'], starred: true }, paths)
  await library.update({ action: 'rename', tag: '同人', name: '二创' }, paths)
  assert.deepEqual((await library.project(cards))[0].tags, ['二创', '待玩'])
  await library.update({ action: 'delete', tag: '二创' }, paths)
  const result = await library.project(cards)
  assert.equal(result.length, 4)
  assert.equal(result[0].starred, true)
  assert.deepEqual(result[0].tags, ['待玩'])
  assert.deepEqual((await library.read()).tags, ['待玩'])
})

test('批量加、去标签只动列出的标签；不存在的标签和重名被拒绝', async t => {
  const { library } = await fixture(t)
  for (const name of ['甲', '乙', '丙']) await library.update({ action: 'create', name }, paths)
  await library.update({ action: 'cards', paths: ['a'], tags: ['甲'] }, paths)
  await library.update({ action: 'cards', paths: ['a', 'b'], addTags: ['乙', '丙'] }, paths)
  await library.update({ action: 'cards', paths: ['a', 'b'], removeTags: ['丙'] }, paths)
  const [a, b] = await library.project(cards)
  assert.deepEqual(a.tags, ['甲', '乙'])
  assert.deepEqual(b.tags, ['乙'])
  await assert.rejects(library.update({ action: 'cards', paths: ['a'], addTags: ['没有'] }, paths), /标签不存在/)
  await assert.rejects(library.update({ action: 'create', name: '甲' }, paths), /已有同名标签/)
  await assert.rejects(library.update({ action: 'create', name: 'x'.repeat(41) }, paths), /1–40/)
})

test('旧版分组读成同名标签；写回时保留旧字段，只认分组的版本仍能看到第一个标签', async t => {
  const { library, store } = await fixture(t)
  await store.writeJson('card-organization.json', { version: 1, groups: ['常玩', '收着'], cards: { a: { starred: true, group: '常玩' }, b: { starred: false, group: '' } } })
  const projected = await library.project(cards)
  assert.deepEqual(projected.map(card => card.tags), [['常玩'], [], [], []])
  await library.update({ action: 'cards', paths: ['a'], addTags: ['收着'] }, paths)
  const file = await store.readJson('card-organization.json')
  assert.equal(file.version, 2)
  assert.deepEqual(file.groups, ['常玩', '收着'])
  assert.deepEqual(file.cards.a, { starred: true, tags: ['常玩', '收着'], group: '常玩' })
})

test('展示名与标签和星标一起保存，保留人物名称并可清除', async t => {
  const { library, store } = await fixture(t)
  await store.writeJson('card-organization.json', { version: 1, groups: ['常玩'], cards: { a: { starred: true, group: '常玩' } } })
  await library.update({ action: 'cards', paths: ['a'], displayName: '  自定名称  ' }, paths)
  await library.update({ action: 'cards', paths: ['a'], starred: false }, paths)
  const reopened = createCardOrganization(store)
  assert.deepEqual((await reopened.project(cards))[0], { path: 'a', name: 'a', starred: false, tags: ['常玩'], displayName: '自定名称' })
  await assert.rejects(library.update({ action: 'cards', paths: ['a'], displayName: 'a'.repeat(121) }, paths), /展示名最多/)
  await library.movePath('a', 'renamed')
  assert.equal((await library.read()).cards.renamed.displayName, '自定名称')
  await library.update({ action: 'cards', paths: ['renamed'], displayName: '' }, ['renamed'])
  assert.deepEqual((await library.read()).cards.renamed, { starred: false, tags: ['常玩'] })
})

test('最近游玩取每张卡游戏里最新的一次，卡片工作台对话不算', () => {
  const latest = lastPlayedByCard([
    { cardPath: 'a', updatedAt: 10 }, { cardPath: 'a', updatedAt: 30 }, { cardPath: 'a', mode: 'card', updatedAt: 99 },
    { cardPath: 'b', updatedAt: 5 }, { updatedAt: 50 }
  ])
  assert.deepEqual([...latest], [['a', 30], ['b', 5]])
})
