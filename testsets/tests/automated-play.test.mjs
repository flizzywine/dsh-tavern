import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settledTurn, loadScenario } from '../lib/scenario.mjs'
import { nativeResult } from '../lib/evidence.mjs'

test('cannot advance on previous settlement, partial reply or pending MVU', () => {
  const chat = { settleStatus: 'done', messages: [{ role: 'assistant', greeting: true }, { role: 'user', text: '继续' }] }
  assert.equal(settledTurn(chat, 1, '继续').ready, false)
  chat.messages.push({ role: 'assistant', text: '正文', mvu: { pending: true } })
  assert.equal(settledTurn(chat, 1, '继续').ready, false)
  chat.messages[2].mvu.pending = false
  chat.settleStatus = 'running'
  assert.equal(settledTurn(chat, 1, '继续').ready, false)
  chat.settleStatus = 'done'
  assert.equal(settledTurn(chat, 1, '继续').ready, true)
  assert.match(settledTurn(chat, 1, '不同输入').error, /不一致/)
})

test('native completion follows the new turn, not an old end or intermediate tool step', () => {
  const events = [ { seq: 1, type: 'turn/start', data: { turn: 1 } }, { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { seq: 3, type: 'turn/start', data: { turn: 2 } }, { seq: 4, type: 'step/end', data: { turn: 2 } } ]
  assert.equal(nativeResult(events, 2).ready, false)
  events.push({ seq: 5, type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '完成' }] } } }, { seq: 6, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(nativeResult(events, 2).text, '完成')
  assert.equal(nativeResult(events, 6).ready, false)
})
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

test('dynamic inputs select by candidate type and reject stale or missing choices', async () => {
  const { selectCandidate } = await import('../lib/scenario.mjs')
  const saved = { requestId: 'round-1', messageId: 'reply-1', choices: [{ type: 'scene', text: '次日清晨' }, { type: 'action', text: '推开门' }] }
  const action = selectCandidate(saved, { candidate: 1 }, 'round-1')
  assert.equal(action.index, 1)
  assert.equal(action.input, '推开门')
  assert.equal(selectCandidate(saved, { candidate: 1, type: 'scene' }, 'round-1').input, '【场景变化】次日清晨')
  assert.throws(() => selectCandidate(saved, { candidate: 1 }, 'older-round'), /已变化/)
  assert.throws(() => selectCandidate(saved, { candidate: 2 }, 'round-1'), /不存在/)
})
