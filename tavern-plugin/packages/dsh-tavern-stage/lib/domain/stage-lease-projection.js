import {validateSceneSelection} from '../../../dsh-presentation-protocol/src/asset-packs.js'

// A borrowed stage is a read-only presentation, never a director record or a cast update.
export async function projectStageLease({consumer, actors = [], scene, openingScene = null, live2d = true, spine = true}) {
  const {presentation, allowedPackIds} = consumer
  const rows = await presentation.figureRows()
  const characters = [], seen = new Set()
  for (const actor of actors.slice(0, 4)) {
    const found = await presentation.resolveName(actor.name)
    if (found.status !== 'resolved' || seen.has(found.actorKey)) continue
    seen.add(found.actorKey)
    const character = await presentation.character(found.actorKey, {emotion:actor.emotion, figureRows:rows, live2d, spine})
    characters.push(await presentation.materialize(character, {descriptors:true}))
  }
  const selected = scene === undefined ? openingScene : scene
  if (scene !== undefined && scene !== null) validateSceneSelection(scene)
  // Check before presentation.scene can resolve anything, including an explicit plugin mapping.
  const permitted = selected?.background && allowedPackIds.includes(selected.background.packId) ? selected : null
  const projected = await presentation.scene({scene:permitted}, {snap:true, descriptors:true, performanceAllowed:false})
  return {characters, scene:projected}
}
