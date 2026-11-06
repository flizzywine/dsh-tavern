import {randomUUID} from 'node:crypto'
import imageContract from '../shared/sprite-images.cjs'
import {check} from '../asset-packs/common.js'
import {spriteResourcePaths} from '../asset-packs/sprite.js'
import {jsonBytes} from './validation.js'
import {trimAuthoringImages} from './image-closure.js'

export function trimMouthSets(sprite) {
  const entries = Object.values(imageContract.spriteImageTable(sprite))
  const sets = new Set(entries.map(entry => entry.mouthSet).filter(key => key !== undefined))
  if (sprite.mouthSets) for (const key of Object.keys(sprite.mouthSets)) if (!sets.has(key)) delete sprite.mouthSets[key]
  if (sprite.mouthSets && !Object.keys(sprite.mouthSets).length) delete sprite.mouthSets
  if (sprite.mouthAtlas && entries.every(entry => entry.mouthSet !== undefined)) delete sprite.mouthAtlas
}

// A custom declaration and all its figure-owned uses retire in the same publication.
export function removeFigureEmotion(manifest, files, before, figureId, emotionId) {
  const original = before.figures[figureId]
  check(original, '$.figureId', 'Figure missing', 'ASSET_UNAVAILABLE')
  check(original.emotions?.some(row => row.id === emotionId), '$.emotionId', 'Difference missing', 'ASSET_UNAVAILABLE')
  const figure = structuredClone(original), rewritten = new Map()
  figure.emotions = figure.emotions.filter(row => row.id !== emotionId)
  if (figure.voice?.emotionVariants) delete figure.voice.emotionVariants[emotionId]
  for (const outfit of figure.outfits) {
    check(figure.schemaVersion !== 2 || (outfit.defaultEmotion ?? original.emotions[0]?.id) !== emotionId,'$.emotionId','Select another default before retiring this state')
    if(outfit.defaultEmotion===emotionId) delete outfit.defaultEmotion
    if(outfit.fallbackEmotions) outfit.fallbackEmotions=outfit.fallbackEmotions.filter(id=>id!==emotionId && id!==(outfit.defaultEmotion ?? figure.emotions[0]?.id))
    // a stand-in, a default prompt or a record of the retired 差分 goes with it.
    if(outfit.fallbackTo) { outfit.fallbackTo=Object.fromEntries(Object.entries(outfit.fallbackTo).filter(([id,use])=>use!==emotionId && outfit.fallbackEmotions?.includes(id))); if(!Object.keys(outfit.fallbackTo).length) delete outfit.fallbackTo }
    if(outfit.genPrompts) { for(const map of Object.values(outfit.genPrompts)) delete map[emotionId]; for(const kind of Object.keys(outfit.genPrompts)) if(!Object.keys(outfit.genPrompts[kind]).length) delete outfit.genPrompts[kind]; if(!Object.keys(outfit.genPrompts).length) delete outfit.genPrompts }
    if(outfit.genRecords) { outfit.genRecords=outfit.genRecords.filter(row=>row.emotionId!==emotionId); if(!outfit.genRecords.length) delete outfit.genRecords }
    if (outfit.avatars && !(figure.schemaVersion === 2 && outfit.sprite)) delete outfit.avatars[emotionId]
    if (outfit.live2d?.emotionMap) delete outfit.live2d.emotionMap[emotionId]
    if (outfit.spine?.emotionMap) delete outfit.spine.emotionMap[emotionId]
    if (!outfit.sprite) continue
    if (figure.schemaVersion === 2) {
      // The complete image table and its metadata remain retention roots for saved selections.
      delete outfit.sprite.imagePools[emotionId]
      continue
    }
    const oldKey = outfit.sprite.manifestKey
    if (!Object.hasOwn(before.sprites[oldKey].emotions, emotionId)) continue
    if (!rewritten.has(oldKey)) {
      const sprite = structuredClone(before.sprites[oldKey])
      delete sprite.emotions[emotionId]
      const entries = Object.values(sprite.emotions)
      if (!entries.length) rewritten.set(oldKey, null)
      else {
        trimMouthSets(sprite)
        // Other figures may share a manifest; never rewrite their vocabulary or renderer.
        const shared = Object.values(before.figures).some(other => other.id !== figureId && other.outfits.some(o => o.sprite?.manifestKey === oldKey))
        const key = shared ? 'sprite-' + randomUUID() : oldKey
        manifest.sprites[key] ||= 'sprites/' + key + '/manifest.json'
        files.set(manifest.sprites[key], jsonBytes(sprite))
        rewritten.set(oldKey, {key, resources:new Set(spriteResourcePaths(sprite))})
      }
    }
    const next = rewritten.get(oldKey)
    if (!next) { delete outfit.sprite; continue }
    outfit.sprite.manifestKey = next.key
    outfit.sprite.assets = Object.fromEntries(Object.entries(outfit.sprite.assets).filter(([resource]) => next.resources.has(resource)))
    for (const key of ['avatarCrop','avatarCropAuto','anatomy']) if (outfit.sprite[key]) delete outfit.sprite[key][emotionId]
  }
  files.set('figures/' + figureId + '.json', jsonBytes(figure))
  trimAuthoringImages(manifest, files, before.figures)
}
