import assert from 'node:assert/strict'
import test from 'node:test'
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
  assert.equal(w.TavernHelper.generateRaw, undefined, '不暴露尚未实现的能力')
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
