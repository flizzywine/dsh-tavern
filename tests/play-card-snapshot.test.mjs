import assert from 'node:assert/strict'
import test from 'node:test'

import { createPlayCardSnapshots, cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'
import { createPlayCardUpdate } from '../tavern-plugin/lib/domain/card-auto-reload.js'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'

const oldChat = () => ({ id: 'chat', mode: 'story', messages: [{ text: '既有剧情' }], cardContextSnapshot: '旧前缀', cardContextSnapshotVersion: 5, _storageRevision: 7 })

test('没有本局副本的游戏也能显式重载人物卡，且不新建世界书副本 (#318)', async () => {
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

test('卡片脚本仅写内嵌世界书时同步新条目和常驻前缀，保留当前脚本生命周期', async () => {
  const entry = (id, content, constant) => ({ id, comment: '测试条目 ' + id, content, constant, enabled: true, keys: [] })
  let card = { name: '内嵌', character_book: { entries: [entry(0, '开局摘要', true), entry(1, '旧线索', false)] } }
  let saved = { id: 'chat', sessionId: 'session', mode: 'story', cardPath: 'cards/follow.json', messages: [],
    tavernHelperLifecycleRevision: 4, preparedWorldBook: { cached: true }, variables: { hp: 5 } }
  const writes = [], jobs = []
  const worldBooks = createWorldBookLibrary({ normalizePath: p => p, removeStandalone: async () => {},
    cards: { read: async () => card }, resources: { bindingForCard: async () => ({ kind: 'default' }) } })
  const snapshots = createPlayCardSnapshots({ worldBooks, planner: { plan: async ({ worldBookContext }) => ({ text: worldBookContext }) },
    readCard: async chat => chat.cardDefinitionSnapshot, readLatestCard: async () => card,
    updateChat: async (_id, mutate, metadata) => {
      const next = mutate(saved)
      if (next) { saved = next; writes.push(metadata.source) }
      return saved
    } })
  await snapshots.prepare(saved, card)
  const updates = createPlayCardUpdate({ snapshots: () => snapshots, native: { agent: () => null }, defer: job => jobs.push(job) })

  // The library write is visible before the script can update the game's snapshot.
  card = { ...card, character_book: { entries: [entry(0, '新的自动摘要', true), entry(1, '旧线索', false)] } }
  assert.equal((await updates.status(structuredClone(saved), { busy: true })).available, false)
  assert.equal(writes.length, 0)
  assert.equal((await updates.status(structuredClone(saved))).available, false)
  assert.match(saved.cardContextSnapshot, /新的自动摘要/)
  assert.equal(saved.preparedWorldBook, null)
  assert.deepEqual(saved.cardDefinitionSnapshot.character_book, card.character_book)

  const prefixRevision = saved.cardContextRevision
  card = { ...card, character_book: { entries: [entry(0, '新的自动摘要', true), entry(1, '新线索', false)] } }
  await snapshots.autoSync(structuredClone(saved))
  assert.equal(saved.cardContextRevision, prefixRevision)
  assert.deepEqual(saved.cardDefinitionSnapshot.character_book, card.character_book)
  assert.equal(saved.cardContentDigest, cardContentDigest(card))
  assert.deepEqual(writes, ['card-context.constants', 'card-context.embedded-worldbook'])
  assert.deepEqual(saved.variables, { hp: 5 })
  assert.equal(saved.tavernHelperLifecycleRevision, 4)
  assert.equal(jobs.length, 0)

  card = { ...card, description: '修改人物设定' }
  assert.equal((await updates.status(structuredClone(saved))).autoReloading, true)
  assert.equal(jobs.length, 1)
})
