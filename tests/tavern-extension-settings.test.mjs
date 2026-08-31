import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createTavernExtensionSettings } from '../tavern-plugin/lib/domain/tavern-extension-settings.js'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'helper-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const open = (name = 'one') => createTavernExtensionSettings(createProfileDataStore({ dataRoot: join(root, name) }))
  return { store: open(), open }
}

test('Profile 设置跨实例恢复，合并独立插件并拒绝同一插件的过期保存', async t => {
  const { store, open } = await fixture(t)
  await Promise.all([store.save({ phone: { enabled: true, old: 1 } }, {}), store.save({ database: { auto: true } }, {})])
  const base = await open().read()
  assert.deepEqual(base, { phone: { enabled: true, old: 1 }, database: { auto: true } })
  await store.save({ ...base, phone: { enabled: false } }, base)
  await assert.rejects(open().save({ ...base, phone: { enabled: true, other: 2 } }, base), /其他窗口修改/)
  assert.deepEqual((await open().read()).phone, { enabled: false })
  assert.deepEqual(await open('two').read(), {}, '不同 Profile 相互隔离')
  const latest = await store.read()
  delete latest.database
  await store.save(latest, await store.read())
  assert.equal(Object.hasOwn(await open().read(), 'database'), false)
  await assert.rejects(store.save([], {}), /JSON 对象/)
  await assert.rejects(store.save({}, undefined), /JSON 对象/)
})

test('设置中的特殊键只作为数据保存，不修改对象原型', async t => {
  const { store } = await fixture(t)
  const next = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}')
  await store.save(next, {})
  assert.deepEqual(await store.read(), next)
  assert.equal({}.polluted, undefined)
})

test('共享设置引用、排队保存和写入期间新编辑，在宿主往返后保持一致', async () => {
  const run = helperHostHarness({ extensionSettings: { phone: { value: 1, remove: true } } })
  const ctx = run.window.SillyTavern.getContext(), settings = ctx.extensionSettings, phone = settings.phone
  phone.value = 2
  delete phone.remove
  let completed = false
  const first = ctx.saveSettingsDebounced().then(() => { completed = true })
  await tick()
  assert.equal(completed, false)
  phone.value = 3
  const second = ctx.saveSettingsDebounced()
  run.reply(run.calls()[0], { updated: true, extensionSettings: { phone: { value: 2 }, database: { on: true } } })
  await first
  await tick()
  assert.equal(settings.phone, phone)
  assert.equal(phone.value, 3)
  assert.equal(settings.database.on, true)
  assert.equal(run.calls()[1].args.expectedSettings.phone.value, 2)
  assert.equal(run.calls()[1].args.settings.phone.value, 3)
  run.reply(run.calls()[1], { updated: true, extensionSettings: { phone: { value: 3 }, database: { on: true } } })
  await second
  assert.equal(ctx.extensionSettings, settings)
  assert.equal(settings.phone, phone)
  const failure = ctx.saveSettingsDebounced()
  await tick()
  run.reply(run.calls()[2], '磁盘不可写', false)
  await assert.rejects(failure, /磁盘不可写/)
})

test('浏览器设置真实写入 Profile 后，销毁环境并重新加载可恢复', async t => {
  const { store, open } = await fixture(t)
  let run
  run = helperHostHarness({ extensionSettings: await store.read() }, { onCall(message) {
    if (message.type !== 'dsh-tavern-helper-call') return
    assert.equal(message.method, 'saveTavernExtensionSettings')
    store.save(message.args.settings, message.args.expectedSettings).then(extensionSettings => run.reply(message, { updated: true, extensionSettings }))
  } })
  run.window.SillyTavern.extensionSettings.phone = { size: 80 }
  await run.window.SillyTavern.saveSettingsDebounced()
  const reloaded = helperHostHarness({ extensionSettings: await open().read() })
  assert.equal(reloaded.window.SillyTavern.extensionSettings.phone.size, 80)
})
