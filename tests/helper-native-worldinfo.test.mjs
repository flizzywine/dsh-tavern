import assert from 'node:assert/strict'
import test from 'node:test'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'
import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'

function connect(host) {
  let run
  run = helperHostHarness({ mvuEnabled: false }, { onCall(message) {
    if (message.type !== 'dsh-tavern-helper-call') return
    host.invoke(message.method, message.args).then(result => run.reply(message, result), error => run.reply(message, error.message, false))
  } })
  return run.window.SillyTavern.getContext()
}

for (const embedded of [false, true]) test(`原生世界书保存/恢复及字段删除：${embedded ? '卡内嵌' : '独立文件'}`, async t => {
  const host = await createHelperWorldbookHost(embedded)
  t.after(host.cleanup)
  const api = connect(host)
  const book = await api.loadWorldInfo('审计书')
  assert.equal(Array.isArray(book.entries), false)
  assert.deepEqual(Array.from(book.entries[7].key), ['旧词'])
  assert.equal(typeof book.entries[7].position === 'object', false)
  book.entries[7].content = '原生改写'
  book.entries[7].key = ['触发词']
  book.entries[7].position = 4
  book.entries[7].depth = 0
  book.entries[7].caseSensitive = true
  book.entries[7].customPluginField = { alive: true }
  delete book.entries[7].unknownEntry
  delete book.entries[7].extensions.vendor
  book.extraRoot = '新增书字段'
  delete book.unknownBook
  book.entries[11] = { uid: 11, content: '新增条目', key: [], position: 1, disable: false, caseSensitive: null, customPluginField: '新值' }
  await api.saveWorldInfo('审计书', book, true)
  const restored = await connect(host).loadWorldInfo('审计书')
  assert.equal(restored.entries[7].position, 4)
  assert.equal(restored.entries[7].depth, 0)
  assert.equal(restored.entries[7].caseSensitive, true)
  assert.equal(restored.entries[7].customPluginField.alive, true)
  assert.equal(restored.entries[7].unknownEntry, undefined)
  assert.equal(restored.entries[7].extensions.vendor, undefined)
  assert.equal(restored.extraRoot, '新增书字段')
  assert.equal(restored.unknownBook, undefined)
  assert.equal(restored.entries[11].customPluginField, '新值')
  assert.equal(restored.entries[11].caseSensitive, null)
  delete restored.entries[11]
  delete restored.entries[7].depth
  delete restored.entries[7].caseSensitive
  await api.saveWorldInfo('审计书', restored)
  const final = await connect(host).loadWorldInfo('审计书')
  assert.equal(final.entries[11], undefined)
  assert.equal(final.entries[7].depth, undefined)
  assert.notEqual(final.entries[7].caseSensitive, true)
  const stored = await host.read()
  assert.equal(Array.isArray(stored.entries), embedded, '存储保持原有格式')
  const entry = embedded ? stored.entries[0] : stored.entries[7]
  assert.equal(entry.content, '原生改写')
  assert.deepEqual(embedded ? entry.keys : entry.key, ['触发词'])
})

test('原生和 Helper 写入共享冲突检测，过期对象和非绑定世界书不能覆盖', async t => {
  const host = await createHelperWorldbookHost()
  t.after(host.cleanup)
  const api = connect(host)
  const stale = await api.loadWorldInfo('审计书')
  await api.TavernHelper.setLorebookEntries('审计书', [{ uid: 7, content: '更新胜出' }])
  await api.loadWorldInfo('审计书') // Later reads must not make the old object look current.
  stale.entries[7].content = '过期内容'
  await assert.rejects(api.saveWorldInfo('审计书', stale), /其他操作修改/)
  assert.equal((await host.read()).entries[7].content, '更新胜出')
  await assert.rejects(api.loadWorldInfo('另一书'), /只能访问/)
  const bad = await api.loadWorldInfo('审计书')
  bad.entries = []
  await assert.rejects(api.saveWorldInfo('审计书', bad), /entries 对象/)
  const duplicate = await api.loadWorldInfo('审计书')
  duplicate.entries[8] = { uid: 7 }
  await assert.rejects(api.saveWorldInfo('审计书', duplicate), /编号无效或重复/)
  await assert.rejects(connect(host).saveWorldInfo('审计书', {}), /先读取/)
  assert.equal((await host.read()).entries[7].content, '更新胜出')
})
