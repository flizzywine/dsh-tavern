import {isDeepStrictEqual} from 'node:util'
import {check,validateUuid} from '../asset-packs/common.js'
import {jsonBytes} from './validation.js'
import {trimAuthoringImages,retireFigureBundles} from './image-closure.js'

// Host maintenance only: figures change owner pack but keep their ids, sprite keys, bundle keys and outfit keys, so the
// reference migration (bin/lib/pack-merge-*.mjs) rewrites nothing but the pack half of each (pack, figure) pair.
// source/target: loaded packs; returns the next manifest and files of both. Unwritten: the caller seals and publishes.
export function moveFigureContents(source, target, figureIds) {
  check(source.manifest.schemaVersion === target.manifest.schemaVersion,'$.schemaVersion','Migrate both packs to the same image format before moving','UNSUPPORTED_SCHEMA_VERSION')
  check(Array.isArray(figureIds) && figureIds.length > 0 && new Set(figureIds).size === figureIds.length,'$.figureIds','Choose the figures to move')
  figureIds.forEach(id => validateUuid(id,'$.figureIds'))
  const from = {manifest:structuredClone(source.manifest),files:new Map(source.files)}, to = {manifest:structuredClone(target.manifest),files:new Map(target.files)}
  const moved = figureIds.map(id => {
    check(source.figures[id],'$.figureIds','Figure missing in source: '+id,'ASSET_UNAVAILABLE')
    check(!target.manifest.figures.includes(id),'$.figureIds','Figure already in target: '+id,'DUPLICATE_ID')
    return structuredClone(source.figures[id])
  })
  const blobs = new Set(), copyBlob = hash => {
    const descriptor = source.manifest.blobs[hash]
    check(!to.manifest.blobs[hash] || isDeepStrictEqual(to.manifest.blobs[hash],descriptor),'$.blob','Conflicting blob descriptor','REVISION_CONFLICT')
    to.manifest.blobs[hash] = structuredClone(descriptor)
    const name = 'media/' + hash + '.' + descriptor.ext
    to.files.set(name,source.files.get(name))
  }
  const visit = value => {
    if (typeof value === 'string' && Object.hasOwn(source.manifest.blobs,value)) blobs.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  const copyFile = (name,bytes) => {
    const existing = to.files.get(name)
    check(!existing || Buffer.compare(Buffer.from(existing),Buffer.from(bytes)) === 0,'$.files','Conflicting file: '+name,'REVISION_CONFLICT')
    to.files.set(name,bytes)
  }
  const voices = {}
  for (const figure of moved) {
    for (const outfit of figure.outfits) {
      if (outfit.sprite) {
        const key = outfit.sprite.manifestKey, file = source.manifest.sprites[key]
        check(!Object.hasOwn(to.manifest.sprites,key) || to.manifest.sprites[key] === file && isDeepStrictEqual(to.files.get(file),source.files.get(file)),'$.sprites','Sprite key already used in target: '+key,'DUPLICATE_ID')
        to.manifest.sprites[key] = file; to.files.set(file,source.files.get(file))
      }
      for (const form of ['live2d','spine']) if (outfit[form]) {
        const key = outfit[form].bundleKey
        check(!Object.hasOwn(to.manifest.bundles,key) || isDeepStrictEqual(to.manifest.bundles[key],source.manifest.bundles[key]),'$.bundles','Bundle key already used in target: '+key,'DUPLICATE_ID')
        to.manifest.bundles[key] = structuredClone(source.manifest.bundles[key])
        for (const [name,bytes] of source.files) if (name.startsWith('bundles/'+key+'/')) copyFile(name,bytes)
      }
    }
    if (figure.voice?.voice) {
      const old = figure.voice.voice, spec = source.manifest.voiceLibrary?.voices?.[old]
      check(spec,'$.voice','Voice missing in source: '+old,'ASSET_UNAVAILABLE')
      const library = to.manifest.voiceLibrary ||= {version:1,voices:{}}
      if (!voices[old]) {
        let next = old
        for (let n = 2; Object.hasOwn(library.voices,next) && !isDeepStrictEqual(library.voices[next],spec); n++) next = old.slice(0,60) + '-' + n
        library.voices[next] = structuredClone(spec); voices[old] = next
      }
      figure.voice.voice = voices[old]
      visit(spec)
    }
    visit(figure)
    to.manifest.figures.push(figure.id); to.files.set('figures/'+figure.id+'.json',jsonBytes(figure))
  }
  for (const hash of blobs) copyBlob(hash)
  for (const path of source.manifest.credits || []) if (!(to.manifest.credits || []).includes(path)) {
    copyFile(path,source.files.get(path)); (to.manifest.credits ||= []).push(path)
  }
  // The source forgets them: what no remaining figure or asset uses goes with them.
  from.manifest.figures = from.manifest.figures.filter(id => !figureIds.includes(id))
  for (const id of figureIds) from.files.delete('figures/'+id+'.json')
  trimAuthoringImages(from.manifest,from.files,source.figures)
  retireFigureBundles(from.manifest,from.files,moved,from.manifest.figures.map(id => source.figures[id]))
  const remaining = JSON.stringify([from.manifest.figures.map(id => source.figures[id]),from.manifest.assets,from.manifest.voiceLibrary?.voices && Object.entries(from.manifest.voiceLibrary.voices).filter(([id]) => !Object.keys(voices).includes(id)),from.manifest.tagIcons])
  const used = new Set(from.manifest.figures.map(id => source.figures[id].voice?.voice).filter(Boolean))
  for (const id of Object.keys(voices)) if (!used.has(id)) delete from.manifest.voiceLibrary.voices[id]
  for (const hash of blobs) if (from.manifest.blobs[hash] && !remaining.includes(hash) && !JSON.stringify(from.manifest.voiceLibrary || {}).includes(hash)) {
    const name = 'media/' + hash + '.' + from.manifest.blobs[hash].ext
    delete from.manifest.blobs[hash]; from.files.delete(name)
  }
  return {from,to,mapping:{source:source.manifest.id,target:target.manifest.id,moveFigures:figureIds,figures:{},outfits:{}}}
}
