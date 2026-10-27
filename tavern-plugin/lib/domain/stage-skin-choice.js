// Which skin a card's stage is drawn in. In order: the player's choice for this card (舞台设置 › 本卡皮肤, cast.json
// skinChoice) > the card's own default (the card file's extensions.dsh_tavern.stage.defaultSkin) > the default of its packs
// (the first bound pack, in binding order, that declares one: manifest.stageSkin) > the global default (舞台设置 › 默认皮肤,
// the tavern setting stageSkin) > 经典. A pack skin counts only while its pack still holds it: one that is gone (pack
// deleted or unbound, skin removed) is passed over for the next in the order. Nothing stored is rewritten, so it applies
// again once its skin is back. Selections are checked where they are written (validateStageSkinSelection), not here.
import { BUILTIN_STAGE_SKINS } from '../../packages/dsh-presentation-protocol/src/stage-skin.cjs'
import { validateAssetRef } from '../asset-library/shared/asset-pack-refs.js'
import { check } from '../asset-library/shared/asset-pack-json.js'

// A selection: a built-in skin's id or a pack skin ref { packId, kind: 'skins', assetId }.
export function validateStageSkinSelection(skin, path = '$') {
  if (typeof skin === 'string') check(Object.hasOwn(BUILTIN_STAGE_SKINS, skin), path, 'Unknown built-in skin')
  else validateAssetRef(skin, path, 'skins')
  return skin
}

// A pack's declared default (manifest.stageSkin) as a skin ref, while that skin is still in the pack.
export function packStageSkin(pack) {
  const id = pack?.manifest?.stageSkin
  return id && pack.manifest.assets.some(asset => asset.kind === 'skins' && asset.id === id) ? { packId: pack.manifest.id, kind: 'skins', assetId: id } : null
}

// The packs whose snapshots stageSkinChoice reads: the card's bound packs and the pack of a global default pack skin.
export function stageSkinPackIds(boundPackIds, global) {
  return [...new Set([...(boundPackIds || []), ...(global && typeof global === 'object' ? [global.packId] : [])])]
}

// { skin, fallback, document }: fallback is the same order without the player's choice (what 「跟随默认」 draws);
// document the chosen skin's dsh.skin/1 document. `packs`: snapshots of stageSkinPackIds (missing ones left out).
export function stageSkinChoice({ choice = null, cardDefault = null, boundPackIds = [], global = 'classic', packs = [] }) {
  const byId = new Map(packs.filter(Boolean).map(pack => [pack.manifest.id, pack]))
  const documentOf = skin => typeof skin === 'string' ? Object.hasOwn(BUILTIN_STAGE_SKINS, skin) ? BUILTIN_STAGE_SKINS[skin] : null
    : skin && typeof skin === 'object' && byId.get(skin.packId)?.manifest.assets.some(asset => asset.kind === 'skins' && asset.id === skin.assetId) ? byId.get(skin.packId).skins?.[skin.assetId] || null : null
  const packDefault = (boundPackIds || []).map(id => packStageSkin(byId.get(id))).find(Boolean) || null
  const fallback = [cardDefault, packDefault, global].find(documentOf) ?? 'classic'
  const skin = documentOf(choice) ? choice : fallback
  return { skin, fallback, document: documentOf(skin) }
}
