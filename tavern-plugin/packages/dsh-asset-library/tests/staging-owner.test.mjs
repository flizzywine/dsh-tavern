// deterministic two-process recovery race; synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, lstat, mkdir, writeFile, readdir, utimes, unlink, rmdir } from 'node:fs/promises'
import { createPackStorage } from '../src/pack-v2/storage.js'
import { verifyPackFiles } from '../src/asset-packs/index.js'
import { syntheticPack, PACK_ID } from '../../../../tests/fixtures/asset-packs/pack.mjs'

const storageUrl = new URL('../src/pack-v2/storage.js', import.meta.url).href
const limits = {entrySize:1e8, totalSize:1e9, entries:10000}
function child(code) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {encoding:'utf8', timeout:30000})
  assert.equal(result.status, 0, result.stderr || String(result.error))
  return result.stdout
}
function recoverElsewhere(assetRoot) {
  child(`import {createPackStorage} from ${JSON.stringify(storageUrl)}; await createPackStorage({assetRoot:${JSON.stringify(assetRoot)},limits:${JSON.stringify(limits)}}).run([],async()=>{});`)
}
async function removeTree(folder) {
  for (const entry of await readdir(folder, {withFileTypes:true})) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) await removeTree(full)
    else await unlink(full)
  }
  await rmdir(folder)
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'staging-owner-'))
  t.after(() => removeTree(root))
  return root
}
for (const batch of [false, true]) test(`foreign recovery preserves active ${batch ? 'batch' : 'single'} publication before and after journal`, async t => {
  const assetRoot = await fixture(t), pack = await syntheticPack()
  const second = [...pack.files.keys()][1]
  let paused = false, prepared = false
  const storage = createPackStorage({assetRoot, limits,
    inspectPath:async file => {
      if (!paused && file.replaceAll('\\', '/').endsWith('/new-pack/' + second)) {
        paused = true
        recoverElsewhere(assetRoot)
      }
      return lstat(file)
    },
    fault:async stage => {
      if (stage === (batch ? 'batch-prepared' : 'prepared')) { prepared = true; recoverElsewhere(assetRoot) }
    }
  })
  const local = {revision:'test', retired:[]}
  await storage.run([PACK_ID], () => batch
    ? storage.publishMany([{pack, local}], {record:{}, commit:async () => {}, status:async () => 'after'})
    : storage.publish(PACK_ID, pack, local))
  assert.ok(paused && prepared)
  const loaded = await storage.run([PACK_ID], () => storage.load(PACK_ID))
  await verifyPackFiles(loaded.manifest, loaded.files)
  assert.equal(loaded.files.size, pack.files.size)
  assert.deepEqual(await readdir(path.join(assetRoot, 'staging')), [])
})
test('foreign recovery preserves active temporary archive', async t => {
  const assetRoot = await fixture(t), storage = createPackStorage({assetRoot, limits})
  await storage.run([], () => storage.temporary(async file => {
    await writeFile(file, 'archive')
    recoverElsewhere(assetRoot)
    assert.ok((await lstat(file)).isFile())
  }))
})
test('dead owners recover immediately; ownerless staging ages; live owners never age out', async t => {
  const assetRoot = await fixture(t), storage = createPackStorage({assetRoot, limits})
  const deadPid = Number(child('console.log(process.pid)'))
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000)
  const dirs = {}
  for (const kind of ['dead', 'fresh', 'old', 'live']) {
    const tx = path.join(assetRoot, 'staging', randomUUID()); dirs[kind] = tx
    await mkdir(tx, {recursive:true})
    if (kind === 'dead' || kind === 'live') await writeFile(path.join(tx, 'owner.json'), JSON.stringify({pid:kind === 'dead' ? deadPid : process.pid, token:randomUUID(), createdAt:kind === 'dead' ? Date.now() : stale.getTime()}))
    if (kind === 'old' || kind === 'live') await utimes(tx, stale, stale)
  }
  await storage.run([], async () => {})
  for (const kind of ['dead', 'old']) await assert.rejects(lstat(dirs[kind]), {code:'ENOENT'})
  for (const kind of ['fresh', 'live']) assert.ok((await lstat(dirs[kind])).isDirectory())
})
