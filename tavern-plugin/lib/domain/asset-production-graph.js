// structural edges survive missing artifacts; invalidation never crosses outfits unnecessarily.
export function slotDependencies(p, s) {
  if (!s.character || s.kind === 'identity-settei') return []
  const id = (kind, emotion) => [s.character,s.outfit,kind,emotion].filter(Boolean).join('/')
  if (s.kind === 'settei') return [s.character + '/identity-settei']
  const figure=p.characters.find(c=>c.key===s.character),first=figure?.outfits.find(o=>o.key===s.outfit)?.defaultEmotion ?? figure?.emotions?.[0]?.id
  const refs = [id('settei')]
  if (s.kind === 'sprite' && s.emotion !== first || s.kind === 'avatar-sheet') refs.push(id('sprite',first))
  if (['avatar','blink','mouth'].includes(s.kind)) refs.push(id('sprite',s.emotion))
  if (s.kind === 'avatar' && s.emotion !== first) refs.push(id('avatar',first))
  return refs.filter(dep => Boolean(p.slots[dep]))
}
export function descendants(p, id) {
  const result = new Set(), pending = [id], children = new Map()
  for (const slot of Object.values(p.slots)) for (const parent of slotDependencies(p,slot)) {
    if (!children.has(parent)) children.set(parent,[])
    children.get(parent).push(slot.id)
  }
  while (pending.length) {
    const parent = pending.pop()
    for (const child of children.get(parent)||[]) if (!result.has(child)) {
      result.add(child); pending.push(child)
    }
  }
  return [...result]
}
export function invalidateDescendants(p, id) {
  const affected = descendants(p,id)
  for (const key of [id,...affected]) {
    const s = p.slots[key]
    delete s.approved
    if (key !== id && s.artifact) {
      // Preserve evidence, not approval, for a later explicit human rebind.
      if(s.kind==='avatar'&&s.accepted===s.artifact.hash&&s.acceptedVersion===s.version&&s.acceptedBy)
        s.previousAcceptance={hash:s.accepted,version:s.acceptedVersion,reviewer:s.acceptedBy}
      s.stale = true;delete s.accepted
    }
  }
  return affected
}
