// Reviewed outfit crops are pinned to the complete set of known body identities.
export function reviewedAvatarCrops(review, states) {
  if (!review || !states.length || states.some(({id,hash})=>!review.hashes.includes(hash) || review.stateHashes[id]!==hash)) return null
  return review
}
