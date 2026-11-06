import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {debtKey, acknowledgeMouthGaps, figureMouthGaps, retireMouthDebt, spriteImageStates, stateImage} from './mouth-debt.js'

// Copy acknowledgements are private local metadata, committed with the new IDs.
// The external ledger remains the owner of historical ops acknowledgements.
export function combineMouthDebt(external, local = {}) {
  const figures = structuredClone(external.figures || {}), nativeCopies = {...external.nativeCopies}
  for (const [id, debt] of Object.entries(local)) {
    // Once projected by ops, its review/retirement edits supersede the copy receipt.
    if (nativeCopies[id]) continue
    nativeCopies[id] = true
    const holder = {extensions:{[debtKey]:figures[id] || {version:1,gaps:[]}}}
    for (const gap of debt.gaps) acknowledgeMouthGaps(holder,[gap],gap.receipt)
    figures[id] = holder.extensions[debtKey]
  }
  return {...external,figures,nativeCopies}
}
export async function readCopyMouthDebt(assetRoot, pack, local, directory = path.join(assetRoot,'.pack-installs/mouth-debt')) {
  let external = {figures:{}}
  try { external = JSON.parse(await readFile(path.join(directory,pack+'.json'),'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  return combineMouthDebt(external,local?.mouthDebt).figures
}
export function copiedMouthDebt(source, target, mapping, debt) {
  const result = {}
  for (const {kind,fromId,toId} of mapping) {
    if (kind !== 'figures' || !debt[fromId]) continue
    const missing = figureMouthGaps(target.figures[toId],target.sprites)
    const gaps = debt[fromId].gaps.flatMap(gap => {
      if (gap.reviewRequired) {
        // Review debt also survives when all four unreviewed frames already exist.
        const outfit = target.figures[toId].outfits.find(row => row.key === gap.outfit)
        const sprite = target.sprites[outfit?.sprite?.manifestKey]
        const state = spriteImageStates(sprite)[gap.imageId || gap.emotion]
        return outfit && gap.source && stateImage(outfit,state,sprite) === gap.source ? [structuredClone(gap)] : []
      }
      const match = missing.find(row => row.source && row.source === gap.source)
      return match ? [{...gap,outfit:match.outfit,emotion:match.emotion}] : []
    })
    if (gaps.length) result[toId] = {version:1,gaps}
  }
  return result
}
export function retireLocalMouthDebt(local, pack) {
  if (!local.mouthDebt) return local
  const next = structuredClone(local)
  for (const [id,debt] of Object.entries(next.mouthDebt)) {
    if (!pack.figures[id]) { delete next.mouthDebt[id]; continue }
    const holder = {...pack.figures[id],extensions:{...pack.figures[id].extensions,[debtKey]:debt}}
    retireMouthDebt(holder,pack.sprites)
    next.mouthDebt[id] = holder.extensions[debtKey]
  }
  return next
}
