import test from 'node:test'
import assert from 'node:assert/strict'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createScriptNavigation } from '../tavern-plugin/lib/domain/script-navigation.js'

function fixture() {
  const scripts = createScriptContinuity()
  const script = { title: '长剧本', importedAt: 1, chunks: Array.from({ length: 1000 }, (_, order) => ({ id: 'c' + order, order, text: '正文' + order })) }
  let chat = { id: 'chat', mode: 'script', cardPath: 'card', _storageRevision: 1, scriptState: scripts.start(script, 49), messages: ['保留正文'], variables: { hp: 2 }, candidates: { choices: ['保留候选'] } }
  let busy = false, beforeUpdate = () => {}
  const service = createScriptNavigation({ scripts, readScript: async () => script,
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { beforeUpdate(); const draft = fn(structuredClone(chat)); draft._storageRevision++; chat = draft; return structuredClone(chat) } },
    isBusy: () => busy, exclusive: async (_id, work) => work() })
  return { scripts, script, service, get chat() { return chat }, set busy(v) { busy = v }, set beforeUpdate(fn) { beforeUpdate = fn } }
}
test('7-block windows center on cursor or requested block without changing progress', async () => {
  const h = fixture()
  for (const [position, from, to] of [[undefined,47,53],[5,2,8],[1,1,7],[998,994,1000]]) {
    const page = await h.service.browse('session', position)
    assert.equal(page.from, from); assert.equal(page.to, to); assert.equal(page.chunks.length, 7)
  }
  assert.equal(h.chat.scriptState.cursor, 49)
  await assert.rejects(h.service.browse('session', 1001), /有效/)
  await assert.rejects(h.service.browse('session', 1.2), /有效/)
})

test('save rechecks busy and revision inside atomic mutation; stale pages cannot overwrite newer state', async () => {
  const h = fixture(), page = await h.service.browse('session')
  h.beforeUpdate = () => { h.busy = true }
  await assert.rejects(h.service.point('session', { ...page, position: 3 }), /等待/)
  h.beforeUpdate = () => {}; h.busy = false
  await h.service.point('session', { ...page, position: 3 })
  await assert.rejects(h.service.point('session', { ...page, position: 2 }), /已变化/)
  assert.equal(h.chat.scriptState.cursor, 2)
})

test('chunk budget uses the same exclusive, stale-page and busy guards as cursor changes', async () => {
  const h = fixture(), page = await h.service.browse('session'), before = structuredClone(h.chat)
  h.busy = true
  await assert.rejects(h.service.setChunkSize('session', { ...page, chunkSize: 1000 }), /等待/)
  h.busy = false
  await assert.rejects(h.service.setChunkSize('session', { ...page, chunkSize: 10001 }), /整数/)
  await h.service.setChunkSize('session', { ...page, chunkSize: 1000 })
  assert.equal(h.chat.scriptState.chunkSize, 1000)
  assert.equal(h.chat.scriptState.sourceOffset, before.scriptState.sourceOffset)
  for (const field of ['messages', 'variables', 'candidates']) assert.deepEqual(h.chat[field], before[field])
  assert.equal((await h.service.browse('session')).chunkSize, 1000)
  await assert.rejects(h.service.setChunkSize('session', { ...page, chunkSize: 300 }), /已变化/)
})
