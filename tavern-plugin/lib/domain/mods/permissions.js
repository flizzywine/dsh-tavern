import contract from '../../../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck: check, modFreeze, modResultError} = contract

export function assertModCurrent(context, current) {
  check(current(context), '$.source', 'Mod authority or source is no longer current', 'MOD_SOURCE_STALE')
}
export function assertModPermission(manifest, capability) {
  const [group, name] = capability.split('.')
  const allowed = name ? manifest.permissions[group]?.includes(name) : manifest.permissions[group] === true
  check(allowed, '$.permission', 'Mod capability not granted: ' + capability, 'MOD_PERMISSION_DENIED')
}
export async function modBoundary(work) {
  try { return modFreeze({ok:true, value:await work()}) }
  catch (error) { return modFreeze(modResultError(error)) }
}
export function modScope(globalEnabled, cardEnabled) {
  return globalEnabled ? 'global' : cardEnabled ? 'card' : 'off'
}
export function modVersionMatches(version, range) {
  const [,min,max] = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(range) || []
  if (!min) return false
  const compare = (a,b) => {const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return 0}
  return compare(version,min)>=0 && compare(version,max)<0
}
