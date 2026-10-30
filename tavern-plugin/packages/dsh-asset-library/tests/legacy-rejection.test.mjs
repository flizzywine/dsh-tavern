import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssetPackService } from '../lib/index.js'
import { writeZip } from '../src/zip.js'

for (const name of ['dsh-tavern-pack.json', 'dsh-tavern-library.json']) test('v2 rejects unsupported legacy ZIP manifest: ' + name, async t => {
  const root = await mkdtemp(join(tmpdir(), 'legacy-rejection-'))
  const service = createAssetPackService({assetRoot:join(root, 'asset-packs')})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true, force:true}) })
  const zip = join(root, 'old.zip')
  await writeZip(zip, [{path:name, data:Buffer.from('{"version":1,"files":[]}')}])
  await assert.rejects(service.inspectImport({bytes:await readFile(zip)}))
  assert.deepEqual(await service.listPacks(), [])
})
test('explicit v2 root never reads old library/model/card layouts or infers legacy storage', async t => {
  const root = await mkdtemp(join(tmpdir(), 'legacy-root-')), old = join(root, 'data')
  t.after(() => rm(root, {recursive:true, force:true}))
  await mkdir(join(old, 'card-assets/card-a/models'), {recursive:true})
  await writeFile(join(old, 'card-assets/card-a/models/library.json'), '{"version":1,"models":[]}')
  assert.throws(() => createAssetPackService({legacyDataRoot:old}))
  const service = createAssetPackService({assetRoot:join(root, 'asset-packs'), legacyDataRoot:old})
  try { assert.deepEqual(await service.listPacks(), []) }
  finally { await service.dispose() }
  assert.equal(await readFile(join(old, 'card-assets/card-a/models/library.json'), 'utf8'), '{"version":1,"models":[]}')
})
