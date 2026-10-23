import test from 'node:test'
import assert from 'node:assert/strict'

import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

const card = { name: '测试', first_mes: '首页', alternate_greetings: [] }

async function prepared() {
  const service = createOpeningPreparation({ readCard: async () => card, worldBooks: { bound: async () => null } })
  return { service, draft: await service.create('card', { runtime: true }) }
}

// 大凉龙虎传 v4.11 的开局页把自己的记录写进"刚发送的那一楼"，随后时间结算脚本
// 再从同一条楼层的消息变量里读回来。延迟开局后那一楼还没建，于是它在准备页里
// 先写进草稿，开局时跟着第一条用户楼层进入新局。
test('准备页发送的开局文本先在草稿里占一层，卡的写回落在这层上', async () => {
  const { service, draft: current } = await prepared()
  const deferred = await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/send 我推门而入' })
  assert.equal(deferred.deferred, true)
  const rows = deferred.context.messages
  assert.equal(rows.length, 2, '开场白之外还有一层等待开局的用户楼层')
  assert.equal(rows[0].role, 'assistant')
  assert.equal(rows[1].role, 'user')
  assert.equal(rows[1].message, '我推门而入')
  assert.notEqual(rows[1].is_user, false)

  const floor = rows.length - 1
  const record = { 标识: 'preset-a', 来源: '开局界面', 消息楼: floor }
  const written = await service.callRuntime(current.id, 'updateTavernHelperVariables', {
    option: { type: 'message', message_id: floor },
    variables: { dshOpening327: record, stat_data: { 系统接入: {} } }
  })
  assert.deepEqual(written.context.messages[floor].variables.dshOpening327, record)

  assert.equal(service.resolve(current.id, 'card').startCommand, undefined, '写回数据不等于开局')
  await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/trigger' })
  const resolved = service.resolve(current.id, 'card')
  assert.equal(resolved.startCommand.input, '我推门而入')
  assert.deepEqual(resolved.openingMessageVariables.dshOpening327, record)
  assert.deepEqual(resolved.openingMessageVariables.stat_data, { 系统接入: {} })
  await service.release(current.id)
})

test('准备页拒绝写不存在的楼层', async () => {
  const { service, draft: current } = await prepared()
  await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/send 我推门而入' })
  await assert.rejects(service.callRuntime(current.id, 'updateTavernHelperVariables', {
    option: { type: 'message', message_id: 7 }, variables: { dshOpening327: {} }
  }), /消息楼层不存在/)
  await service.release(current.id)
})

test('重复发送的开局文本改写同一层，不会越攒越多', async () => {
  const { service, draft: current } = await prepared()
  await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/send 我推门而入' })
  const again = await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/send 我推门而入。' })
  assert.equal(again.context.messages.length, 2)
  assert.equal(again.context.messages[1].message, '我推门而入。')
  await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/trigger' })
  assert.equal(service.resolve(current.id, 'card').startCommand.input, '我推门而入。')
  await service.release(current.id)
})

test('新局把准备页写下的开局楼层变量挂到第一条用户楼层上', async () => {
  const h = initializationFixture()
  const service = createOpeningPreparation({ readCard: async () => ({ ...h.card, first_mes: '首页', alternate_greetings: [] }), worldBooks: { bound: async () => null } })
  const current = await service.create(h.card.path, { runtime: true })
  const deferred = await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/send 我推门而入' })
  const floor = deferred.context.messages.length - 1
  const record = { 标识: 'preset-a', 来源: '开局界面', 消息楼: floor }
  await service.callRuntime(current.id, 'updateTavernHelperVariables', {
    option: { type: 'message', message_id: floor },
    variables: { dshOpening327: record, stat_data: { 系统接入: { 开局367: { 标识: 'preset-a' } } } }
  })
  await service.callRuntime(current.id, 'prepareOpeningCommand', { line: '/trigger' })
  const started = await h.make().start({ ...h.input, openingId: '', preparation: service.resolve(current.id, h.card.path) })
  const stored = h.saved.get(started.id)
  assert.deepEqual(stored.pendingOpeningMessageVariables.dshOpening327, record)
  assert.equal(stored.messages.some(message => message.role === 'user'), false, '准备页的占位楼层不进新局')

  let chat = null
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + (chat ? 2 : 1), now: () => 2000 })
  const turns = createTurnOrchestrator({
    store: {
      async chatForSession() { return structuredClone(chat) },
      async readCard() { return { name: '测试角色' } },
      async readCardExtensions() { return { regexScripts: [] } },
      async writeChat(value) { chat = structuredClone(value); chat._storageRevision = Number(chat._storageRevision || 0) + 1 },
      async updateChat(_id, mutation) { const next = await mutation(structuredClone(chat)); if (next !== undefined) await this.writeChat(next); return structuredClone(chat) }
    },
    timeline,
    frameBuilder: createForegroundFrameBuilder(),
    planner: { plan: async () => ({ text: 'context' }) },
    projectReply: text => ({ sourceText: text, projectionText: text, sessionText: text, displayText: text }),
    now: () => 2000
  })
  chat = stored
  const input = { sessionId: stored.sessionId || 'session', turn: 1, userText: '我推门而入' }
  await turns.prepare(input)
  await turns.finalize({ ...input, assistantText: '雨水敲窗。' })
  const user = chat.messages.find(message => message.role === 'user')
  assert.ok(user, '开局的第一条用户楼层已写入')
  assert.deepEqual(user.variables[0].dshOpening327, record)
  assert.deepEqual(user.variables[0].stat_data, { 系统接入: { 开局367: { 标识: 'preset-a' } } })
  assert.equal(user.swipes[0], '我推门而入')
  assert.equal(chat.pendingOpeningMessageVariables, undefined, '写入一次后就不再重复带')
  await service.release(current.id)
})
