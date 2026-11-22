import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayInteractionFlow } from '../tavern-plugin/lib/domain/play-interaction-flow.js'

function flow(calls, getChoices, options) {
  return createPlayInteractionFlow({
    rpc: async (method, args, sessionId) => { calls.push([method, args, sessionId]); return getChoices(args) },
    coordinationView: v => v,
    coordination: { setView() {}, invalidate() {} },
    applyBodyResult() {},
    reportError() {}, ...options
  })
}

const saved = { messageId: 'tavern-regen:0d2f', choices: [{ type: 'action', text: '走近' }, { type: 'scene', text: '门开了' }], traceSessionId: 's1', traceMode: 'one-shot' }
const round = (messageId, extras) => ({ sessionId: 'a', messageId, running: false, ...extras })

test('前台候选项：这一轮没存候选项时报空，已显示的面板不重读', async () => {
  const calls = []
  const interactions = flow(calls, () => ({ candidates: null }))
  interactions.candidates.set({ sessionId: 'a', messageId: 'm', phase: 'ready', choices: [{ type: 'action', text: '走近' }] })
  assert.equal(await interactions.syncCandidateRound(round('m')), interactions.candidates.getSnapshot())
  assert.deepEqual(calls, [], '已显示的面板不再重读')
  assert.equal(await interactions.syncCandidateRound(round('m2')), null)
  assert.equal(interactions.candidates.getSnapshot(), null)
})

test('已取消的读取晚到时不会覆盖新一轮候选项', async () => {
  const pending = Promise.withResolvers()
  const interactions = flow([], ({ messageId }) => messageId === 'old' ? pending.promise : { candidates: saved })
  const controller = new AbortController()
  const oldRead = interactions.syncCandidateRound(round('old'), controller.signal)
  controller.abort()
  const current = await interactions.syncCandidateRound(round('new'))
  pending.resolve({ candidates: { choices: ['上一轮'] } })
  assert.equal(await oldRead, null)
  assert.equal(interactions.candidates.getSnapshot(), current)
  assert.equal(current.messageId, 'new')
})

test('正文运行后，即使仍是同一个消息 id，旧读取也不能重新显示候选', async () => {
  const pending = Promise.withResolvers()
  const calls = []
  const interactions = flow(calls, () => calls.length === 1 ? pending.promise : { candidates: null })
  const oldRead = interactions.syncCandidateRound(round('m'))
  assert.equal(interactions.syncCandidateRound(round('m', { running: true })), null)
  assert.equal(await interactions.syncCandidateRound(round('m')), null)
  pending.resolve({ candidates: saved })
  assert.equal(await oldRead, null)
  assert.equal(interactions.candidates.getSnapshot(), null)
})

test('两个界面观察同一候选任务时，任务结果只应用一次，关闭后不再弹出', () => {
  const calls = [], dismissed = new Set()
  const interactions = flow(calls, () => null, { candidateErrorDismissed: key => dismissed.has(key) })
  const task = { taskId: 'job', version: 1, status: 'running', busy: true }
  assert.equal(interactions.syncCandidateRound(round('m', { task })).phase, 'loading')
  const succeeded = { ...task, version: 2, status: 'succeeded', busy: false, result: { candidates: saved } }
  assert.equal(interactions.syncCandidateRound(round('m', { task: succeeded })).phase, 'ready')
  interactions.candidates.set(null)
  assert.equal(interactions.syncCandidateRound(round('m', { task: { ...succeeded } })), null)

  const cancelled = { ...task, version: 3, status: 'cancelled', busy: false, terminal: true }
  assert.equal(interactions.syncCandidateRound(round('m', { task: cancelled })), null)
  const failed = { ...cancelled, version: 4, status: 'failed', error: '模型失败' }
  const error = interactions.syncCandidateRound(round('m', { task: failed }))
  assert.equal(error.phase, 'error')
  dismissed.add(error.taskKey)
  interactions.candidates.set(null)
  interactions.syncCandidateRound(round('new', { running: true }))
  assert.equal(interactions.syncCandidateRound(round('m', { task: failed })), null)
  assert.deepEqual(calls, [])
})

test('前台开始后撤下候选和引导框，上一轮提交的迟到错误不会恢复面板', async () => {
  const submitted = Promise.withResolvers()
  const requests = []
  const interactions = flow(requests, () => submitted.promise)
  interactions.guide.set({ sessionId: 'a', messageId: 'old', phase: 'input' })
  const pending = interactions.generateCandidates('a', 'old')
  assert.equal(interactions.candidates.getSnapshot().phase, 'loading')
  assert.equal(interactions.syncCandidateRound(round('old', { running: true })), null)
  assert.equal(interactions.guide.getSnapshot(), null)
  submitted.reject(new Error('任务已过期'))
  assert.equal(await pending, null)
  assert.equal(interactions.candidates.getSnapshot(), null)
  assert.deepEqual(requests.map(([method]) => method), ['submitTask'])
})
