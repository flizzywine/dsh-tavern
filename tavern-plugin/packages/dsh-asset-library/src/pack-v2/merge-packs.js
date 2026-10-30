import {isDeepStrictEqual} from 'node:util'
import {check} from '../asset-packs/common.js'
import {jsonBytes,readDocument} from './validation.js'

// Explicit one-time authoring, not a runtime identity alias.
export function mergePackContents(source, target, {name, figureMerges = [], backgroundStyle} = {}) {
  check(source.manifest.schemaVersion === target.manifest.schemaVersion,'$.schemaVersion','Migrate both packs to the same image format before merging','UNSUPPORTED_SCHEMA_VERSION')
  const manifest = structuredClone(target.manifest), files = new Map(target.files), mapping = {source:source.manifest.id,target:target.manifest.id,figures:{},outfits:{}}
  const bundleKeys = {}, spriteKeys = {}, voiceKeys = {}
  function allocate(id, entries) {
    let key = id
    for (let n = 2; Object.hasOwn(entries,key); n++) key = id.slice(0,56) + '-' + n
    return key
  }
  for (const key of Object.keys(source.manifest.bundles)) bundleKeys[key] = allocate(key,{...manifest.bundles,...Object.fromEntries(Object.values(bundleKeys).map(key=>[key,true]))})
  for (const key of Object.keys(source.manifest.sprites)) spriteKeys[key] = allocate(key,{...manifest.sprites,...Object.fromEntries(Object.values(spriteKeys).map(key=>[key,true]))})
  for (const key of Object.keys(source.manifest.voiceLibrary?.voices || {})) voiceKeys[key] = allocate(key,{...manifest.voiceLibrary?.voices,...Object.fromEntries(Object.values(voiceKeys).map(key=>[key,true]))})
  for (const merge of figureMerges) {
    check(source.figures[merge.source] && target.figures[merge.target], '$.figureMerges','Missing figure')
    mapping.figures[merge.source] = merge.target
    mapping.outfits[merge.source] = merge.outfits || {}
  }
  function rewrite(value) {
    if (Array.isArray(value)) return value.map(rewrite)
    if (!value || typeof value !== 'object') return value === mapping.source ? mapping.target : value
    const result = Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item)]))
    if (value.packId === mapping.source && value.figureId) result.figureId = mapping.figures[value.figureId] || value.figureId
    if (value.bundleKey) result.bundleKey = bundleKeys[value.bundleKey] || value.bundleKey
    if (value.manifestKey) result.manifestKey = spriteKeys[value.manifestKey] || value.manifestKey
    return result
  }
  const fileName = name => name.replace(/^bundles\/([^/]+)\//,(_,key)=>'bundles/'+bundleKeys[key]+'/').replace(/^sprites\/([^/]+)\//,(_,key)=>'sprites/'+spriteKeys[key]+'/')
  for (const [name, bytes] of source.files) {
    if (name.startsWith('figures/')) continue
    const nextName = fileName(name)
    if (files.has(nextName)) {
      const a = target.manifest.files.find(row=>row.path===nextName), b = source.manifest.files.find(row=>row.path===name)
      check(a?.sha256 === b?.sha256 && a?.size === b?.size,'$.files','Conflicting file: '+nextName,'REVISION_CONFLICT')
      continue
    }
    if (name.endsWith('.json')) {
      const before = readDocument(bytes), next = rewrite(before)
      files.set(nextName,isDeepStrictEqual(before,next) ? bytes : jsonBytes(next))
    } else files.set(nextName,bytes)
  }
  for (const [key,value] of Object.entries(source.manifest.blobs)) {
    check(!manifest.blobs[key] || isDeepStrictEqual(manifest.blobs[key],value),'$.blobs','Conflicting blob descriptor')
    manifest.blobs[key] = structuredClone(value)
  }
  for (const [key,value] of Object.entries(source.manifest.bundles)) manifest.bundles[bundleKeys[key]] = structuredClone(value)
  for (const [key,value] of Object.entries(source.manifest.sprites)) manifest.sprites[spriteKeys[key]] = fileName(value)
  for (const [key,value] of Object.entries(source.manifest.voiceLibrary?.voices || {})) ((manifest.voiceLibrary ||= {version:1,voices:{}}).voices)[voiceKeys[key]] = structuredClone(value)
  for (const asset of source.manifest.assets) {
    check(!manifest.assets.some(row=>row.kind===asset.kind && row.id===asset.id),'$.assets','Resolve asset ID collision before merge: '+asset.kind+'/'+asset.id,'DUPLICATE_ID')
    manifest.assets.push(rewrite(asset))
  }
  for (const id of source.manifest.figures) {
    const incoming = rewrite(source.figures[id]), rule = figureMerges.find(row=>row.source===id)
    if (incoming.voice) incoming.voice.voice = voiceKeys[incoming.voice.voice]
    if (!rule) {
      check(!manifest.figures.includes(id),'$.figures','Duplicate figure UUID','DUPLICATE_ID')
      manifest.figures.push(id); files.set('figures/'+id+'.json',jsonBytes(incoming)); continue
    }
    const figure = structuredClone(target.figures[rule.target])
    figure.aliases = [...new Set([...(figure.aliases || []),incoming.name,...(incoming.aliases || [])])].filter(alias=>alias!==figure.name)
    if(manifest.schemaVersion === 2) for(const row of incoming.emotions) {
      const old=figure.emotions.find(state=>state.id===row.id)
      check(!old || isDeepStrictEqual(old,row),'$.figureMerges','Conflicting flat meanings require an explicit owner decision','REVISION_CONFLICT')
    }
    figure.emotions = [...figure.emotions,...incoming.emotions.filter(row=>!figure.emotions.some(old=>old.id===row.id))]
    if (incoming.voice) {
      check(!figure.voice || isDeepStrictEqual(figure.voice,incoming.voice),'$.figure.voice','Conflicting voices need an explicit choice')
      figure.voice = incoming.voice
    }
    for (const outfit of incoming.outfits) {
      const key = rule.outfits?.[outfit.key] || outfit.key, index = figure.outfits.findIndex(row=>row.key===key)
      if (index < 0) figure.outfits.push({...outfit,key})
      else {
        // Keep the destination's dedicated avatars/static art, use reviewed source model/calibration.
        check(rule.preferSourceModels === true,'$.figureMerges','Overlapping outfits need explicit model preference')
        figure.outfits[index] = {...figure.outfits[index],...(outfit.live2d?{live2d:outfit.live2d}:{}),...(outfit.spine?{spine:outfit.spine}:{})}
      }
    }
    files.set('figures/'+figure.id+'.json',jsonBytes(figure))
  }
  for (const key of ['backgroundStyle','stageSkin']) if (source.manifest[key]) {
    if (!manifest[key]) manifest[key] = rewrite(source.manifest[key])
    else check(isDeepStrictEqual(manifest[key],rewrite(source.manifest[key])) || key==='backgroundStyle' && backgroundStyle,'$.'+key,'Conflicting pack setting needs an explicit choice')
  }
  if (backgroundStyle) manifest.backgroundStyle = structuredClone(backgroundStyle==='source'?source.manifest.backgroundStyle:target.manifest.backgroundStyle)
  for (const row of source.manifest.tagIcons || []) {
    const old = manifest.tagIcons?.find(item=>item.tag===row.tag)
    check(!old || isDeepStrictEqual(old,row),'$.tagIcons','Conflicting tag icon')
    if (!old) (manifest.tagIcons ||= []).push(structuredClone(row))
  }
  if (source.manifest.credits) manifest.credits = [...new Set([...(manifest.credits || []),...source.manifest.credits])]
  if (name) manifest.name = name
  Object.assign(mapping,{bundleKeys,spriteKeys,voiceKeys})
  return {manifest,files,mapping,bundleKeys,spriteKeys,voiceKeys}
}
