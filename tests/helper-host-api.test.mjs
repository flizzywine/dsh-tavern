import assert from 'node:assert/strict'
import test from 'node:test'

import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

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

for (const frozen of [false, true]) test('nested script errors retain the failing owner through an outer host event: ' + frozen, async () => {
  const run = helperHostHarness(), w = run.window
  const original = new Error('chat-variable-host-adapter-not-configured')
  if (frozen) Object.freeze(original)
  w.__dshTavernHelperSetCurrentScript('b')
  w.eventOn('inner', async () => { await tick(); throw original })
  w.__dshTavernHelperSetCurrentScript('a')
  w.eventOn('outer', () => w.eventEmit('inner'))
  run.receive({ type: 'dsh-tavern-helper-event', name: 'outer', eventId: 'nested', args: [] })
  await tick(); await tick()
  const receipt = run.sent.find(x => x.type === 'dsh-tavern-helper-event-complete' && x.eventId === 'nested')
  assert.equal(receipt.scriptId, 'b')
  assert.equal(receipt.error, original.message)
})
