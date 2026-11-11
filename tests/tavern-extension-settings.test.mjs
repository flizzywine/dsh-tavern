import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createTavernExtensionSettings } from '../tavern-plugin/lib/domain/tavern-extension-settings.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'helper-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const open = (name = 'one') => createTavernExtensionSettings(createProfileDataStore({ dataRoot: join(root, name) }))
  return { store: open(), open }
}

test('读取结果仍与持久设置隔离，调用者修改不会污染后续读取', async t => {
  const { store } = await fixture(t)
  await store.save({ phone: { size: 80 } }, {})
  const first = await store.read()
  first.phone.size = 99
  assert.equal((await store.read()).phone.size, 80)
})
