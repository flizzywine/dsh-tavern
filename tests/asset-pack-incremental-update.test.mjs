import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {jsonBytes, sealPack} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
import {syntheticPack, png, digest, PACK_ID, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

// 增量更新: an installed pack meets the author's new version. update (完全替换) deletes what only the installed version has;
// merge keeps it under the same ids, the new version winning where both have an entry.
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

// A second figure cloned from the fixture's, with its own picture, sprite keys and Live2D bundle.
function addFigure(pack, id, name, color, prefix) {
  const source = pack.figures[FIGURE_ID], face = source.outfits.find(outfit => outfit.key === 'school').avatars.calm
  const bytes = png(color), hash = digest(bytes)
  pack.manifest.blobs[hash] = {ext:'png', mime:'image/png', size:bytes.length}; pack.files.set(`media/${hash}.png`, bytes)
  const figure = JSON.parse(JSON.stringify(source).replaceAll(face, hash))
  Object.assign(figure, {id, name, aliases:[name + ' 别名']})
  for (const outfit of figure.outfits) {
    const sprite = prefix + outfit.sprite.manifestKey
    pack.manifest.sprites[sprite] = `sprites/${sprite}/manifest.json`
    pack.files.set(pack.manifest.sprites[sprite], pack.files.get(pack.manifest.sprites[outfit.sprite.manifestKey]))
    outfit.sprite.manifestKey = sprite
    if (outfit.live2d) {
      const old = outfit.live2d.bundleKey, key = prefix + 'model'
      pack.manifest.bundles[key] = structuredClone(pack.manifest.bundles[old])
      for (const [name, data] of [...pack.files]) if (name.startsWith(`bundles/${old}/`)) pack.files.set(`bundles/${key}/` + name.slice(`bundles/${old}/`.length), data)
      outfit.live2d.bundleKey = key
    }
  }
  pack.manifest.figures.push(id); pack.figures[id] = figure
  pack.files.set(`figures/${id}.json`, jsonBytes(figure))
  return hash
}
async function archive(root, pack) {
  await sealPack(pack.manifest, pack.files)
  const file = path.join(root, crypto.randomUUID() + '.zip')
  await writeZip(file, [{path:'manifest.json', data:jsonBytes(pack.manifest)}, ...[...pack.files].map(([name, data]) => ({path:name, data}))])
  return file
}
// The installed version: A and B, with the sound effect 'bell'. The author's new version: A renamed, C added, B and 'bell' gone.
async function versions(root, cPrefix = 'c') {
  const old = await syntheticPack(), bMedia = addFigure(old, B, 'Bee', [10, 200, 30], 'b')
  const next = await syntheticPack()
  next.figures[FIGURE_ID].name = 'A prime'; next.files.set(`figures/${FIGURE_ID}.json`, jsonBytes(next.figures[FIGURE_ID]))
  addFigure(next, C, 'Sea', [30, 10, 200], cPrefix)
  // C's model under B's old bundle key, with other content
  if (cPrefix === 'b') next.files.set('bundles/bmodel/textures/face.png', png([1, 2, 3]))
  const bell = next.manifest.assets.findIndex(asset => asset.kind === 'sfx' && asset.id === 'bell')
  next.manifest.assets.splice(bell, 1)
  return {bMedia, oldFile:await archive(root, old), nextFile:await archive(root, next)}
}
async function library(t, cPrefix) {
  const root = await mkdtemp(path.join(tmpdir(), 'pack-incremental-'))
  const service = createAssetPackService({assetRoot:path.join(root, 'library')})
  t.after(async () => { await service.dispose(); await rm(root, {recursive:true, force:true}) })
  const files = await versions(root, cPrefix)
  const first = await service.inspectImportFile({file:files.oldFile})
  const installed = await service.applyImport({inspectionId:first.inspectionId, expectedRevision:null, decision:'install', acceptScriptRisk:true})
  return {service, installed:installed.snapshot, ...files}
}

test('the update preview offers 增量更新 and lists the entries only the installed version has', async t => {
  const {service, nextFile} = await library(t)
  const preview = await service.inspectImportFile({file:nextFile})
  assert.deepEqual(preview.choices, ['update', 'merge', 'keep-both', 'cancel'])
  assert.deepEqual(preview.removed, [{kind:'figures', id:B, name:'Bee'}, {kind:'sfx', id:'bell', name:'Synthetic sfx'}])
})

test('merge keeps B with its UUID and pictures, takes A\' and C from the author, and keeps local recall words', async t => {
  const {service, installed, bMedia, nextFile} = await library(t)
  const music = installed.manifest.assets.find(asset => asset.kind === 'music')
  const recall = {...music.recall, keywords:['本机词', 'synthetic']}
  const edited = await service.patchPack({packId:PACK_ID, expectedRevision:installed.revision,
    patch:{assets:installed.manifest.assets.map(asset => asset === music ? {...asset, recall} : asset)}})
  const local = await service.patchFigure({packId:PACK_ID, figureId:FIGURE_ID, expectedRevision:edited.snapshot.revision, patch:{aliases:['本机名']}})
  const preview = await service.inspectImportFile({file:nextFile})
  const {snapshot} = await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:local.snapshot.revision, decision:'merge', acceptScriptRisk:true})
  assert.deepEqual(snapshot.manifest.figures, [FIGURE_ID, C, B])
  assert.equal(snapshot.figures[FIGURE_ID].name, 'A prime', 'the author\'s version of a shared entry wins')
  assert.deepEqual(snapshot.figures[FIGURE_ID].aliases, ['本机名'])
  assert.deepEqual(snapshot.manifest.assets.find(asset => asset.kind === 'music').recall, recall)
  assert.deepEqual(snapshot.figures[B], installed.figures[B], 'B keeps its UUID, outfits and pictures')
  assert.ok(snapshot.manifest.files.some(file => file.path === `media/${bMedia}.png`))
  assert.ok(snapshot.manifest.bundles.bmodel && snapshot.manifest.sprites.bschool)
  assert.ok(snapshot.manifest.assets.some(asset => asset.kind === 'sfx' && asset.id === 'bell'))
  const media = await service.readMedia({packId:PACK_ID, hash:bMedia, expectedRevision:snapshot.revision})
  assert.deepEqual(Buffer.from(media.bytes), png([10, 200, 30]))
})

test('a kept figure whose model key the new version uses for other content moves its model to a fresh key', async t => {
  const {service, installed, nextFile} = await library(t, 'b')
  const preview = await service.inspectImportFile({file:nextFile})
  const {snapshot} = await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:'merge', acceptScriptRisk:true})
  const model = figure => figure.outfits.find(outfit => outfit.live2d).live2d.bundleKey
  assert.equal(model(snapshot.figures[C]), 'bmodel')
  assert.equal(model(snapshot.figures[B]), 'bmodel-2')
  assert.equal(snapshot.manifest.bundles['bmodel-2'].contentHash, installed.manifest.bundles.bmodel.contentHash)
  assert.notEqual(snapshot.manifest.bundles.bmodel.contentHash, installed.manifest.bundles.bmodel.contentHash)
})

test('update replaces the installed version: B and the sound effect are gone', async t => {
  const {service, nextFile} = await library(t)
  const preview = await service.inspectImportFile({file:nextFile})
  const {snapshot} = await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:preview.expectedRevision, decision:'update', acceptScriptRisk:true})
  assert.deepEqual(snapshot.manifest.figures, [FIGURE_ID, C])
  assert.equal(snapshot.manifest.assets.some(asset => asset.kind === 'sfx' && asset.id === 'bell'), false)
})
