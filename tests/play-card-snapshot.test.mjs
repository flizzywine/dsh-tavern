import assert from 'node:assert/strict'
import test from 'node:test'

import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createPlayCardSnapshots, cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'

function fixture() {
  let reads = 0, writes = 0, builds = 0
  let plan = async () => ({ text: '固定背景' })
  let write = async () => {}
  const api = createPlayCardSnapshots({
    worldBooks: { bound: async () => null },
    planner: { async plan(input) { builds++; return plan(input) } },
    readCard: async () => { reads++; return { name: '测试' } },
    writeChat: async (...args) => { writes++; return write(...args) }, logger: { warn() {} }
  })
  return { api, get counts() { return { reads, writes, builds } }, plan(fn) { plan = fn }, write(fn) { write = fn } }
}
const oldChat = () => ({ id: 'chat', mode: 'story', messages: [{ text: '既有剧情' }], cardContextSnapshot: '旧前缀', cardContextSnapshotVersion: 5, _storageRevision: 7 })

test('concurrent readers share one migration and all receive its fields without borrowing another storage revision', async () => {
  const h = fixture(), first = oldChat(), second = oldChat()
  let finish
  h.plan(() => new Promise(resolve => { finish = resolve }))
  h.write(async draft => { draft._storageRevision = 8 })
  const one = h.api.ensure(first), two = h.api.ensure(second)
  await new Promise(resolve => setImmediate(resolve))
  finish({ text: '统一前缀' })
  assert.deepEqual(await Promise.all([one, two]), ['统一前缀', '统一前缀'])
  assert.equal(first.cardContextSnapshotVersion, 7)
  assert.equal(second.cardContextSnapshotVersion, 7)
  assert.equal(first._storageRevision, 8)
  assert.equal(second._storageRevision, 7)
  assert.deepEqual(h.counts, { reads: 1, writes: 1, builds: 1 })
})

test('failed save leaves caller state intact, releases concurrent build and permits retry', async () => {
  const h = fixture(), chat = oldChat(), before = structuredClone(chat)
  h.write(async () => { throw Error('disk full') })
  await assert.rejects(h.api.ensure(chat), /disk full/)
  assert.deepEqual(chat, before)
  h.write(async () => {})
  assert.equal(await h.api.ensure(chat), '固定背景')
  assert.equal(chat.cardContextSnapshotVersion, 7)
  assert.equal(h.counts.writes, 2)
})

test('游玩中切换画像仅修改固定前缀，保留 200 轮历史、变量与原卡背景', async () => {
  const { Session } = await import('./fixtures/dsh-session-host.mjs')
  const { ensureSessionStablePrefix, sessionStablePrefixSections } = await import('../tavern-plugin/lib/domain/session-stable-prefix.js')
  let preference = { revision: 3, text: '【用户已确认的长期偏好】\n温和叙事' }
  const snapshots = createPlayCardSnapshots({ userPreferenceProfile: { stableContext: async () => preference },
    planner: { plan: () => { throw new Error('切换画像不得重建人物卡背景') } },
    writeChat: () => { throw new Error('补丁不能直接写存档') } })
  let chat = { id: 'profile-toggle', mode: 'story', cardContextSnapshotVersion: 7, cardContextSnapshot: '【故事设定 · 人物卡】\n原卡背景\n\n【常驻世界书】\n原世界书', cardContentDigest: 'old-card',
    userProfileEnabled: false, messages: Array.from({ length: 200 }, (_, turn) => ({ turn, text: '历史' })), variables: { hp: 12 }, mvu: { enabled: true }, runtimePresetSnapshot: { id: 'preset' } }
  const original = structuredClone(chat)
  const session = Session.create('profile-toggle')
  await ensureSessionStablePrefix(session, chat.cardContextSnapshot, undefined, 0)
  const enabled = await snapshots.preferenceReplacement(chat, true)
  assert.deepEqual(chat, original)
  chat = { ...chat, ...enabled }
  await ensureSessionStablePrefix(session, chat.cardContextSnapshot, undefined, chat.cardContextRevision)
  assert.match(sessionStablePrefixSections(session).map(s => s.text).join('\n'), /温和叙事/)
  assert.equal(chat.userProfileRevision, 3)
  assert.equal(chat.cardContextRevision, 1)
  assert.equal(chat.cardContentDigest, 'old-card')
  assert.deepEqual(await snapshots.preferenceReplacement(chat, true), {}, '重复开启不破坏缓存')
  preference = { revision: 4, text: '【用户已确认的长期偏好】\n新的偏好' }
  const disabled = await snapshots.preferenceReplacement(chat, false)
  chat = { ...chat, ...disabled }
  await ensureSessionStablePrefix(session, chat.cardContextSnapshot, undefined, chat.cardContextRevision)
  assert.equal(chat.cardContextSnapshot, original.cardContextSnapshot)
  assert.doesNotMatch(sessionStablePrefixSections(session).map(s => s.text).join('\n'), /温和叙事|新的偏好/)
  assert.equal(chat.userProfileRevision, 0)
  chat = { ...chat, ...await snapshots.preferenceReplacement(chat, true) }
  assert.equal(chat.userProfileRevision, 4)
  assert.equal(chat.cardContextRevision, 3)
  for (const field of ['messages', 'variables', 'mvu', 'runtimePresetSnapshot']) assert.deepEqual(chat[field], original[field])
})

test('显式应用新版同步刷新常驻背景、MVU 规则和模板世界书，普通读取仍固定', async () => {
  const { createWorldBookLibrary } = await import('../tavern-plugin/lib/domain/worldbook-library.js')
  const { mvuUpdateRulesFromWorldBook } = await import('../tavern-plugin/lib/domain/worldbook-recall.js')
  const card = { name: '测试', character_book: { entries: [
    { id: 0, comment: '背景', content: '新版背景', constant: true, enabled: true, keys: [] },
    { id: 1, comment: '[mvu_update]变量更新规则', content: '人际关系.人际网络', constant: true, enabled: true, keys: [] }
  ] } }
  let binding = { kind: 'default' }
  const worldBooks = createWorldBookLibrary({ normalizePath: p => p, removeStandalone: async () => {},
    cards: { read: async () => card }, resources: { bindingForCard: async () => binding, readText: async () => JSON.stringify({entries:{0:{uid:0,comment:"独立世界书",content:"独立新版",constant:true,disable:false,key:[]}}}) } })
  const old = structuredClone(card.character_book)
  old.entries[0].content = '旧版背景'
  old.entries[1].content = '人际网络'
  const chat = { id: 'test', mode: 'story', cardPath: 'cards/test.json', cardContextSnapshotVersion: 7,
    cardContextSnapshot: '旧版背景', messages: [{role:'assistant',text:'历史'}], variables: {hp:12},
    openingWorldbookSnapshot: {version:1,source:{kind:'card',cardPath:'cards/test.json',cardName:card.name},document:old} }
  chat.cardContentDigest = cardContentDigest(card)
  const before = structuredClone(chat)
  const api = createPlayCardSnapshots({worldBooks, planner:createContextPlanner({prompt:()=>''}), writeChat:async()=>{throw Error('must not save')}, readCard:async()=>card})
  assert.equal(await api.ensure(chat,card),'旧版背景')
  const status = await api.updateStatus(chat, card)
  assert.equal(status.available, true)
  assert.equal(status.worldbookSyncRequired, true, '旧存档缺少原始版本时提示同步')
  const patch = await api.replacement(chat,card,status.digest)
  assert.deepEqual(chat,before)
  assert.match(patch.cardContextSnapshot,/新版背景/)
  const updated = {...chat,...patch}
  assert.match(mvuUpdateRulesFromWorldBook(await worldBooks.bound(chat.cardPath,card,updated)).join('\n'),/人际关系\.人际网络/)
  assert.match(JSON.stringify(await worldBooks.templateSnapshot(chat.cardPath,card,updated)),/人际关系\.人际网络/)
  assert.equal(patch.messages,undefined)
  assert.equal(patch.variables,undefined)
  binding = {kind:'standalone',path:'worldbooks/current.json',available:true}
  const rebound = await api.replacement(chat,card)
  assert.equal(rebound.openingWorldbookSnapshot.source.path,'worldbooks/current.json')
  assert.match(rebound.cardContextSnapshot,/独立新版/)
  binding = {kind:'standalone',path:'worldbooks/missing.json',available:false}
  await assert.rejects(api.replacement(chat,card),/世界书不存在/)
  assert.deepEqual(chat,before,'读取失败不应用部分更新')
  binding = {kind:'none'}
  const removed = await api.replacement(chat,card)
  assert.equal(removed.openingWorldbookSnapshot.document,null)
  assert.equal(await worldBooks.bound(chat.cardPath,card,{...chat,...removed}),null)
})

test('settled() answers from the header exactly when ensure() would not build or write', async () => {
  const h = fixture()
  const current = { id: 'chat', mode: 'story', cardContextSnapshot: '固定背景', cardContextSnapshotVersion: 7 }
  assert.equal(h.api.settled(current), '固定背景')
  assert.equal(await h.api.ensure({ ...current, messages: [] }), '固定背景')
  assert.deepEqual(h.counts, { reads: 0, writes: 0, builds: 0 })
  assert.equal(h.api.settled({ ...current, cardContextSnapshotVersion: 5 }), undefined)
  assert.equal(h.api.settled({ ...current, cardContextSnapshot: '' }), undefined)
  assert.equal(h.api.settled({ id: 'x', mode: 'card-extract' }), '')
})
