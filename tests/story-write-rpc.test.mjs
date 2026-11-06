import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

// 故事直选写入（messageIndex/revision）不得在写前 reconcileStory：reconcile 会采纳
// 原生历史并推进 revision，直接让刚读到的编辑令牌过期。
function handlers(events, record) {
  return createPlayHandlers({
    autoChoices: { cancel: () => events.push('cancel') },
    messageDeletion: { remove: async args => { events.push('remove'); record.deletion = args; return { view: { ok: 1 }, deletedCount: (args.items || []).length } } },
    bodyEditor: {
      read: async (sessionId, args) => { events.push('read'); record.read = args; return { token: 't' } },
      readUser: async (sessionId, args) => { events.push('readUser'); record.read = args; return { token: 'u' } },
      save: async (sessionId, args) => { events.push('save'); record.save = args; return { view: 'assistant' } },
      saveUser: async (sessionId, args) => { events.push('saveUser'); record.save = args; return { messages: [] } }
    },
    reconcileStory: async sessionId => { events.push('reconcile'); record.reconciled = sessionId },
    notifyPluginTimeline: () => {},
    rollbackTurn: async () => ({}),
    str: value => String(value === undefined || value === null ? '' : value)
  })
}

test('故事直选删除只在写后动存档，不调用 reconcileStory；旧路径仍先 reconcile', async () => {
  const events = [], record = {}
  const h = handlers(events, record)
  const story = await h.deleteMessages({ sessionId: 's1', items: [{ messageIndex: 2 }, { messageIndex: 3 }] })
  assert.deepEqual(story.deletedCount, 2)
  assert.deepEqual(events, ['cancel', 'remove'])
  assert.equal(record.reconciled, undefined)
  assert.deepEqual(record.deletion.items, [{ messageIndex: 2 }, { messageIndex: 3 }])

  events.length = 0
  await h.deleteMessages({ sessionId: 's1', items: [{ messageIndex: 2 }, { turn: 3 }] })
  assert.deepEqual(events, ['cancel', 'reconcile', 'remove'], '混用非索引项仍走旧 reconcile')
  events.length = 0
  await h.deleteMessages({ sessionId: 's1', items: [{ id: 'm1' }] })
  assert.deepEqual(events, ['cancel', 'reconcile', 'remove'])
  events.length = 0
  await h.deleteMessages({ sessionId: 's1' })
  assert.deepEqual(events, ['cancel', 'reconcile', 'remove'])
})

test('故事直选保存不先 reconcile，revision 不被写前推进', async () => {
  const events = [], record = {}
  const h = handlers(events, record)
  await h.saveBodyEdit({ sessionId: 's1', role: 'assistant', messageIndex: 4, revision: 7, token: 't', texts: ['新'] })
  assert.deepEqual(events, ['cancel', 'save'], 'assistant 直选：写前无 reconcile')
  assert.deepEqual(record.save, { sessionId: 's1', role: 'assistant', messageIndex: 4, revision: 7, token: 't', texts: ['新'] })
  events.length = 0
  await h.saveBodyEdit({ sessionId: 's1', role: 'user', messageIndex: 1, revision: 7, token: 'u', texts: ['新'] })
  assert.deepEqual(events, ['cancel', 'saveUser'], 'user 直选：写前无 reconcile')
  events.length = 0
  await h.saveBodyEdit({ sessionId: 's1', role: 'assistant', token: 't', texts: ['新'] })
  assert.deepEqual(events, ['cancel', 'reconcile', 'save'], '旧路径仍先 reconcile 再写')
})

test('getBodyEdit 的 assistant 分支把 messageIndex/revision 透传给 bodyEditor.read', async () => {
  const events = [], record = {}
  const h = handlers(events, record)
  const args = { sessionId: 's1', role: 'assistant', messageIndex: 6, revision: 11 }
  await h.getBodyEdit(args)
  assert.deepEqual(events, ['cancel', 'read'])
  assert.equal(record.read.messageIndex, 6)
  assert.equal(record.read.revision, 11)
  assert.equal(record.read.sessionId, 's1')
  events.length = 0
  await h.getBodyEdit({ sessionId: 's1', role: 'user', messageIndex: 6, revision: 11 })
  assert.deepEqual(events, ['cancel', 'readUser'])
})

// 组件级（BodyEditPanel）运行成本高：这里只做源码静态断言，标注「部分确认」。
test('BodyEditPanel 保存 payload 不丢 messageIndex/revision（静态部分确认）', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  const call = /rpc\("saveBodyEdit",\s*\{([^}]*)\}/.exec(source)
  assert.ok(call, '找不到 saveBodyEdit 调用')
  assert.match(call[1], /messageIndex:\s*edit\.messageIndex/)
  assert.match(call[1], /revision:\s*edit\.revision/)
  assert.match(source, /JSON\.stringify\(refreshed\.edit\.parts\)\s*!==\s*JSON\.stringify\(panel\.edit\.parts\)/, '过期重试必须先确认可编辑内容逐字未变')
  assert.match(source, /new CustomEvent\("dsh-tavern-story-mutated"/, '保存后仍需广播 story-mutated 让故事列表重读')
})
