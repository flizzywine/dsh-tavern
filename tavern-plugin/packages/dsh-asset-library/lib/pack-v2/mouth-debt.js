// Private ops bookkeeping. Never serialize these records into asset documents.
export const debtKey = 'dsh.mouth-debt'
import mouthPolicy from '../shared/figure-mouth.cjs'
export const mouthStatic = (figure, outfit, state, image) => mouthPolicy.resolveFigureMouth(figure, outfit, state, image).mouth === 'static'
export const spriteImageStates = sprite => sprite?.images ?? sprite?.emotions ?? {}
// An identity annotation, not a media reference (must not keep retired image blobs alive).
export const stateImage = (outfit, state, sprite) => {
  const digest = outfit.sprite?.assets?.[state?.stage?.src ?? state?.src]
  if (digest) return 'sha256:' + digest
  return null
}
export function stateHasMouth(sprite, state) {
  if (!state) return false
  return Boolean(state.mouthSet !== undefined || state.stage?.mouth)
}
export function figureMouthGaps(figure, sprites) {
  return (figure.outfits || []).flatMap(outfit => {
    const sprite = sprites[outfit.sprite?.manifestKey]
    return Object.entries(spriteImageStates(sprite)).filter(([, state]) => !stateHasMouth(sprite, state))
      .map(([emotion, state]) => {
        const pools=outfit.sprite?.imagePools,stateId=pools?Object.entries(pools).find(([,pool])=>pool.imageIds.includes(emotion))?.[0]:undefined
        return {outfit:outfit.key,emotion,source:stateImage(outfit,state,sprite),...(pools?{stateId:stateId || null,imageId:emotion,retired:!stateId}:{})}
      }).filter(gap => !mouthStatic(figure, outfit.key, gap.stateId || gap.emotion, gap.imageId))
  })
}
// Callers scope records by pack and figure; outfit/state names are diagnostic labels, never identity.
export const sameGap = (a, b) => Boolean(a.source && b.source) && a.source === b.source
export function acknowledgeMouthGaps(figure, gaps, receipt) {
  if (!gaps.length) return
  if (gaps.some(gap => !gap.source)) throw Error('Cannot acknowledge a mouth gap without an exact source identity')
  const debt = figure.extensions?.[debtKey] || { version: 1, gaps: [] }
  const identity = gap => gap.reviewRequired ? JSON.stringify([gap.source, gap.outfit, gap.imageId]) : gap.source
  const seen = new Set(debt.gaps.map(identity))
  const added = gaps.filter(gap => { const key = identity(gap); if (seen.has(key)) return false; seen.add(key); return true })
  if (!added.length) return
  figure.extensions = { ...figure.extensions, [debtKey]: { ...debt, gaps: [...debt.gaps, ...added.map(({ outfit, emotion, source, imageId, reviewRequired, levels, reason }) => ({ outfit, emotion, source, receipt, ...(reviewRequired ? {imageId, reviewRequired, levels, reason} : {}) }))] } }
}
// Installed mouths or explicit static policy retire debt; hiding/removing an image does not.
export function retireMouthDebt(figure, sprites) {
  const debt = figure.extensions?.[debtKey]
  if (!debt?.gaps.length) return false
  const states = (figure.outfits || []).flatMap(outfit => {
    const sprite = sprites[outfit.sprite?.manifestKey]
    return Object.entries(spriteImageStates(sprite)).map(([imageId, state]) => ({
      source: stateImage(outfit, state, sprite), mouth: stateHasMouth(sprite, state) || mouthStatic(figure, outfit.key, imageId)
    }))
  })
  const gaps = debt.gaps.filter(gap => {
    if (gap.reviewRequired) return true
    const matching = states.filter(state => sameGap(state, gap))
    return !matching.length || matching.some(state => !state.mouth)
  })
  if (gaps.length === debt.gaps.length) return false
  figure.extensions = { ...figure.extensions, [debtKey]: { ...debt, gaps } }
  return true
}

