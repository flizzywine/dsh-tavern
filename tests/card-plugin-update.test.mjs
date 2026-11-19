import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCardPlugins, createCardPluginUpdates } from '../tavern-plugin/lib/domain/card-plugins.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { openZipFile } from '../tavern-plugin/lib/domain/zip-file.js'
import { readCardArchive } from '../tavern-plugin/lib/domain/card-archive.js'
import { writeZip } from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'

const cardPath = 'cards/plugin-card.json', name = 'card-game-plugin'
const pkg = version => Buffer.from(JSON.stringify({ name, version, main: 'main.js' }))

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'card-plugin-update-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const profile = path.join(root, 'data'), pluginsDir = path.join(profile, 'plugins')
  await fs.mkdir(profile)
  const cast = createCastAssets({ store: createProfileDataStore({ dataRoot: profile }) })
  const manager = createCardPlugins({ dataRoot: profile, pluginsDir, keyOf: cast.keyOf, journalPath: path.join(profile, 'card-plugin-update.journal.json') })
  const card = path.join(root, 'card.dshcard')
  await writeZip(card, [
    { path: 'card.json', data: Buffer.from('{"name":"card"}') },
    { path: 'plugins/game/package.json', data: pkg('1.0.0') },
    { path: 'plugins/game/main.js', data: Buffer.from('export const version = 1') },
    { path: 'dsh.json', data: Buffer.from(JSON.stringify({ format: 'dshcard', formatVersion: 1, plugins: [{ name, path: 'plugins/game/', purpose: 'mini game' }] })) }
  ])
  const zip = await openZipFile(card)
  let staged
  try { staged = await manager.stage(zip, { cardKey: cast.keyOf(cardPath), plugins: (await readCardArchive(zip)).plugins }) }
  finally { await zip.close() }
  await manager.enable({ cardKey: cast.keyOf(cardPath), cardPath, plugins: staged })
  await cast.replaceManifest(cardPath, { version: 1, characters: [], plugins: [{ ...staged[0], enabled: true }] })
  const backups = []
  const service = createCardPluginUpdates({ cardPlugins: manager, castAssets: cast,
    backup: async () => { const file = path.join(root, 'backup-' + backups.length + '.json'); backups.push(file); await fs.writeFile(file, '{}'); return file } })
  return { root, pluginsDir, cast, service, backups }
}

test("a plugin's own ZIP, as its author publishes it, updates that plugin on the card", async t => {
  const f = await fixture(t), file = path.join(f.root, 'release.zip')
  // A release archive keeps its files under one top folder.
  await writeZip(file, [
    { path: 'card-game-plugin-1.1.0/package.json', data: pkg('1.1.0') },
    { path: 'card-game-plugin-1.1.0/main.js', data: Buffer.from('export const version = 2') }
  ])
  const preview = await f.service.preview({ cardPath, file })
  assert.equal(preview.pluginName, name)
  assert.deepEqual([preview.before.version, preview.after.version], ['1.0.0', '1.1.0'])
  assert.deepEqual(preview.changes.map(change => change.path + ' ' + change.kind).sort(), ['main.js modified', 'package.json modified'])
  const result = await f.service.confirm({ cardPath, inspectionId: preview.inspectionId, acceptPluginRisk: true })
  assert.deepEqual([result.beforeVersion, result.afterVersion, result.restartRequired], ['1.0.0', '1.1.0', true])
  assert.equal(f.backups.length, 1)
  const [binding] = (await f.cast.read(cardPath)).plugins
  assert.equal(binding.enabled, true)
  assert.equal(binding.purpose, 'mini game', 'the card keeps what it says the plugin is for')
  const installed = (await fs.readdir(f.pluginsDir)).filter(folder => !folder.startsWith('.'))
  assert.deepEqual(await Promise.all(installed.map(folder => fs.readFile(path.join(f.pluginsDir, folder, 'main.js'), 'utf8'))), ['export const version = 2'])
})
