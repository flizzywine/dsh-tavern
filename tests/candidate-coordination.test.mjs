import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

async function loadCoordinator() {
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } }, setTimeout, clearTimeout }, console, AbortController }
  vm.runInNewContext(source, sandbox)
  return descriptor.factory(function () { return {} }).createCandidateGenerationCoordinator
}

const createCandidateGenerationCoordinator = await loadCoordinator()

test('候选 Operation 启动后只轮询持久状态，不等待长生成请求', async function () {
  const operations = [
    new Error('temporary connection failure'),
    { operationId: 'operation-1', status: 'running', terminal: false, successful: false },
    { operationId: 'operation-1', status: 'completed', terminal: true, successful: true }
  ]
  let released = 0
  let sleeps = 0
  const coordinator = createCandidateGenerationCoordinator({
    async start() { return { operationId: 'operation-1' } },
    async operation(_sessionId, operationId) {
      assert.equal(operationId, 'operation-1')
      const next = operations.shift()
      if (next instanceof Error) throw next
      return next
    },
    async read() { return { candidates: { messageId: 'message-1', choices: [{ type: 'action', text: '继续前进' }] } } },
    projectBusy() { return function () { released += 1 } },
    async sleep() { sleeps += 1 }
  })

  const result = await coordinator.run({ sessionId: 'session-1', messageId: 'message-1' })
  assert.equal(released, 1)
  assert.equal(sleeps, 2)
  assert.equal(result.candidates.messageId, 'message-1')
})

test('候选 Operation 权威失败时解除门控并报告失败', async function () {
  let released = 0
  const coordinator = createCandidateGenerationCoordinator({
    async start() { return { operationId: 'operation-failed' } },
    async operation() { return { operationId: 'operation-failed', status: 'failed', terminal: true, successful: false } },
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

test('候选 Operation 被重启中断时立即结束等待，不把中断当成耗时超时', async function () {
  const coordinator = createCandidateGenerationCoordinator({
    async start() { return { operationId: 'operation-interrupted' } },
    async operation() { return { operationId: 'operation-interrupted', status: 'interrupted', terminal: true, successful: false } },
    async read() { throw new Error('should not read') },
    projectBusy() { return function () {} },
    async sleep() {}
  })

  await assert.rejects(
    coordinator.run({ sessionId: 'session-1', messageId: 'message-1' }),
    /后台重启中断了本次候选生成/
  )
})

test('候选启动响应丢失时用同一请求标识重试，不会永久停在生成中', async function () {
  let starts = 0
  const coordinator = createCandidateGenerationCoordinator({
    id() { return 'candidate-request-1' },
    async start(input) {
      starts += 1
      assert.equal(input.requestId, 'candidate-request-1')
      if (starts === 1) return await new Promise(function () {})
      return { operationId: 'operation-1' }
    },
    async operation() { return { operationId: 'operation-1', status: 'completed', terminal: true, successful: true } },
    async read() { return { candidates: { messageId: 'message-1', choices: [{ type: 'action', text: '继续前进' }] } } },
    projectBusy() { return function () {} },
    async sleep() {},
    queryTimeoutMs: 5
  })

  const result = await Promise.race([
    coordinator.run({ sessionId: 'session-1', messageId: 'message-1' }),
    new Promise(function (resolve) { setTimeout(function () { resolve('STUCK') }, 30) })
  ])

  assert.notEqual(result, 'STUCK')
  assert.equal(starts, 2)
  assert.equal(result.candidates.messageId, 'message-1')
})
