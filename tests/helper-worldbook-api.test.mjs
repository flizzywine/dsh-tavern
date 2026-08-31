import assert from 'node:assert/strict'
import test from 'node:test'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
import { prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'

async function connect(host) {
  const initial = await host.adapter.getWorldbook('audit', 'current')
  let run
  run = helperHostHarness(initial, { onCall(message) {
    if (message.type !== 'dsh-tavern-helper-call') return
    Promise.resolve().then(() => host.invoke(message.method, message.args)).then(result => run.reply(message, result), error => run.reply(message, error.message, false))
  } })
  return run.window.TavernHelper
}

for (const embedded of [false, true]) {
  test(`新旧脚本 API → 实际世界书库 → 文件保存 → 刷新回读 (${embedded ? '内嵌' : '独立'})`, async t => {
    const host = await createHelperWorldbookHost(embedded)
    t.after(host.cleanup)
    const api = await connect(host)
    const added = await api.createLorebookEntries('审计书', [{ comment: '新增', content: '新设定', type: 'selective', keys: ['钟楼'], position: 'at_depth_as_user', depth: 0, order: 123, sticky: 2 }])
    assert.equal(added.new_uids.length, 1)
    const uid = added.new_uids[0]
    assert(uid > 7)
    const changed = await api.setLorebookEntries('审计书', [{ uid, comment: '改名', filters: ['午夜'], logic: 'and_all', scan_depth: 3, probability: 75, exclude_recursion: true, prevent_recursion: true, delay_until_recursion: 2, cooldown: 4, delay: 5, case_sensitive: true, match_whole_words: false, group: 'scene' }])
    const row = changed.find(entry => entry.uid === uid)
    assert.equal(row.position, 'at_depth_as_user')
    assert.equal(row.depth, 0)
    assert.equal(row.order, 123)
    assert.equal(row.type, 'selective')
    assert.equal(row.case_sensitive, true)
    assert.equal(row.group, 'scene')
    const reloaded = await connect(host)
    const persisted = (await reloaded.getWorldbook('审计书')).find(entry => entry.uid === uid)
    assert.deepEqual(Array.from(persisted.strategy.keys_secondary.keys), ['午夜'])
    assert.equal(persisted.strategy.keys_secondary.logic, 'and_all')
    assert.equal(persisted.strategy.scan_depth, 3)
    assert.equal(persisted.probability, 75)
    assert.equal(persisted.recursion.delay_until, 2)
    assert.equal(persisted.recursion.prevent_outgoing, true)
    assert.equal(persisted.effect.sticky, 2)
    assert.equal(persisted.effect.cooldown, 4)
    assert.equal(persisted.effect.delay, 5)
    const raw = await host.read(), original = embedded ? raw.entries[0] : raw.entries[7]
    assert.equal(raw.unknownBook, 'keep')
    assert.equal(original.unknownEntry, 'keep')
    assert.equal(original.extensions.vendor, 'keep')
    const deleted = await reloaded.deleteLorebookEntries('审计书', [7])
    assert.equal(deleted.delete_occurred, true)
    assert.equal(deleted.entries.length, 1)
    assert.equal(deleted.entries[0].uid, uid)
    await reloaded.updateWorldbookWith('审计书', entries => { entries[0].extra.pluginState = { table: 'x' }; entries[0].name = ''; return entries })
    const fresh = (await (await connect(host)).getWorldbook('审计书'))[0]
    assert.equal(fresh.name, '')
    assert.equal(fresh.extra.pluginState.table, 'x')
    await reloaded.updateWorldbookWith('审计书', entries => { delete entries[0].extra.pluginState; return entries })
    assert.equal((await (await connect(host)).getWorldbook('审计书'))[0].extra.pluginState, undefined)
    await reloaded.replaceWorldbook('审计书', [])
    assert.equal((await host.adapter.getWorldbook('audit', 'current')).worldbook.entries.length, 0)
  })
}

test('关键词更新进入现有 DSH 世界书召回，RegExp 跨宿主边界不丢失', async t => {
  const host = await createHelperWorldbookHost()
  t.after(host.cleanup)
  const api = await connect(host)
  await api.updateWorldbookWith('审计书', entries => { entries[0].strategy.keys = [/钟楼/u]; entries[0].content = '已更新的钟楼设定'; return entries })
  const worldBook = await host.record()
  const prepared = prepareWorldBookRecall({ card: { name: '角色' }, chat: { id: 'audit', messages: [{ role: 'assistant', text: '抵达钟楼', turn: 2 }] }, turn: 2, worldBook })
  assert.equal(prepared.context, '已更新的钟楼设定')
  assert.deepEqual(worldBook.view.entries[0].primaryKeys, ['/钟楼/u'])
})

test('异步更新拒绝覆盖其他写入，未绑定世界书及无效请求不改变文件', async t => {
  const host = await createHelperWorldbookHost()
  t.after(host.cleanup)
  const api = await connect(host)
  let release, started
  const waiting = new Promise(resolve => { started = resolve })
  const slow = api.updateWorldbookWith('审计书', async entries => { started(); await new Promise(resolve => { release = resolve }); entries[0].content = 'stale'; return entries })
  await waiting
  await api.setLorebookEntries('审计书', [{ uid: 7, content: 'winner' }])
  release()
  await assert.rejects(slow, /已被其他操作修改/)
  assert.equal((await host.read()).entries[7].content, 'winner')
  const before = JSON.stringify(await host.read())
  await assert.rejects(api.createWorldbookEntries('另一书', [{}]), /只能访问/)
  await assert.rejects(api.replaceWorldbook('审计书', [{ uid: 1 }, { uid: 1 }]), /编号无效或重复/)
  await assert.rejects(api.setLorebookEntries('审计书', [{ uid: 7, group_prioritized: true }]), /尚未支持/)
  assert.equal(JSON.stringify(await host.read()), before)
})
