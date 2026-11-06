import { check, shape, record, array, unique, validateStateId } from './common.js'

// Write-boundary validation; retained images need not belong to a future-choice pool.
export function validateStateImagePools(pools, { states, images, fallbackTo = {} }, path = '$.imagePools') {
  const stateIds = new Set(states.map(row => row.id)), assigned = new Set()
  record(pools, path, (pool, p, stateId) => {
    check(stateIds.has(stateId), p, 'Pool must name a declared state')
    shape(pool, ['imageIds', 'defaultImageId'], ['imageIds', 'defaultImageId'], p)
    array(pool.imageIds, p + '.imageIds', 1024)
    check(pool.imageIds.length > 0, p, 'A state image pool cannot be empty')
    unique(pool.imageIds, p + '.imageIds')
    check(pool.imageIds.includes(pool.defaultImageId), p + '.defaultImageId', 'Default image must belong to this pool')
    for (const imageId of pool.imageIds) {
      validateStateId(imageId, p + '.imageIds')
      if (images) check(Object.hasOwn(images, imageId), p, 'Image must exist in this outfit manifest')
      check(!assigned.has(imageId), p, 'An image can belong to only one semantic pool')
      assigned.add(imageId)
    }
  })
  for (const [stateId, target] of Object.entries(fallbackTo)) {
    const seen = new Set([stateId])
    check(stateIds.has(stateId) && stateIds.has(target), path, 'Fallback must reference declared states')
    let next = target
    while (next !== undefined) {
      check(!seen.has(next), path, 'State fallback cycle')
      seen.add(next)
      next = fallbackTo[next]
    }
  }
  return pools
}

export function validateStateImageSelection(actor, path = '$.actor') {
  const { stateId, imageSelection, lastImages, stateVisit, visitImages } = actor
  validateStateId(stateId, path + '.stateId')
  check(Number.isSafeInteger(stateVisit) && stateVisit > 0, path + '.stateVisit', 'Positive state visit required')
  shape(imageSelection, ['outfitKey', 'manifestKey', 'imageId'], ['outfitKey', 'manifestKey', 'imageId'], path + '.imageSelection')
  for (const [key, value] of Object.entries(imageSelection)) validateStateId(value, path + '.imageSelection.' + key)
  record(lastImages, path + '.lastImages', (states, p, outfit) => {
    validateStateId(outfit, p)
    record(states, p, (image, q, state) => { validateStateId(state, q); validateStateId(image, q) })
  })
  record(visitImages, path + '.visitImages', (visit, p, outfit) => {
    validateStateId(outfit, p)
    shape(visit, ['imageId', 'stateVisit'], ['imageId', 'stateVisit'], p)
    validateStateId(visit.imageId, p + '.imageId')
    check(visit.stateVisit === stateVisit, p + '.stateVisit', 'Only current-visit outfits are retained')
  })
  check(visitImages[imageSelection.outfitKey]?.imageId === imageSelection.imageId && lastImages[imageSelection.outfitKey]?.[stateId] === imageSelection.imageId, path, 'Selection and image memory must agree')
  return actor
}
