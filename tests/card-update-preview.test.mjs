import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import vm from 'node:vm'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'

const source = await readFile(new URL('../tavern-plugin/src/client/modules/card-update-dialog.js', import.meta.url), 'utf8')
const api = vm.runInNewContext(source + ';({ readTavernCardUpdateMetadata,tavernCardUpdateMetadata })', {
  TextDecoder, Uint8Array, DataView, Blob, DecompressionStream, atob,
  parseCardFile: async file => ({ kind: 'text', text: await file.text() })
})
const file = (bytes, name) => Object.assign(new Blob([bytes]), { name })

test('opening update dialog renders without relying on a parent component h alias', () => {
  const React = { useState: value => [value, () => {}], useEffect() {}, createElement: (type, props, ...children) => ({ type, props, children }) }
  const dialog = vm.runInNewContext(source + ';TavernCardUpdateDialog({})', { React })
  assert.equal(dialog.type, 'div')
})

test('version preview reads v1 JSON and v3 DSH/CHARX metadata without modifying a card', async () => {
  const json = await api.readTavernCardUpdateMetadata(file(JSON.stringify({name:'Old',character_version:'0.6.0'}),'old.json'))
  assert.equal(json.version,'0.6.0')
  const bytes = writeZipEntries([{path:'card.json',content:JSON.stringify({spec:'chara_card_v3',data:{name:'New',character_version:'0.7.0'}})}])
  for (const name of ['new.dshcard','new.charx']) {
    const preview = await api.readTavernCardUpdateMetadata(file(bytes,name))
    assert.equal(preview.name,'New'); assert.equal(preview.version,'0.7.0')
  }
  assert.equal(api.tavernCardUpdateMetadata({data:{name:'Unversioned'}}).version,'')
})

test('version preview skips large ZIP assets and bounds oversized or encrypted metadata', async () => {
  const bytes = writeZipEntries([{path:'assets/large.bin',content:randomBytes(300000)},{path:'card.json',content:JSON.stringify({data:{name:'Small',character_version:'2'}})}])
  const original = file(bytes,'large.dshcard'); let readBytes = 0
  const guarded = {name:original.name,size:original.size,slice(start,end){readBytes+=end-start;return original.slice(start,end)}}
  assert.equal((await api.readTavernCardUpdateMetadata(guarded)).version,'2')
  assert(readBytes < 80000, 'Preview must not read the asset payload')
  const encrypted = Buffer.from(bytes), header = encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]), encrypted.length-300)
  // Find the card.json directory record, independently of the asset's compression ratio.
  const cardHeader = encrypted.lastIndexOf(Buffer.from([0x50,0x4b,0x01,0x02]))
  assert(header >= 0); encrypted.writeUInt16LE(1,cardHeader+8)
  await assert.rejects(api.readTavernCardUpdateMetadata(file(encrypted,'locked.dshcard')), /加密/)
  const oversized = writeZipEntries([{path:'card.json',content:' '.repeat(2*1024*1024+1)}])
  await assert.rejects(api.readTavernCardUpdateMetadata(file(oversized,'oversized.dshcard')), /过大/)
  await assert.rejects(api.readTavernCardUpdateMetadata(file('broken','bad.dshcard')), /预览/)
})
