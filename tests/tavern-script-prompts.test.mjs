import assert from 'node:assert/strict'
import test from 'node:test'
import { mutateScriptPrompts, scriptPromptFrameInputs, consumeScriptPrompts } from '../tavern-plugin/lib/domain/tavern-script-prompts.js'

import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const prompt = (id, content, position = 'in_chat') => ({ id, content, position, role: 'system', depth: 0, should_scan: true })

test('同 ID 替换、删除、一次性与无效批次原子验证', () => {
  const chat = {}
  mutateScriptPrompts(chat, { kind: 'inject', prompts: [prompt('__proto__', '旧')] })
  mutateScriptPrompts(chat, { kind: 'inject', prompts: [prompt('__proto__', '新')], once: true })
  assert.equal(chat.tavernScriptPrompts.length, 1)
  assert.equal(scriptPromptFrameInputs(chat)[0].text, '新')
  assert.throws(() => mutateScriptPrompts(chat, { kind: 'inject', prompts: [prompt('ok', '有效'), { ...prompt('bad', '错误'), depth: -1 }] }))
  assert.equal(chat.tavernScriptPrompts.length, 1)
  consumeScriptPrompts(chat)
  assert.deepEqual(chat.tavernScriptPrompts, [])
})

test('宿主拒绝过期写入，提示词与会话隔离', async t => {
  const host = await createHelperWorldbookHost()
  t.after(host.cleanup)
  host.chat.tavernHelperLifecycleRevision = 2
  assert.equal((await host.adapter.updatePrompts('audit', { kind: 'inject', prompts: [prompt('x', '内容')] }, 1)).stale, true)
  assert.equal(host.chat.tavernScriptPrompts, undefined)
  await host.adapter.updatePrompts('audit', { kind: 'inject', prompts: [prompt('x', '内容')] }, 2)
  assert.equal(host.chat.tavernScriptPrompts[0].content, '内容')
})

test('并发宿主事件串行完成，提示词写入不会携带已经结束的事件 ID', async () => {
  const run = helperHostHarness({ lifecycleRevision: 3 })
  run.window.eventOn('ONE', () => run.window.injectPrompts([prompt('one', '一')]))
  run.window.eventOn('TWO', () => run.window.injectPrompts([prompt('two', '二')]))
  run.receive({ type: 'dsh-tavern-helper-event', name: 'ONE', args: [], eventId: 'event-one' })
  run.receive({ type: 'dsh-tavern-helper-event', name: 'TWO', args: [], eventId: 'event-two' })
  const tick = () => new Promise(resolve => setImmediate(resolve))
  await tick()
  assert.equal(run.calls().length, 1)
  assert.equal(run.calls()[0].eventId, 'event-one')
  assert.equal(run.calls()[0].lifecycleRevision, 3)
  run.reply(run.calls()[0], { updated: true })
  await tick()
  assert.equal(run.calls()[1].eventId, 'event-two')
  run.reply(run.calls()[1], { updated: true })
  await tick()
  assert.deepEqual(run.sent.filter(x => x.type === 'dsh-tavern-helper-event-complete').map(x => x.eventId), ['event-one', 'event-two'])
})

test('重复提示词不产生宿主更新，变化和删除仍生效，过期检查仍执行', async t => {
  const host = await createHelperWorldbookHost()
  t.after(host.cleanup)
  const operation = { kind: 'inject', prompts: [prompt('repeat', '内容')] }
  assert.equal((await host.adapter.updatePrompts('audit', operation)).updated, true)
  assert.equal((await host.adapter.updatePrompts('audit', operation)).updated, false)
  assert.equal((await host.adapter.updatePrompts('audit', { ...operation, once: true })).updated, true)
  assert.equal((await host.adapter.updatePrompts('audit', { kind: 'remove', ids: ['absent'] })).updated, false)
  assert.equal(host.writes.length, 2)
  host.chat.tavernHelperLifecycleRevision = 2
  assert.equal((await host.adapter.updatePrompts('audit', { ...operation, once: true }, 1)).stale, true)
  assert.equal((await host.adapter.updatePrompts('audit', { kind: 'remove', ids: ['repeat'] }, 2)).updated, true)
})

test('十五个并发初始化回调都确认失败，不被一个回调先消费错误', async () => {
  const run = helperHostHarness()
  run.window.eventOn('INIT_MANY', async () => {
    await Promise.resolve()
    run.window.injectPrompts([prompt('init', '初始化')])
  })
  const events = Array.from({ length: 15 }, () => run.window.eventEmit('INIT_MANY'))
  const settled = Promise.allSettled(events)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(run.calls().length, 1, '相同的并发注入共享持久化回执')
  run.calls().forEach((call, index) => run.reply(call, index === 0 ? '持久化失败' : { updated: true }, index !== 0))
  const results = await settled
  assert.ok(results.every(result => result.status === 'rejected' && /持久化失败/.test(result.reason.message)))
})

test('确认范围之外的迟到失败不污染已经完成的回调，也不会丢失', async () => {
  const run = helperHostHarness()
  const tick = () => new Promise(resolve => setImmediate(resolve))
  run.window.eventOn('INIT', () => run.window.injectPrompts([prompt('init', '初始化')]))
  const event = run.window.eventEmit('INIT')
  await tick()
  run.window.injectPrompts([prompt('later', '后续')])
  run.reply(run.calls()[1], '后续保存失败', false)
  run.reply(run.calls()[0], { updated: true })
  await event
  run.window.eventOn('CHECK', () => {})
  await assert.rejects(run.window.eventEmit('CHECK'), /后续保存失败/)
  await run.window.eventEmit('CHECK')
})

test('并发去重不能越过删除或一次性注入', async () => {
  const run = helperHostHarness()
  const prompts = [prompt('x', '内容')]
  run.window.injectPrompts(prompts)
  run.window.injectPrompts(prompts)
  assert.equal(run.calls().length, 1)
  run.window.uninjectPrompts(['x'])
  run.window.uninjectPrompts(['x'])
  assert.equal(run.calls().length, 2)
  run.window.injectPrompts(prompts)
  run.window.injectPrompts(prompts, { once: true })
  run.window.injectPrompts(prompts, { once: true })
  assert.equal(run.calls().length, 5)
  run.calls().forEach(call => run.reply(call, { updated: true }))
})

test('提示词批次原子验证、保留顺序并只保存一次', async t => {
  const host = await createHelperWorldbookHost()
  t.after(host.cleanup)
  const operations = [
    { kind: 'inject', prompts: [prompt('a', '旧'), prompt('b', '保留')] },
    { kind: 'remove', ids: ['a'] },
    { kind: 'inject', prompts: [prompt('a', '新')] }
  ]
  await host.adapter.updatePrompts('audit', { kind: 'batch', operations })
  assert.deepEqual(host.chat.tavernScriptPrompts.map(p => p.id), ['b', 'a'])
  assert.equal(host.chat.tavernScriptPrompts[1].content, '新')
  assert.equal(host.writes.length, 1)
  const before = structuredClone(host.chat.tavernScriptPrompts)
  await assert.rejects(host.adapter.updatePrompts('audit', { kind: 'batch', operations: [
    { kind: 'remove', ids: ['a'] }, { kind: 'inject', prompts: [{ ...prompt('bad', '错误'), depth: -1 }] }
  ] }))
  assert.deepEqual(host.chat.tavernScriptPrompts, before)
  assert.equal(host.writes.length, 1)
})
