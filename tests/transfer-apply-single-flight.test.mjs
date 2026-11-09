import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildTransferManifest, packTransferBundle, transferItem } from '../tavern-plugin/lib/domain/transfer-bundle.js'
import { createTransferHandlers } from '../tavern-plugin/lib/rpc/transfer.js'

const CARD = JSON.stringify({ spec: 'chara_card_v3', data: { name: '作家', description: '写东西的人' } })

// 一台手机等的太久会再点一次「确认导入」，服务端必须在同一个 token 上只跑一趟。
async function environment(delayMs = 30) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tavern-single-flight-'))
  const cards = new Map()
  const writes = []
  const file = path.join(dir, 'bundle.dshtransfer')
  const manifest = buildTransferManifest({
    name: '一台机器的备份',
    source: { tavern: '3.1.0', platform: 'linux' },
    parts: [{ kind: 'cards', label: '人物卡', items: [transferItem({ key: 'cards:作家', title: '作家', entry: 'parts/cards/作家.json', content: CARD })] }]
  })
  await writeFile(file, packTransferBundle({ manifest, files: new Map([['parts/cards/作家.json', Buffer.from(CARD)]]) }))

  const handlers = createTransferHandlers({
    dataRoot: path.join(dir, 'data'),
    uploads: { async take() { return { file, size: Buffer.byteLength(CARD), remove: async () => {} } } },
    fileResources: {
      async list(kind) { return kind === 'card' ? [...cards.keys()] : [] },
      async readText(relative) { return cards.get(relative) },
      absolute(relative) { return path.join(dir, 'data', relative) }
    },
    worldBooks: { async catalog() { return { standalone: [] } }, async remove() {} },
    presetLibrary: { async catalog() { return { presets: [] } } },
    promptDocuments: {},
    userPreferenceProfile: { async read() { return { profiles: [] } } },
    regexManager: { async read() { return { global: [] } } },
    readTavernSettings: () => ({ promptSets: { sets: [] } }),
    updateTavernSettings: async () => ({}),
    importCard: async ({ name, text }) => {
      await new Promise(resolve => setTimeout(resolve, delayMs))
      writes.push(name)
      cards.set('cards/' + name, text)
      return { path: 'cards/' + name }
    },
    importPreset: async () => ({}),
    readCardWorkspace: async () => undefined,
    cardPreparation: {},
    TAVERN_PACKAGE_VERSION: '3.1.0',
    listTavernSessions: async () => [],
    readChat: async () => null,
    exportGameSave: async () => null,
    importGameSave: async () => null,
    userPluginInstaller: { pluginsDir: path.join(dir, 'plugins'), async list() { return [] } },
    pluginDataStore: {},
    tavernSkills: { async list() { return [] } },
    transferExports: null,
    exportTavernLogs: async () => null,
    deleteCard: async () => {},
    deletePreset: async () => {},
    deleteResource: async () => {},
    readRawTavernSettings: async () => null,
    updateChat: async () => {},
    assetLibrary: null,
    profileData: null
  })
  return { handlers, writes, cards, dir }
}

test('同一个 token 并发点两次：只导入一次，两次拿到同一份结果', async () => {
  const env = await environment()
  const preview = await env.handlers.previewTransferBundle({ uploadId: 'upload-1' })
  assert.ok(preview.token)

  const [first, second] = await Promise.all([
    env.handlers.applyTransferBundle({ token: preview.token }),
    env.handlers.applyTransferBundle({ token: preview.token })
  ])
  assert.equal(env.writes.length, 1, '第二下等第一下的结果，不再写一遍')
  assert.deepEqual(second.results, first.results)
  assert.deepEqual(env.cards.keys().next().value, 'cards/作家.json')

  // 导入完成后回包丢了、用户又点一次：回放结果，不重做。
  const replayed = await env.handlers.applyTransferBundle({ token: preview.token })
  assert.deepEqual(replayed.results, first.results)
  assert.equal(env.writes.length, 1)
})
