import assert from 'node:assert/strict'
import test from 'node:test'

import { waitForAgentSession } from '../tavern-plugin/lib/domain/agent-readiness.js'

test('等待延迟注册的 Agent 后返回可写会话', async () => {
  let lookups = 0
  const readyAgent = { session: { id: 'session-delayed' } }
  const registry = {
    get() {
      lookups += 1
      return lookups < 3 ? undefined : readyAgent
    }
  }
  const waits = []

  const agent = await waitForAgentSession({
    registry,
    sessionId: 'session-delayed',
    attempts: 4,
    intervalMs: 25,
    sleep: async function (ms) { waits.push(ms) }
  })

  assert.equal(agent, readyAgent)
  assert.deepEqual(waits, [25, 25])
})

test('Agent 始终未注册时在有限重试后报错', async () => {
  let lookups = 0

  await assert.rejects(
    waitForAgentSession({
      registry: { get() { lookups += 1; return undefined } },
      sessionId: 'session-missing',
      attempts: 3,
      intervalMs: 10,
      sleep: async function () {}
    }),
    /无法写入 DSH 会话开场白: session-missing/
  )
  assert.equal(lookups, 3)
})
