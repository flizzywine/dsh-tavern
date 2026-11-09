import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { helperClient } from './fixtures/helper-host-harness.mjs'
import { sessionOpeningDescriptor, selectSessionOpening } from '../tavern-plugin/lib/domain/session-opening.js'

const card = { name: '测试卡', first_mes: '【首页】', alternate_greetings: ['实际开场', ''] }
const initial = () => ({ id: 'chat', sessionId: 'session', mode: 'story', messages: [{ role: 'assistant', text: '【首页】', greeting: true }] })

for (const method of ['saveChat', 'setChatMessage', 'setChatMessages', 'swipe.to']) test('第 0 楼兼容接口原地切换开场：' + method, async () => {
  const chat = initial()
  const calls = []
  let listener
  const parent = { postMessage(data) {
    calls.push(data.method)
    Promise.resolve().then(() => {
      const selection = selectSessionOpening({ chat, card, ...data.args })
      chat.messages[0].openingChoiceId = selection.id
      return { selectedIndex: data.args.swipeId, lifecycleRevision: 1 }
    }).then(result => listener({ source: parent, data: { type: 'dsh-tavern-helper-response', token: 't', requestId: data.requestId, ok: true, result } }))
  } }
  const w = { parent, setTimeout, clearTimeout, Map, addEventListener(_name, fn) { listener = fn } }; w.window = w
  const html = helperClient.buildTavernFrameDocument({ token: 't', content: '', helperContext: { openingHost: sessionOpeningDescriptor(chat, card) } })
  const script = html.match(/<script data-dsh-tavern-session-opening>([\s\S]*?)<\/script>/)
  assert.ok(script, '正式消息必须加载开场宿主接口')
  vm.runInNewContext(script[1], w)
  if (method === 'swipe.to') {
    const ctx = w.SillyTavern.getContext()
    await assert.rejects(ctx.swipe.to(null, 'right', { forceMesId: 1, forceSwipeId: 1 }), /开场/)
    await assert.rejects(ctx.swipe.to(null, 'right', { forceMesId: 0, forceSwipeId: 99 }), /开场/)
    await ctx.swipe.to(null, 'right', { forceMesId: 0, forceSwipeId: 1 })
  } else if (method === 'setChatMessage') {
    await w.setChatMessage('实际开场', 0, { swipe_id: 1, refresh: 'display_and_render_current' })
  } else if (method === 'setChatMessages') {
    await w.setChatMessages([{ message_id: 0, swipe_id: 1 }])
  } else {
    w.SillyTavern.chat[0].swipe_id = 1
    w.SillyTavern.chat[0].mes = w.SillyTavern.chat[0].swipes[1]
    await w.SillyTavern.saveChat()
    await w.SillyTavern.reloadCurrentChat()
  }
  assert.deepEqual(calls, ['switchSessionOpening'])
  assert.equal(chat.sessionId, 'session')
  assert.equal(chat.messages[0].openingChoiceId, 'alternate:0')
  assert.equal(w.SillyTavern.chat[0].mes, '实际开场')
})

test('校验可切换的第 0 楼，并保留重复正文和空白开场各自的编号', () => {
  const played = initial(); played.messages.push({ role: 'user', text: '继续' })
  assert.equal(sessionOpeningDescriptor(played, card), null)
  const busy = initial(); busy.timeline = { operations: { op: { status: 'running' } } }
  assert.equal(sessionOpeningDescriptor(busy, card), null)
  assert.throws(() => selectSessionOpening({ chat: initial(), card, swipeId: 1, message: '任意正文' }), /已有开场/)
  const chat = initial()
  chat.messages[0].openingChoiceId = 'alternate:0'
  const duplicate = { ...card, first_mes: '实际开场' }
  assert.equal(sessionOpeningDescriptor(chat, duplicate).selectedIndex, 1)
  assert.deepEqual(selectSessionOpening({ chat, card, swipeId: 2, message: '' }), { id: 'alternate:1', text: '', current: false })
})
