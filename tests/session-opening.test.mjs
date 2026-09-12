import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { helperClient } from './fixtures/helper-host-harness.mjs'
import { sessionOpeningDescriptor, prepareSessionOpening } from '../tavern-plugin/lib/domain/session-opening.js'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

const card = { name: '测试卡', first_mes: '【首页】', alternate_greetings: ['实际开场'] }
const initial = () => ({ id: 'old-chat', sessionId: 'old-session', cardPath: 'card', mode: 'story', messages: [{ role: 'assistant', text: '【首页】', sourceText: '【首页】', greeting: true }], macroState: { userName: '玩家' } })

for (const method of ['saveChat', 'setChatMessage', 'swipe.to']) test('正式首页开场切换进入原生新会话：' + method, async () => {
  const chat = initial(), original = structuredClone(chat)
  const sourceBook = { name: '本局世界书', entries: [{ id: 1, name: '选中的核心', content: '规则', enabled: true }] }
  const preparation = createOpeningPreparation({ readCard: async () => card, worldBooks: { bound: async (_path, _card, source) => {
    assert.equal(source.sessionId, 'old-session')
    return { source: { kind: 'card' }, view: inspectWorldBookDocument(sourceBook) }
  } } })
  let created = null, opened = null, starts = 0, saved = null, listener
  const lifecycle = helperClient.createConversationLifecycleModule({
    archiveCurrent: async () => {}, resolveWorkspace: async () => 'workspace', connectWorkspace: async () => { starts++; return 'new-session' },
    waitForSession: async () => {}, ensurePreset: async () => {}, rememberPending: () => {},
    createChat: async (request, sessionId) => { created = { sessionId, preparation: preparation.resolve(request.preparationId, request.card.path, request.openingId) } },
    finishOpen: async pending => { opened = pending.sessionId }
  })
  const parent = { postMessage(data) {
    Promise.resolve().then(async () => {
      if (data.method === 'prepareSessionOpening') return saved = await prepareSessionOpening({ chat, card, ...data.args, preparation })
      assert.equal(data.method, 'startSessionOpening')
      assert.equal(data.args.preparationId, saved.preparationId)
      return lifecycle.start({ kind: 'play', ...saved })
    }).then(result => listener({ source: parent, data: { type: 'dsh-tavern-helper-response', token: 't', requestId: data.requestId, ok: true, result } }))
  } }
  const w = { parent, setTimeout, clearTimeout, Map, addEventListener(_name, fn) { listener = fn } }; w.window = w
  const html = helperClient.buildTavernFrameDocument({ token: 't', content: '', helperContext: { openingHost: sessionOpeningDescriptor(chat, card) } })
  const script = html.match(/<script data-dsh-tavern-session-opening>([\s\S]*?)<\/script>/)
  assert.ok(script, '正式消息必须加载开场宿主接口')
  vm.runInNewContext(script[1], w)
  // Same host calls used by the card's StartPage.
  if (method === 'swipe.to') {
    const ctx = w.SillyTavern.getContext()
    await assert.rejects(ctx.swipe.to(null, 'right', { forceMesId: 1, forceSwipeId: 1 }), /开场/)
    await assert.rejects(ctx.swipe.to(null, 'right', { forceMesId: 0, forceSwipeId: 99 }), /开场/)
    await ctx.swipe.to(null, 'right', { forceMesId: 0, forceSwipeId: 1 })
  } else if (method === 'setChatMessage') {
    await w.setChatMessage('实际开场', 0, { swipe_id: 1, refresh: 'display_and_render_current' })
  } else {
  w.SillyTavern.chat[0].swipe_id = 1
  w.SillyTavern.chat[0].mes = w.SillyTavern.chat[0].swipes[1]
  await w.SillyTavern.saveChat()
  await Promise.all([w.SillyTavern.reloadCurrentChat(), w.SillyTavern.reloadCurrentChat()])
  }
  assert.equal(starts, 1)
  assert.equal(opened, 'new-session')
  assert.equal(created.preparation.openingId, 'alternate:0')
  assert.equal(created.preparation.worldbookSnapshot.document.entries[0].enabled, true)
  assert.equal(created.preparation.sourceSessionId, 'old-session')
  assert.deepEqual(chat, original)
})

test('已有剧情、运行中的回合和伪造开场不能通过首页改写历史', async () => {
  const played = initial(); played.messages.push({ role: 'user', text: '继续' })
  assert.equal(sessionOpeningDescriptor(played, card), null)
  const busy = initial(); busy.timeline = { operations: { op: { status: 'running' } } }
  assert.equal(sessionOpeningDescriptor(busy, card), null)
  await assert.rejects(prepareSessionOpening({ chat: initial(), card, swipeId: 1, message: '任意正文' }), /已有开场/)
  await assert.rejects(prepareSessionOpening({ chat: played, card, swipeId: 1, message: '实际开场' }), /已有剧情/)
})

test('empty primary follows native swipe numbering without shifting alternate ids', () => {
  const c = { name: 'chooser', first_mes: '', alternate_greetings: ['menu', 'story'] }
  const chat = initial(); chat.messages[0].text = chat.messages[0].sourceText = 'menu'
  assert.deepEqual(sessionOpeningDescriptor(chat, c), { swipes: ['menu', 'story'], openingIds: ['alternate:0', 'alternate:1'], selectedIndex: 0, characterName: 'chooser' })
})
