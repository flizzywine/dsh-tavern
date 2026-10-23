import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

const card = { name: '测试', first_mes: '首页', alternate_greetings: ['第二幕'] }

async function draft(settings = { runtime: true }) {
  const service = createOpeningPreparation({ readCard: async () => card, worldBooks: { bound: async () => null } })
  return { service, draft: await service.create('card', settings) }
}

test('准备页的 createChatMessages 把脚本书写的楼层留在草稿里', async () => {
  const { service, draft: prepared } = await draft()
  const created = await service.callRuntime(prepared.id, 'createTavernHelperMessages', {
    messages: [{ role: 'system', message: '旧日余烬' }, { role: 'assistant', message: '风起于青萍', name: '旁白', data: { scene: 1 } }],
    option: {}
  })
  assert.equal(created.updated, true)
  assert.deepEqual(created.targets, [{ messageId: 1 }, { messageId: 2 }])
  assert.equal(created.context.messages.length, 3)
  assert.equal(created.context.messages[1].role, 'system')
  assert.equal(created.context.messages[1].message, '旧日余烬')
  assert.equal(created.context.messages[2].role, 'assistant')
  assert.equal(created.context.messages[2].name, '旁白')
  assert.deepEqual(created.context.messages[2].variables, { scene: 1 })
  assert.equal(created.context.stateRevision, 2)

  const resolved = service.resolve(prepared.id, 'card')
  assert.equal(resolved.preparedMessages.length, 2)
  assert.equal(resolved.preparedMessages[0].role, 'tavern-helper')
  assert.equal(resolved.preparedMessages[0].tavernRole, 'system')
  assert.equal(resolved.preparedMessages[0].projectionText, '旧日余烬')
  await service.release(prepared.id)
})

test('准备页只接受能落到末尾的楼层写法', async () => {
  const { service, draft: prepared } = await draft()
  await assert.rejects(service.callRuntime(prepared.id, 'createTavernHelperMessages', { messages: [{ role: 'narrator', message: 'x' }] }), /role 无效/)
  await assert.rejects(service.callRuntime(prepared.id, 'createTavernHelperMessages', { messages: [{ role: 'system', message: 'x' }], option: { insert_before: 1 } }), /只支持追加到末尾/)
  assert.equal(service.resolve(prepared.id, 'card').preparedMessages.length, 0)
  await service.release(prepared.id)
})

test('准备页的 saveChatChatData 写入开场白插件数据与聊天元数据', async () => {
  const { service, draft: prepared } = await draft()
  const base = (await service.callRuntime(prepared.id, 'updateTavernHelperVariables', { option: { type: 'chat' }, variables: { turn: 0 } })).context
  const request = {
    chatId: base.chatId, lifecycleRevision: base.lifecycleRevision,
    messages: [{ message_id: 0, stateRevision: base.stateRevision, data: { demo: { opened: true } } }],
    metadata: { stateRevision: base.stateRevision, data: { demo: { seen: 2 } } }
  }
  const saved = await service.callRuntime(prepared.id, 'saveTavernChatData', { request })
  assert.equal(saved.updated, true)
  assert.deepEqual(saved.context.messages[0].pluginData, { demo: { opened: true } })
  assert.deepEqual(saved.context.chatMetadata, { demo: { seen: 2 } })

  const resolved = service.resolve(prepared.id, 'card')
  assert.deepEqual(resolved.openingPluginData, { demo: { opened: true } })
  assert.deepEqual(resolved.chatPluginMetadata, { demo: { seen: 2 } })
  await service.release(prepared.id)
})

test('准备页的 saveChatChatData 拒绝对不上聊天或版本已过期的请求', async () => {
  const { service, draft: prepared } = await draft()
  const base = (await service.callRuntime(prepared.id, 'updateTavernHelperVariables', { option: { type: 'chat' }, variables: { turn: 0 } })).context
  const row = (revision, data = {}) => [{ message_id: 0, stateRevision: revision, data }]
  await assert.rejects(service.callRuntime(prepared.id, 'saveTavernChatData', { request: {
    chatId: base.chatId, lifecycleRevision: base.lifecycleRevision, messages: row(1), metadata: { stateRevision: 999, data: {} }
  } }), /不一致|版本/)
  await assert.rejects(service.callRuntime(prepared.id, 'saveTavernChatData', { request: {
    chatId: 'other-chat', lifecycleRevision: 0, messages: row(base.stateRevision), metadata: { stateRevision: base.stateRevision, data: {} }
  } }), /草稿已变化/)
  await service.release(prepared.id)
})

test('单独 /send 只记录文本，/trigger 才落成开局命令', async () => {
  const { service, draft: prepared } = await draft()
  assert.deepEqual(await service.callRuntime(prepared.id, 'prepareOpeningCommand', { line: '/send 我推门而入' }), { deferred: true, input: '' })
  assert.equal(service.resolve(prepared.id, 'card').startCommand, undefined, '记录文本不等于开局')
  // 两步之间卡会保存自己的数据，草稿必须照常接受
  const context = (await service.callRuntime(prepared.id, 'updateTavernHelperVariables', { option: { type: 'chat' }, variables: { chapter: 1 } })).context
  const saved = await service.callRuntime(prepared.id, 'saveTavernChatData', { request: {
    chatId: context.chatId, lifecycleRevision: context.lifecycleRevision, messages: [],
    metadata: { stateRevision: context.stateRevision, data: { demo: { seen: 1 } } }
  } })
  assert.deepEqual(saved.context.chatMetadata, { demo: { seen: 1 } })
  assert.deepEqual(await service.callRuntime(prepared.id, 'prepareOpeningCommand', { line: '/trigger' }), { deferred: false, input: '我推门而入' })
  const resolved = service.resolve(prepared.id, 'card')
  assert.equal(resolved.startCommand.input, '我推门而入')
  assert.deepEqual(resolved.chatPluginMetadata, { demo: { seen: 1 } })
  await service.release(prepared.id)
})

test('单独 /sys 的旁白等到 /trigger 才成为开局系统楼层', async () => {
  const { service, draft: prepared } = await draft()
  assert.deepEqual(await service.callRuntime(prepared.id, 'prepareOpeningCommand', { line: '/sys 天启三年' }), { deferred: true, input: '' })
  await service.callRuntime(prepared.id, 'prepareOpeningCommand', { line: '/send 我推门而入' })
  assert.deepEqual(await service.callRuntime(prepared.id, 'prepareOpeningCommand', { line: '/trigger' }), { deferred: false, input: '我推门而入' })
  const command = service.resolve(prepared.id, 'card').startCommand
  assert.equal(command.input, '我推门而入')
  assert.equal(command.systemText, '天启三年')
  await service.release(prepared.id)
})

test('新局继承准备页写下的插件数据与楼层', async () => {
  const h = initializationFixture()
  const service = createOpeningPreparation({ readCard: async () => ({ ...h.card, first_mes: '首页', alternate_greetings: [] }), worldBooks: { bound: async () => null } })
  const prepared = await service.create(h.card.path, { runtime: true })
  await service.callRuntime(prepared.id, 'updateTavernHelperVariables', { option: { type: 'chat' }, variables: { chapter: 1 } })
  await service.callRuntime(prepared.id, 'createTavernHelperMessages', { messages: [{ role: 'system', message: '旧日余烬' }] })
  const context = (await service.callRuntime(prepared.id, 'updateTavernHelperVariables', { option: { type: 'chat' }, variables: { chapter: 2 } })).context
  await service.callRuntime(prepared.id, 'saveTavernChatData', { request: {
    chatId: context.chatId, lifecycleRevision: context.lifecycleRevision,
    messages: [{ message_id: 0, stateRevision: context.stateRevision, data: { demo: { opened: true } } }],
    metadata: { stateRevision: context.stateRevision, data: { demo: { seen: 2 } } }
  } })
  const preparation = service.resolve(prepared.id, h.card.path)
  const started = await h.make().start({ ...h.input, openingId: '', preparation })
  const stored = h.saved.get(started.id)
  assert.deepEqual(stored.messages[0].tavernPluginData, { demo: { opened: true } })
  assert.deepEqual(stored.tavernPluginMetadata, { demo: { seen: 2 } })
  assert.deepEqual(stored.variables, { chapter: 2 })
  const created = stored.messages.filter(message => message.tavernHelperCreated === true)
  assert.equal(created.length, 1)
  assert.equal(created[0].projectionText, '旧日余烬')
  assert.equal(stored.messages.indexOf(created[0]) > 0, true, '预写楼层要排在开场白之后')
  await service.release(prepared.id)
})
