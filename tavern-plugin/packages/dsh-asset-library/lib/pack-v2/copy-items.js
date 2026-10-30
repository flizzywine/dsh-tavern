import assetTags from '../shared/asset-tags.cjs'
import {assetContents,assetContentMedia,assetDocument} from '../shared/asset-variant-content.js'
// copy chosen items plus their same-pack dependency closure into another pack (one publication).
// Refs into the source pack are rewritten to the copies; refs to other packs stay as they are.
import contract from '../shared/stage-performance.cjs'
import { check, canonicalJson, validateUuid, validateShortId, ASSET_KINDS } from '../asset-packs/common.js'
import { jsonBytes } from './validation.js'
import { copyFigureAssets } from './copy-figure.js'
const {performanceReferences} = contract
const EVENT_KINDS = {skin:'skins', sfx:'sfx', bgm:'music', look:'looks', ambience:'ambience', widget:'widgets'}

// source: a loaded pack (all files); manifest/files: the target being edited; retired: the target's retired identities.
export function copyPackItems(source, itemRefs, manifest, files, retired) {
  check(Array.isArray(itemRefs) && itemRefs.length > 0, '$.itemRefs', 'Choose items to copy')
  const sourceId = source.manifest.id
  const asset = (kind, id) => source.manifest.assets.find(a => a.kind === kind && a.id === id)
  const queue = [], seen = new Set()
  function add(kind, id) {
    if (seen.has(kind + '/' + id)) return
    check(kind === 'figures' ? source.figures[id] : asset(kind, id), '$.itemRefs', 'Item missing: ' + kind + '/' + id, 'ASSET_UNAVAILABLE')
    seen.add(kind + '/' + id); queue.push({kind, id})
  }
  for (const ref of itemRefs) {
    check(ref && (ref.kind === 'figures' || [...ASSET_KINDS,'props'].includes(ref.kind)), '$.itemRefs', 'Unknown item kind')
    if (ref.kind === 'figures') validateUuid(ref.id, '$.itemRefs.id'); else validateShortId(ref.id, '$.itemRefs.id')
    add(ref.kind, ref.id)
  }
  // Same-pack closure: a background's ambience, everything a performance names in its own pack.
  for (let i = 0; i < queue.length; i++) {
    const {kind, id} = queue[i]
    if (kind === 'figures') continue
    const item = asset(kind, id)
    if (kind === 'widgets') for (const content of assetContents(item)) for (const ref of Object.values(content.settingsDefaults || {})) if (ref?.kind === 'backgrounds' && ref.packId === sourceId) add('backgrounds', ref.assetId)
    if (kind === 'performances') for (const content of assetContents(item)) if (content.background && asset('backgrounds',content.background)) add('backgrounds',content.background)
    if (kind === 'performances') for (const document of item.variants?Object.values(source.variantDocuments[kind+'/'+id]):[source.performances[id]]) for (const {ref} of performanceReferences(document, sourceId)) if (ref.packId === sourceId) add(ref.kind, ref.assetId)
  }
  // Fresh ids only where the target already has (or once had) the same kind/id.
  const ids = new Map(), claimed = new Set()
  for (const {kind, id} of queue) if (kind !== 'figures') {
    const taken = next => claimed.has(kind + '/' + next) || retired.has(`asset/${kind}/${next}`) || manifest.assets.some(a => a.kind === kind && a.id === next)
    let next = id
    for (let n = 2; taken(next); n++) next = id.slice(0, 44) + '-' + n
    claimed.add(kind + '/' + next); ids.set(kind + '/' + id, next)
  }
  const bundles = new Map()
  function bundle(old) {
    if (!bundles.has(old)) {
      let key = old
      for (let n = 2; Object.hasOwn(manifest.bundles, key) || retired.has('bundle/' + key); n++) key = old.slice(0, 56) + '-' + n
      manifest.bundles[key] = structuredClone(source.manifest.bundles[old])
      for (const [path, bytes] of source.files) if (path.startsWith(`bundles/${old}/`)) files.set(`bundles/${key}/` + path.slice(`bundles/${old}/`.length), bytes)
      bundles.set(old, key)
    }
    return bundles.get(old)
  }
  function blob(hash) {
    const descriptor = source.manifest.blobs[hash]
    check(!manifest.blobs[hash] || canonicalJson(manifest.blobs[hash]) === canonicalJson(descriptor), '$.blob', 'Conflicting blob descriptor')
    manifest.blobs[hash] = structuredClone(descriptor)
    files.set(`media/${hash}.${descriptor.ext}`, source.files.get(`media/${hash}.${descriptor.ext}`))
  }
  // Attribution travels with the copies; identical text already in the target is reused.
  function credit(path) {
    const bytes = source.files.get(path)
    const same = [...files].find(([name, data]) => name.startsWith('credits/') && Buffer.compare(Buffer.from(data), Buffer.from(bytes)) === 0)
    if (same) return same[0]
    let next = path
    for (let n = 2; files.has(next); n++) next = path.replace(/(\.[^./]*)?$/, '-' + n + '$1')
    files.set(next, bytes)
    return next
  }
  const local = (document, alias) => alias === 'self' || document.packs[alias] === sourceId
  // materialize the complete figure mapping before rewriting any CG.
  const voices = new Map()
  const figureIds = new Map(queue.filter(item => item.kind === 'figures').map(({id}) => [id, copyFigureAssets(source, id, manifest, files, {credits:false,voices}).figureId]))
  const copied = []
  for (const {kind, id} of queue) {
    if (kind === 'figures') {
      copied.push({kind, fromId:id, toId:figureIds.get(id)})
      continue
    }
    const next = structuredClone(asset(kind, id)), toId = ids.get(kind + '/' + id)
    next.id = toId
    if (kind === 'performances') for (const content of assetContents(next)) if (content.background && ids.has('backgrounds/' + content.background)) content.background = ids.get('backgrounds/' + content.background)
    next.extensions = {...next.extensions,dsh_tavern:{...next.extensions?.dsh_tavern,copiedFrom:next.extensions?.dsh_tavern?.copiedFrom || {packId:sourceId,kind,assetId:id}}}
    if (kind === 'widgets') for (const content of assetContents(next)) for (const ref of Object.values(content.settingsDefaults || {})) if (ref?.kind === 'backgrounds' && ref.packId === sourceId) {
      ref.packId = manifest.id; ref.assetId = ids.get('backgrounds/' + ref.assetId)
    }
    for (const icon of source.manifest.tagIcons || []) if (assetTags.matches(next.category, icon.tag)) {
      const existing = manifest.tagIcons?.find(row => row.tag === icon.tag)
      check(!existing || existing.media === icon.media, '$.tagIcons', 'Conflicting tag icon: ' + icon.tag, 'REVISION_CONFLICT')
      if (!existing) { (manifest.tagIcons ||= []).push(structuredClone(icon)); blob(icon.media) }
    }
    for (const {hash} of assetContentMedia(next)) blob(hash)
    if (next.credits) next.credits = next.credits.map(credit)
    for (const [i,content] of assetContents(next).entries()) if (content.bundleKey) {
      content.bundleKey = bundle(content.bundleKey)
      const entry = `bundles/${content.bundleKey}/${content.entry}`, documentSource=assetDocument(source,asset(kind,id),next.variants?.entries[i].id)
      if (kind === 'skins' && toId !== id) files.set(entry, jsonBytes({...documentSource, id:toId}))
      if (kind === 'performances') {
        const document = structuredClone(documentSource)
        // embedded themes are private resources, not copied library skins.
        const oldThemeId = document.theme?.id
        if (oldThemeId) {
          const occupied = new Set(manifest.assets.flatMap(a => a.kind === 'skins' ? [a.id] : a.kind === 'performances' ? assetContents(a).map(content=>JSON.parse(files.get(`bundles/${content.bundleKey}/${content.entry}`)).theme?.id) : []))
          let themeId = oldThemeId
          for (let n = 2; occupied.has(themeId); n++) themeId = oldThemeId.slice(0,44) + '-' + n
          document.theme.id = themeId
          delete document.legacySkinId
        }
        const swap = (value, kind) => { const [alias, assetId] = value.split(':'); return kind === 'skins' && alias === 'self' && assetId === oldThemeId ? 'self:' + document.theme.id : local(document, alias) ? 'self:' + ids.get(kind + '/' + assetId) : value }
        if (typeof document.bgm === 'string') document.bgm = swap(document.bgm, 'music')
        else if (document.bgm) document.bgm.ref = swap(document.bgm.ref, 'music')
        for (const [key, value] of Object.entries(document.sfxMap || {})) {
          if (typeof value === 'string') document.sfxMap[key] = swap(value, 'sfx'); else value.ref = swap(value.ref, 'sfx')
        }
        for (const block of Object.values(document.timeline)) for (const event of block.events) if (event.ref) event.ref = swap(event.ref, EVENT_KINDS[event.do])
        for (const [alias, packId] of Object.entries(document.packs)) if (packId === sourceId) delete document.packs[alias]
        document.id = toId
        files.set(entry, jsonBytes(document))
      }
    }
    manifest.assets.push(next)
    copied.push({kind, fromId:id, toId})
  }
  for (const path of source.manifest.credits || []) {
    const next = credit(path)
    if (!(manifest.credits ||= []).includes(next)) manifest.credits.push(next)
  }
  return copied
}
