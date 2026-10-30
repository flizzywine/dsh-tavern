import { selectStateImage, STATE_IMAGE_FIELDS } from './state-image-selection.js'
import { initialAssetPackStage, deriveAssetPackFigureScale } from './stage-asset-pack-tools.js'
import { parseBubbles } from '../../src/client/bubble-line.cjs'
import identity from '../../packages/dsh-asset-library/lib/shared/emotion-identity.cjs'
import resolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'

const memory = actor => Object.fromEntries(STATE_IMAGE_FIELDS.filter(key => Object.hasOwn(actor,key)).map(key => [key,actor[key]]))

// Canonical writer meaning only. No image lookup, entropy or model work happens in parsing.
export function writerStateChanges(units, context) {
  return units.flatMap((unit, index) => {
    if (unit.kind !== 'line') return []
    const bubble = parseBubbles(unit.text).find(row => row.kind === 'bubble')
    if (!bubble?.mood) return []
    const resolved = resolution.resolveFigureName(context.figureRows, bubble)
    const actor = context.actors[resolved.actorKey]
    if (!actor || resolved.status !== 'resolved') return []
    const state = identity.matchBubbleMood(bubble.mood, actor.emotions)
    return state ? [{at:index + 1,actor:resolved.actorKey,stateId:state.id}] : []
  })
}

export function hasStateImagePools(context) {
  return Object.values(context.actors).some(actor => actor.outfits.some(outfit => outfit.sprite?.imagePools))
}

// A regenerate keeps only committed image choices in the existing task checkpoint.
export function stateImageReplay(record) {
  if (!record || !Object.values(record.end.actors).some(actor => actor.imageSelection)) return null
  return {target:record.binding.target, unitsDigest:record.binding.unitsDigest,
    baseline:Object.fromEntries(Object.entries(record.baseline.actors).map(([id,actor]) => [id,memory(actor)])),
    entries:record.entries.flatMap(entry => entry.ops.filter(op => op.op === 'actor.image.select').map(op => ({at:entry.at,actor:op.actor,value:op.value})))}
}

function admitActor(actor, definition, stateId, draw, replay) {
  const outfit = definition?.outfits.find(row => row.key === actor.outfitKey)
  const sprite = outfit?.sprite
  if (!sprite) return actor
  const replayState = replay?.imageSelection?.outfitKey === outfit.key && replay.imageSelection.manifestKey === sprite.manifestKey ? replay.stateId : undefined
  const requested = stateId || replayState || actor.stateId || outfit.defaultEmotion
  const pool = sprite.imagePools[requested] || sprite.imagePools[outfit.fallbackTo?.[requested]] || sprite.imagePools[outfit.defaultEmotion]
  if (!pool) return actor
  const selected = selectStateImage({stateId:requested,outfitKey:outfit.key,manifestKey:sprite.manifestKey,pool,previous:actor,draw,replay})
  if (selected === actor) return actor
  const anatomy = sprite.anatomy?.[selected.imageSelection.imageId]
  return {...selected,ruler:outfit.ruler ? {...outfit.ruler,...(anatomy ? {headRatio:anatomy.headRatio} : {})} : null}
}

export function initializeStateImages(baseline, context, draw, replay, states = {}) {
  const next = structuredClone(baseline)
  for (const [id, actor] of Object.entries(next.actors)) next.actors[id] = admitActor(actor, context.actors[id], states[id], draw, replay?.baseline[id])
  return next
}

// Called once when a transaction seals its accepted window, before checkpoint/publication.
// Director snapshots supply outfits; image memory flows only from the accepted predecessor.
export function admitStateImages({ prepared, previous, result, from, through, draw }) {
  if (!hasStateImagePools(prepared.context)) return result
  const priorEntries = result.entries.filter(entry => entry.at < from)
  const pending = result.entries.filter(entry => entry.at >= from)
  const changes = writerStateChanges(prepared.imageUnits, prepared.context)
  let state = structuredClone(previous)
  const entries = [...priorEntries]
  for (let at = from; at <= through; at++) {
    const directed = pending.filter(entry => entry.at === at)
    for (const entry of directed) {
      const snapshot = structuredClone(entry.state)
      snapshot.actors = {...structuredClone(state.actors),...snapshot.actors}
      for (const [id, actor] of Object.entries(snapshot.actors)) {
        for (const key of STATE_IMAGE_FIELDS) delete actor[key]
        const previousActor = state.actors[id]
        Object.assign(actor, memory(previousActor || {}))
        if (previousActor?.imageSelection && actor.outfitKey === previousActor.outfitKey) actor.ruler = structuredClone(previousActor.ruler)
      }
      entries.push({...entry,state:snapshot})
      state = snapshot
    }
    const next = structuredClone(state)
    const chosen = new Map(changes.filter(change => change.at === at).map(change => [change.actor,change.stateId]))
    for (const id of chosen.keys()) if (!next.actors[id] && prepared.context.actors[id].outfits[0]?.sprite?.imagePools) {
      next.actors[id] = initialAssetPackStage({[id]:prepared.context.actors[id]}).actors[id]
    }
    const ops = []
    for (const [id, actor] of Object.entries(next.actors)) {
      const replay = prepared.imageReplay?.entries.find(entry => entry.at === at && entry.actor === id)?.value
      const admitted = admitActor(actor, prepared.context.actors[id], chosen.get(id), draw, replay)
      if (admitted !== actor) {
        next.actors[id] = admitted
        ops.push({op:'actor.image.select',actor:id,value:structuredClone(memory(admitted)),ruler:structuredClone(admitted.ruler)})
      }
    }
    if (ops.length) {
      next.figureScale = deriveAssetPackFigureScale(state,next,at)
      entries.push({at,ops,state:structuredClone(next),timeTransitionMs:0})
    }
    state = next
  }
  // Preserve director-owned fields updated without a visible operation (pacing, etc.).
  const end = {...result.state, actors:state.actors,...(state.figureScale ? {figureScale:state.figureScale} : {})}
  return {...result,state:end,entries}
}
