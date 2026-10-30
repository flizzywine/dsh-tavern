// Pure relative Live2D resource closure validation.
const fail = code => { throw Object.assign(new Error(code), {code}) }
export function modelReferences(document, model3) {
  if (!document || document.Version !== 3 || !document.FileReferences || typeof document.FileReferences !== 'object') fail('INVALID_INPUT')
  const refs = document.FileReferences, names = new Set([model3])
  function add(value, required = false) {
    if (value === undefined && !required) return
    if (typeof value !== 'string' || !value || value.length > 512 || !/\.(json|moc3|png|webp|jpe?g|wav|mp3|ogg|m4a|flac)$/i.test(value) || value.split('/').some(part => !/^[A-Za-z0-9_@.-]{1,120}$/.test(part) || part === '.' || part === '..')) fail('INVALID_INPUT')
    names.add(value)
    if (names.size > 512) fail('LEASE_LIMIT')
  }
  for (const key of Object.keys(refs)) if (!['Moc', 'Textures', 'Physics', 'Pose', 'UserData', 'DisplayInfo', 'Expressions', 'Motions'].includes(key)) fail('INVALID_INPUT')
  add(refs.Moc, true)
  if (!Array.isArray(refs.Textures)) fail('INVALID_INPUT')
  for (const file of refs.Textures) add(file, true)
  for (const key of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) add(refs[key])
  if (refs.Expressions !== undefined && !Array.isArray(refs.Expressions)) fail('INVALID_INPUT')
  for (const entry of refs.Expressions || []) add(entry?.File, true)
  if (refs.Motions !== undefined && (!refs.Motions || typeof refs.Motions !== 'object' || Array.isArray(refs.Motions))) fail('INVALID_INPUT')
  for (const motions of Object.values(refs.Motions || {})) {
    if (!Array.isArray(motions)) fail('INVALID_INPUT')
    for (const motion of motions) { add(motion?.File, true); add(motion?.Sound) }
  }
  return [...names].sort()
}
