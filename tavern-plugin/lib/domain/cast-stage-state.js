function tavernCastCharacter(cast, name) {
  return (cast || []).find(item => item.name === name || (item.aliases || []).includes(name)) || null
}

// Accepted director deltas are the only stage-state input. Reading never resets it.
function emptyStageState() {
  return { figures: [], background: null, music: null }
}

function foldStageState(state, delta) {
  const next = { ...state, figures: state.figures.map(figure => ({ ...figure })) }
  if (delta.figures === null) next.figures = []
  else for (const change of delta.figures || []) {
    const index = next.figures.findIndex(figure => figure.speaker === change.speaker)
    if (change.remove) {
      if (index >= 0) next.figures.splice(index, 1)
    } else if (index >= 0) {
      if (change.emotion !== undefined) next.figures[index].emotion = change.emotion
    } else next.figures.push({ speaker: change.speaker, emotion: change.emotion ?? 'neutral' })
  }
  for (const field of ['background', 'music']) if (Object.hasOwn(delta, field)) next[field] = delta[field]
  // 环境音 is only in the state while one plays, so a stage that never had one reads exactly as before.
  if (typeof delta.ambience === 'string') next.ambience = delta.ambience
  else if (delta.ambience === null) delete next.ambience
  return next
}

export { tavernCastCharacter, emptyStageState, foldStageState }
