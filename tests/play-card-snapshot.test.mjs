import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { createPlayCardSnapshots } from '../tavern-plugin/lib/domain/play-card-snapshots.js'

test('v4 老对话重建完整固定前缀，v5 后续请求和恢复复用快照', async () => {
  const card = { name: '测试人物', description: '固定描述', personality: '固定性格', scenario: '固定场景', mes_example: '固定示例', system_prompt: '逐轮系统指令', post_history_instructions: '逐轮历史后指令' }
  let reads = 0
  const writes = []
  function open() {
    return createPlayCardSnapshots({
      worldBooks: { async bound(path) {
        assert.equal(path, 'cards/测试人物.json')
        return { view: { entries: [
          { constant: true, content: '固定世界设定' },
          { constant: false, content: '动态条目不得进入前缀' },
          { constant: true, comment: '[mvu_update]规则', content: 'MVU规则不得进入前缀' }
        ] } }
      } },
      planner: createContextPlanner({ prompt: () => '' }),
      readCard: async () => { reads++; return card },
      writeChat: async (chat, metadata) => { writes.push({ chat: structuredClone(chat), metadata }) }
    }).ensure
  }
  const chat = { id: 'old-chat', mode: 'story', cardPath: 'cards/测试人物.json', cardContextSnapshotVersion: 4, cardContextSnapshot: '旧前缀缺少描述性格', messages: [{ role: 'assistant', text: '原有剧情' }] }
  const beforeMessages = structuredClone(chat.messages)
  const ensure = open()
  const first = await ensure(chat)
  assert.equal(chat.cardContextSnapshotVersion, 5)
  for (const fixed of ['固定描述', '固定性格', '固定场景', '固定示例', '固定世界设定']) assert.equal(first.split(fixed).length - 1, 1)
  assert.doesNotMatch(first, /旧前缀|逐轮|动态条目|MVU规则/)
  assert.equal(await ensure(chat), first)
  assert.equal(await open()(structuredClone(chat)), first)
  assert.equal(reads, 1)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].metadata.source, 'card-context.snapshot')
  assert.deepEqual(chat.messages, beforeMessages)
})

function fixture() {
  let reads = 0, writes = 0, builds = 0
  let plan = async () => ({ text: '固定背景' })
  let write = async () => {}
  const api = createPlayCardSnapshots({
    worldBooks: { bound: async () => null },
    planner: { async plan(input) { builds++; return plan(input) } },
    readCard: async () => { reads++; return { name: '测试' } },
    writeChat: async (...args) => { writes++; return write(...args) }, logger: { warn() {} }
  })
  return { api, get counts() { return { reads, writes, builds } }, plan(fn) { plan = fn }, write(fn) { write = fn } }
}
const oldChat = () => ({ id: 'chat', mode: 'story', messages: [{ text: '既有剧情' }], cardContextSnapshot: '旧前缀', cardContextSnapshotVersion: 4, _storageRevision: 7 })

test('preparing a new chat does not publish it; card workspace and current snapshots do not rebuild', async () => {
  const h = fixture(), chat = oldChat()
  assert.equal(await h.api.prepare(chat), '固定背景')
  assert.equal(h.counts.writes, 0)
  assert.equal(await h.api.ensure(chat), '固定背景')
  assert.equal(await h.api.ensure({ ...oldChat(), mode: 'card' }), '')
  assert.equal(await h.api.ensure(undefined), '')
  assert.deepEqual(h.counts, { reads: 1, writes: 0, builds: 1 })
  assert.deepEqual(chat.messages, [{ text: '既有剧情' }])
})

test('concurrent readers share one migration and all receive its fields without borrowing another storage revision', async () => {
  const h = fixture(), first = oldChat(), second = oldChat()
  let finish
  h.plan(() => new Promise(resolve => { finish = resolve }))
  h.write(async draft => { draft._storageRevision = 8 })
  const one = h.api.ensure(first), two = h.api.ensure(second)
  await new Promise(resolve => setImmediate(resolve))
  finish({ text: '统一前缀' })
  assert.deepEqual(await Promise.all([one, two]), ['统一前缀', '统一前缀'])
  assert.equal(first.cardContextSnapshotVersion, 5)
  assert.equal(second.cardContextSnapshotVersion, 5)
  assert.equal(first._storageRevision, 8)
  assert.equal(second._storageRevision, 7)
  assert.deepEqual(h.counts, { reads: 1, writes: 1, builds: 1 })
})

test('failed save leaves caller state intact, releases concurrent build and permits retry', async () => {
  const h = fixture(), chat = oldChat(), before = structuredClone(chat)
  h.write(async () => { throw Error('disk full') })
  await assert.rejects(h.api.ensure(chat), /disk full/)
  assert.deepEqual(chat, before)
  h.write(async () => {})
  assert.equal(await h.api.ensure(chat), '固定背景')
  assert.equal(chat.cardContextSnapshotVersion, 5)
  assert.equal(h.counts.writes, 2)
})

test('failed plan is retryable and does not publish or mutate a new chat', async () => {
  const h = fixture(), chat = oldChat(), before = structuredClone(chat)
  h.plan(async () => { throw Error('projection failure') })
  await assert.rejects(h.api.prepare(chat), /projection failure/)
  await assert.rejects(h.api.ensure(chat), /projection failure/)
  assert.deepEqual(chat, before)
  assert.equal(h.counts.writes, 0)
  h.plan(async () => ({ text: '恢复' }))
  assert.equal(await h.api.ensure(chat), '恢复')
})

test('missing worldbook is isolated and a newer saved snapshot is preserved', async () => {
  const warnings = [], plans = [], writes = []
  const api = createPlayCardSnapshots({
    worldBooks: { bound: async () => { throw Error('missing worldbook') } },
    planner: { async plan(input) { plans.push(input); return { text: '人物背景' } } },
    readCard: async () => ({ name: '角色' }), writeChat: async (...args) => writes.push(args),
    logger: { warn: (...args) => warnings.push(args) }
  })
  assert.equal(await api.ensure(oldChat()), '人物背景')
  assert.equal(warnings.length, 1)
  assert.equal(plans[0].worldBookContext, '')
  const current = { ...oldChat(), cardContextSnapshot: '未来版本前缀', cardContextSnapshotVersion: 8 }
  assert.equal(await api.ensure(current), '未来版本前缀')
  assert.equal(current.cardContextSnapshotVersion, 8)
  assert.equal(writes.length, 1)
})

test('snapshot owner exposes the same stable worldbook context to candidate generation', async () => {
  const warnings = []
  const api = createPlayCardSnapshots({
    worldBooks: { async bound(path, card) {
      assert.equal(path, 'cards/test.json')
      assert.equal(card.name, 'Test')
      return { view: { entries: [
        { constant: true, content: 'stable lore' },
        { constant: false, content: 'dynamic lore' }
      ] } }
    } },
    planner: { async plan() { return { text: '' } } },
    readCard: async () => ({ name: 'Test' }),
    writeChat: async () => {},
    logger: { warn: (...args) => warnings.push(args) }
  })
  const chat = { cardPath: 'cards/test.json' }
  assert.equal(await api.constantContext(chat, { name: 'Test' }), 'stable lore')
  assert.equal(warnings.length, 0)
})


test('sanitizing an existing snapshot is not visible until its save succeeds', async () => {
  const h = fixture(), chat = { ...oldChat(), cardContextSnapshotVersion: 5, cardContextSnapshot: '{{literal}}' }
  const before = structuredClone(chat)
  h.write(async () => { throw Error('disk full') })
  await assert.rejects(h.api.ensure(chat), /disk full/)
  assert.deepEqual(chat, before)
  h.write(async () => {})
  assert.equal(await h.api.ensure(chat), 'literal')
  assert.equal(h.counts.builds, 0)
})

test('snapshot migration cannot manufacture a past worldbook archive from current files', async () => {
  let captures = 0
  const api = createPlayCardSnapshots({ worldBooks: { bound: async () => ({ view: { entries: [] } }) },
    readCard: async () => ({}), planner: { plan: async () => ({ text: '迁移前缀' }) }, writeChat: async () => {},
    captureSceneWorldbook: async () => { captures++; return { version: 1, digest: 'd'.repeat(64) } } })
  const chat = oldChat()
  await api.ensure(chat)
  assert.equal(captures, 0)
  assert.equal(chat.sceneOpeningWorldbook, undefined)
})

test('migration adopts merged persistence state; another reader retains its baseline for later writes', async () => {
  let stored = { ...oldChat(), posture: '原姿势', customUnknown: { keep: true } }
  const persistence = createChatPersistence({ store: {
    read: async () => structuredClone(stored),
    update: async (_id, fn) => { stored = await fn(structuredClone(stored)); return structuredClone(stored) },
    remove: async () => {}
  } })
  const owner = await persistence.read('chat'), waiter = await persistence.read('chat')
  let finish
  const api = createPlayCardSnapshots({ worldBooks: { bound: async () => null }, readCard: async () => ({}),
    planner: { plan: () => new Promise(resolve => { finish = resolve }) }, writeChat: persistence.write })
  const first = api.ensure(owner), second = api.ensure(waiter)
  await new Promise(resolve => setImmediate(resolve))
  await persistence.update('chat', chat => { chat.posture = '新姿势'; return chat })
  finish({ text: '新版背景' })
  await Promise.all([first, second])
  assert.equal(owner.posture, '新姿势')
  assert.deepEqual(owner.customUnknown, { keep: true })
  assert.equal(waiter._storageRevision, 7)
  waiter.messages.push({ text: '并发读取者继续对话' })
  await persistence.write(waiter)
  assert.equal(stored.posture, '新姿势')
  assert.deepEqual(stored.customUnknown, { keep: true })
  assert.equal(stored.cardContextSnapshot, '新版背景')
  assert.equal(stored.messages.length, 2)
})
