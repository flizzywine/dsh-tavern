// pacing compares complete refs; time-only changes never spend mood quota.
import { assetRefKey } from '../../../dsh-presentation-protocol/src/asset-packs.js'
import { check } from '../../../dsh-presentation-protocol/src/asset-pack-json.js'
const same = (a, b) => (a ? assetRefKey(a) : null) === (b ? assetRefKey(b) : null)
export function initialAssetPackPacing(state) {
  return { paragraph: 0, moodSetAt: state.lighting.mood ? 0 : null, musicSetAt: null,
    moodChanges: 0, previousMood: null, recentTracks: [], sceneAt: null, moodAt: null, openingAt: null }
}
export function paceAssetPackOperation(before, after, context, at, locationChanged) {
  const pacing = structuredClone(before.pacing || initialAssetPackPacing(before))
  if (locationChanged) {
    pacing.moodChanges = 0; pacing.previousMood = null; pacing.sceneAt = at; pacing.openingAt = null
  }
  const eventLook = ref => ref && context.catalogue.candidates.looks.some(row => same(row.ref, ref) && row.asset.event === true)
  if (!same(before.lighting.mood, after.lighting.mood) && !eventLook(before.lighting.mood) && !eventLook(after.lighting.mood)) {
    const opening = pacing.sceneAt === at && pacing.openingAt !== at || pacing.moodSetAt === null && at === 0
    check(pacing.moodSetAt === null || at - pacing.moodSetAt >= 8, '$.pacing.mood', 'Mood must hold for eight paragraphs')
    pacing.previousMood = opening ? null : structuredClone(before.lighting.mood)
    pacing.moodSetAt = at
    if (opening) pacing.openingAt = at
    else { pacing.moodChanges++; pacing.moodAt = at }
  }
  after.pacing = pacing
}
