import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadCoordinator() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createCandidateGenerationCoordinator
}

const createCandidateGenerationCoordinator = await loadCoordinator()

test('候选 Operation 启动后只轮询持久状态，不等待长生成请求', async function () {
  const states = [
    new Error('temporary connection failure'),
    { operationId: 'operation-1', phase: 'running', busy: true },
    { operationId: 'operation-1', phase: 'idle', busy: false }
  ]
  let released = 0
  let sleeps = 0
  let terminal = null
  const coordinator = createCandidateGenerationCoordinator({
    async start() { return { operationId: 'operation-1' } },
    async activity() {
      const next = states.shift()
      if (next instanceof Error) throw next
      return next
    },
    async read() { return { candidates: { messageId: 'message-1', choices: [{ type: 'action', text: '继续前进' }] } } },
    projectBusy() { return function () { released += 1 } },
    projectTerminal(_sessionId, activity) { terminal = activity },
    async sleep() { sleeps += 1 }
  })

  const result = await coordinator.run({ sessionId: 'session-1', messageId: 'message-1' })
  assert.equal(released, 1)
  assert.equal(sleeps, 2)
  assert.equal(terminal.phase, 'idle')
  assert.equal(result.candidates.messageId, 'message-1')
})

test('候选 Operation 权威失败时解除门控并报告失败', async function () {
  let released = 0
  const coordinator = createCandidateGenerationCoordinator({
    async start() { return { operationId: 'operation-failed' } },
    async activity() { return { operationId: 'operation-failed', phase: 'failed', busy: false } },
    async read() { throw new Error('should not read') },
    projectBusy() { return function () { released += 1 } },
    async sleep() {}
  })

  await assert.rejects(
    coordinator.run({ sessionId: 'session-1', messageId: 'message-1' }),
    /候选 Agent 生成失败/
  )
  assert.equal(released, 1)
})
