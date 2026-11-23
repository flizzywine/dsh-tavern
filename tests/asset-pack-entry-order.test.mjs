import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { validatePackManifest } from '../tavern-plugin/packages/dsh-asset-library/lib/asset-packs/manifest.js'
import { FIGURE_ID, syntheticPack } from './fixtures/asset-packs/pack.mjs'

const src = await readFile(new URL('../tavern-plugin/src/client/asset-pack-ui.js', import.meta.url), 'utf8')
const orderedPackItems = vm.runInNewContext(src + '\norderedPackItems')
const key = 'dsh.entry-order'

test('the library accepts group positions and rejects undeclared groups or invalid positions', async () => {
  const {manifest} = await syntheticPack()
  manifest.extensions = {[key]: {groups:['first','second'], entries:{['figures/'+FIGURE_ID]:['first',2]}}}
  assert.doesNotThrow(() => validatePackManifest(manifest))
  manifest.extensions[key].entries['figures/'+FIGURE_ID] = ['third',2]
  assert.throws(() => validatePackManifest(manifest), /declared group/)
  manifest.extensions[key].entries['figures/'+FIGURE_ID] = ['first',0]
  assert.throws(() => validatePackManifest(manifest), /Invalid integer/)
})

test('each tab follows the same group and position order; other packs keep their stored order', () => {
  const ids = ['unranked-a','late','first-3','unranked-b','first-1','first-2']
  const kinds = ['figures','music','sfx','backgrounds']
  const assets = kinds.slice(1).flatMap(kind => ids.map(id => ({kind,id})))
  const figures = Object.fromEntries(ids.map(id => [id,{id}]))
  const entries = Object.fromEntries(kinds.flatMap(kind => [
    [kind+'/late',['later',1]], [kind+'/first-3',['first',3]], [kind+'/first-1',['first',1]], [kind+'/first-2',['first',2]],
  ]))
  const pack = {figures,manifest:{figures:ids,assets}}
  const read = kind => Array.from(orderedPackItems(pack,kind), item => item.id)
  for (const kind of kinds) assert.deepEqual(read(kind), ids)
  pack.manifest.extensions = {[key]:{groups:['first','later'],entries}}
  for (const kind of kinds) assert.deepEqual(read(kind), ['first-1','first-2','first-3','late','unranked-a','unranked-b'])
  assert.deepEqual(pack.manifest.figures, ids)
  assert.deepEqual(pack.manifest.assets.filter(a => a.kind==='music').map(a => a.id), ids)
})
