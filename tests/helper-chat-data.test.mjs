import assert from 'node:assert/strict'
import test from 'node:test'
import { createHelperChatDataHost } from './fixtures/helper-chat-data-host.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
async function fixture(t) { const host = await createHelperChatDataHost(); t.after(host.cleanup); return host }

test('独立插件并发合并，同一字段冲突时消息和元数据一起回滚', async t => {
  const host = await fixture(t), a = await host.connect(), b = await host.connect()
  a.api.chat[0].database = { n: 1 }; a.api.chatMetadata.database = { n: 1 }
  b.api.chat[0].phone = { n: 2 }; b.api.chatMetadata.phone = { n: 2 }
  await Promise.all([a.api.saveChat(), b.api.saveChat()])
  const saved = await host.persistence.read('audit')
  assert.deepEqual(saved.messages[0].tavernPluginData, { database: { n: 1 }, phone: { n: 2 } })
  assert.deepEqual(saved.tavernPluginMetadata, { database: { n: 1 }, phone: { n: 2 } })
  const old = await host.connect(), winner = await host.connect()
  winner.api.chat[0].phone.n = 3
  await winner.api.saveChat()
  old.api.chat[0].phone.n = 4; old.api.chatMetadata.mustNotSave = 1
  await assert.rejects(old.api.saveChat(), /其他操作修改/)
  assert.equal(old.api.chat[0].phone.n, 4, '失败保留本地编辑')
  const actual = await host.persistence.read('audit')
  assert.equal(actual.messages[0].tavernPluginData.phone.n, 3)
  assert.equal(actual.tavernPluginMetadata.mustNotSave, undefined)
})

test('旧式变量保存拒绝并发冲突和已推进的历史，元数据也不部分保存', async t => {
  const host = await fixture(t), stale = await host.connect()
  stale.api.chat[0].variables[0].hp = 8
  stale.api.chatMetadata.marker = true
  await host.persistence.update('audit', chat => { chat.messages[0].variables[0].hp=9; return chat })
  await assert.rejects(stale.api.saveChat(), /其他操作修改/)
  const newer = await host.connect()
  newer.api.chat[0].variables[0].hp=10
  await host.persistence.update('audit', chat => { chat.messages.push({...chat.messages[0],id:'next',turn:2});return chat })
  await assert.rejects(newer.api.saveChat(), /历史|版本/)
  const saved=await host.open().read('audit')
  assert.equal(saved.messages[0].variables[0].hp,9)
  assert.equal(saved.tavernPluginMetadata,undefined)
})
