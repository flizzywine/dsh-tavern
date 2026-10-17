import { projectChatSessionState } from '../tavern-plugin/lib/domain/chat-session-state.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoCompaction, compactionPolicy } from '../tavern-plugin/lib/domain/auto-compaction.js'
function fixture() {
  let chat = { id: 'chat', mode: 'story', sessionId: 'front', messages: [], timeline: { branchId: 'main', participants: { background: { sessionId: 'back' } } } }
  let policy = { mode: 'manual' }, activity = { phase: 'idle' }, pressure = 0, fail = '', evidence = 'succeeded'
  const calls = [], deps = {
    readState: async () => projectChatSessionState(chat),
    readChat: async () => structuredClone(chat), updateChat: async (_id, fn) => { chat = fn(structuredClone(chat)); return structuredClone(chat) },
    policy: async () => policy, activity: () => activity, pressure: async () => pressure === null ? null : { percent: pressure },
    exclusive: async (_id, fn) => fn(), checkpoint: async () => 7, recover: async () => evidence, markBackground: async () => {},
    compact: async (id, side) => { calls.push(side); if (fail === side) throw new Error('fixture failure'); return { message: 'done' } }
  }
  let service = createAutoCompaction(deps)
  return { calls, deps, get chat() { return chat }, set policy(v) { policy = v }, set activity(v) { activity = v }, set pressure(v) { pressure = v }, set fail(v) { fail = v },
    run: options => service.run('front', options), round(n) { chat.messages.push({ role: 'assistant', turn: n }) },
    restart() { service = createAutoCompaction(deps) }, blocked: () => service.blocked(chat) }
}
test('default manual disables only the extra joint schedule; settings validate bounds', async () => {
  assert.equal(compactionPolicy().mode, 'manual')
  for (const policy of [{ mode: 'bad' }, { rounds: 0 }, { percent: 100 }, { rounds: 1.5 }]) assert.throws(() => compactionPolicy(policy))
  const h = fixture(); h.pressure = 100; h.round(1); await h.run(); assert.deepEqual(h.calls, [])
})
test('idle manual checks after rollback do not write metadata and invalidate its undo revision', async () => {
  const h = fixture()
  h.chat.timeline.branchId = 'rolled-back'
  h.chat._storageRevision = 23
  h.chat.rollbackUndo = { ready: true, storageRevision: 23 }
  h.chat.contextCompaction = { branch: 'main', operation: null }
  let writes = 0
  const update = h.deps.updateChat
  h.deps.updateChat = (...args) => { writes++; return update(...args) }
  const before = structuredClone(h.chat)
  await h.run()
  assert.equal(writes, 0)
  assert.deepEqual(h.chat, before)
})

test('percent mode, unknown capacity, no-progress suppression and branch reset', async () => {
  const h = fixture(); h.policy = { mode: 'percent', percent: 80 }; h.pressure = null; await h.run(); assert.match(h.chat.contextCompaction.warning, /容量/)
  h.pressure = 79; await h.run(); assert.equal(h.calls.length, 0)
  h.pressure = 80; await h.run(); assert.equal(h.calls.length, 2)
  await h.run(); assert.equal(h.calls.length, 2)
  h.chat.timeline.branchId = 'fork'; h.policy = { mode: 'rounds', rounds: 1 }; await h.run(); assert.equal(h.calls.length, 2)
  h.round(1); await h.run(); assert.equal(h.calls.length, 4)
})

test('an unavailable previously successful side does not block retrying the other side', async () => {
  const h = fixture(); h.fail = 'foreground'; await h.run({ manual: true })
  h.fail = ''; h.deps.checkpoint = async id => { if (id === 'back') throw Error('missing background session'); return 7 }
  await h.run({ manual: true })
  assert.equal(h.chat.contextCompaction.operation.foreground.status, 'succeeded')
  assert.equal(h.chat.contextCompaction.operation.background.status, 'failed')
  assert.deepEqual(h.calls, ['foreground', 'background', 'foreground'])
})

test('manual request joining an automatic no-op still executes, concurrent clicks share the work', async () => {
  const h = fixture()
  let release
  const gate = new Promise(resolve => { release = resolve })
  h.deps.policy = async () => { await gate; return { mode: 'manual' } }
  const automatic = h.run()
  await new Promise(resolve => setImmediate(resolve))
  const first = h.run({ manual: true }), second = h.run({ manual: true })
  await new Promise(resolve => setImmediate(resolve)); release()
  await automatic
  assert.equal((await first).status, 'completed')
  assert.equal((await second).status, 'completed')
  assert.deepEqual(h.calls, ['foreground', 'background'])
})

test('manual retry joining an automatic failure suppression still retries the failed side', async () => {
  const h = fixture(); h.policy = { mode: 'rounds', rounds: 1 }; await h.run(); h.round(1)
  h.fail = 'background'; await h.run(); h.fail = ''
  let release
  const gate = new Promise(resolve => { release = resolve })
  h.deps.policy = async () => { await gate; return { mode: 'rounds', rounds: 1 } }
  const automatic = h.run(); await new Promise(resolve => setImmediate(resolve))
  const manual = h.run({ manual: true }); await new Promise(resolve => setImmediate(resolve)); release()
  await automatic; assert.equal((await manual).status, 'completed')
  assert.deepEqual(h.calls, ['foreground', 'background', 'background'])
})

test('cancellation during the final measurement still publishes committed results', async () => {
  const h = fixture(); h.policy = { mode: 'percent', percent: 80 }
  const controller = new AbortController()
  h.deps.pressure = async () => { controller.abort(); controller.signal.throwIfAborted() }
  const result = await h.run({ manual: true, signal: controller.signal })
  assert.equal(result.status, 'completed')
  assert.equal(h.blocked(), false)
  assert.deepEqual(h.calls, ['foreground', 'background'])
})

test('manual policy bypasses summary history but enabled policies and running recovery retain it',async()=>{
  const h=fixture()
  h.deps.readMetadata=async()=>({id:'chat',sessionId:'front',mode:'story',contextCompaction:h.chat.contextCompaction})
  let reads=0
  const read=h.deps.readState
  h.deps.readState=async(...args)=>{reads++;return read(...args)}
  await h.run()
  assert.equal(reads,0)
  h.policy={mode:'rounds',rounds:2}
  await h.run()
  assert.equal(reads,1)
  await h.run({manual:true})
  assert.ok(reads>1)
  const beforeRecovery=reads
  h.policy={mode:'manual'}
  // Reuse a real operation shape and re-enter durable recovery on the manual policy.
  h.chat.contextCompaction.operation.status='running'
  await h.run()
  assert.ok(reads>beforeRecovery)
})
