// Measurements bound to one picture (the figure's face anchors, an outfit's measured heads) retire with that picture:
// 删除差分 used to fail with INVALID_ASSET_PACK because a face anchor still named the media it had just removed.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {syntheticPack,png,PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {sealPack,jsonBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'

test('删除差分 drops the face anchor and measured head of its picture, keeps the others and trims the image', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'figure-measurements-')), pack = await syntheticPack(), figure = pack.figures[FIGURE_ID]
  figure.emotions.push({id: 'proud', label: '得意'})
  const bytes = png([100, 110, 120]), hash = createHash('sha256').update(bytes).digest('hex')
  pack.manifest.blobs[hash] = {ext: 'png', mime: 'image/png', size: bytes.length}; pack.files.set('media/' + hash + '.png', bytes)
  const outfit = figure.outfits[0]
  outfit.sprite.assets['assets/stage-special.png'] = hash
  const school = pack.sprites.school; school.emotions.proud = school.emotions.crying; delete school.emotions.crying
  outfit.avatars.proud = outfit.avatars.crying; delete outfit.avatars.crying
  const kept = outfit.avatars.calm
  figure.extensions = {...figure.extensions, 'dsh.avatar-face-anchors': {[hash]: [0.3, 0.1, 0.3, 0.2], [kept]: [0.2, 0.1, 0.4, 0.3]}}
  outfit.extensions = {...outfit.extensions, 'dsh.avatar-heads': {proud: {media: hash, headTop: 0.1, chin: 0.3, faceRect: [0.3, 0.1, 0.3, 0.2]}, calm: {media: kept, headTop: 0.1, chin: 0.3, faceRect: [0.2, 0.1, 0.4, 0.3]}}}
  for (const [id, value] of Object.entries(pack.figures)) pack.files.set('figures/' + id + '.json', jsonBytes(value))
  for (const [key, value] of Object.entries(pack.sprites)) pack.files.set(pack.manifest.sprites[key], jsonBytes(value))
  await sealPack(pack.manifest, pack.files)
  const zip = path.join(root, 'pack.zip'); await writeZip(zip, [{path: 'manifest.json', data: jsonBytes(pack.manifest)}, ...[...pack.files].map(([path, data]) => ({path, data}))])
  const service = createAssetPackService({assetRoot: path.join(root, 'assets')})
  t.after(async () => { await service.dispose(); await rm(root, {recursive: true, force: true}) })
  const inspect = await service.inspectImport({bytes: await readFile(zip)})
  const {snapshot: before} = await service.applyImport({inspectionId: inspect.inspectionId, expectedRevision: null, decision: 'install'})
  const {snapshot} = await service.removeFigureEmotion({packId: PACK_ID, figureId: FIGURE_ID, emotionId: 'proud', expectedRevision: before.revision})
  const after = snapshot.figures[FIGURE_ID]
  assert.deepEqual(Object.keys(after.extensions['dsh.avatar-face-anchors']), [kept])
  assert.deepEqual(Object.keys(after.outfits[0].extensions['dsh.avatar-heads']), ['calm'])
  assert.equal(snapshot.manifest.blobs[hash], undefined)
  assert.ok(snapshot.manifest.blobs[kept])
})
