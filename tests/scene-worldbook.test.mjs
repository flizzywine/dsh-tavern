import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createSceneWorldbooks, bindSceneWorldbook, sceneWorldbookBinding } from '../tavern-plugin/lib/domain/scene-worldbook.js'
import { sceneTarget } from '../tavern-plugin/lib/domain/scene-illustration.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scene-worldbook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  return { store, api: createSceneWorldbooks({ store }) }
}
const book = text => ({ view: { entries: [
  { ref: 'entry:one', title: '林岚', primaryKeys: ['岚岚'], content: text, enabled: true, constant: false },
  { ref: 'disabled', title: '林岚', content: '停用条目', enabled: false },
  { ref: 'rules', title: '[mvu_update] rules', content: '更新教程', constant: true },
  { ref: 'entry:place', title: '青石车站', primaryKeys: ['车站'], content: '青石车站有石柱。', constant: true }
] } })

test('opening swipes retain their archive; rewritten bodies and missing/corrupt archives never use current resources', async t => {
  const { store, api } = await fixture(t), ref = await api.capture({ worldBook: book('黑色短发') })
  const chat = { id: 'chat', messages: [bindSceneWorldbook({ role: 'assistant', turn: 1, greeting: true, swipes: ['林岚站着。', '林岚坐着。'], swipeId: 0 }, ref)] }
  for (const swipeId of [0, 1]) {
    chat.messages[0].swipeId = swipeId
    assert.deepEqual(sceneWorldbookBinding(chat, sceneTarget(chat, 1)), ref)
  }
  chat.messages[0].swipes[1] = '新写的正文。'
  assert.equal(sceneWorldbookBinding(chat, sceneTarget(chat, 1)), null)
  await store.writeJson('scene-images/worldbooks/' + ref.digest + '.json', { version: 1, entries: null }) // structural damage; names are not re-hashed
  assert.match((await api.read(ref)).unavailable, /校验失败/)
  await store.remove('scene-images/worldbooks/' + ref.digest + '.json')
  assert.match((await api.read(ref)).unavailable, /缺失/)
  assert.equal(await api.read({ version: 1, digest: '../../elsewhere' }), null)
})

test('跨机器导入保持快照可读，损坏快照不产生登记或覆盖已有数据', async t => {
  const source = await fixture(t), target = await fixture(t)
  const opening = await source.api.capture({ worldBook: book('初始设定') })
  const later = await source.api.capture({ worldBook: book('后续设定') })
  const states = [{ sceneOpeningWorldbook: opening, messages: [{ role: 'assistant', turn: 2, sceneWorldbook: later }] }]
  const snapshots = await source.api.exportForSave(states)
  await target.api.importForSave('imported', states, snapshots)
  for (const ref of [opening, later]) assert.deepEqual(await target.api.read(ref), await source.api.read(ref))
  await assert.rejects(target.api.importForSave('bad', states, [{ ...snapshots[0], content: Buffer.from('{"version":1,"entries":[]}') }]), /校验失败/)
  assert.equal(await target.store.readJson('scene-images/worldbook-refs/bad.json'), undefined)
  await target.api.forgetChat('imported')
  assert.match((await target.api.read(later)).unavailable, /缺失/)
})
