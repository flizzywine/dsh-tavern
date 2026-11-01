import test from 'node:test'
import assert from 'node:assert/strict'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { createScriptNavigation } from '../tavern-plugin/lib/domain/script-navigation.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

function fixture() {
  const scripts = createScriptContinuity()
  const script = { title: '长剧本', importedAt: 1, chunks: Array.from({ length: 1000 }, (_, order) => ({ id: 'c' + order, order, text: '正文' + order })) }
  let chat = { id: 'chat', mode: 'script', cardPath: 'card', _storageRevision: 1, scriptState: scripts.start(script, 49), messages: ['保留正文'], variables: { hp: 2 }, candidates: { choices: ['保留候选'] } }
  let busy = false, beforeUpdate = () => {}, settings
  const service = createScriptNavigation({ scripts, readScript: async () => script,
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { beforeUpdate(); const draft = fn(structuredClone(chat)); draft._storageRevision++; chat = draft; return structuredClone(chat) } },
    isBusy: () => busy, exclusive: async (_id, work) => work(),
    updateSettings: async patch => { settings = applyTavernSettingsPatch(settings, patch) } })
  return { scripts, script, service, get chat() { return chat }, get settings() { return presentTavernSettings(settings, {}) }, set busy(v) { busy = v }, set beforeUpdate(fn) { beforeUpdate = fn } }
}

test('保存推进字数同时更新用户默认值，重新读取仍为 1200 且不移动已读位置', async () => {
  const h = fixture(), page = await h.service.browse('session')
  const offset = h.chat.scriptState.sourceOffset
  const saved = await h.service.setChunkSize('session', { ...page, chunkSize: 1200 })
  assert.equal(saved.chunkSize, 1200)
  assert.equal(h.settings.scriptChunkSize, 1200)
  assert.equal((await h.service.browse('session')).chunkSize, 1200)
  assert.equal(h.chat.scriptState.sourceOffset, offset)
  assert.deepEqual(h.chat.messages, ['保留正文'])
  await assert.rejects(h.service.setChunkSize('session', { ...page, chunkSize: 800 }), /已变化/)
  assert.equal(h.settings.scriptChunkSize, 1200)
  const fresh = await h.service.browse('session')
  await assert.rejects(h.service.setChunkSize('session', { ...fresh, chunkSize: 99 }), /100–10000/)
  assert.equal(h.settings.scriptChunkSize, 1200)
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
