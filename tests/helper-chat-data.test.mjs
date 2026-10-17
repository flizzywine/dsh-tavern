import assert from 'node:assert/strict'
import test from 'node:test'
import { createHelperChatDataHost } from './fixtures/helper-chat-data-host.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
async function fixture(t) { const host = await createHelperChatDataHost(); t.after(host.cleanup); return host }

function withoutPluginData(chat) {
  const value = structuredClone(chat)
  delete value.tavernPluginMetadata; delete value._storageRevision; delete value.updatedAt
  for (const message of value.messages) delete message.tavernPluginData
  return value
}

test('saveChat 保存消息附加数据与元数据，重新打开 Journal 恢复，正文/Frame 保持不变', async t => {
  const host = await fixture(t), run = await host.connect(), { api } = run
  const before = await host.persistence.read('audit'), chat = api.chat, message = chat[0], metadata = api.chatMetadata
  message.TavernDB_ACU_IsolatedData = { rows: [{ where: '家中' }], remove: 1 }
  const held = message.TavernDB_ACU_IsolatedData
  api.updateChatMetadata({ phone: { current: '联系人甲' } })
  assert.equal((await host.persistence.read('audit')).tavernPluginMetadata, undefined, 'updateChatMetadata 只更新内存')
  await api.saveChat()
  assert.equal(api.chat, chat); assert.equal(api.chat[0], message); assert.equal(api.chatMetadata, metadata)
  assert.equal(api.chat[0].TavernDB_ACU_IsolatedData, held)
  delete held.remove; held.rows[0].where = '门口'
  await api.saveMetadata()
  const persisted = await host.open().read('audit')
  assert.deepEqual(persisted.messages[0].tavernPluginData, { TavernDB_ACU_IsolatedData: { rows: [{ where: '门口' }] } })
  assert.deepEqual(persisted.tavernPluginMetadata, { phone: { current: '联系人甲' } })
  assert.deepEqual(withoutPluginData(persisted), withoutPluginData(before))
  const reloaded = await host.connect()
  assert.equal(reloaded.api.chat[0].TavernDB_ACU_IsolatedData.rows[0].where, '门口')
  delete reloaded.api.chat[0].TavernDB_ACU_IsolatedData
  reloaded.api.updateChatMetadata({ database: { enabled: true } }, true)
  await reloaded.api.saveMetadataDebounced()
  assert.deepEqual((await host.open().read('audit')).messages[0].tavernPluginData, {})
  assert.deepEqual((await host.open().read('audit')).tavernPluginMetadata, { database: { enabled: true } })
  assert.equal((await host.connect('other')).api.chatMetadata.database, undefined)
})

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

test('旧生命周期、聊天身份、变化的消息以及临时楼层都不能写回', async t => {
  const host = await fixture(t), stale = await host.connect()
  stale.api.chat[0].data = 1
  await host.persistence.update('audit', chat => { chat.tavernHelperLifecycleRevision++; return chat })
  await assert.rejects(stale.api.saveChat(), /版本已变化/)
  const current = await host.connect()
  current.api.chat[0].data = 2
  await host.persistence.update('audit', chat => { chat.messages[0].sourceText = '新的正文'; return chat })
  await assert.rejects(current.api.saveChat(), /版本已变化/)
  const context = await host.context(), virtual = await host.connect()
  context.messages.push({ message_id: 1, role: 'user', message: '尚未保存的玩家输入', swipes: ['尚未保存的玩家输入'], swipe_id: 0 })
  virtual.receive({ type: 'dsh-tavern-helper-context', context })
  virtual.api.chat[1].data = 3
  await assert.rejects(virtual.api.saveChat(), /尚未保存/)
  await assert.rejects(host.adapter.saveChatData('audit', { chatId: 'other', lifecycleRevision: 3, messages: [] }), /聊天已切换/)
})

test('切换聊天会隔离旧对象，排队的旧保存不能污染新聊天', async t => {
  const host = await fixture(t), run = await host.connect(), oldChat = run.api.chat, oldMetadata = run.api.chatMetadata
  const other = await host.context('other')
  oldChat[0].database = 1
  const save = run.api.saveChat()
  run.receive({ type: 'dsh-tavern-helper-context', context: other })
  await assert.rejects(save, /聊天已切换/)
  assert.equal(run.calls().length, 0)
  oldMetadata.old = true
  assert.notEqual(run.api.chat, oldChat); assert.notEqual(run.api.chatMetadata, oldMetadata)
  assert.equal(run.api.chatMetadata.old, undefined)
  assert.equal(run.api.chat[0].database, undefined)
  assert.equal((await host.open().read('other')).tavernPluginMetadata, undefined)
})

test('宿主拒绝伪造正文字段和危险 JSON，失败不产生部分存档', async t => {
  const host = await fixture(t), value = await host.context()
  const request = { chatId: 'audit', lifecycleRevision: 2, messages: [{ message_id: 0, stateRevision: value.stateRevision, data: { mes: '改写' } }] }
  await assert.rejects(host.adapter.saveChatData('audit', request), /不支持修改/)
  request.messages[0].data = JSON.parse('{"plugin":{"__proto__":{"polluted":true}}}')
  await assert.rejects(host.adapter.saveChatData('audit', request), /不安全字段/)
  assert.equal({}.polluted, undefined)
  assert.equal((await host.open().read('audit')).messages[0].tavernPluginData, undefined)
})

test('宿主刷新不能掩盖脏字段冲突或本地旧正文修改', async t => {
  const host = await fixture(t), run = await host.connect()
  run.api.chat[0].database = { value: 1 }
  run.api.chat[0].mes = '插件试图改写'
  await host.persistence.update('audit', chat => { chat.messages[0].tavernPluginData = { database: { value: 2 } }; return chat })
  run.receive({ type: 'dsh-tavern-helper-context', context: await host.context() })
  assert.equal(run.api.chat[0].mes, '插件试图改写')
  await assert.rejects(run.api.saveChat(), /不支持/)
  run.api.chat[0].mes = '她回到了家。'
  await assert.rejects(run.api.saveChat(), /其他操作修改/)
  assert.equal((await host.open().read('audit')).messages[0].tavernPluginData.database.value, 2)
})

test('进行中保存的旧回执不会覆盖新聊天上下文', async t => {
  const host = await fixture(t), deliveries = []
  const run = await host.connect('audit', (_message, dispatch) => deliveries.push(dispatch))
  run.api.chat[0].database = 1
  const save = run.api.saveChat()
  await tick()
  run.receive({ type: 'dsh-tavern-helper-context', context: await host.context('other') })
  await deliveries.shift()(); await save
  assert.equal(run.api.chatId, 'other')
  assert.equal(run.api.chat[0].database, undefined)
  assert.equal(run.api.chatMetadata.database, undefined)
  assert.equal((await host.open().read('audit')).messages[0].tavernPluginData.database, 1)
  assert.equal((await host.open().read('other')).messages[0].tavernPluginData, undefined)
})

test('旧式面板变量编辑与元数据原子保存，重开后恢复且不改正文和历史', async t => {
  const host = await fixture(t), run = await host.connect()
  const before = await host.open().read('audit')
  run.api.chat[0].variables[0].hp = 8
  run.api.chatMetadata.migration = 2
  await run.api.saveMetadata()
  const saved = await host.open().read('audit')
  assert.equal(saved.messages[0].variables[0].hp, 8)
  assert.equal(saved.tavernPluginMetadata.migration, 2)
  assert.deepEqual(saved.timeline, before.timeline)
  assert.deepEqual(saved.foregroundFrame, before.foregroundFrame)
  assert.equal(saved.messages[0].text, before.messages[0].text)
  assert.equal(run.api.chat[0].variables[0].hp, 8)
  assert.equal((await host.connect()).api.chat[0].variables[0].hp, 8)
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

test('保存期间的新变量编辑不会被回执覆盖，连续保存可重开恢复', async t => {
  const host=await fixture(t), deliveries=[]
  const run=await host.connect('audit',(_message,dispatch)=>deliveries.push(dispatch))
  run.api.chat[0].variables[0].hp=2
  const first=run.api.saveChat()
  await tick()
  run.api.chat[0].variables[0].hp=3
  const second=run.api.saveChat()
  await deliveries.shift()(); await first; await tick()
  assert.equal(run.api.chat[0].variables[0].hp,3)
  await deliveries.shift()(); await second
  assert.equal((await host.open().read('audit')).messages[0].variables[0].hp,3)
})

test('远端刷新不掩盖未保存变量的冲突，宿主拒绝旧楼层和非当前 swipe', async t => {
  const host=await fixture(t), run=await host.connect()
  run.api.chat[0].variables[0].hp=2
  await host.persistence.update('audit',chat=>{chat.messages[0].variables[0].hp=3;return chat})
  run.receive({type:'dsh-tavern-helper-context',context:await host.context()})
  await assert.rejects(run.api.saveChat(),/其他操作修改/)
  await host.persistence.update('audit',chat=>{chat.messages.push({...chat.messages[0],id:'next',turn:2});return chat})
  const current=await host.context()
  const request={chatId:'audit',lifecycleRevision:2,messages:[],metadata:{stateRevision:current.stateRevision,data:{bad:true}},variableUpdates:[{message_id:0,swipe_id:0,stateRevision:current.stateRevision,data:{hp:4}}]}
  await assert.rejects(host.adapter.saveChatData('audit',request),/当前变量快照/)
  request.variableUpdates[0].message_id=1;request.variableUpdates[0].swipe_id=1
  await assert.rejects(host.adapter.saveChatData('audit',request),/当前变量快照/)
  assert.equal((await host.open().read('audit')).tavernPluginMetadata,undefined)
})
