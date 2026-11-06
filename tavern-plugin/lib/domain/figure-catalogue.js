// one effective figure index; identities are refs, never recall evidence.
import {createHash} from 'node:crypto'
import {listEffectiveAssets} from './effective-assets.js'
import resolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'
import {check} from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
const {codepointCompare} = resolution
export const figureRefKey = ref => ref.packId + '/' + ref.figureId
export const figureActorKey = ref => 'f_' + createHash('sha256').update(figureRefKey(ref)).digest('hex').slice(0,16)
export function effectiveFigurePackIds(bindings, globalEnabledPackIds = []) {
  return [...new Set([...(bindings?.boundPackIds || []), ...globalEnabledPackIds.slice().sort(codepointCompare)])]
}
// Published pack snapshots are frozen per revision (manifest and figure documents keep their identity until the pack
// changes), so the index of the same frozen packs and bindings is built once: the phone's 通讯录 reads it per contact.
// Rows are shared and frozen; callers derive, never mutate. A few combinations per leading manifest; old revisions fall out.
const catalogues = new WeakMap()
export function figureCatalogue({snapshots = [], bindings, globalEnabledPackIds = []}) {
  const bound = bindings?.boundPackIds || [], ids = [...new Set([...bound, ...globalEnabledPackIds.slice().sort()])]
  const packs = ids.map(packId => snapshots.find(pack => pack.manifest.id === packId)).filter(Boolean)
  if (!packs.length || !packs.every(pack => Object.isFrozen(pack.manifest) && (!pack.figures || Object.isFrozen(pack.figures))))
    return buildFigureCatalogue({snapshots, bindings, globalEnabledPackIds})
  const signature = JSON.stringify([bound, ids]), parts = packs.flatMap(pack => [pack.manifest, pack.figures])
  const known = catalogues.get(packs[0].manifest) || []
  const hit = known.find(entry => entry.signature === signature && entry.parts.length === parts.length && entry.parts.every((part, i) => part === parts[i]))
  if (hit) return hit.rows
  const rows = Object.freeze(buildFigureCatalogue({snapshots:packs, bindings, globalEnabledPackIds}).map(row => Object.freeze(row)))
  catalogues.set(packs[0].manifest, [{signature, parts, rows}, ...known].slice(0, 4))
  return rows
}
function buildFigureCatalogue({snapshots, bindings, globalEnabledPackIds}) {
  const rows = [], keys = new Map()
  for (const {pack,asset:figure,ref,sourceRefs} of listEffectiveAssets({snapshots,boundPackIds:bindings?.boundPackIds,globalEnabledPackIds}).filter(row => row.ref.figureId)) {
    const identity = figureRefKey(ref), generated = figureActorKey(ref)
    check(!keys.has(generated) || keys.get(generated) === identity, '$.figures', 'Figure actor key collision')
    keys.set(generated,identity)
    rows.push({actorKey:generated,ref,sourceRefs,name:figure.name,aliases:figure.aliases || [],enabled:figure.enabled,
      appearance:figure.appearance,recall:figure.recall,figure,packName:pack.manifest.name})
  }
  return rows
}
export {resolution}
