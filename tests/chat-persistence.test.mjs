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
