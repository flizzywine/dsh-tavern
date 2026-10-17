import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createTavernExtensionSettings } from '../tavern-plugin/lib/domain/tavern-extension-settings.js'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'helper-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const open = (name = 'one') => createTavernExtensionSettings(createProfileDataStore({ dataRoot: join(root, name) }))
  return { store: open(), open }
}

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
