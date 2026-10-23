import path from 'node:path'
import { lstat } from 'node:fs/promises'
import { check, relativePath } from '../asset-packs/common.js'

export const absent = error => { if (error.code === 'ENOENT') return undefined; throw error }
export async function checkedPath(root, relative, inspect = lstat) {
  if (relative) relativePath(relative)
  const absolute = path.resolve(root, ...(relative ? relative.split('/') : [])), anchor = path.parse(absolute).root
  let current = anchor
  for (const segment of ['', ...absolute.slice(anchor.length).split(path.sep)]) {
    if (segment) current = path.join(current, segment)
    const info = await inspect(current).catch(absent)
    check(!info?.isSymbolicLink(), relative, 'Symlink/reparse point rejected', 'INVALID_PATH')
  }
  return absolute
}
