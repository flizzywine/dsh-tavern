// fixed catalogue/card data precedes the one-shot volatile payload.
export function directorPromptData(request) {
  const fixed = JSON.parse(request.system.split('<stage_assets>\n').at(-1).split('\n')[1])
  const turn = Object.assign({}, ...request.messages[0].content.flatMap(part => {try {return [JSON.parse(part.text)]} catch {return []}}))
  const catalogue = Object.fromEntries(Object.keys({ ...fixed.catalogue, ...turn.catalogue }).map(kind => [kind, [...(fixed.catalogue[kind] || []), ...(turn.catalogue[kind] || [])]]))
  const actors = (fixed.actors || turn.actors) && Object.fromEntries(Object.entries({...fixed.actors,...turn.actors}).map(([alias, actor]) => [alias, {...actor, ...(actor.outfits ? {outfits:[...actor.outfits, ...(turn.outfits?.[alias] || [])]} : {})}]))
  return { ...fixed, ...turn, ...(actors ? {actors} : {}), catalogue }
}
