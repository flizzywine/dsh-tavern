export const STATE_IMAGE_FIELDS = ['stateId','imageSelection','lastImages','stateVisit','visitImages']

// Only transaction admission calls this function. Projection reads its concrete result.
export function selectStateImage({ stateId, outfitKey, manifestKey, pool, previous = {}, replay, draw = Math.random }) {
  const sameVisit = previous.stateId === stateId
  const selection = previous.imageSelection
  const stateVisit = sameVisit ? previous.stateVisit : (previous.stateVisit || 0) + 1
  const replayMatches = replay?.stateId === stateId && replay.stateVisit === stateVisit && replay.imageSelection?.outfitKey === outfitKey && replay.imageSelection.manifestKey === manifestKey
  // A migrated body may retain distinct historical images inside one newly merged meaning.
  if (sameVisit && selection?.outfitKey === outfitKey && selection.manifestKey === manifestKey && (!replayMatches || selection.imageId === replay.imageSelection.imageId)) return previous

  const visited = sameVisit ? previous.visitImages?.[outfitKey] : null
  let imageId
  if (replayMatches) imageId = replay.imageSelection.imageId
  else if (visited?.stateVisit === stateVisit) imageId = visited.imageId
  else if (sameVisit) imageId = pool.defaultImageId
  else {
    const last = previous.lastImages?.[outfitKey]?.[stateId]
    const candidates = pool.imageIds.length > 1 ? pool.imageIds.filter(id => id !== last) : pool.imageIds
    imageId = candidates.length === 1 ? candidates[0] : candidates[Math.floor(draw() * candidates.length)]
  }
  return {
    ...previous, stateId, stateVisit,
    imageSelection: { outfitKey, manifestKey, imageId },
    lastImages: { ...previous.lastImages, [outfitKey]: { ...previous.lastImages?.[outfitKey], [stateId]: imageId } },
    visitImages: { ...(sameVisit ? previous.visitImages : {}), [outfitKey]: { imageId, stateVisit } }
  }
}
