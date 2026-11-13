import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlayInteractionFlow } from '../tavern-plugin/lib/domain/play-interaction-flow.js'

function flow(calls, getChoices) {
  return createPlayInteractionFlow({
    rpc: async (method, args, sessionId) => { calls.push([method, args, sessionId]); return getChoices(args) },
    coordinationView: v => v,
    coordination: { setView() {}, invalidate() {} },
    applyBodyResult() {},
    reportError() {}
  })
}

const saved = { messageId: 'tavern-regen:0d2f', choices: [{ type: 'action', text: '走近' }, { type: 'scene', text: '门开了' }], traceSessionId: 's1', traceMode: 'one-shot' }

test('前台候选项：正文自带候选项时按这一轮读一次就补上面板', async () => {
  const calls = []
  const panel = await flow(calls, () => ({ candidates: saved })).loadSavedCandidates('a', 'host-message-1')
  assert.deepEqual(calls, [['getChoices', { sessionId: 'a', messageId: 'host-message-1', latest: true }, 'a']])
  assert.equal(panel.sessionId, 'a')
  assert.equal(panel.messageId, 'host-message-1', '面板认页面手里的消息 id，不认存档里那套')
  assert.equal(panel.phase, 'ready')
  assert.deepEqual(panel.choices, [{ type: 'action', text: '走近' }, { type: 'scene', text: '门开了' }])
  assert.equal(panel.traceSessionId, 's1')
})

test('前台候选项：这一轮没存候选项时报空，已显示的面板不重读', async () => {
  const calls = []
  const interactions = flow(calls, () => ({ candidates: null }))
  interactions.candidates.set({ sessionId: 'a', messageId: 'm', phase: 'ready', choices: [{ type: 'action', text: '走近' }] })
  assert.equal(await interactions.loadSavedCandidates('a', 'm'), interactions.candidates.getSnapshot())
  assert.deepEqual(calls, [], '已显示的面板不再重读')
  assert.equal(await interactions.loadSavedCandidates('a', 'm2'), null)
})

test('前台候选项：新的一轮没有候选项时清掉上一轮已经显示好的选项', async () => {
  const interactions = flow([], () => ({ candidates: null }))
  interactions.candidates.set({ sessionId: 'a', messageId: 'old', phase: 'ready', choices: [{ type: 'action', text: '上一轮' }] })
  assert.equal(await interactions.loadSavedCandidates('a', 'new'), null)
  assert.equal(interactions.candidates.getSnapshot(), null, '旧轮次的选项不能挂在新正文下面')
})

test('前台候选项：正在生成或出错的面板不被清掉', async () => {
  for (const phase of ['loading', 'error']) {
    const interactions = flow([], () => ({ candidates: null }))
    interactions.candidates.set({ sessionId: 'a', messageId: 'old', phase, choices: [], error: phase === 'error' ? '失败' : '' })
    await interactions.loadSavedCandidates('a', 'new')
    assert.equal(interactions.candidates.getSnapshot().phase, phase, phase + ' 属于另一个在跑/待处理的请求')
  }
})

test('前台候选项：页面没有宿主消息 id 时也读，面板消息 id 跟着为空', async () => {
  const calls = []
  const panel = await flow(calls, () => ({ candidates: saved })).loadSavedCandidates('a', null)
  assert.deepEqual(calls, [['getChoices', { sessionId: 'a', messageId: '', latest: true }, 'a']])
  assert.equal(panel.messageId, null)
})

test('前台候选项：没有会话时不发请求', async () => {
  const calls = []
  const interactions = flow(calls, () => ({ candidates: saved }))
  assert.equal(await interactions.loadSavedCandidates('', 'm'), null)
  assert.deepEqual(calls, [])
})
