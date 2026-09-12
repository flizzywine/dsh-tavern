import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('插件命名空间与全局函数共享实现，context 在更新后读取真实身份', () => {
  const run = helperHostHarness({ chatId: 'one', playerName: '甲' })
  const w = run.window, context = w.SillyTavern.getContext()
  assert.equal(context, w.getContext())
  assert.equal(context.TavernHelper, w.TavernHelper)
  assert.equal(w.TavernHelper.getChatMessages, w.getChatMessages)
  const replacement = () => 8
  w.TavernHelper.getLastMessageId = replacement
  assert.equal(w.getLastMessageId, replacement)
  run.receive({ type: 'dsh-tavern-helper-context', context: { chatId: 'two', playerName: '乙' } })
  assert.equal(context.chatId, 'two')
  assert.equal(context.name1, '乙')
  assert.equal(w.TavernHelper.generateRaw, w.generateRaw)
})

test('createChatMessages 追加楼层并等待宿主确认后更新同步上下文', async () => {
  const run = helperHostHarness({
    messages: [{ message_id: 0, role: 'assistant', message: '正文', swipes: ['正文'], swipe_id: 0 }]
  })
  const w = run.window
  assert.equal(w.TavernHelper.createChatMessages, w.createChatMessages)

  const pending = w.createChatMessages([{
    role: 'assistant',
    message: '<chat_history target="楚青妤">回复</chat_history>',
    is_hidden: false,
    data: { phone: true }
  }])
  await tick()

  assert.deepEqual(JSON.parse(JSON.stringify(run.calls()[0])), {
    type: 'dsh-tavern-helper-call', token: 'host-test', requestId: '1',
    method: 'createTavernHelperMessages', args: {
      messages: [{ role: 'assistant', message: '<chat_history target="楚青妤">回复</chat_history>', is_hidden: false, data: { phone: true } }],
      option: {}
    }, eventId: '', scriptId: 'a', lifecycleRevision: 0
  })
  run.reply(run.calls()[0], {
    updated: true,
    context: { messages: [
      { message_id: 0, role: 'assistant', message: '正文', swipes: ['正文'], swipe_id: 0 },
      { message_id: 1, role: 'assistant', message: '<chat_history target="楚青妤">回复</chat_history>', swipes: ['<chat_history target="楚青妤">回复</chat_history>'], swipe_id: 0, variables: { phone: true } }
    ] }
  })
  assert.equal(await pending, undefined)
  assert.equal(w.getLastMessageId(), 1)
  assert.equal(w.getChatMessages('1')[0].message, '<chat_history target="楚青妤">回复</chat_history>')
})

test('Helper 与 ST 共用事件总线，支持去重、重新排序、异步等待和旧字符串', async () => {
  const w = helperHostHarness().window, seen = []
  const first = async value => { await tick(); seen.push('first:' + value) }
  const last = () => seen.push('last')
  const middle = () => seen.push('middle')
  w.eventOn('MESSAGE_SENT', last)
  w.eventOn('MESSAGE_SENT', middle)
  w.eventOn('MESSAGE_SENT', middle)
  w.SillyTavern.eventSource.makeFirst('message_sent', first)
  w.SillyTavern.eventSource.makeLast('MESSAGE_SENT', last)
  await w.SillyTavern.eventSource.emit(w.SillyTavern.eventTypes.MESSAGE_SENT, 3)
  assert.deepEqual(seen, ['first:3', 'middle', 'last'])
})

test('once 在回调前解绑，stop 保留所属脚本，不会移除另一个脚本监听', async () => {
  const w = helperHostHarness().window
  let once = 0, repeated = 0
  w.eventOnce('recursive', async () => { once++; await w.eventEmit('recursive') })
  await w.eventEmit('recursive')
  assert.equal(once, 1)
  const callback = () => repeated++
  const handle = w.eventOn('shared', callback)
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('shared', callback)
  handle.stop()
  await w.eventEmit('shared')
  assert.equal(repeated, 1)
  w.eventOff('shared', callback)
  await w.eventEmit('shared')
  assert.equal(repeated, 1)
})

test('宿主派发也遵循 first/once 顺序并返回完成回执', async () => {
  const run = helperHostHarness(), w = run.window, seen = []
  w.eventOn('MESSAGE_RECEIVED', () => seen.push('normal'))
  w.eventOnce('MESSAGE_RECEIVED', () => seen.push('once'))
  w.eventMakeFirst('MESSAGE_RECEIVED', () => seen.push('first'))
  for (const eventId of ['one', 'two']) {
    run.receive({ type: 'dsh-tavern-helper-event', name: 'MESSAGE_RECEIVED', eventId, args: [0] })
    await tick()
    assert(run.sent.some(message => message.type === 'dsh-tavern-helper-event-complete' && message.eventId === eventId))
  }
  assert.deepEqual(seen, ['first', 'normal', 'once', 'first', 'normal'])
})

test('变量合并写入等待宿主保存，拒绝及过期结果均向插件报错', async () => {
  for (const method of ['insertVariables', 'insertOrAssignVariables']) {
    const run = helperHostHarness({ chatVariables: { old: 1 } }), w = run.window
    let settled = false
    const pending = w.TavernHelper[method]({ added: 2 }, { type: 'chat' }).then(value => { settled = true; return value })
    await tick()
    assert.equal(settled, false)
    assert.equal(w.getVariables({ type: 'chat' }).added, undefined)
    run.reply(run.calls()[0], { updated: true })
    assert.equal((await pending).added, 2)
    assert.equal(w.getVariables({ type: 'chat' }).added, 2)
    const failed = w[method]({ bad: 3 }, { type: 'chat' })
    run.reply(run.calls()[1], '保存失败', false)
    await assert.rejects(failed, /保存失败/)
    assert.equal(w.getVariables({ type: 'chat' }).bad, undefined)
    const stale = w[method]({ bad: 4 }, { type: 'chat' })
    run.reply(run.calls()[2], { stale: true, updated: false })
    await assert.rejects(stale, /未保存/)
  }
})

test('快速脚本先完成订阅时仍等待 iframe load，再宣布就绪和派发首个事件', async () => {
  const { helperClient } = await import('./fixtures/helper-host-harness.mjs')
  const listeners = {}, sent = [], ready = []
  let frame, emitted
  const hostWindow = { crypto: { randomUUID: () => 'early-ready' }, setTimeout, clearTimeout,
    addEventListener(name, fn) { listeners[name] = fn }, removeEventListener() {} }
  const root = { isConnected: true, appendChild() {}, remove() {} }
  const document = { body: { appendChild() {} }, createElement(tag) {
    if (tag === 'div') return root
    frame = { contentWindow: { postMessage(message) { sent.push(message) } }, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn }, remove() {} }
    return frame
  } }
  const runtime = helperClient.createTavernHelperScriptRuntime({ window: hostWindow, document, rpc: async () => ({}), reportError() {}, resolveError() {},
    onReady(id) { ready.push(id); emitted = runtime.emit('MESSAGE_SENT', [1]) } })
  runtime.sync('audit', { tavernHelper: { messages: [] }, tavernHelperScripts: [{ id: 'quick', content: 'void 0' }] })
  listeners.message({ source: frame.contentWindow, data: { token: 'early-ready', type: 'dsh-tavern-helper-subscriptions', ready: true, names: ['MESSAGE_SENT'] } })
  assert.equal(ready.length, 0)
  await runtime.emit('MESSAGE_SENT', [0])
  assert.equal(sent.length, 0)
  frame.listeners.load()
  assert.deepEqual(ready, ['audit'])
  const event = sent.find(message => message.type === 'dsh-tavern-helper-event')
  assert(event, '首个事件必须真正发到 iframe，不能创建一个永远得不到回执的等待')
  listeners.message({ source: frame.contentWindow, data: { token: 'early-ready', type: 'dsh-tavern-helper-event-complete', eventId: event.eventId, args: [1] } })
  await emitted
  runtime.dispose()
})

test('普通脚本获得 Helper 接口但不误检测到 MVU 框架', () => {
  const w = helperHostHarness({ mvuEnabled: false }).window
  assert.equal(typeof w.TavernHelper.getVariables, 'function')
  assert.equal(w.Mvu, undefined)
})

for (const outcome of ['pending', 'failed']) test('其他脚本的提示词写入不阻塞或污染 CHAT_CHANGED：' + outcome, async () => {
  const h = helperHostHarness(), w = h.window
  w.__dshTavernHelperSetCurrentScript('a')
  w.injectPrompts([{ id: 'a-prompt', content: 'test' }])
  const write = h.calls()[0]
  if (outcome === 'failed') { h.reply(write, 'write A failed', false); await tick() }
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('CHAT_CHANGED', () => {})
  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'b-event', name: 'CHAT_CHANGED', args: ['chat'] })
  await tick()
  const completed = h.sent.find(item => item.type === 'dsh-tavern-helper-event-complete' && item.eventId === 'b-event')
  assert.ok(completed, 'B 必须独立完成，不等待 A 的写入')
  assert.equal(completed.error, undefined)
  if (outcome === 'pending') { h.reply(write, { updated: true }); await tick() }
})

for (const fails of [false, true]) test('事件等待自己的提示词持久化，并保留失败归属：' + fails, async () => {
  const h = helperHostHarness(), w = h.window
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('CHAT_CHANGED', () => { w.injectPrompts([{ id: 'b-prompt', content: 'test' }]) })
  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'own-event', name: 'CHAT_CHANGED', args: ['chat'] })
  await tick()
  assert.equal(h.sent.some(item => item.type === 'dsh-tavern-helper-event-complete'), false)
  h.reply(h.calls()[0], fails ? 'write B failed' : { updated: true }, !fails)
  await tick()
  const result = h.sent.find(item => item.type === 'dsh-tavern-helper-event-complete')
  assert.ok(result)
  if (fails) { assert.equal(result.scriptId, 'b'); assert.match(result.error, /write B failed/) }
  else assert.equal(result.error, undefined)
})


test('generateRaw 返回独立 RPC 文本，不创建聊天消息', async () => {
  const run = helperHostHarness({ chatId: 'one' })
  const config = { ordered_prompts: [{ role: 'user', content: '生成档案' }], should_stream: false }
  const pending = run.window.TavernHelper.generateRaw(config)
  await tick()
  const request = run.calls().at(-1)
  assert.equal(request.method, 'generateTavernHelperRaw')
  assert.deepEqual(JSON.parse(JSON.stringify(request.args)), { config })
  run.reply(request, { text: '档案内容' })
  assert.equal(await pending, '档案内容')
  assert.equal(run.calls().length, 1)
})

test('异步 RPC 报错保留调用时的脚本和事件，不能署名最后加载的脚本', async () => {
  const h = helperHostHarness(), w = h.window
  w.__dshTavernHelperSetCurrentScript('a')
  const pending = w.insertVariables({ x: 1 }, { type: 'chat' })
  w.__dshTavernHelperSetCurrentScript('b')
  h.reply(h.calls()[0], '写入被拒绝', false)
  await assert.rejects(pending, error => error.dshTavernScriptId === 'a' && error.dshTavernMethod === 'updateTavernHelperVariables')
})

test('悬浮角色库读取当前人物卡名称，并随宿主上下文更新', () => {
  const run = helperHostHarness({ characterName: '命定之诗', character: { name: '命定之诗' } })
  assert.equal(run.window.getCurrentCharacterName(), '命定之诗')
  assert.equal(run.window.TavernHelper.getCurrentCharacterName(), '命定之诗')
  run.receive({ type: 'dsh-tavern-helper-context', context: { characterName: '新卡', character: { name: '新卡' } } })
  assert.equal(run.window.getCurrentCharacterName(), '新卡')
})


test('script context exposes the bound character avatar and follows chat changes', () => {
  const run = helperHostHarness({ chatId: 'one', character: { name: 'A', path: 'cards/a.png' } })
  const ctx = run.window.SillyTavern.getContext()
  assert.equal(ctx.characters[ctx.characterId].avatar, 'cards/a.png')
  run.receive({ type: 'dsh-tavern-helper-context', context: { chatId: 'two', character: { name: 'B', path: 'cards/b.json', avatar: 'b.png' } } })
  assert.equal(ctx.characters[ctx.characterId].avatar, 'b.png')
  assert.equal(ctx.characters[ctx.characterId].name, 'B')
  ctx.characters[0].name = 'local mutation'
  assert.equal(ctx.characters[0].name, 'B')
  run.receive({ type: 'dsh-tavern-helper-context', context: { character: null } })
  assert.equal(ctx.characters.length, 0)
  assert.equal(ctx.characterId, undefined)
})

test('awaited MVU event writes retain the host event identity across asynchronous callbacks', async () => {
  const h = helperHostHarness({ messages: [{ role: 'assistant', variables: { stat_data: { hp: 10 } } }] })
  h.window.eventOn('MESSAGE_RECEIVED', async () => {
    await tick()
    await h.window.replaceVariables({ stat_data: { hp: 9 } }, { type: 'message', message_id: 0 })
  })
  h.receive({ type: 'dsh-tavern-helper-event', name: 'MESSAGE_RECEIVED', eventId: 'settlement-1', args: [0] })
  await tick(); await tick()
  const call = h.calls().find(item => item.method === 'updateTavernHelperVariables')
  assert.equal(call.eventId, 'settlement-1')
  assert.equal(h.sent.some(item => item.type === 'dsh-tavern-helper-event-complete'), false)
  h.reply(call, { updated: true })
  await tick()
  assert.equal(h.sent.find(item => item.type === 'dsh-tavern-helper-event-complete').eventId, 'settlement-1')
})

test('原卡关闭前端不兼容选项的 ready 回调无需写入不存在的 ST 设置', async () => {
  const run = helperHostHarness(), callbacks = []
  run.window.$ = value => {
    if (typeof value === 'function') { callbacks.push(value); return }
    throw new Error('Already disabled settings must not access a missing checkbox')
  }
  // The reported card's callback, without its unrelated character/story data.
  vm.runInNewContext(`$((async()=>{const power_user=SillyTavern.powerUserSettings;["auto_fix_generated_markdown","trim_sentences","forbid_external_media","encode_tags"].map((setting=>function toggle_if_not_allowed(setting,expected){return power_user[setting]!==expected&&(power_user[setting]=expected,$("#"+setting).prop("checked",expected),!0)}(setting,!1))).some((is_changed=>!!is_changed))&&SillyTavern.saveSettingsDebounced()}));`, run.window)
  await callbacks[0]()
  assert.equal(run.calls().length, 0)
})

test('延迟执行的 jQuery ready 回调注册事件时保留原脚本归属', async () => {
  const callbacks = []
  const jquery = { fn: { ready(fn) { callbacks.push(fn); return this } } }
  const h = helperHostHarness({}, { jQuery: jquery }), w = h.window
  w.__dshTavernHelperSetCurrentScript('a')
  jquery.fn.ready(() => w.eventOn('CHAT_CHANGED', () => { throw new Error('original script failure') }))
  w.__dshTavernHelperSetCurrentScript('b')
  await callbacks[0]()
  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'ready-owner', name: 'CHAT_CHANGED', args: ['chat'] })
  await tick()
  const result = h.sent.find(item => item.type === 'dsh-tavern-helper-event-complete' && item.eventId === 'ready-owner')
  assert.equal(result.error, 'original script failure')
  assert.equal(result.scriptId, 'a')
})

test('旧 eventOnButton 按所属脚本注册同名按钮，等待异步回调并沿用事件解绑', async () => {
  const h = helperHostHarness(), w = h.window, seen = []
  w.__dshTavernHelperSetCurrentScript('a')
  const a = w.getButtonEvent('搜索面板')
  const handler = async () => { await tick(); seen.push(w.getScriptId()) }
  w.eventOnButton('搜索面板', handler)
  w.eventOnButton('搜索面板', handler)
  w.__dshTavernHelperSetCurrentScript('b')
  const b = w.getButtonEvent('搜索面板')
  w.eventOnButton('搜索面板', () => seen.push('b'))
  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'button-a', name: a, args: [] })
  await tick(); await tick()
  assert.deepEqual(seen, ['a'], '同名按钮隔离，重复注册不重复执行')
  assert(h.sent.some(item => item.type === 'dsh-tavern-helper-event-complete' && item.eventId === 'button-a' && !item.error))
  await w.eventEmit(b)
  assert.deepEqual(seen, ['a', 'b'])
  w.__dshTavernHelperSetCurrentScript('a')
  w.eventOff(a, handler)
  await w.eventEmit(a)
  assert.deepEqual(seen, ['a', 'b'])
})

test('事件清理接口仅清理当前脚本，支持别名、重复清理与重新注册', async () => {
  const w = helperHostHarness().window, seen = []
  w.eventOn('MESSAGE_RECEIVED', () => seen.push('a-old'))
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('MESSAGE_RECEIVED', () => seen.push('b'))
  w.__dshTavernHelperSetCurrentScript('a')
  w.eventClearEvent('message_received')
  w.eventClearEvent('message_received')
  w.eventOn('MESSAGE_RECEIVED', () => seen.push('a-new'))
  await w.eventEmit('MESSAGE_RECEIVED')
  assert.deepEqual(seen, ['b', 'a-new'])
  const handler = () => seen.push('shared')
  w.eventOn('one', handler)
  w.eventOn('two', handler)
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('one', handler)
  w.__dshTavernHelperSetCurrentScript('a')
  w.eventClearListener(handler)
  await w.eventEmit('one')
  await w.eventEmit('two')
  assert.deepEqual(seen, ['b', 'a-new', 'shared'])
  w.eventClearAll()
  seen.length = 0
  await w.eventEmit('MESSAGE_RECEIVED')
  await w.eventEmit('one')
  assert.deepEqual(seen, ['b', 'shared'])
})
