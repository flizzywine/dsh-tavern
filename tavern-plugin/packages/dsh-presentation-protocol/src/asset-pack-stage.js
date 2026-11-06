import { assetRefKey, validateAssetRef, validateSceneSelection } from './asset-packs.js'
import { check } from './asset-pack-json.js'
import {projectBackgroundTime} from './stage-time.js'
import {assetContent} from './asset-variant-content.js'

export function assetPackLookLayer(look) { return look?.layer === 'mood' ? 'mood' : null }
// The persistent slot stays inert; global time parameters never name a pack asset.
export function assetPackTimeLighting() { return {time:{mode:'auto',ref:null},diagnostics:[]} }
export function reduceAssetPackScene(state, selection, _looks, { snap = false } = {}) {
  if (selection !== null) validateSceneSelection(selection)
  const next = structuredClone(state)
  const scene = selection === null ? null : {...structuredClone(selection),timeLook:null}
  const locationChanged = (state.scene?.background ? assetRefKey(state.scene.background) : null) !== (scene?.background ? assetRefKey(scene.background) : null)
  const timeChanged = state.scene?.timeOfDay !== scene?.timeOfDay
  next.scene = scene
  next.lighting.time = assetPackTimeLighting().time
  if (locationChanged) {
    if (next.camera?.mode === 'close') next.camera = { mode: 'reset', actor: null }
    for (const [id, widget] of Object.entries(next.widgets || {})) if (widget.lifetime?.until === 'scene-change') delete next.widgets[id]
  }
  return { state: next, diagnostics: [], locationChanged, transitionMs: !snap && !locationChanged && timeChanged ? 2500 : 0 }
}
export function applyAssetPackLight(state, value, looks) {
  check(value && typeof value === 'object', '$.light')
  check(value.mode === 'mood' && Object.keys(value).length === 2 && Object.hasOwn(value, 'ref'), '$.light')
  if (value.ref !== null) {
    validateAssetRef(value.ref, '$.light.ref', 'looks')
    check(looks.some(look => assetPackLookLayer(look) === 'mood' && assetRefKey(look.ref) === assetRefKey(value.ref)), '$.light.ref', 'Mood look must be recalled with an explicit layer')
  }
  const next = structuredClone(state); next.lighting.mood = structuredClone(value.ref)
  return { state: next, diagnostics: [] }
}
export function assetPackBackgroundVariant(background, scene) {
  if (scene?.variant) {
    const content=assetContent(background,scene.variant)
    const matched=scene.variant===scene.timeOfDay
    return {media:content.media,variant:scene.variant,timeMatched:matched,compensateBackground:!matched && ['dusk','night'].includes(scene.timeOfDay),diagnostics:[]}
  }
  return projectBackgroundTime(background,scene?.timeOfDay ?? null)
}
