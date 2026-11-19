import assert from 'node:assert/strict'
import test from 'node:test'

import { createPlayCardSnapshots, cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'

const oldChat = () => ({ id: 'chat', mode: 'story', messages: [{ text: '既有剧情' }], cardContextSnapshot: '旧前缀', cardContextSnapshotVersion: 5, _storageRevision: 7 })

test('没有本局副本的游戏也能显式重载人物卡，且不新建世界书副本 (#318)', async () => {
  const { createWorldBookLibrary } = await import('../tavern-plugin/lib/domain/worldbook-library.js')
  const entry = (id, content, enabled = true) => ({ id, comment: content, content, constant: true, enabled, keys: [] })
  let card = { name: '内嵌', character_book: { entries: [entry(0, '旧条目'), entry(1, '保留条目')] } }
  const worldBooks = createWorldBookLibrary({ normalizePath: p => p, removeStandalone: async () => {},
    cards: { read: async () => card }, resources: { bindingForCard: async () => ({ kind: 'default' }) } })
  const api = createPlayCardSnapshots({ worldBooks, planner: { plan: async ({ worldBookContext }) => ({ text: worldBookContext }) },
    readCard: async () => card, writeChat: async () => { throw new Error('不能整份覆盖存档') } })
  const chat = { id: 'follow-card', mode: 'story', cardPath: 'cards/follow.json', messages: [{ role: 'assistant', text: '开场' }] }
  await api.prepare(chat, card)
  assert.equal(chat.openingWorldbookSnapshot, undefined)
  assert.match(chat.cardContextSnapshot, /旧条目/)
  assert.equal(api.libraryBoundStatus(chat, card).available, false, '卡没变不提示')

  card = { ...card, character_book: { entries: [entry(0, '旧条目', false), entry(1, '保留条目')] }, extensions: { regex_scripts: [{ id: 'new' }] } }
  const status = api.libraryBoundStatus(chat, card)
  assert.equal(status.cardChanged, true)
  assert.equal(status.available, true)
  assert.notEqual(status.digest, '', '重载按钮必须拿得到校验值')

  const before = structuredClone(chat)
  const patch = await api.replacement(chat, card, status.digest)
  assert.deepEqual(chat, before)
  assert.equal('openingWorldbookSnapshot' in patch, false, '不为跟随库的游戏新建副本')
  assert.doesNotMatch(patch.cardContextSnapshot, /旧条目/, '卡内嵌世界书关掉的条目离开前缀')
  assert.match(patch.cardContextSnapshot, /保留条目/)
  assert.deepEqual(patch.cardDefinitionSnapshot, card)
  assert.equal(patch.cardContentDigest, cardContentDigest(card))
  assert.equal(api.libraryBoundStatus({ ...chat, ...patch }, card).available, false, '应用后不再提示')

  const stale = status.digest
  card = { ...card, name: '再改' }
  await assert.rejects(api.replacement(chat, card, stale), /人物卡已再次修改/)
})
