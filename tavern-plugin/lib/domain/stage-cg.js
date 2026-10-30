// CG semantics share the stage snapshot and turn accounting, not a second store.
import { assetRefKey, validateAssetRef } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import { check, shape, text } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import {assetContent} from '../../packages/dsh-presentation-protocol/src/asset-variant-content.js'
import {selectAssetVariant,assetVariantCandidate,variantTarget} from '../../packages/dsh-presentation-protocol/src/asset-variants.js'

export function validateStageCg(cg, actors) {
  shape(cg, ['ref','variant','focus','resumeCast'], ['ref','variant','focus','resumeCast'], '$.cg')
  validateAssetRef(cg.ref, '$.cg.ref', 'cg')
  if(cg.variant!==null)text(cg.variant, '$.cg.variant', 64)
  text(cg.focus, '$.cg.focus', 64)
  check(Array.isArray(cg.resumeCast) && new Set(cg.resumeCast).size === cg.resumeCast.length && cg.resumeCast.every(alias => Object.hasOwn(actors, alias)), '$.cg.resumeCast')
}
export function hideStageCg(state) {
  if (!state.cg) return
  state.cast = [...state.cg.resumeCast]
  delete state.cg
}
export function applyStageCg(state, op, catalogue, diagnostics) {
  if (op.op === 'cg.hide') { hideStageCg(state); return }
  const ref = op.op === 'cg.show' ? op.cg : state.cg?.ref
  check(ref, '$.op', 'Show a CG first', 'PRECONDITION')
  const row = catalogue.candidates.cg?.find(row => assetRefKey(row.ref) === assetRefKey(ref))
  check(row, '$.cg', 'CG is unavailable', 'REF_UNAVAILABLE')
  const asset = row.asset
  if(op.op==='cg.variant')variantTarget([state.cg.ref],op.ref)
  if (op.op === 'cg.pan') {
    // Full is a protocol-defined reset, not an authored focus hint.
    check(op.focus === 'full' || assetContent(asset,state.cg.variant ?? undefined).focusHints?.some(f => f.key === op.focus), '$.focus', 'Choose a listed focus or full', 'ARG_INVALID')
    state.cg.focus = op.focus
    return
  }
  const variant = selectAssetVariant(asset,op.variant)?.id ?? null
  if (state.cg && assetRefKey(state.cg.ref) === assetRefKey(ref)) state.cg.variant = variant
  else state.cg = {ref:structuredClone(ref),variant,focus:'full',resumeCast:[...(state.cg?.resumeCast || state.cast)]}
}
export function cgPromptRow(row) {
  const cut = (text, n) => {
    const points = [...String(text)]
    if (points.length <= n) return points.join('')
    const prefix = points.slice(0,n).join('')
    // Prefer complete sentences; otherwise avoid splitting a whitespace-delimited word.
    const sentence = prefix.match(/^.*[.!?\u3002\uff01\uff1f](?=\s|$)/s)?.[0]
    if (sentence) return sentence
    if (/\s/u.test(points[n]) || /\s$/u.test(prefix)) return prefix.trimEnd()
    return prefix.replace(/\s+\S*$/u, '').trimEnd()
  }
  const asset = row.asset
  const variants=assetVariantCandidate(asset),content=assetContent(asset)
  const result = {ref:row.ref,label:row.label,directorNote:cut(asset.directorNote,60),
    ...(variants?{variants:{...variants,entries:variants.entries.map(row=>({...row,name:cut(row.name,16)}))}}:{}),
    ...(content.focusHints?.length ? {focus:content.focusHints.map(f => ({key:f.key,label:cut(f.label,16)}))} : {})}
  check(Buffer.byteLength(JSON.stringify(result),'utf8') <= 8192,'$.cg','CG prompt row exceeds 8 KiB; shorten its name or variant descriptions','MODEL_CONTEXT_EXCEEDED')
  return result
}
