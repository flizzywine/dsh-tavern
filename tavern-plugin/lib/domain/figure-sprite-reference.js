import images from '../../packages/dsh-asset-library/lib/shared/sprite-images.cjs'
import { matchBubbleMood } from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import avatars from './pack-avatar.cjs'

export function figureReferenceSkip(figure, outfit) {
  if (figure.enabled === false || outfit.enabled === false) return 'disabled'
  const label = [figure.name, outfit.key, outfit.label].join(' ')
  if (/silhouette|剪影/i.test(label)) return 'silhouette'
  if (/mask|面具|蒙版|遮罩/i.test(label)) return 'mask'
  return null
}

// One selection contract shared by the dry-run and the CAS copy RPC.
export function figureOutfitReference(pack, figure, outfit) {
  if (figureReferenceSkip(figure, outfit)) return null
  const sprite = pack.sprites?.[outfit.sprite?.manifestKey]
  const emotion = matchBubbleMood('平静', figure.emotions || [])?.id || outfit.defaultEmotion
  const id = images.spriteUsesImages(sprite) ? images.stateImageId(outfit, emotion) : emotion
  const table = images.spriteImageTable(sprite) || {}
  const hashOf = entry => {
    const source = sprite?.kind === 'static-sprites' ? entry?.src : entry?.stage?.src
    return source ? outfit.sprite.assets[source] || null : null
  }
  const base = hashOf(table[id])
  if (base) return {hash:base, kind:'sprite'}
  const first = Object.values(table).map(hashOf).find(Boolean)
  if (first) return {hash:first, kind:'emotion'}
  const avatar = avatars.selectFigureAvatar(figure, pack.sprites || {}, {outfitKey:outfit.key, emotion:'平静'})
  return avatar ? {hash:avatar.hash, kind:'avatar'} : null
}

export function figureSpriteReference(pack, figure, outfit) {
  return figureOutfitReference(pack, figure, outfit)?.hash || null
}
