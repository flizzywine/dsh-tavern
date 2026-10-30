import path from 'node:path'
import { lstat } from 'node:fs/promises'
import { check, relativePath } from '../asset-packs/common.js'

export const absent = error => { if (error.code === 'ENOENT') return undefined; throw error }
export async function checkedPath(root, relative, inspect = lstat) {
  if (relative) relativePath(relative)
  // Only what lies beneath the root is checked: the configured root may itself sit beneath a
  // symlink (macOS /var, an Android shared-storage link).
  const base = path.resolve(root), absolute = path.resolve(base, ...(relative ? relative.split('/') : []))
  let current = base
  for (const segment of relative ? relative.split('/') : []) {
    current = path.join(current, segment)
    const info = await inspect(current).catch(absent)
    check(!info?.isSymbolicLink(), relative, 'Symlink/reparse point rejected', 'INVALID_PATH')
  }
  return absolute
}
