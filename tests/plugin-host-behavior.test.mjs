import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostBehaviorPolicies } from '../tavern-plugin/lib/domain/plugin-host-behavior.js'
import { createBackgroundAgentRunner } from '../tavern-plugin/lib/background-agent-runner.js'
import { createSettlementRun } from '../tavern-plugin/lib/domain/settlement-run.js'

test('host policy is card scoped, deny wins, and unload restores defaults', async () => {
  const policy = createHostBehaviorPolicies({ allowed: (_, id) => id === 'game' })
  const dispose = policy.register('ra2', { backgroundAgents: false })
  policy.register('other', { backgroundAgents: true })
  assert.equal((await policy.forGame('game')).backgroundAgents, false)
  assert.equal((await policy.forGame('other-game')).backgroundAgents, true)
  assert.throws(() => policy.register('bad', { unknown: false }))
  dispose()
  assert.equal((await policy.forGame('game')).backgroundAgents, true)
})

test('denied background task never creates an agent', async () => {
  const runner = createBackgroundAgentRunner({ allowRun: async () => false,
    agents: { create() { assert.fail('must not create an agent') } } })
  await assert.rejects(runner.run({ sessionId: 'game' }), { code: 'TAVERN_BACKGROUND_DISABLED' })
})

test('disabled settlement commits a no-op receipt without calling model or plugin phases', async () => {
  const chat = { id: 'chat', sessionId: 'game' }
  let committed = false
  const run = createSettlementRun({
    pluginApi: { hostBehavior: { forGame: async () => ({ backgroundAgents: false }) } },
    taskStateReader: { read: async () => chat },
    chatPersistence: { readWindow: async () => null }, readChat: async () => chat,
    backgroundTasks: { begin: async () => ({ chat, participantRequest: {}, commit: async completion => {
      completion.apply(chat); committed = true; return { status: 'completed' }
    } }) }
  })
  await run.runCycle('chat', new AbortController().signal)
  assert.equal(committed, true)
  assert.equal(chat.settleStatus, 'done')
  assert.equal(chat.lastSettle.skipped, 'plugin-host-behavior')
})
