import assert from 'node:assert/strict'
import test from 'node:test'

import { createPhoneChat, projectPhoneChat } from '../tavern-plugin/lib/domain/phone-chat.js'

function fixture() {
  let chat = {
    id: 'chat-1', sessionId: 'session-1', cardPath: 'cards/a.json', cardName: '林岚', posture: '林岚正在书房看雨。',
    messages: [{ role: 'assistant', turn: 1, text: '林岚来到书房。' }],
    characterDesignDocument: { characters: [
      { name: '林岚', design: { personality: '克制安静' } },
      { name: '周宁', design: { identity: '朋友', speechStyle: '说话爽快' } }
    ] }
  }
  const card = { name: '林岚', description: '住在旧宅的青年。', personality: '寡言。' }
  const writes = []
  let serial = 0
  const store = {
    async chatForSession() { return structuredClone(chat) },
    async readCard() { return structuredClone(card) },
    async updateChat(_chatId, mutate, metadata) {
      chat = mutate(structuredClone(chat))
      writes.push(metadata)
      return structuredClone(chat)
    }
  }
  return { store, card, chat: function () { return structuredClone(chat) }, writes, id: function () { serial++; return 'id-' + serial } }
}

test('手机联系人来自人物卡主角和人物设计档案，并按名称去重', () => {
  const run = fixture()
  const view = projectPhoneChat(run.chat(), run.card)

  assert.deepEqual(view.contacts.map(function (contact) { return [contact.name, contact.main] }), [['林岚', true], ['周宁', false]])
  assert.deepEqual(view.threads, [
    { contactId: encodeURIComponent('林岚'), messages: [], preview: '', updatedAt: 0, pending: false },
    { contactId: encodeURIComponent('周宁'), messages: [], preview: '', updatedAt: 0, pending: false }
  ])
})

test('手机私聊使用后台模型并独立持久化，不修改正文和状态', async () => {
  const run = fixture()
  const calls = []
  const service = createPhoneChat({
    store: run.store,
    selection: function () { return { provider: 'test', model: 'roleplay' } },
    runAgent: async function (input) { calls.push(input); return { text: '窗外雨很大，你到家了吗？' } },
    now: function () { return 100 },
    id: run.id
  })
  const before = run.chat()
  const result = await service.send({ sessionId: 'session-1', contactId: encodeURIComponent('周宁'), requestId: 'request-1', text: '你在做什么？' })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].task, 'phone')
  assert.equal(calls[0].persistent, false)
  assert.equal(calls[0].temperature, 0.9)
  assert.match(calls[0].turnContext, /周宁/)
  assert.match(calls[0].turnContext, /说话爽快/)
  assert.match(calls[0].turnContext, /最近剧情/)
  assert.deepEqual(run.chat().messages, before.messages)
  assert.equal(run.chat().posture, before.posture)
  assert.deepEqual(result.threads[1].messages.map(function (message) { return [message.role, message.text, message.status] }), [
    ['user', '你在做什么？', 'sent'],
    ['assistant', '窗外雨很大，你到家了吗？', 'sent']
  ])
  assert.deepEqual(run.writes.map(function (entry) { return entry.source }), ['phone-chat.send', 'phone-chat.reply'])
})

test('回复失败保留用户消息和可读错误，同一请求不会重复调用模型', async () => {
  const run = fixture()
  let calls = 0
  const service = createPhoneChat({
    store: run.store,
    selection: function () { return { provider: 'test', model: 'roleplay' } },
    runAgent: async function () { calls++; throw new Error('模型暂时不可用') },
    now: function () { return 200 },
    id: run.id
  })
  const input = { sessionId: 'session-1', contactId: encodeURIComponent('林岚'), requestId: 'same-request', text: '在吗？' }
  await assert.rejects(service.send(input), /模型暂时不可用/)
  await service.send(input)

  assert.equal(calls, 1)
  const message = projectPhoneChat(run.chat(), run.card).threads[0].messages[0]
  assert.equal(message.status, 'failed')
  assert.equal(message.error, '模型暂时不可用')
})

test('服务重启后遗留的 pending 私聊显示为已中断，不会永远转圈', () => {
  const run = fixture()
  const interrupted = run.chat()
  interrupted.phoneChat = { version: 1, threads: [{ contactId: encodeURIComponent('林岚'), messages: [{ id: 'old', requestId: 'old-request', role: 'user', text: '还在吗？', createdAt: 1, status: 'pending' }] }] }
  const service = createPhoneChat({
    store: Object.assign({}, run.store, { async chatForSession() { return structuredClone(interrupted) } }),
    selection: function () { return { provider: 'test', model: 'roleplay' } },
    runAgent: async function () { return { text: '在。' } }
  })
  const projected = service.project(interrupted, run.card)

  assert.equal(projected.threads[0].pending, false)
  assert.equal(projected.threads[0].messages[0].status, 'failed')
  assert.match(projected.threads[0].messages[0].error, /服务重启或中断/)
})
