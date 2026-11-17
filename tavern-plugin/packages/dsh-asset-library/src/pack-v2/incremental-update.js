// 增量更新 (decision 'merge'): the author's new version of an installed pack plus the entries only the installed version has.
// Kept entries keep their ids / UUIDs (saved chats name them) together with what they need inside the pack: media, bundles,
// sprites, voices and credits. Where the new version has the same entry, the new version wins.
import assetTags from '../shared/asset-tags.cjs'
import { assetContents } from '../shared/asset-variant-content.js'
import { check } from '../asset-packs/common.js'
import { isDeepStrictEqual } from 'node:util'
import { jsonBytes, sealPack } from './validation.js'

const sameAsset = (a, b) => a.kind === b.kind && a.id === b.id

// The entries an update would delete, in the installed pack's order: figures ('figures') first, then the other entries.
export function removedEntries(before, pack) {
  return [
    ...before.manifest.figures.filter(id => !pack.manifest.figures.includes(id)).map(id => ({kind:'figures', id, name:before.figures[id].name})),
    ...before.manifest.assets.filter(old => !pack.manifest.assets.some(next => sameAsset(old, next))).map(asset => ({kind:asset.kind, id:asset.id, name:asset.name}))
  ]
}

// pack: the verified new version (metadata already merged); before: the installed pack's metadata;
// read(path, size): an installed file's bytes; verify: the service's sealed-pack verification.
export async function withRemovedEntries(pack, before, {read, verify}) {
  const removed = removedEntries(before, pack)
  if (!removed.length) return pack
  const manifest = structuredClone(pack.manifest), files = new Map(pack.files), hashed = new Map()
  const stored = new Map(before.manifest.files.map(file => [file.path, file])), incoming = new Map(pack.manifest.files.map(file => [file.path, file]))
  const retired = new Set(before.local.retired || [])
  async function take(from, to) {
    const file = stored.get(from)
    check(file && !incoming.has(to), from, 'Installed file missing', 'FILE_CLOSURE_MISMATCH')
    files.set(to, before.documents?.get(from) || await read(from, file.size)); hashed.set(to, file.sha256)
  }
  const free = (start, taken, limit) => { let key = start; for (let n = 2; taken(key); n++) key = start.slice(0, limit) + '-' + n; return key }
  // Media are named by their content: one the new version holds is the same bytes.
  const blobs = new Set()
  function media(hash) {
    if (manifest.blobs[hash]) return
    manifest.blobs[hash] = structuredClone(before.manifest.blobs[hash]); blobs.add(hash)
  }
  const visit = value => {
    if (typeof value === 'string') { if (Object.hasOwn(before.manifest.blobs, value)) media(value) }
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  // Same key and content in the new version: shared. Otherwise the installed bundle moves along, under a fresh key if taken.
  const bundles = new Map()
  async function bundle(old) {
    if (!bundles.has(old)) {
      const prefix = `bundles/${old}/`, paths = before.manifest.files.map(file => file.path).filter(path => path.startsWith(prefix))
      if (manifest.bundles[old]?.contentHash === before.manifest.bundles[old].contentHash) bundles.set(old, old)
      else {
        const key = free(old, key => Object.hasOwn(manifest.bundles, key) || retired.has('bundle/' + key) || [...incoming.keys()].some(path => path.startsWith(`bundles/${key}/`)), 56)
        manifest.bundles[key] = structuredClone(before.manifest.bundles[old]); bundles.set(old, key)
        for (const path of paths) await take(path, `bundles/${key}/` + path.slice(prefix.length))
      }
    }
    return bundles.get(old)
  }
  const sprites = new Map()
  async function sprite(old) {
    if (!sprites.has(old)) {
      const path = before.manifest.sprites[old]
      if (manifest.sprites[old] === path && incoming.get(path)?.sha256 === stored.get(path).sha256) sprites.set(old, old)
      else {
        const key = free(old, key => Object.hasOwn(manifest.sprites, key) || retired.has('sprite/' + key) || incoming.has(`sprites/${key}/manifest.json`), 56)
        const next = manifest.sprites[old] === undefined && !incoming.has(path) ? path : `sprites/${key}/manifest.json`
        manifest.sprites[key] = next; sprites.set(old, key)
        await take(path, next)
      }
    }
    return sprites.get(old)
  }
  function voice(old) {
    const spec = before.manifest.voiceLibrary.voices[old], library = manifest.voiceLibrary ||= {version:1, voices:{}}
    const key = isDeepStrictEqual(library.voices[old], spec) ? old : free(old, key => Object.hasOwn(library.voices, key), 60)
    library.voices[key] = structuredClone(spec); visit(spec)
    return key
  }
  // Attribution travels with the kept entries; the same text the new version already holds is reused.
  async function credit(path) {
    const sha = stored.get(path).sha256, same = [...incoming.values(), ...[...hashed].map(([path, sha256]) => ({path, sha256}))].find(file => file.path.startsWith('credits/') && file.sha256 === sha)
    if (same) return same.path
    let next = path
    for (let n = 2; files.has(next); n++) next = path.replace(/(\.[^./]*)?$/, '-' + n + '$1')
    await take(path, next)
    return next
  }
  for (const {kind, id} of removed) {
    if (kind === 'figures') {
      const figure = structuredClone(before.figures[id])
      for (const outfit of figure.outfits) {
        if (outfit.sprite) outfit.sprite.manifestKey = await sprite(outfit.sprite.manifestKey)
        for (const form of ['live2d', 'spine']) if (outfit[form]) outfit[form].bundleKey = await bundle(outfit[form].bundleKey)
      }
      if (figure.voice?.voice) figure.voice.voice = voice(figure.voice.voice)
      visit(figure)
      manifest.figures.push(id); files.set(`figures/${id}.json`, jsonBytes(figure))
      continue
    }
    const asset = structuredClone(before.manifest.assets.find(row => sameAsset(row, {kind, id})))
    for (const content of assetContents(asset)) if (content.bundleKey) content.bundleKey = await bundle(content.bundleKey)
    if (asset.credits) asset.credits = await Promise.all(asset.credits.map(credit))
    for (const icon of before.manifest.tagIcons || []) if (assetTags.matches(asset.category, icon.tag) && !manifest.tagIcons?.some(row => row.tag === icon.tag)) {
      (manifest.tagIcons ||= []).push(structuredClone(icon)); media(icon.media)
    }
    visit(asset)
    manifest.assets.push(asset)
  }
  for (const path of before.manifest.credits || []) {
    const next = await credit(path)
    if (!(manifest.credits ||= []).includes(next)) manifest.credits.push(next)
  }
  for (const hash of blobs) { const name = `media/${hash}.${manifest.blobs[hash].ext}`; await take(name, name) }
  await sealPack(manifest, files, pack, hashed)
  return verify(manifest, files, pack, true)
}
