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

test('前台候选项：正文自带候选项时按消息读一次就补上面板', async () => {
  const calls = []
  const panel = await flow(calls, () => ({ candidates: { choices: [{ type: 'action', text: '走近' }, { type: 'scene', text: '门开了' }], traceSessionId: 's1', traceMode: 'one-shot' } })).loadSavedCandidates('a', 'm')
  assert.deepEqual(calls, [['getChoices', { sessionId: 'a', messageId: 'm' }, 'a']])
  assert.equal(panel.sessionId, 'a')
  assert.equal(panel.messageId, 'm')
  assert.equal(panel.phase, 'ready')
  assert.deepEqual(panel.choices, [{ type: 'action', text: '走近' }, { type: 'scene', text: '门开了' }])
  assert.equal(panel.traceSessionId, 's1')
})

test('前台候选项：这一轮没存候选项时报空，不覆盖已有面板', async () => {
  const calls = []
  const interactions = flow(calls, () => ({ candidates: null }))
  interactions.candidates.set({ sessionId: 'a', messageId: 'm', phase: 'ready', choices: [{ type: 'action', text: '走近' }] })
  assert.equal(await interactions.loadSavedCandidates('a', 'm'), interactions.candidates.getSnapshot())
  assert.deepEqual(calls, [], '已显示的面板不再重读')
  assert.equal(await interactions.loadSavedCandidates('a', 'm2'), null)
  assert.equal(interactions.candidates.getSnapshot().messageId, 'm', '别的轮次没有候选项就保持原样')
})

test('前台候选项：没有会话或消息时不发请求', async () => {
  const calls = []
  const interactions = flow(calls, () => ({ candidates: {} }))
  assert.equal(await interactions.loadSavedCandidates('', 'm'), null)
  assert.equal(await interactions.loadSavedCandidates('a', ''), null)
  assert.deepEqual(calls, [])
})
