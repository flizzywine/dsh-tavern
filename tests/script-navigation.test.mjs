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

test('save rechecks busy and revision inside atomic mutation; stale pages cannot overwrite newer state', async () => {
  const h = fixture(), page = await h.service.browse('session')
  h.beforeUpdate = () => { h.busy = true }
  await assert.rejects(h.service.point('session', { ...page, position: 3 }), /等待/)
  h.beforeUpdate = () => {}; h.busy = false
  await h.service.point('session', { ...page, position: 3 })
  await assert.rejects(h.service.point('session', { ...page, position: 2 }), /已变化/)
  assert.equal(h.chat.scriptState.cursor, 2)
})
