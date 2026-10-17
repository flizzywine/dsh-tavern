import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadScenario } from "../lib/scenario.mjs"

test('scenario validation rejects unsupported assertions and image outside play', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'play-scenario-'))
  const file = path.join(root, 'test.json')
  const base = { model: { provider: 'p', model: 'm' }, steps: [{ action: 'card' }, { action: 'say', input: 'test' }] }
  try {
    await writeFile(file, JSON.stringify(base)); assert.equal((await loadScenario(file)).steps.length, 2)
    base.steps.push({ action: 'image' }); await writeFile(file, JSON.stringify(base)); await assert.rejects(loadScenario(file), /游玩对话/)
    base.steps.pop(); base.steps[1].expect = { typo: true }; await writeFile(file, JSON.stringify(base)); await assert.rejects(loadScenario(file), /不支持的断言/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('refusal marks keep service errors and fictional dialogue separate', async () => {
  const { classifyResponse, refusalPatterns, requestChecks } = await import('../lib/refusal.mjs')
  assert.equal(classifyResponse({ text: '抱歉，我无法帮助你完成这个请求。' }).refused, true)
  assert.equal(classifyResponse({ text: "I cannot assist with that request." }).verdict, '未通过')
  assert.equal(classifyResponse({ text: '阿芙拉摇头说：“抱歉，我无法帮助你。”' }).refused, false)
  assert.equal(classifyResponse({ text: '她把麦酒推到你面前。' }).verdict, '通过')
  assert.equal(classifyResponse({ error: 'HTTP 429', completed: false }).refused, null)
  assert.equal(classifyResponse({ finish: 'content_filter', completed: false }).refused, true)
  assert.equal(classifyResponse({ text: '拒绝标记' }, refusalPatterns(['^拒绝标记$'])).refused, true)
  assert.throws(() => refusalPatterns(['[']), SyntaxError)
  const checks = requestChecks([{ id: 'a', scope: 'background', task: 'settlement', status: 'completed', response: { text: '抱歉，我不能提供此类信息。' } }, { id: 'b', scope: 'background', task: 'scene-image', status: 'completed', response: {} }], 'story', refusalPatterns())
  assert.equal(checks[0].agent, 'background'); assert.equal(checks[0].refused, true)
  assert.equal(checks[1].agent, 'image'); assert.equal(checks[1].refused, false)
})

test('foreground success cannot pass a missing or failed background chain', async () => {
  const { backgroundChain } = await import('../lib/recording.mjs')
  const foreground = { id: 'fg', scope: 'foreground', status: 'completed' }
  assert.equal(backgroundChain([foreground]).passed, false)
  assert.equal(backgroundChain([foreground], false).status, 'not-invoked')
  assert.equal(backgroundChain([foreground], false).passed, true)
  for (const status of ['running', 'failed', 'cancelled']) {
    assert.equal(backgroundChain([{ id: 'bg', scope: 'background', task: 'posture', status }]).passed, false)
  }
  assert.equal(backgroundChain([{ id: 'bg', scope: 'background', task: 'posture', status: 'completed' }]).passed, true)
})

test('recording preserves failed subagent output even if the chat journal is unreadable', async () => {
  const { captureStep } = await import('../lib/recording.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-evidence-'))
  try {
    const evidence = {
      chat: async () => { throw new Error('broken journal') },
      requests: async () => [{ id: 'old', sessionId: 'old-session' }, { id: 'new', scope: 'background', sessionId: 'bg', status: 'failed', response: { text: 'partial output', error: 'provider error' } }],
      native: async id => { assert.equal(id, 'bg'); return [{ seq: 1, type: 'error', data: 'provider error' }] },
    }
    const result = await captureStep({ evidence, chatId: 'chat', prefix: path.join(root, '02'), beforeRequestIds: ['old'] })
    assert.deepEqual(result.errors, [{ source: 'chat', error: 'broken journal' }])
    const requests = JSON.parse(await readFile(path.join(root, '02-requests.json'), 'utf8'))
    assert.deepEqual(requests.map(r => r.id), ['new'])
    assert.equal(requests[0].response.text, 'partial output')
    assert.equal(JSON.parse(await readFile(path.join(root, '02-subagent-native-bg.json'), 'utf8'))[0].type, 'error')
  } finally { await rm(root, { recursive: true, force: true }) }
})
