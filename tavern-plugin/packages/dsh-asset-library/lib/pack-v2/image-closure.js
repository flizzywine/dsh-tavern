import {readDocument, jsonBytes} from './validation.js'
import {retireMediaMeasurements} from '../asset-packs/figure.js'

// Atomic authoring writes retire replaced images. External imports instead reject unused images.
export function trimAuthoringImages(manifest, files, previousFigures) {
  const figures = manifest.figures.map(id => {
    const name = 'figures/' + id + '.json'
    if (!files.has(name)) return previousFigures[id]
    // a written figure's measurements of the pictures it no longer has go before the images are counted
    const figure = readDocument(files.get(name)), kept = retireMediaMeasurements(figure)
    if (kept !== figure) files.set(name, jsonBytes(kept))
    return kept
  })
  const sprites = new Set(figures.flatMap(figure => figure.outfits.map(outfit => outfit.sprite?.manifestKey).filter(Boolean)))
  for (const [key, file] of Object.entries(manifest.sprites)) if (!sprites.has(key)) {
    delete manifest.sprites[key]
    files.delete(file)
  }
  const used = new Set()
  const visit = value => {
    if (typeof value === 'string' && Object.hasOwn(manifest.blobs,value)) used.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(figures); visit(manifest.assets); visit(manifest.voiceLibrary); visit(manifest.tagIcons); visit(manifest.backgroundStyle)
  for (const [hash, descriptor] of Object.entries(manifest.blobs)) if (descriptor.mime.startsWith('image/') && !used.has(hash)) {
    delete manifest.blobs[hash]
    files.delete('media/' + hash + '.' + descriptor.ext)
  }
}
