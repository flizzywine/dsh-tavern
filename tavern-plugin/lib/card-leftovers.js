import path from 'node:path'
import { readdir, rm, rmdir } from 'node:fs/promises'
import { CARD_PROJECTION_REVISIONS } from './domain/card-editor.js'
import { normalizeResourcePath } from './domain/file-resources.js'

// What a deleted card leaves outside its own file: its character material and the packs it carried (cast-assets), the
// stored copies of those packs nobody else carries (asset-packs/packs/ID/HASH.json; their files go with the next media
// cleanup), the worldbook files derived from its book, its projection revision and, through the presentation
// observers, what optional renderers keep per card (the stage's CG gallery).
export function createCardLeftovers({ dataRoot, profileData, castAssets, worldbookFiles, presentationObservers }) {
  const castRoot = path.join(dataRoot, 'cast-assets')
  async function carriedElsewhere(cardKey) {
    const kept = new Set()
    for (const entry of await readdir(castRoot, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })) {
      if (!entry.isDirectory() || entry.name === cardKey) continue
      const manifest = await profileData.readJson('cast-assets/' + entry.name + '/cast.json')
      for (const pack of manifest?.packs || []) kept.add(pack.id + '/' + pack.contentHash)
    }
    return kept
  }
  /** Removes the leftovers of the card that was at cardPath. The card itself must be gone already. */
  async function remove({ cardPath, cardId }) {
    const normalized = normalizeResourcePath(cardPath, 'card'), cardKey = castAssets.keyOf(normalized)
    const { packs = [] } = await castAssets.read(normalized)
    const kept = await carriedElsewhere(cardKey), storedPacks = []
    for (const pack of packs) {
      if (kept.has(pack.id + '/' + pack.contentHash)) continue
      await profileData.remove('asset-packs/packs/' + pack.id + '/' + pack.contentHash + '.json')
      // Another version of the same pack id may still be stored beside it.
      await rmdir(path.join(dataRoot, 'asset-packs/packs', pack.id)).catch(error => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error })
      storedPacks.push({ id: pack.id, contentHash: pack.contentHash })
    }
    await rm(path.join(castRoot, cardKey), { recursive: true, force: true })
    const worldbookDirectories = await worldbookFiles.removeCard(normalized)
    await profileData.updateJson(CARD_PROJECTION_REVISIONS, value => {
      if (!value?.cards || !Object.hasOwn(value.cards, normalized)) return undefined
      const { [normalized]: _, ...cards } = value.cards
      return { ...value, cards }
    })
    await presentationObservers.cardRemoved(normalized, cardId)
    return { cardPath: normalized, storedPacks, worldbookDirectories }
  }
  return Object.freeze({ remove })
}
