import {isDeepStrictEqual} from 'node:util'

const without = (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)))
const entryFields = ['name', 'description', 'remark', 'enabled', 'recall', 'directorNote', 'aliases', 'category', 'inventoryId', 'tags', 'usage', 'volume', 'loop', 'durationMs', 'gainDb', 'loudness', 'stageTheme']
function resources(manifest, figures) {
  return {
    manifest:{...without(manifest, ['name', 'description', 'assets', 'voiceLibrary']), assets:manifest.assets.map(asset => ({...without(asset, entryFields),...(asset.variants?{variants:{entries:asset.variants.entries.map(row=>({id:row.id,content:without(row.content,entryFields)})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}}:{})})),...(manifest.voiceLibrary?{voiceLibrary:{...manifest.voiceLibrary,voices:Object.fromEntries(Object.entries(manifest.voiceLibrary.voices).map(([id,voice])=>[id,without(voice,['emotions'])]))}}:{})},
    figures:Object.fromEntries(Object.entries(figures).map(([id, figure]) => [id, {
      ...without(figure, ['name', 'aliases', 'description', 'remark', 'enabled', 'recall', 'appearance', 'identityAppearance', 'heightCm', 'heightBasis', 'elevationCm', 'stageForm', 'imageColor', 'autoColor', 'emotions', 'outfits', 'voice']),
      outfits:figure.outfits.map(outfit => ({
        ...without(outfit, ['label', 'enabled', 'emotions', 'defaultEmotion', 'fallbackEmotions', 'fallbackTo', 'genPrompts', 'genRecords', 'recall', 'guidance', 'remark', 'outfitAppearance', 'avatarCrop']),
        ...(outfit.sprite ? {sprite:without(outfit.sprite, ['emotionMap', 'avatarCrop', 'avatarCropAuto', 'anatomy'])} : {}),
        ...(outfit.live2d ? {live2d:without(outfit.live2d, ['emotionMap', 'anatomy'])} : {}),
        ...(outfit.spine ? {spine:without(outfit.spine, ['emotionMap', 'anatomy'])} : {})
      })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    }]))
  }
}
// Only these author fields can bypass media validation/publication. Resource,
// identity, schema and capability changes still use the full write validator.
export function isMetadataEdit(before, manifest, figures) {
  // Eligibility is not admission: the selected write path still validates the documents.
  // Compare the resource projections directly, without two whole-pack JSON strings.
  return isDeepStrictEqual(resources(before.manifest, before.figures), resources(manifest, figures))
}
