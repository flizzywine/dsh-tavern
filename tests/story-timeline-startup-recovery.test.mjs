// 启动恢复在服务就绪之后才跑：恢复期间开始的这一轮，它的后台结算属于本进程，不能被当成上次留下的孤儿中断。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

test('startup recovery interrupts only work an earlier process left running', () => {
  let next = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + ++next, now: () => 500 })
  const settlement = (id, createdAt) => ({ id, kind: 'agent', role: 'settlement', status: 'running', createdAt, basedOn: { branchId: 'b', revision: 3 } })
  const chat = { id: 'c', messages: [], timeline: { schemaVersion: 1, branchId: 'b', revision: 3, participants: {}, checkpoints: [],
    operations: { old: settlement('old', 100), fresh: settlement('fresh', 300) } } }
  const recovered = timeline.apply({ chat, intent: { kind: 'background.recover', startedBefore: 200 } }).chat
  assert.equal(recovered.timeline.operations.old.status, 'interrupted')
  assert.equal(recovered.timeline.operations.fresh.status, 'running')
  // Without a startup time (a player's stop, a stuck commit) every running task is recovered, as before.
  const all = timeline.apply({ chat, intent: { kind: 'background.recover' } }).chat
  assert.equal(all.timeline.operations.fresh.status, 'interrupted')
})
