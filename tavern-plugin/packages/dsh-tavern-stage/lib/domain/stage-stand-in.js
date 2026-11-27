// 借用形象 (stand-ins): a new person, who speaks before they have a 立绘 of their own, still comes on stage, wearing the 立绘 of
// an ordinary library figure the 选角助理 lent them (a 通用角色; 自动素材's record keeps the lending by name: looks). Pure.
//
// A stand-in is an actor keyed by the speaker's name (standInKey), shown as the lent figure; the stage state keeps the name on
// the actor (`standIn`). When the name later resolves to a figure of its own with something to show, the stand-in becomes that
// figure's actor in the same place on stage (rekeyStandIns, at the next round's start); within a round the projection shows
// the figure as soon as it has a 立绘 (standInShown). The person keeps their own name and voice throughout.
import {createHash} from 'node:crypto'
import figureResolution from '../../../dsh-presentation-protocol/src/figure-resolution.cjs'
import figureScale from '../../../dsh-presentation-protocol/src/figure-scale.cjs'

export const standInKey = name => 's_' + createHash('sha256').update('stand-in/' + String(name).trim()).digest('hex').slice(0, 16)
const sameRef = (a, b) => !!a && !!b && a.packId === b.packId && a.figureId === b.figureId

// The stand-ins a round's director needs: every speaker of `units` (a line with a name) and every stand-in still in the
// carried state who was lent a look (looks: {name: {packId, figureId}}, found among lentRows: the lent packs' rows, bound to the
// card or not), and has nothing of their own to show (castRows: the card's figures): their name resolves to no figure yet (written meanwhile, not in this round's snapshot) or to one 自动素材 wrote with no
// actor yet. The player, and a figure the owner made (a contact), are never stood in for.
// actorOf(row) builds an actor from the lent figure's row (the director's frozenActors for one row).
// → {actors:{[standInKey]: actor with name = the speaker's name and standIn = that name}, speakers:{unit alias → standInKey}}.
export function standInActors({units, carried, castRows, lentRows = castRows, actors, actorOf, player, looks = {}}) {
  const result = {}, speakers = {}
  // the lent figure's row for a speaker (a unit or a name), or null
  const lentRow = speaker => {
    const name = typeof speaker === 'string' ? speaker : speaker.name
    if (player && (name === player || figureResolution.resolveFigureName([{actorKey:'player', name:player, aliases:[]}], speaker).status === 'resolved')) return null
    const found = figureResolution.resolveFigureName(castRows, speaker, carried?.actors)
    if (found.status === 'resolved' && (Object.hasOwn(actors, found.actorKey) || !found.row.figure?.extensions?.['dsh.automatic-write'])) return null
    const lent = looks[name]
    return lent && lentRows.find(row => row.enabled !== false && sameRef(row.ref, lent)) || null
  }
  const add = (name, row) => {
    const key = standInKey(name)
    // listed with this round's actors (never the conversation's fixed section): it comes and goes with its speaker
    if (!result[key]) { const actor = actorOf(row); if (actor) result[key] = {...actor, name, standIn:name, constant:false} }
    return result[key] ? key : null
  }
  for (const actor of Object.values(carried?.actors || {})) {
    const row = actor.standIn && lentRow(actor.standIn)
    if (row) add(actor.standIn, row)
  }
  for (const unit of units) {
    if (typeof unit === 'string' || unit.kind !== 'line' || !unit.name) continue
    const key = result[standInKey(unit.name)] ? standInKey(unit.name) : (row => row && add(unit.name, row))(lentRow(unit))
    if (key && unit.alias) speakers[unit.alias] = key
  }
  return {actors:result, speakers}
}

// At a round's start: a stand-in whose name now resolves to an actor of its own becomes that actor, in its place on stage
// (cast order, gaze, light and every reference to it carried over); a stand-in whose person is already on stage as
// themselves leaves. actors: this round's actors (not stand-ins). Returns the state unchanged when there is nothing to do.
export function rekeyStandIns(state, castRows, actors) {
  const moves = new Map()
  for (const [key, actor] of Object.entries(state.actors)) {
    if (!actor.standIn) continue
    const found = figureResolution.resolveFigureName(castRows, actor.standIn, state.actors)
    if (found.status === 'resolved' && Object.hasOwn(actors, found.actorKey)) moves.set(key, found.actorKey)
  }
  if (!moves.size) return state
  const next = structuredClone(state)
  for (const [from, to] of moves) {
    const old = next.actors[from], target = actors[to]
    delete next.actors[from]
    const onStage = next.cast.includes(to)
    if (!next.actors[to]) {
      const {standIn, ...rest} = old
      next.actors[to] = {...rest, figure:structuredClone(target.figure), outfitKey:target.outfits[0]?.key ?? null, ruler:structuredClone(target.ruler || null)}
    }
    next.cast = onStage ? next.cast.filter(id => id !== from) : next.cast.map(id => id === from ? to : id)
    for (const actor of Object.values(next.actors)) if (actor.gaze === from) actor.gaze = to
    if (next.camera?.actor === from) next.camera.actor = to
    if (next.dof === from) next.dof = to
    if (next.cg?.resumeCast) next.cg.resumeCast = [...new Set(next.cg.resumeCast.map(id => id === from ? to : id))]
  }
  return next
}

// While a round is read: a stand-in whose person now has a figure with a stage outfit (its first 立绘 landed) is shown as that
// figure, in the same place. rows: the projection's figure rows; stageOutfitKey(figure): the outfit the stage would show, or null.
export function standInShown(actor, rows, stageOutfitKey) {
  if (!actor?.standIn) return actor
  const found = figureResolution.resolveFigureName(rows.filter(row => row.enabled !== false), actor.standIn)
  const outfitKey = found.status === 'resolved' && !sameRef(found.row.ref, actor.figure) ? stageOutfitKey(found.row.figure) : null
  if (outfitKey === null) return actor
  return {...actor, figure:{packId:found.row.ref.packId, figureId:found.row.ref.figureId}, outfitKey,
    ruler:{heightCm:found.row.figure.heightCm ?? figureScale.FIGURE_DISPLAY.DEFAULT_HEIGHT_CM, headRatio:actor.ruler?.headRatio ?? 1, elevationCm:found.row.figure.elevationCm ?? 0}}
}
// The stand-in on this stage for a speaker of this name, or undefined.
export const standInFor = (actors, name) => Object.keys(actors).find(alias => actors[alias].standIn && actors[alias].standIn === name)
