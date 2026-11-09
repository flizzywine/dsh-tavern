import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRunTree } from '../tavern-plugin/lib/domain/background-run-tree.js'

const catalog = [{ task: 'settlement', name: '变量结算' }, { task: 'candidate', name: '生成选项' }, { task: 'polish', name: '正文精修' }]

test('a turn lists its moments in order, each with the background tasks it started, and what ran after a task under it', () => {
  const moments = [
    { event: 'turn-started', name: '玩家发送', at: 1000, turn: 7 },
    { event: 'reply-committed', name: '正文写完', at: 5000 },
    { event: 'turn-settled', name: '本轮结算完', at: 9000 }]
  const runs = [
    { id: 'run-1', task: 'settlement', name: '变量结算', status: 'completed', member: 'background', lane: 'resident', queuedAt: 5100, startedAt: 5100, endedAt: 8900, model: 'm', turn: 7 },
    { id: 'run-2', task: 'plugin', plugin: 'map', status: 'completed', member: 'plugin:map:surveyor', lane: 'resident', queuedAt: 9100, startedAt: 9100, endedAt: 9900 },
    { id: 'run-3', task: 'polish', name: '正文精修', status: 'completed', member: 'polish', lane: 'resident', queuedAt: 5020, startedAt: 5020, endedAt: 6000 },
    { id: 'run-4', task: 'candidate', name: '生成选项', status: 'running', member: 'background', lane: 'resident', queuedAt: 9500, startedAt: 9500 }]
  const jobRuns = [
    { id: 'auto-polish', name: '自动精修', task: 'polish', event: 'reply-committed', at: 5010, endedAt: 5030, status: 'completed' },
    { id: 'game-title', name: '对局标题', task: '', event: 'turn-settled', at: 9010, endedAt: 9020, status: 'completed' },
    { id: 'plugin:map:locate', name: '插件「map」定位', task: 'plugin:map:locate', event: 'task-finished', cause: 'settlement', turn: 7, at: 9050, endedAt: 9950, status: 'completed' },
    { id: 'plugin:phone:call', name: '插件「phone」来电', task: 'plugin:phone:call', event: 'needs', needs: ['plugin:map:locate'], turn: 7, at: 9960, endedAt: 9970, status: 'failed', error: '打不通' }]
  const [turn] = buildRunTree({ moments, jobRuns, runs, catalog, now: 10000 })
  assert.equal(turn.turn, 7)
  assert.deepEqual(turn.moments.map(item => [item.name, item.tasks.map(task => task.name)]),
    [['玩家发送', []], ['正文写完', ['自动精修', '变量结算']], ['本轮结算完', []]], 'upkeep with no background task (对局标题) is left out')
  const [polish, settlement] = turn.moments[1].tasks
  assert.deepEqual(polish.agents.map(run => run.id), ['run-3'], 'the polish Agent run belongs to 自动精修')
  assert.deepEqual(settlement.agents.map(run => [run.id, run.model]), [['run-1', 'm']])
  const [locate] = settlement.then
  assert.equal(locate.name, '插件「map」定位')
  assert.deepEqual(locate.agents.map(run => run.id), ['run-2'])
  assert.deepEqual(locate.then.map(task => [task.name, task.status, task.error]), [['插件「phone」来电', 'failed', '打不通']])
  assert.deepEqual(turn.others.map(task => [task.name, task.status]), [['生成选项', 'running']], 'started by the player, not by a moment')
})
