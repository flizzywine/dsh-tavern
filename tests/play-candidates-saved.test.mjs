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

test('前台候选项：这一轮没存候选项时报空，已显示的面板不重读', async () => {
  const calls = []
  const interactions = flow(calls, () => ({ candidates: null }))
  interactions.candidates.set({ sessionId: 'a', messageId: 'm', phase: 'ready', choices: [{ type: 'action', text: '走近' }] })
  assert.equal(await interactions.loadSavedCandidates('a', 'm'), interactions.candidates.getSnapshot())
  assert.deepEqual(calls, [], '已显示的面板不再重读')
  assert.equal(await interactions.loadSavedCandidates('a', 'm2'), null)
  assert.equal(interactions.candidates.getSnapshot(), null)
})

test('已取消的读取晚到时不会覆盖新一轮候选项', async () => {
  const pending = Promise.withResolvers()
  const interactions = flow([], ({ messageId }) => messageId === 'old' ? pending.promise : { candidates: saved })
  const controller = new AbortController()
  const oldRead = interactions.loadSavedCandidates('a', 'old', controller.signal)
  controller.abort()
  const current = await interactions.loadSavedCandidates('a', 'new')
  pending.resolve({ candidates: { choices: ['上一轮'] } })
  assert.equal(await oldRead, null)
  assert.equal(interactions.candidates.getSnapshot(), current)
  assert.equal(current.messageId, 'new')
})
