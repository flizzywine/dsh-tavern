import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { BACKGROUND_TASK_CATALOG, describeTasks, registerBackgroundTasks } from '../tavern-plugin/lib/domain/background-tasks.js'
import { createStoryEvents } from '../tavern-plugin/lib/domain/story-events.js'
import { createWorkflow } from '../tavern-plugin/lib/domain/workflow.js'

async function sources(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'client.js') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await sources(path))
    else if (entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

test('the page lines are written from the declarations: starting moments, needs and what waits', () => {
  const jobs = [{ task: 'settlement', on: ['reply-committed'], cancelOn: [], condition: '', flow: true }, { task: 'polish', on: ['reply-committed', 'turn-settled'], cancelOn: [], condition: '开启自动精修时' },
    { task: 'stage-director', on: ['reply-committed'], cancelOn: ['turn-discarded'], condition: '' }]
  const names = { 'reply-committed': '正文写完', 'turn-settled': '本轮结算完', 'turn-discarded': '回合作废' }
  const lines = Object.fromEntries(describeTasks(BACKGROUND_TASK_CATALOG, jobs, event => names[event]).map(item => [item.task, item]))
  assert.equal(lines.polish.trigger, '正文写完、本轮结算完（开启自动精修时）；点「精修」')
  assert.deepEqual(lines.polish.spec.on, [{ moments: ['正文写完', '本轮结算完'], needs: [], condition: '开启自动精修时', flow: false }])
  assert.deepEqual(lines.settlement.spec.neededBy, ['生成选项'])
  assert.deepEqual(lines['stage-director'].spec.cancelOn, ['回合作废'])
  assert.match(lines['stage-director'].waits, /^回合作废时取消；/)
  assert.equal(lines.settlement.trigger, '正文写完，由流程直接启动并等它的结果；重新生成正文后（流程启动）；失败后在酒馆状态里点重试')
  assert.equal(lines.candidate.waits, '等变量结算完成')
  assert.equal(lines.settlement.waits, '下一轮开始前要等它；生成选项要等它完成')
  assert.equal(lines.phone, undefined, 'the phone mod owns its task registration')
  assert.equal(lines.plugin.waits, '前台不在生成时才能开始；下一轮开始前要等它')
  const plugin = describeTasks([{ task: 'plugin:x:y', name: 'y', trigger: '自己的', waits: '' }], [])[0]
  assert.equal(plugin.trigger, '自己的')
})

test('one table: registering it gives the scheduler each task\'s triggers and the waits others rely on', async () => {
  const events = createStoryEvents({ logger: { warn() {} } })
  const workflow = createWorkflow({ events, tasks: BACKGROUND_TASK_CATALOG })
  const calls = []
  const stop = registerBackgroundTasks(workflow, {
    readTavernSettings: async () => ({ polishPrereview: true, castPresentation: false }), stageOn: async () => false,
    directRound: id => calls.push(['director', id]), polishPrereview: { start: id => calls.push(['polish', id]) },
    announceCast: id => calls.push(['bubbles', id]),
    backgroundTasks: { activity: () => ({ role: '', phase: 'idle' }) }, settlementJobs: { pending: () => calls.push(['settlement-wait']) },
    settlementRun: { pluginTaskJob: () => calls.push(['plugin-wait']) } })
  const jobs = Object.fromEntries(workflow.table().map(job => [job.id, job]))
  assert.deepEqual([jobs.settlement.flow, jobs.polish.task, jobs['game-title'].task, [...jobs['stage-director'].cancelOn]], [true, 'polish', '', ['turn-discarded']])
  events.emit('reply-committed', { sessionId: 'game' })
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [['polish', 'game']], 'stage is off, bubbles follow the settled turn; settlement is the flow\'s')
  await workflow.beforeNextTurn({ id: 'chat' })
  await workflow.needs('candidate', { id: 'chat' })
  assert.deepEqual(calls.slice(1), [['settlement-wait'], ['plugin-wait'], ['settlement-wait']])
  assert.deepEqual(workflow.runs('game').map(run => [run.id, run.status]).sort(), [['polish', 'completed'], ['stage-director', 'skipped']])
  stop()
  assert.deepEqual(workflow.table(), [])
})
