import {readFile} from 'node:fs/promises'
import {trimAuthoringImages} from './image-closure.js'
import {sealPack} from './validation.js'

const readJson = async bytes => JSON.parse((bytes.file ? await readFile(bytes.file) : Buffer.from(bytes)).toString('utf8'))

// A detached export view; never publish the projected identity to storage.
export async function projectPackFigures(packs, excludeFigures) {
  const excluded = new Set(excludeFigures), rows = [], projected = []
  for (const original of packs) {
    const manifest = structuredClone(original.manifest), files = new Map(original.files), figures = {}
    for (const id of manifest.figures || []) {
      figures[id] = await readJson(files.get('figures/' + id + '.json'))
      rows.push({...figures[id], ref:{packId:manifest.id, figureId:id}})
    }
    const removed = (manifest.figures || []).filter(id => excluded.has(id))
    if (removed.length) {
      manifest.figures = manifest.figures.filter(id => !excluded.has(id))
      for (const id of removed) files.delete('figures/' + id + '.json')
      const mediaFiles = new Map([...files].filter(([name]) => !name.startsWith('figures/')))
      trimAuthoringImages(manifest, mediaFiles, figures)
      for (const name of files.keys()) if (!name.startsWith('figures/') && !mediaFiles.has(name)) files.delete(name)
      const used = new Set()
      const visit = value => {
        if (typeof value === 'string') used.add(value)
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      visit(manifest.assets); visit(manifest.voiceLibrary); visit(manifest.tagIcons); visit(manifest.backgroundStyle)
      for (const id of manifest.figures) visit(figures[id])
      const owned = new Set()
      const own = value => { if (typeof value === 'string') owned.add(value); else if (value && typeof value === 'object') Object.values(value).forEach(own) }
      for (const id of removed) own(figures[id])
      for (const [key, blob] of Object.entries(manifest.blobs || {})) if (owned.has(key) && !used.has(key)) {
        delete manifest.blobs[key]; files.delete('media/' + key + '.' + blob.ext)
      }
      for (const key of Object.keys(manifest.bundles || {})) if (owned.has(key) && !used.has(key)) {
        delete manifest.bundles[key]
        for (const name of files.keys()) if (name.startsWith('bundles/' + key + '/')) files.delete(name)
      }
      await sealPack(manifest, files, original)
    }
    projected.push({...original, manifest, files})
  }
  return {packs:projected, figures:rows}
}
