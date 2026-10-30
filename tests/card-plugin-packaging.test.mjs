import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { openZipFile } from '../tavern-plugin/lib/domain/zip-file.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const root = fileURLToPath(new URL('../', import.meta.url))
async function temp(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'card-plugin-packaging-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}
async function archive(file) {
  const zip = await openZipFile(file)
  try {
    const dsh = JSON.parse((await zip.readBuffer(zip.entries.get('dsh.json'), 65536)).toString())
    return { dsh, paths: [...zip.entries.keys()] }
  } finally { await zip.close() }
}
async function manifest(file, folder) {
  const zip = await openZipFile(file)
  try { return JSON.parse((await zip.readBuffer(zip.entries.get('plugins/' + folder + '/package.json'), 65536)).toString()) }
  finally { await zip.close() }
}

test('hello example builds a real archive with the plugin package identity', async t => {
  const target = path.join(await temp(t), 'hello.dshcard')
  const result = run(path.join(root, 'examples/dshcard-hello/build.mjs'), target)
  assert.equal(result.status, 0, result.stderr)
  const pkg = await manifest(target, 'hello-mood')
  assert.equal(pkg.name, 'dsh-card-hello-mood')
  assert.equal(pkg.version, '1.0.0')
})

// 大肥鱼 carries no plugin: Tavern's stage draws it from its bound packs, and it declares the stage
// (defaults.stage). The compressor also strips an earlier build's galgame plugin.
test('dafeiyu build and distribution compressor produce a card without a plugin in real ZIPs', async t => {
  const dir = await temp(t)
  const source = path.join(dir, 'bundle.zip'), built = path.join(dir, 'source.dshcard'), distributed = path.join(dir, 'distributed.dshcard')
  const packId = '8eb406da-b0af-4070-9e67-8e056c5e9b2e'
  // No media conversion: exercise the actual packaging pipeline without external tools or model calls.
  const files = {
    'dsh-tavern-card-bundle.json': { dependencies: [], cover: { path: 'cover.png' } },
    'card/card.json': { data: { name: 'Fixture', extensions: { dsh_tavern: { openings: { lead: { packId, figureId: 'lead' } } } } } },
    ['packs/' + packId + '/figures/lead.json']: { outfits: [{ avatars: {} }] },
  }
  await writeFile(source, writeZipEntries([
    ...Object.entries(files).map(([path, value]) => ({ path, content: JSON.stringify(value) })),
    { path: 'cover.png', content: Buffer.from('fixture') },
  ]))
  let result = run(path.join(root, 'examples/dafeiyu-card/build.mjs'), source, built)
  assert.equal(result.status, 0, result.stderr)
  let card = await archive(built)
  assert.equal(card.dsh.plugins, undefined)
  assert.equal(card.dsh.defaults.stage, true)
  assert.equal(card.paths.some(file => file.startsWith('plugins/')), false)
  // A card built before: it still carries the plugin and asks for the stage.
  const zip = await openZipFile(built), entries = []
  for (const entry of zip.entries.values()) entries.push({ path: entry.path, content: await zip.readBuffer(entry, 64 * 1024 * 1024) })
  await zip.close()
  const dsh = { ...card.dsh, plugins: [{ name: 'dsh-card-dafeiyu-galgame', path: 'plugins/galgame/' }], defaults: { ...card.dsh.defaults, stage: undefined } }
  const old = path.join(dir, 'old.dshcard')
  await writeFile(old, writeZipEntries([...entries.filter(entry => entry.path !== 'dsh.json'), { path: 'dsh.json', content: JSON.stringify(dsh) },
    { path: 'plugins/galgame/package.json', content: JSON.stringify({ name: 'dsh-card-dafeiyu-galgame', version: '1.0.0' }) }]))
  result = run(path.join(root, 'examples/dafeiyu-card/compress.mjs'), old, distributed)
  assert.equal(result.status, 0, result.stderr)
  card = await archive(distributed)
  assert.equal(card.dsh.plugins, undefined)
  assert.equal(card.dsh.defaults.stage, true)
  assert.equal(card.paths.some(file => file.startsWith('plugins/')), false)
})

test('all card packagers reject missing, blank, and non-string identity before reading inputs or writing output', async t => {
  const dir = await temp(t)
  await symlink(path.join(root, 'tavern-plugin'), path.join(dir, 'tavern-plugin'), 'dir')
  for (const relative of ['dshcard-hello/build.mjs']) {
    const script = path.join(dir, 'examples', relative), plugin = path.join(path.dirname(script), 'plugin')
    await mkdir(plugin, { recursive: true })
    await copyFile(path.join(root, 'examples', relative), script)
    for (const invalid of [undefined, '', '  ', 1, null]) {
      for (const field of ['name', 'version']) {
        const pkg = { name: 'fixture-plugin', version: '1.0.0', [field]: invalid }
        await writeFile(path.join(plugin, 'package.json'), JSON.stringify(pkg))
        const target = path.join(dir, 'must-not-exist.dshcard')
        const args = relative.startsWith('dshcard-hello') ? [target] : [path.join(dir, 'missing-input.zip'), target]
        const result = run(script, ...args)
        assert.notEqual(result.status, 0, relative + ' accepted ' + field + '=' + invalid)
        assert.match(result.stderr, new RegExp('package.json.*' + field))
        await assert.rejects(stat(target), { code: 'ENOENT' })
      }
    }
  }
})
