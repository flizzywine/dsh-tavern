// The content fields each entry kind stores beside its common fields (name, lamp, notes). A skin is a bundle: its
// dsh.skin/1 document (`entry`, beside the files it declares) under bundles/<bundleKey>/.
export const ASSET_CONTENT_FIELDS = Object.freeze({
  backgrounds: ['media', 'tags'],
  music: ['media', 'usage', 'tags', 'volume', 'loopStart', 'loopEnd'],
  props: ['media', 'tags'],
  skins: ['bundleKey', 'entry']
})

// A stored entry has exactly one content source: the entry itself.
export function assetContents(entry) {
  return [entry]
}
export function assetContentMedia(entry) {
  const refs = new Map()
  for (const content of assetContents(entry)) if (content.media) refs.set(content.media, {hash:content.media, type:entry.kind === 'music' ? 'audio/' : 'image/'})
  return [...refs.values()]
}
