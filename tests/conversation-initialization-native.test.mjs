import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { KNOWN_SESSION_EVENT_TYPES } from './fixtures/dsh-session-host.mjs'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'
import { createForegroundOrchestrationStrategies } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { projectVirtualWorldbookPrefix } from '../tavern-plugin/lib/domain/worldbook-virtual-state.js'
import { sessionOpeningDescriptor } from '../tavern-plugin/lib/domain/session-opening.js'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }

test('首页按钮在卡片自动更新后仍可开始，切过开场后旧首页按钮失效', native, async t => {
  const card = { name: '角色', first_mes: '【首页】', alternate_greetings: ['实际开场'] }
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { cardOverrides: card })
  t.after(() => h.dispose())
  const initialization = h.open()
  const chat = await initialization.start(h.input)
  const original = sessionOpeningDescriptor(chat, card)
  await h.persistence.update(chat.id, current => {
    current.tavernHelperLifecycleRevision = 2
    current.cardAutoReload = { at: Date.now(), turn: 1 }
    return current
  })
  const result = await initialization.switchOpening(chat.sessionId, {
    swipeId: 1, message: '实际开场', expectedLifecycleRevision: 0, expectedOpeningVersion: original.version
  })
  assert.equal(result.lifecycleRevision, 3)
  assert.equal((await h.persistence.read(chat.id)).messages[0].text, '实际开场')
  await initialization.switchOpening(chat.sessionId, { swipeId: 0, expectedOpeningVersion: result.openingVersion })
  await assert.rejects(initialization.switchOpening(chat.sessionId, {
    swipeId: 1, expectedOpeningVersion: original.version
  }), /开场白已变化/)
})

test('原地切换开场可从保存中恢复，第一条模型请求只看到最终选择', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, {
    cardOverrides: { first_mes: '旧路线', alternate_greetings: ['{{user}}，新路线', ''] }
  })
  t.after(() => h.dispose())
  const initialization = h.open()
  const original = await initialization.start(h.input)
  await initialization.switchOpening(original.sessionId, { swipeId: 2, expectedLifecycleRevision: 0 })
  assert.equal((await h.persistence.read(original.id)).messages[0].openingChoiceId, 'alternate:1')
  h.state.failFlush = true
  await assert.rejects(initialization.switchOpening(original.sessionId, {
    swipeId: 1, message: '{{user}}，新路线', expectedLifecycleRevision: 1
  }), /native flush failure/)
  h.state.failFlush = false
  assert.ok((await h.persistence.read(original.id)).nativeOpeningSwitch)
  await h.restoreDetached()
  const recovered = await h.open().ensureOpening(original.sessionId)
  assert.equal(recovered.id, original.id)
  assert.equal(recovered.sessionId, original.sessionId)
  assert.equal(recovered.nativeOpeningSwitch, undefined)
  assert.equal(recovered.messages.length, 1)
  assert.equal(recovered.messages[0].text, '玩家，新路线')
  await h.continueWithAgent()
  const replies = h.requests[0].messages.filter(message => message.role === 'assistant')
    .flatMap(message => message.content.map(part => part.text || ''))
  assert.equal(replies.filter(text => text === '玩家，新路线').length, 1)
  assert.ok(!replies.includes('旧路线'))
  await assert.rejects(initialization.switchOpening(original.sessionId, { swipeId: 0, expectedLifecycleRevision: 2 }), /首轮已开始/)
})

test('修改玩家称呼更新已经生成的开场和后续模型请求，保留骰点与存档变量', native, async t => {
  const source = '{{setvar::gold::30}}玩家站在门外。{{user}}，你好。骰点 {{roll::1d6}}。'
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { cardOverrides: { first_mes: source } })
  t.after(() => h.dispose())
  const initialization = h.open()
  const original = await initialization.start(h.input)
  const firstText = original.messages[0].text
  assert.match(firstText, /^玩家站在门外。玩家，你好。骰点 [1-6]。$/)
  await h.continueWithAgent()
  await h.persistence.update(original.id, chat => {
    chat.macroState.local.gold = '50'
    return chat
  })
  assert.equal(await initialization.setPlayerName(original.sessionId, '  旅人  '), '旅人')
  await h.restoreDetached()
  const saved = await h.open().ensureOpening(original.sessionId)
  const renamed = firstText.replace('玩家，你好。', '旅人，你好。')
  assert.equal(saved.macroState.userName, '旅人')
  assert.equal(saved.macroState.local.gold, '50')
  assert.equal(saved.messages[0].sourceText, source)
  assert.equal(saved.messages[0].projectionText, renamed)
  assert.equal(saved.messages[0].displayText, renamed)
  assert.equal(saved.openingText, renamed)
  assert.equal(saved.tavernHelperLifecycleRevision, original.tavernHelperLifecycleRevision)
  await h.continueWithAgent()
  const replies = h.requests[1].messages.filter(message => message.role === 'assistant')
    .map(message => message.content.map(part => part.text || '').join(''))
  assert.equal(replies.filter(text => text === renamed).length, 1)
  assert.ok(!replies.includes(firstText))
})

test('first native reply uses the prepared static worldbook in the actual system prompt', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { assembleStablePrefix: false })
  t.after(() => h.dispose())
  let chat = { ...await h.open().start(h.input), worldbookStrategy: 'native-skills' }
  let preparations = 0
  const worldBook = { view: { entries: [
    { ref: 'visible', constant: true, content: '已准备的常驻规则' },
    { ref: 'hidden', constant: true, content: '预处理隐藏的规则' },
    { ref: 'disabled', constant: true, enabled: false, content: '已禁用的常驻规则' },
    { ref: 'controller', constant: true, content: '@@preprocessing\n<% controller %>' }
  ] } }
  const project = createForegroundWorldbook({
    bound: async () => worldBook,
    runtime: async () => ({
      async prepareWorldbook(entries) {
        preparations++
        return { entries: entries.filter(entry => entry.uid !== 'hidden'), scopes: {} }
      },
      async render() { return { ok: true, text: '控制器输出', scopes: {} } }
    }),
    globalVariables: async () => ({})
  })
  t.after(() => project.dispose())
  const foregroundStrategies = createForegroundOrchestrationStrategies({ nativePlay: {
    modeFor: async () => 'story', filterMessages: messages => messages, resolvePreset: async () => null,
    visibleTools: async () => [], controlledToolNames: new Set(),
    async prepareTurn({ turn, userText }) {
      const prepared = await project({ requestKey: String(turn), chat, card: { name: '角色' }, userText })
      assert.equal(prepared.error, null)
      chat = { ...chat, worldBookVirtualState: prepared.virtualState }
      return { frame: { userInput: { projectedText: userText }, source: {
        worldBook: { virtualWorldbook: { scope: prepared.virtualState.scope } },
        regenerationMaterials: { worldbookPrefix: prepared.prefixContext }
      } } }
    },
    appendFrame: ({ messages }) => ({ messages }), recordFrame() {}
  } })
  // The fixture owns turn finalization. Mount the two production hooks that
  // deliver prepared content through the real host assembler and step loop.
  const ctx = { on(name, listener, options) {
    if (name === 'system-prompt/assemble' || name === 'agent/pre-step') return h.ctx.on(name, listener, options)
  } }
  const backgroundAgentRunner = { owns: () => false }, readChat = async () => chat
  registerTurnLifecycleHooks({ ctx, foregroundStrategies, backgroundAgentRunner, hookChatForSession: readChat,
    readChatCard: async () => ({}), turnOrchestrator: { modeFor: async () => 'story' }, ensureNativeSystemPrefix: async () => {},
    publishResourceWorkspace: async () => null, runtimePrompt: () => '', sessionStore: h.ctx.sessions,
    nativeWorldBookTemplateContext: async (current, _card, options) => projectVirtualWorldbookPrefix(worldBook, current, options) })
  registerRequestHooks({ ctx, foregroundStrategies, backgroundAgentRunner, chatForSession: readChat, sessionStore: h.ctx.sessions,
    cardMemory: { appendRecall: ({ decision }) => decision }, requestIdForMessages: () => '', tavernRetryLimiter: { handle() {} } })

  const pending = projectVirtualWorldbookPrefix(worldBook, chat, { restore: false })
  assert.equal(pending.prefixContext, '')
  assert.equal(pending.visibilityPending, true)
  await h.continueInPlace()
  assert.equal(h.requests.length, 1)
  assert.equal(preparations, 1, 'assembly and first pre-step share one preparation')
  const first = h.requests[0].system
  assert.match(first, /【常驻世界书】\n已准备的常驻规则/)
  assert.equal(first.split('已准备的常驻规则').length - 1, 1)
  assert.doesNotMatch(first, /预处理隐藏的规则|已禁用的常驻规则|控制器输出|Fixture constant worldbook/)
  await h.continueInPlace()
  assert.equal(preparations, 2)
  assert.equal(h.requests[1].system, first)

  worldBook.view.entries[0].enabled = false
  await h.continueInPlace()
  assert.equal(preparations, 3)
  assert.doesNotMatch(h.requests[2].system, /【常驻世界书】|已准备的常驻规则|预处理隐藏的规则/)
})

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
