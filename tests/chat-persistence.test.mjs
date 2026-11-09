import { createHistoryRecall } from '../tavern-plugin/lib/domain/history-recall.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'

function harness(initial) {
  let value = initial === undefined ? undefined : structuredClone(initial)
  let tail = Promise.resolve()
  const data = {
    async readJson() { return value === undefined ? undefined : structuredClone(value) },
    async updateJson(_path, updater) {
      const current = tail.then(async function () {
        const next = await updater(value === undefined ? undefined : structuredClone(value))
        if (next !== undefined) value = structuredClone(next)
        return value === undefined ? undefined : structuredClone(value)
      })
      tail = current.catch(function () {})
      return await current
    },
    async remove() { value = undefined }
  }
  const persistence = createChatPersistence({ data, now: function () { return 1000 } })
  return { persistence, stored: function () { return structuredClone(value) } }
}

function message() {
  return { role: 'assistant', turn: 1, text: '正文', sourceText: '正文', swipes: ['正文'], swipeId: 0,
    variables: [{ stat_data: { hp: 10 }, schema: {} }], displayRuntime: { frames: [{ capturedAt: 1, dom: 'old' }] } }
}

for (const stale of [false, true]) test('正文提交消费最新模板输入且拒绝剧情版本变化：stale=' + stale, async () => {
  const app = harness({id:'chat-1',sessionId:'s',mode:'story',cardPath:'card.json',messages:[],_storageRevision:1,
    mvu:{enabled:true,owner:'official'}})
  let renderDuringCommit = false
  const turns = createTurnOrchestrator({
    store: {
      async chatForSession() {
        const snapshot = await app.persistence.read('chat-1')
        if (renderDuringCommit) {
          renderDuringCommit = false
          await app.persistence.update('chat-1', current => {
            current.promptTemplateInput.message.tavernPluginData.template_rendered = {hash:'rendered-input',swipe:0}
            // 同一分支上推进 revision 只是后台写入；换成另一条分支才是剧情换了。
            if (stale) { current.timeline.revision++; current.timeline.branchId = 'other-branch' }
            return current
          }, {source:'prompt-template.state'})
        }
        return snapshot
      },
      readCard: async () => ({name:'Card'}),
      writeChat: app.persistence.write, updateChat: app.persistence.update
    },
    timeline:createStoryTimeline(), frameBuilder:createForegroundFrameBuilder(),
    planner:{plan:async()=>({text:'context'})},
    projectReply:text=>({sourceText:text,projectionText:text,sessionText:text,displayText:text}),
    projectUserTemplate:async ({text})=>({message:{role:'user',text,variables:[{stat_data:{hp:10}}],tavernPluginData:{}},scopes:{local:{},initial:{}}})
  })
  await turns.prepare({sessionId:'s',turn:1,userText:'continue'})
  renderDuringCommit = true
  const input = {sessionId:'s',turn:1,userText:'continue',assistantText:'reply'}
  if (stale) {
    await assert.rejects(turns.finalize(input), /剧情状态已变化/)
    assert.equal(app.stored().messages.length, 2, '过期提交被拒绝，准备阶段的占位保持待清理状态')
    assert.ok(app.stored().promptTemplateInput)
    return
  }
  const results = await Promise.all([turns.finalize(input), turns.finalize(input)])
  const result = results.find(item => !item.duplicate)
  assert.equal(results.filter(item => item.duplicate).length, 1)
  assert.equal(result.saved,true)
  const saved = app.stored()
  assert.equal(saved.messages.length,2)
  assert.equal(saved.promptTemplateInput,undefined)
  assert.deepEqual(saved.messages[0].tavernPluginData.template_rendered,{hash:'rendered-input',swipe:0})
  assert.equal(saved.messages[1].variables[0].stat_data.hp,10)
  assert.equal(saved.timeline.checkpoints.length,1)
})

for (const mutations of [false, true]) test('真实 MVU 草稿结算与显示捕获并发保存：' + (mutations ? '变量更新' : '空操作'), async () => {
  const app = harness({ id: 'chat-1', sessionId: 's', mvu: { enabled: true }, messages: [message()], _storageRevision: 1 })
  let adapter
  adapter = createTavernScriptHostAdapter({
    resolveChat: () => app.persistence.read('chat-1'), writeChat: app.persistence.write,
    readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: { status: () => ({ ready: true }), dispatch: async (_sessionId, _name, _args, _context, work) => {
      const capture = await app.persistence.read('chat-1')
      capture.messages[0].displayRuntime.frames[0] = { capturedAt: 2, dom: 'new' }
      await app.persistence.write(capture, { source: 'display.capture', touchUpdatedAt: false })
      if (mutations) await adapter.updateVariables('s', { type: 'message', message_id: 0 }, { stat_data: { hp: 9 }, schema: {} }, 0, work.eventId)
      return { handled: true }
    } }
  })
  const receipt = await adapter.settleMvuUpdate({ operationId: 'persist-settlement-1', chatId: 'chat-1', sessionId: 's', messageId: 0, swipeId: 0,
    storyText: '正文', command: '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>' })
  assert.equal(receipt.updated, true)
  const latest = await app.persistence.read('chat-1')
  applyMvuSettlementEffect(latest, receipt.effect)
  await app.persistence.write(latest, { source: 'settlement.commit' })
  assert.equal(app.stored().messages[0].variables[0].stat_data.hp, mutations ? 9 : 10)
  assert.equal(app.stored().messages[0].displayRuntime.frames[0].dom, 'new')
  assert.equal(app.stored().messages[0].text, '正文')
})

for (const captureFirst of [true, false]) test('显示捕获与业务写入独立合并，保存顺序 captureFirst=' + captureFirst, async () => {
  const app = harness({ id: 'chat-1', messages: [message()], _storageRevision: 1 })
  const capture = await app.persistence.read('chat-1'), business = await app.persistence.read('chat-1')
  capture.messages[0].displayRuntime.frames[0].dom = 'new'
  business.messages[0].variables[0].stat_data.hp = 9
  for (const draft of captureFirst ? [capture, business] : [business, capture]) await app.persistence.write(draft)
  assert.equal(app.stored().messages[0].variables[0].stat_data.hp, 9)
  assert.equal(app.stored().messages[0].displayRuntime.frames[0].dom, 'new')
})

for (const change of ['text', 'variables', 'append', 'delete', 'reorder']) test('显示捕获不能掩盖真正的消息冲突：' + change, async () => {
  const app = harness({ id: 'chat-1', messages: [message(), { role: 'user', text: '第二条' }], _storageRevision: 1 })
  const first = await app.persistence.read('chat-1'), second = await app.persistence.read('chat-1')
  first.messages[0].variables[0].stat_data.hp = 8
  first.messages[0].displayRuntime.frames[0].dom = 'new'
  if (change === 'text') second.messages[0].text = '另一正文'
  if (change === 'variables') second.messages[0].variables[0].stat_data.hp = 9
  if (change === 'append') second.messages.push({ role: 'assistant', text: '第三条' })
  if (change === 'delete') second.messages.pop()
  if (change === 'reorder') second.messages.reverse()
  await app.persistence.write(first)
  const before = app.stored()
  await assert.rejects(app.persistence.write(second), error => error.code === 'DSH_TAVERN_CHAT_CONFLICT' && error.path === 'messages')
  assert.deepEqual(app.stored(), before)
})

for (const captureFirst of [true, false]) test('过期显示捕获不附着到已替换的正文：' + captureFirst, async () => {
  const app = harness({ id: 'chat-1', messages: [message()], _storageRevision: 1 })
  const capture = await app.persistence.read('chat-1'), replacement = await app.persistence.read('chat-1')
  capture.messages[0].displayRuntime.frames[0].dom = 'stale'
  replacement.messages[0] = { role: 'assistant', turn: 1, text: '替代正文' }
  for (const draft of captureFirst ? [capture, replacement] : [replacement, capture]) await app.persistence.write(draft)
  assert.deepEqual(app.stored().messages, replacement.messages)
})

test('真实 journal 重开后仍保留并发结算与捕获结果，原历史 revision 不变', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-capture-regression-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const original = await persistence.write({ id: 'chat-1', messages: [message()] })
  const capture = await persistence.read('chat-1'), business = await persistence.read('chat-1')
  capture.messages[0].displayRuntime.frames[0].dom = 'new'
  business.messages[0].variables[0].stat_data.hp = 9
  await persistence.write(capture, { source: 'display.capture', touchUpdatedAt: false })
  await persistence.write(business, { source: 'tavern-helper.mvu-settlement' })
  const reopened = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const saved = await reopened.read('chat-1')
  assert.equal(saved.messages[0].variables[0].stat_data.hp, 9)
  assert.equal(saved.messages[0].displayRuntime.frames[0].dom, 'new')
  assert.deepEqual((await reopened.readRevision('chat-1', original._storageRevision)).messages, original.messages)
})

test('并发写入互不相交的聊天字段时保留双方结果', async function () {
  const app = harness({ id: 'chat-1', messages: [], timeline: { revision: 3 }, taskMailbox: { version: 0 }, _storageRevision: 1 })
  const foreground = await app.persistence.read('chat-1')
  const mailbox = await app.persistence.read('chat-1')
  foreground.messages.push({ role: 'assistant', text: '新正文' })
  mailbox.taskMailbox.version = 1

  await Promise.all([app.persistence.write(foreground), app.persistence.write(mailbox)])

  assert.deepEqual(app.stored().messages, [{ role: 'assistant', text: '新正文' }])
  assert.equal(app.stored().taskMailbox.version, 1)
  assert.equal(app.stored()._storageRevision, 3)
})

test('并发改写同一路径时明确拒绝旧快照覆盖', async function () {
  const app = harness({ id: 'chat-1', posture: '门边', _storageRevision: 4 })
  const first = await app.persistence.read('chat-1')
  const second = await app.persistence.read('chat-1')
  first.posture = '窗边'
  second.posture = '桌边'

  await app.persistence.write(first)
  await assert.rejects(app.persistence.write(second), function (error) {
    return error && error.code === 'DSH_TAVERN_CHAT_CONFLICT' && error.path === 'posture'
  })
  assert.equal(app.stored().posture, '窗边')
})

test('时间线同一条目被并发改成不同状态时仍然拒绝', async function () {
  const app = harness({ id: 'chat-1', timeline: { updatedAt: 1, operations: { a: { status: 'running' } } }, _storageRevision: 4 })
  const first = await app.persistence.read('chat-1')
  const second = await app.persistence.read('chat-1')
  first.timeline.operations.a.status = 'settled'; first.timeline.updatedAt = 2
  second.timeline.operations.a.status = 'failed'; second.timeline.updatedAt = 3
  await app.persistence.write(first)
  await assert.rejects(app.persistence.write(second), error => error.code === 'DSH_TAVERN_CHAT_CONFLICT' && error.path === 'timeline.operations.a.status')
})

for (const anotherToggle of [false, true]) test('复用已合并的草稿不会撤销隐藏状态或产生伪冲突：' + anotherToggle, async () => {
  const app = harness({ id: 'chat-1', messages: [], hiddenDshErrorTurns: [], _storageRevision: 1 })
  const draft = await app.persistence.read('chat-1')
  await app.persistence.update('chat-1', current => ({ ...current, hiddenDshErrorTurns: [1] }))
  draft.foregroundError = { turn: 2 }
  await app.persistence.write(draft)
  if (anotherToggle) await app.persistence.update('chat-1', current => ({ ...current, hiddenDshErrorTurns: [1, 2] }))
  draft.foregroundError = { turn: 3 }
  await app.persistence.write(draft)
  assert.deepEqual(app.stored().hiddenDshErrorTurns, anotherToggle ? [1, 2] : [1])
})

test('批量隐藏与单条恢复并发时按顺序保留最新选择及剧情', async () => {
  const { setAllFailedErrorVisibility, setFailedErrorVisibility } = await import('../tavern-plugin/lib/domain/failed-error-visibility.js')
  const app = harness({ id: 'chat-1', messages: [{ text: '正文' }], hiddenDshErrorTurns: [], _storageRevision: 1 })
  const events = [1, 2].map(turn => ({ type: 'turn/end', data: { turn, reason: { kind: 'error' } } }))
  await Promise.all([
    app.persistence.update('chat-1', chat => setAllFailedErrorVisibility(chat, events, true).chat),
    app.persistence.update('chat-1', chat => setFailedErrorVisibility(chat, events, 1, false))
  ])
  assert.deepEqual(app.stored().hiddenDshErrorTurns, [2])
  assert.deepEqual(app.stored().messages, [{ text: '正文' }])
})

test('前后台并发召回分别冷却且不覆盖彼此记录或剧情', async () => {
  const app = harness({ id: 'chat-1', messages: [message()], _storageRevision: 1 })
  const results = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    let result
    await app.persistence.update('chat-1', current => {
      result = createHistoryRecall().recall({ chat: current, turn: 1, radius: 0, trackCooldown: true, audience: index % 2 ? 'background' : 'foreground' })
      return current
    }, { source: 'history-recall', touchUpdatedAt: false })
    return result
  }))
  assert.equal(results.filter(result => result.rounds.length === 1).length, 2)
  const restored = await app.persistence.read('chat-1')
  assert.deepEqual(restored.messages, [message()])
  assert.equal(restored.historyRecallCooldowns.length, 2)
})
