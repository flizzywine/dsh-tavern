import assert from 'node:assert/strict'
import test from 'node:test'

import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const prompt = (id, content, position = 'in_chat') => ({ id, content, position, role: 'system', depth: 0, should_scan: true })

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
