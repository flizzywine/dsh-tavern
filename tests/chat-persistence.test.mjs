import assert from 'node:assert/strict'
import test from 'node:test'

import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'

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
