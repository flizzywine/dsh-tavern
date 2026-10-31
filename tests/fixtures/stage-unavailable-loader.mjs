// Model an absent optional package without renaming a live workspace directory.
export async function resolve(specifier, context, nextResolve) {
  const unavailable = url => url.includes('/packages/dsh-tavern-stage/') || url === 'dsh-tavern-stage' || url.startsWith('dsh-tavern-stage/')
  const denied = () => Object.assign(new Error('Stage package is unavailable'), {code:'ERR_MODULE_NOT_FOUND'})
  if (unavailable(specifier)) throw denied()
  const result = await nextResolve(specifier, context)
  if (unavailable(result.url)) throw denied()
  return result
}
