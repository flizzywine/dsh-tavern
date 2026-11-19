import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { BACKGROUND_TASK_CATALOG, registerBackgroundTasks } from '../tavern-plugin/lib/domain/background-tasks.js'
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

test('one table: registering it gives the scheduler each task\'s triggers and the waits others rely on', async () => {
  const events = createStoryEvents({ logger: { warn() {} } })
  const workflow = createWorkflow({ events, tasks: BACKGROUND_TASK_CATALOG })
  const calls = []
  const stop = registerBackgroundTasks(workflow, {
    readTavernSettings: async () => ({ polishPrereview: true, castPresentation: false }),
    polishPrereview: { start: id => calls.push(['polish', id]) },
    announceCast: id => calls.push(['bubbles', id]),
    backgroundTasks: { activity: () => ({ role: '', phase: 'idle' }) }, settlementJobs: { pending: () => calls.push(['settlement-wait']) },
    settlementRun: { pluginTaskJob: () => calls.push(['plugin-wait']) } })
  const jobs = Object.fromEntries(workflow.table().map(job => [job.id, job]))
  assert.deepEqual([jobs.settlement.flow, jobs.polish.task, jobs['game-title'].task, jobs['stage-director']], [true, 'polish', '', undefined])
  events.emit('reply-committed', { sessionId: 'game' })
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [['polish', 'game']], 'stage is off, bubbles follow the settled turn; settlement is the flow\'s')
  await workflow.beforeNextTurn({ id: 'chat' })
  await workflow.needs('candidate', { id: 'chat' })
  assert.deepEqual(calls.slice(1), [['settlement-wait'], ['plugin-wait'], ['settlement-wait']])
  assert.deepEqual(workflow.runs('game').map(run => [run.id, run.status]).sort(), [['polish', 'completed']])
  stop()
  assert.deepEqual(workflow.table(), [])
})
