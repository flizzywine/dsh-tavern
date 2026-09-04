import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

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

for (const mutations of [false, true]) test('真实 MVU 草稿结算与显示捕获并发保存：' + (mutations ? '变量更新' : '空操作'), async () => {
  const app = harness({ id: 'chat-1', sessionId: 's', mvu: { enabled: true }, messages: [message()], _storageRevision: 1 })
  let adapter
  adapter = createTavernScriptHostAdapter({
    resolveChat: () => app.persistence.read('chat-1'), writeChat: app.persistence.write,
    readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: { status: () => ({ ready: true }), dispatch: async () => {
      const capture = await app.persistence.read('chat-1')
      capture.messages[0].displayRuntime.frames[0] = { capturedAt: 2, dom: 'new' }
      await app.persistence.write(capture, { source: 'display.capture', touchUpdatedAt: false })
      if (mutations) await adapter.updateVariables('s', { type: 'message', message_id: 0 }, { stat_data: { hp: 9 }, schema: {} }, 0)
      return { handled: true }
    } }
  })
  const receipt = await adapter.settleMvuUpdate({ sessionId: 's', messageId: 0, swipeId: 0,
    storyText: '正文', command: '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>' })
  assert.equal(receipt.updated, true)
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

test('清理显示记录与结算合并后不会复活旧记录', async () => {
  for (const cleanupFirst of [true, false]) {
    const app = harness({ id: 'chat-1', messages: [message()], _storageRevision: 1 })
    const cleanup = await app.persistence.read('chat-1'), business = await app.persistence.read('chat-1')
    delete cleanup.messages[0].displayRuntime
    business.messages[0].variables[0].stat_data.hp = 9
    for (const draft of cleanupFirst ? [cleanup, business] : [business, cleanup]) await app.persistence.write(draft)
    assert.equal(app.stored().messages[0].variables[0].stat_data.hp, 9)
    assert.equal(Object.hasOwn(app.stored().messages[0], 'displayRuntime'), false)
  }
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

test('对象字段顺序变化不应让等价的预设条目数组产生假冲突', async function () {
  const app = harness({
    id: 'chat-1',
    runtimePresetSnapshot: { front: { entries: [{ id: 'entry-1', content: '旧内容' }] } },
    macroState: { local: {} },
    _storageRevision: 1
  })
  const compatibilityCompile = await app.persistence.read('chat-1')

  await app.persistence.update('chat-1', function (chat) {
    chat.runtimePresetSnapshot.front.entries = [{ content: '新内容', id: 'entry-1' }]
    return chat
  })
  compatibilityCompile.runtimePresetSnapshot.front.entries = [{ id: 'entry-1', content: '新内容' }]
  compatibilityCompile.macroState.local.compiled = true

  await app.persistence.write(compatibilityCompile)

  assert.deepEqual(app.stored().runtimePresetSnapshot.front.entries, [{ content: '新内容', id: 'entry-1' }])
  assert.equal(app.stored().macroState.local.compiled, true)
})

test('domain mutation 总是在锁内基于最新聊天执行', async function () {
  const app = harness({ id: 'chat-1', counter: 0, _storageRevision: 0 })
  await Promise.all(Array.from({ length: 20 }, function () {
    return app.persistence.update('chat-1', function (chat) { chat.counter += 1; return chat })
  }))
  assert.equal(app.stored().counter, 20)
  assert.equal(app.stored()._storageRevision, 20)
})

test('诊断性写入可以保留业务 updatedAt', async function () {
  const app = harness({ id: 'chat-1', updatedAt: 600, displayRuntime: null, _storageRevision: 1 })
  const chat = await app.persistence.read('chat-1')
  chat.displayRuntime = { dom: '<p>ready</p>' }

  await app.persistence.write(chat, { source: 'display.capture', touchUpdatedAt: false })

  assert.equal(app.stored().updatedAt, 600)
  assert.deepEqual(app.stored().displayRuntime, { dom: '<p>ready</p>' })
})

test('删除字段与修改其他字段可按任意保存顺序合并，删除不会复活', async function () {
  for (const nested of [false, true]) {
    for (const deletionFirst of [false, true]) {
      const app = harness({ id: 'chat-1', state: { obsolete: true, posture: '门边' }, obsolete: true, unknown: { keep: null }, _storageRevision: 1 })
      const deletion = await app.persistence.read('chat-1')
      const edit = await app.persistence.read('chat-1')
      delete (nested ? deletion.state : deletion).obsolete
      edit.state.posture = '窗边'
      const writes = deletionFirst ? [deletion, edit] : [edit, deletion]
      for (const chat of writes) await app.persistence.write(chat)
      const saved = await app.persistence.read('chat-1')
      assert.equal(Object.hasOwn(nested ? saved.state : saved, 'obsolete'), false)
      assert.equal(saved.state.posture, '窗边')
      assert.deepEqual(saved.unknown, { keep: null })
      assert.equal(saved._storageRevision, 3)
    }
  }
})

test('双方删除同一个字段视为一致结果，同时保留各自的其他修改', async function () {
  const app = harness({ id: 'chat-1', state: { obsolete: { nested: true }, left: 0, right: 0 }, _storageRevision: 1 })
  const first = await app.persistence.read('chat-1')
  const second = await app.persistence.read('chat-1')
  delete first.state.obsolete
  delete second.state.obsolete
  first.state.left = 1
  second.state.right = 2
  await app.persistence.write(first)
  await app.persistence.write(second)
  assert.deepEqual(app.stored().state, { left: 1, right: 2 })
})

test('删除与修改同一个字段仍按任意保存顺序拒绝冲突，失败不改存档', async function () {
  for (const deletionFirst of [false, true]) {
    const app = harness({ id: 'chat-1', state: { obsolete: { value: 1 } }, _storageRevision: 1 })
    const deletion = await app.persistence.read('chat-1')
    const edit = await app.persistence.read('chat-1')
    delete deletion.state.obsolete
    edit.state.obsolete.value = 2
    const [first, second] = deletionFirst ? [deletion, edit] : [edit, deletion]
    await app.persistence.write(first)
    const before = app.stored()
    await assert.rejects(app.persistence.write(second), error => error.code === 'DSH_TAVERN_CHAT_CONFLICT' && error.path === 'state.obsolete')
    assert.deepEqual(app.stored(), before)
  }
})

test('两个写入者删除不同字段时都生效，不产生 undefined 字段', async function () {
  const app = harness({ id: 'chat-1', state: { one: true, two: true, keep: null }, _storageRevision: 1 })
  const first = await app.persistence.read('chat-1')
  const second = await app.persistence.read('chat-1')
  delete first.state.one
  delete second.state.two
  await app.persistence.write(first)
  await app.persistence.write(second)
  assert.deepEqual(app.stored().state, { keep: null })
  assert.deepEqual(Object.keys(app.stored().state), ['keep'])
})
