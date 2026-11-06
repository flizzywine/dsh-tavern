import {selectAssetVariant} from './asset-variants.js'

export const ASSET_CONTENT_FIELDS = Object.freeze({
  audience: ['content'],
  timers: ['look', 'seconds', 'mode', 'label', 'onTimeout', 'onTimeup', 'pauseOnChoices'],
  directions: ['text'],
  // 入场演出 - one dsh.entrance/1 document (stage-entrance.cjs), validated once on write;
  // bundleKey: the 'entrance' bundle holding the media it draws (its baked plate), when it draws any.
  entrances: ['entrance', 'bundleKey'],
  // 视频 - one stage video (stage-video.cjs): its 'video' bundle (the video and its poster), duration,
  // default loop, soundtrack mixer layer, intrinsic size and fit. Referenced by id from entrances (and later performances, skins).
  videos: ['bundleKey', 'entry', 'poster', 'durationMs', 'loop', 'audio', 'size', 'fit', 'volume', 'loudness'],
  backgrounds: ['media', 'pendingMedia', 'tags', 'stageTheme'],
  cg: ['media', 'pendingMedia', 'description', 'focusHints'],
  props: ['media', 'pendingMedia'],
  // loudness {v:1,lufs,peak} is measured once when the media is installed .
  music: ['media', 'usage', 'tags', 'volume', 'loopStart', 'loopEnd', 'loudness'],
  sfx: ['media', 'loop', 'durationMs', 'volume', 'tags', 'gainDb', 'loudness'],
  ambience: ['media', 'loop', 'durationMs', 'volume', 'tags', 'loudness'],
  looks: ['layer', 'event', 'params'],
  skins: ['bundleKey', 'entry'],
  performances: ['bundleKey', 'entry', 'background'],
  widgets: ['bundleKey', 'entry', 'settingsDefaults']
})

// Stored entries have exactly one content source; there is no implicit base beside a table.
export function assetContent(entry, variant) {
  const selected = selectAssetVariant(entry, variant)
  return selected ? entry.kind === 'audience' ? {content:selected.content} : selected.content : entry
}
export function assetContents(entry) {
  return entry.variants ? entry.variants.entries.map(row => row.content) : [entry]
}
export function assetContentMedia(entry) {
  const refs = new Map()
  const add = (hash, type) => { if (hash) refs.set(hash, {hash, type}) }
  const walk = value => {
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (key === 'lut' || key === 'texture') add(item, 'image/')
      else walk(item)
    }
  }
  for (const content of assetContents(entry)) {
    add(content.media, ['music', 'sfx', 'ambience'].includes(entry.kind) ? 'audio/' : 'image/')
    if (entry.kind === 'looks') walk(content.params)
  }
  return [...refs.values()]
}

export function assetDocument(pack, entry, variant) {
  const row = selectAssetVariant(entry, variant)
  return row ? pack.variantDocuments?.[entry.kind+'/'+entry.id]?.[row.id] : pack[entry.kind]?.[entry.id]
}
