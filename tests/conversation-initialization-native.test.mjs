import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }
const openingEvents = session => session.events.filter(e => e.type === 'assistant/message' && e.data.turn === 1)

test('native Session and disk Chat journal recover a failed marker once, then actual Agent starts at turn two', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  h.state.failMarker = true
  await assert.rejects(h.open().start(h.input), /marker failure/)
  assert.equal(openingEvents(h.target.session).length, 1)
  assert.equal(h.requests.length, 0, 'opening never calls a model')
  await h.restoreDetached()
  h.state.failMarker = false
  const recovered = await h.open().ensureOpening(h.input.sessionId)
  assert.equal(recovered.nativeOpeningAppended, true)
  assert.equal(openingEvents(h.target.session).length, 1)
  assert.equal(h.target.session.deriveMessages().length, 1)
  assert.equal((await h.persistence.read(recovered.id)).nativeOpeningAppended, true)
  await h.continueWithAgent()
  assert.equal(h.requests.length, 1)
  const messages = h.requests[0].messages
  assert.match(JSON.stringify(messages[0]), /不可丢失的固定背景/)
  assert.equal(messages.filter(m => m.role === 'assistant' && JSON.stringify(m.content).includes('玩家，你好。')).length, 1)
  assert.deepEqual(h.target.session.events.filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2])
  assert.equal(h.target.session.events.at(-1).type, 'turn/end')
})

test('native partial event logs survive disk reload and Session end-seed markers at every append boundary', native, async t => {
  for (const stage of ['turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end']) {
    const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
    t.after(() => h.dispose())
    const session = h.target.session, append = session.append.bind(session)
    session.append = (type, ...args) => { if (type === stage) throw Error('append failure'); return append(type, ...args) }
    await assert.rejects(h.open().start(h.input), /append failure/)
    session.append = append
    const before = structuredClone(session.events)
    await h.checkpoint()
    await h.restoreDetached()
    const recovered = await h.open().ensureOpening(h.input.sessionId)
    assert.equal(recovered.nativeOpeningAppended, true)
    assert.deepEqual(h.target.session.events.slice(0, before.length), before)
    assert.equal(openingEvents(h.target.session).length, 1)
    assert.equal(h.target.session.deriveMessages().length, 1)
    assert.equal(h.target.session.events.filter(e => e.type === 'turn/end').length, 1)
  }
})

test('failed native flush restores only durable events and finishes the published Chat without another Chat', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  h.state.failFlush = true
  await assert.rejects(h.open().start(h.input), /native flush failure/)
  assert.equal(openingEvents(h.target.session).length, 1)
  await h.restoreDetached()
  assert.equal(openingEvents(h.target.session).length, 0, 'failed flush did not persist the greeting')
  h.state.failFlush = false
  const recovered = await h.open().start(h.input)
  assert.equal(recovered.nativeOpeningAppended, true)
  assert.equal(openingEvents(h.target.session).length, 1)
  assert.equal((await h.open().ensureOpening(h.input.sessionId)).id, recovered.id)
  assert.equal(h.requests.length, 0)
})
