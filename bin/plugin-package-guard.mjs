import { readHostCompatibility } from '../tavern-plugin/lib/domain/host-compatibility.js'
import { resolveTavernDataRoot } from '../tavern-plugin/lib/domain/tavern-data.js'
import { ensureUserExtensions } from '../tavern-plugin/lib/domain/user-extensions.js'

// Host classification only ever reports `allowed` (inside the allowlist) or
// `blocked`; `verified` is accepted too so the guard keeps working if a future
// check distinguishes an installer-verified host from a runtime-allowed one.
export function isCompatibleHost(compatibility) {
  return compatibility.status === 'allowed' || compatibility.status === 'verified'
}

// Only the standard package bundle mounts this guard. Legacy installers check
// the selected host before installation and retain their existing behavior.
export async function apply() {
  const compatibility = readHostCompatibility()
  if (!isCompatibleHost(compatibility)) throw new Error(compatibility.message)
  await ensureUserExtensions(resolveTavernDataRoot())
}
