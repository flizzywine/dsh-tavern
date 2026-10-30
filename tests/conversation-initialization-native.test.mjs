import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { KNOWN_SESSION_EVENT_TYPES } from './fixtures/dsh-session-host.mjs'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }

// Released V4 rejects a surface event written before a turn opened. Every
// Tavern-written archive must satisfy that contract, or the play history stops
// loading with "system/message does not match an open turn and step".
for (const scenario of ['opening', 'import']) test(`native ${scenario} archive satisfies the released V4 relationship contract`, native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  if (scenario === 'import') {
    const text = [{ chat_metadata: {} }, { is_user: false, mes: '导入开场' }, { is_user: true, mes: '走到花店' },
      { is_user: false, mes: '抵达花店' }].map(JSON.stringify).join('\n')
    await h.importHistory({ ...h.input, text, operationId: `v4-contract-${scenario}` })
  } else {
    await h.open().start(h.input)
  }
  await h.continueWithAgent()
  const { assertReleasedV4Relationships } = await import(
    new URL('../../dsh-session-format-v3-to-v4/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const session = h.target.session
  assertReleasedV4Relationships(
    { header: session.header, events: sessionEvents(session), inheritedEventCount: 0 }, KNOWN_SESSION_EVENT_TYPES)
})

for (const phase of ['front', 'back']) test(`native Agent preserves fixed system background with ${phase} preset`, native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { preset: { [phase]: { entries: [{ role: 'system', content: '预设验证要求' }] } } })
  t.after(() => h.dispose())
  await h.open().start(h.input)
  await h.continueWithAgent()
  assert.equal(h.requests.length, 1)
  const request = h.requests[0]
  const systems = request.system
  assert.match(systems, /不可丢失的固定背景/)
  assert.equal(request.messages.filter(m => m.role !== 'system').some(m => JSON.stringify(m.content).includes('不可丢失的固定背景')), false)
  assert.equal(systems.split('不可丢失的固定背景').length - 1, 1)
  assert.ok(request.messages.some(m => JSON.stringify(m.content).includes('预设验证要求')))
})
// The seed exchange shares the reserved opening turn, so the greeting is the
// turn-one assistant message that is not part of the seed trajectory.
const openingEvents = session => sessionEvents(session).filter(e => e.type === 'assistant/message' && e.data.turn === 1
  && !String(e.data.message?.id || '').startsWith('tavern-seed-trajectory:'))

test('native card workbench starts with no scripted exchange or greeting, and restores idempotently', native, async t => {
  for (const cardPath of ['', 'cards/test.json']) {
    const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
    t.after(() => h.dispose())
    const chat = await h.open().start({ ...h.input, cardPath, mode: 'card' })
    assert.equal(chat.mode, 'card')
    assert.equal(chat.nativeOpeningAppended, true)
    assert.equal(openingEvents(h.target.session).length, 0)
    const initialMessages = h.target.session.deriveMessages()
    // A card-bound workbench also stores the empty-content fixed-system snapshot (card + constant worldbook).
    const prefix = initialMessages.filter(message => String(message.id).startsWith('tavern-session-prefix:'))
    assert.equal(prefix.length, cardPath ? 1 : 0)
    if (cardPath) assert.deepEqual(prefix[0].content, [])
    // Role and boundaries come from the system prompt, not a fake user/assistant exchange.
    assert.deepEqual(initialMessages.filter(message => !prefix.includes(message)), [])
    await h.restoreDetached()
    const restored = await h.open().ensureOpening(h.input.sessionId)
    assert.equal(restored.id, chat.id)
    assert.equal(h.requests.length, 0)
    assert.deepEqual(h.target.session.deriveMessages(), initialMessages)
  }
})

// The card workbench reserves an opening turn and fills it with no greeting, so
// Tavern closes it before the Agent ever runs. The live Agent must learn that turn
// one is spent: otherwise its own first turn reuses turn one and the stored log can
// never be reopened ("turn/start does not open the expected turn", exactly the
// card-history load failure this guards).
test('native card workbench releases the reserved opening turn to the live Agent', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  await h.open().start({ ...h.input, mode: 'card' })
  assert.equal(openingEvents(h.target.session).length, 0)
  await h.continueInPlace()
  assert.deepEqual(sessionEvents(h.target.session).filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2])
  assert.equal(sessionEvents(h.target.session).at(-1).type, 'turn/end')
})

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
  assert.equal(h.target.session.deriveMessages().length, 5)
  assert.equal(h.target.session.deriveMessages()[0].source.form, 'snapshot')
  assert.equal((await h.persistence.read(recovered.id)).nativeOpeningAppended, true)
  await h.continueWithAgent()
  assert.equal(h.requests.length, 1)
  const messages = h.requests[0].messages
  const nativeSystem = messages.filter(m => m.role === 'system')
  const systemText = h.requests[0].system ?? nativeSystem.map(m => m.content.map(b => b.text || '').join('')).join('\n')
  assert.match(systemText, /不可丢失的固定背景/)
  assert.ok(messages.filter(m => m.role !== 'system').every(message => !JSON.stringify(message.content).includes('不可丢失的固定背景')))
  if (h.target.session.header.version < 3) assert.equal(h.target.session.requestHeader().system, systemText)
  else assert.equal(nativeSystem.length, 1)
  assert.equal(messages.filter(m => m.role === 'assistant' && JSON.stringify(m.content).includes('玩家，你好。')).length, 1)
  assert.deepEqual(sessionEvents(h.target.session).filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2])
  assert.equal(sessionEvents(h.target.session).at(-1).type, 'turn/end')
})

test('failed native flush restores only durable events and finishes the published Chat without another Chat', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  h.state.failFlush = true
  await assert.rejects(h.open().start(h.input), /native flush failure/)
  assert.equal(openingEvents(h.target.session).length, 0, 'the pre-opening seed flush failed before the greeting was appended')
  await h.restoreDetached()
  assert.equal(openingEvents(h.target.session).length, 0, 'failed flush did not persist the greeting')
  h.state.failFlush = false
  const recovered = await h.open().start(h.input)
  assert.equal(recovered.nativeOpeningAppended, true)
  assert.equal(openingEvents(h.target.session).length, 1)
  assert.equal((await h.open().ensureOpening(h.input.sessionId)).id, recovered.id)
  assert.equal(h.requests.length, 0)
})

 test('imported native history survives disk restore and reaches the next real Agent request exactly once', native, async t => {
 const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
 t.after(() => h.dispose())
 const text = [{chat_metadata:{}},{is_user:false,mes:'导入开场'}, {is_user:true,mes:'走到花店'}, {is_user:false,mes:'抵达花店'}, {is_user:true,mes:'返回邮局'}, {is_user:false,mes:'已回邮局'}].map(JSON.stringify).join('\n')
 await h.importHistory({...h.input,text,operationId:'native-import-test'})
 assert.equal(h.requests.length,0)
 await h.restoreDetached()
 await h.continueWithAgent()
 assert.equal(h.requests.length,1)
 assert.equal(h.requests[0].messages.filter(m=>m.source?.form==='foreground-frame').length,2)
 // Fixed writing rules are sent once and stay in force until they change (foreground-frame-session-adapter.js).
 assert.equal(h.requests[0].messages.filter(m=>m.content.some(b=>b.type==='text' && b.text.includes('Native fixture writing rules'))).length,1)
 const actual=h.requests[0].messages.map(m=>m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'))
 for(const phrase of ['导入开场','走到花店','抵达花店','返回邮局','已回邮局','继续。']) assert.equal(actual.filter(t=>t===phrase).length,1)
 assert.doesNotMatch(JSON.stringify(actual),/玩家，你好。/)
 for (const phrase of ['不可丢失的固定背景', 'Fixture constant worldbook', 'Fixture recalled worldbook',
   'Fixture card special instruction', 'Fixture card writing constraint']) {
   assert.ok([h.requests[0].system, ...actual].some(text => text?.includes(phrase)), phrase + ' must reach the model adapter')
 }
 assert.equal(sessionEvents(h.target.session).filter(e=>e.type==='turn\/start').at(-1).data.turn,4)
 })
