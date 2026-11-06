import {normalizePackTags,normalizeEntryTags} from '../asset-packs/item-migration.js'
import {migratePackVoices} from '../asset-packs/voice-migration.js'
import {importFigureVariants} from './import-figure-variants.js'
import {migrateRecallPriorityManifest, migrateRecallPriorityFigure} from '../asset-packs/recall-priority.js'
import {migrateCgFigures} from '../asset-packs/cg-figures.js'
import {migrateFigureNames} from '../asset-packs/figure-names.js'
import {canonicalJson} from '../asset-packs/index.js'
import {readDocument,jsonBytes} from './validation.js'

// Shared archive normalization; callers seal the resulting bytes once.
export function normalizePackImport(manifest, files) {
  for (const [index,asset] of (manifest.assets || []).entries()) {
    const legacy=['baseTime','defaultVariant'].filter(key=>Object.hasOwn(asset,key))
    if (Array.isArray(asset.variants)) legacy.push('variants[]')
    else if (asset.kind==='backgrounds' && asset.variants && Object.values(asset.variants).some(value=>typeof value==='string') && !Object.hasOwn(asset.variants,'entries')) legacy.push('variants{time:media}')
    if (legacy.length) throw Object.assign(new Error('此素材包使用 pre-P5 旧格式（'+legacy.join('/')+'）；请从当前版本的 DSH Tavern 重新导出。'),{code:'PRE_P5_FORMAT',path:'$.assets['+index+']'})
  }
  const tagged = normalizePackTags(manifest)
  const tagsChanged = tagged !== manifest
  manifest = tagged
  const figures = Object.fromEntries(manifest.figures.map(id => [id,readDocument(files.get('figures/'+id+'.json'))]))
  let migratedFigures = figures, changed = tagsChanged
  if (Object.values(figures).some(figure => figure.voice?.preset)) {
    const migrated = migratePackVoices(manifest,figures)
    manifest = migrated.manifest
    migratedFigures = migrated.figures
    changed ||= migrated.mappings.length > 0
  }
  const variants=importFigureVariants(manifest,migratedFigures,Object.fromEntries(Object.entries(manifest.sprites).map(([id,file])=>[id,readDocument(files.get(file))])))
  if(canonicalJson(variants.manifest)!==canonicalJson(manifest)){manifest=variants.manifest;changed=true}
  migratedFigures=variants.figures
  // Old archives lose retired recall priority at ingress.
  const withoutPriority = migrateRecallPriorityManifest(manifest)
  if (withoutPriority !== manifest) { manifest = withoutPriority; changed = true }
  const withoutCgFigures = migrateCgFigures(manifest)
  if (withoutCgFigures !== manifest) { manifest = withoutCgFigures; changed = true }
  for (const [id, figure] of Object.entries(migratedFigures)) {
    const next = normalizeEntryTags(migrateFigureNames(migrateRecallPriorityFigure(figure)))
    if (canonicalJson(next) !== canonicalJson(figures[id])) {
      files.set('figures/'+id+'.json',jsonBytes(next)); changed = true
    }
  }
  return {manifest,files,changed}
}
