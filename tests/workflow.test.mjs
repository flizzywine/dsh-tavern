import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryEvents } from '../tavern-plugin/lib/domain/story-events.js'
import { createWorkflow } from '../tavern-plugin/lib/domain/workflow.js'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('a task that needs others starts once they all finished the turn, hears their outputs; rewinding drops them', async () => {
  const events = createStoryEvents(), workflow = createWorkflow({ events, logger: { warn() {} } }), heard = []
  workflow.job({ id: 'map', on: 'task-finished', run: async ({ turn }) => ({ place: '花店', turn }) })
  workflow.job({ id: 'weather', on: 'task-finished', run: () => '雨' })
  workflow.job({ id: 'phone', needs: ['map', 'weather'], run: ({ gameId, turn, needs }) => { heard.push([gameId, turn, needs]) } })
  assert.throws(() => workflow.job({ id: 'self', needs: ['self'], run() {} }), /不能等它自己/)
  events.emit('task-finished', { sessionId: 'game', turn: 3 })
  await tick(); await tick()
  assert.deepEqual(heard, [['game', 3, { map: { place: '花店', turn: 3 }, weather: '雨' }]])
  assert.deepEqual(workflow.output('game', 3, 'map'), { place: '花店', turn: 3 })
  assert.equal(workflow.output('game', 3, 'phone'), null, 'a run that returns nothing still finished')
  // It runs once per turn, however often what it needs finishes again.
  events.emit('task-finished', { sessionId: 'game', turn: 3 })
  await tick(); await tick()
  assert.equal(heard.length, 1)
  assert.deepEqual(events.table().find(row => row.event === 'story-rewound').followers, ['作废任务产出'])
  events.emit('story-rewound', { sessionId: 'game', kind: 'rollback', turn: 3 })
  assert.equal(workflow.output('game', 3, 'map'), undefined)
  // Taken back, the turn is played again: it runs again.
  events.emit('task-finished', { sessionId: 'game', turn: 3 })
  await tick(); await tick()
  assert.equal(heard.length, 2)
  // A moment with no turn keeps no output.
  events.emit('task-finished', { sessionId: 'game' })
  await tick(); await tick()
  assert.equal(heard.length, 2)
})
