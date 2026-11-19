import test from 'node:test'
import assert from 'node:assert/strict'
import {createManualLedger} from '../tavern-plugin/lib/domain/manual-ledger.js'
import {createManualCharacterDesign} from '../tavern-plugin/lib/domain/manual-character-design.js'
import { withHostAgent } from '../tavern-plugin/lib/host/sessions.js'

function chatRow(){
  return { id: 'c1', sessionId: 's1', mode: 'story', messages: [{ role: 'assistant', turn: 1, text: '正文' }], ledger: {} }
}

function taskRunStub(){
  return { participantRequest: { sessionId: 'bg-1', rewindTo: 0, formatVersion: 1 }, participant: () => ({}), bindSession() {}, fail: async () => {}, commit: async () => ({ status: 'committed' }) }
}

for (const [createTask, statusField] of [
  [createManualLedger, 'ledgerTask'],
  [createManualCharacterDesign, 'characterDesignTask']
]) test(`${statusField} retains a borrowed foreground Agent until its background task fails`, async () => {
  const session = { id: 's1' }, agent = { session }
  let live = false, resumes = 0, disposals = 0, chat = chatRow()
  const borrowed = Promise.withResolvers(), releaseBorrower = Promise.withResolvers()
  const running = Promise.withResolvers(), failTask = Promise.withResolvers()
  const host = { sessions: { get: () => live ? session : undefined }, agents: {
    get: () => live ? agent : undefined,
    async resume() {
      live = true
      resumes++
      return { agent, async dispose() { live = false; disposals++ } }
    }
  } }
  const withForegroundAgent = (id, work) => withHostAgent(host, id, work)
  const api = createTask({
    store: {
      chatForSession: async () => structuredClone(chat), readCard: async () => ({ name: '人物卡' }),
      updateChat: async (_id, mutate) => { chat = mutate(structuredClone(chat)); return chat }
    },
    runAgent: async () => {
      running.resolve()
      await failTask.promise
      assert.equal(live, true)
      throw new Error('模型中断')
    },
    selection: () => ({ provider: 'p', model: 'm' }), beginTask: async () => taskRunStub(), withForegroundAgent
  })
  const other = withForegroundAgent('s1', () => { borrowed.resolve(); return releaseBorrower.promise })
  let task
  try {
    await borrowed.promise
    await api.start({ sessionId: 's1' })
    task = api.wait('c1')
    await Promise.race([running.promise, task])
    releaseBorrower.resolve()
    await other
    assert.equal(disposals, 0)
  } finally {
    releaseBorrower.resolve()
    failTask.resolve()
    await Promise.all([other, task])
  }
  assert.equal(resumes, 1)
  assert.equal(disposals, 1)
  assert.deepEqual([chat[statusField].status, chat[statusField].error], ['failed', '模型中断'])
})
