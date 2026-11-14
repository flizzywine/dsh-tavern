import test from 'node:test'
import assert from 'node:assert/strict'
import {createManualLedger} from '../tavern-plugin/lib/domain/manual-ledger.js'
import {createManualCharacterDesign} from '../tavern-plugin/lib/domain/manual-character-design.js'

const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))

function chatRow(){
  return { id: 'c1', sessionId: 's1', mode: 'story', messages: [{ role: 'assistant', turn: 1, text: '正文' }], ledger: {} }
}

function taskRunStub(){
  return { participantRequest: { sessionId: 'bg-1', rewindTo: 0, formatVersion: 1 }, participant: () => ({}), bindSession() {}, fail: async () => {}, commit: async () => ({ status: 'committed' }) }
}

// A running task's status only reaches the page through session reads. The writes
// announce themselves; otherwise every open panel pays a full-view poll.
test('台账状态写入会通知会话，失败收尾也通知', async () => {
  const rows = new Map([['c1', chatRow()]])
  const statuses = []
  const ledger = createManualLedger({
    store: {
      chatForSession: async () => rows.get('c1'),
      updateChat: async (id, mutate) => { const draft = structuredClone(rows.get(id)); const next = mutate(draft) || draft; rows.set(id, next); return next }
    },
    runAgent: async () => null,
    selection: () => ({ provider: 'p', model: 'm' }),
    beginTask: async () => taskRunStub(),
    ensureSession: async () => {},
    replaceLedger: async () => null,
    onStatus: sessionId => statuses.push(sessionId),
    onError: () => {}
  })
  await ledger.start({ sessionId: 's1' })
  await tick()
  assert.deepEqual(statuses.slice(0, 2), ['s1', 's1'], '运行中与失败收尾各通知一次')
  assert.equal(rows.get('c1').ledgerTask.status, 'failed')
})

test('人物设计状态写入会通知会话', async () => {
  const rows = new Map([['c1', { ...chatRow(), characterDesignTask: undefined }]])
  const statuses = []
  const design = createManualCharacterDesign({
    store: {
      chatForSession: async () => rows.get('c1'),
      updateChat: async (id, mutate) => { const draft = structuredClone(rows.get(id)); const next = mutate(draft) || draft; rows.set(id, next); return next },
      readCard: async () => undefined,
      readWorldBook: async () => undefined
    },
    runAgent: async () => null,
    selection: () => ({ provider: 'p', model: 'm' }),
    beginTask: async () => taskRunStub(),
    ensureSession: async () => {},
    onStatus: sessionId => statuses.push(sessionId),
    onError: () => {}
  })
  await design.start({ sessionId: 's1', guidance: '来个侠客' })
  await tick()
  assert.ok(statuses.length >= 2)
  assert.ok(statuses.every(id => id === 's1'))
})
