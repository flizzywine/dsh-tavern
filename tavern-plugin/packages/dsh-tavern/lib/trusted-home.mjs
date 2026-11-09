// Trust only the configured home ancestry, never links inside managed storage.
import * as fs from 'node:fs'
import path from 'node:path'
export const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
export const withinPath = (child, root) => {
  const relative = path.relative(process.platform === 'win32' ? root.toLowerCase() : root, process.platform === 'win32' ? child.toLowerCase() : child)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}
function physicalPrefix(directory) {
  try { return fs.realpathSync(directory) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    // A dangling link is not a missing directory that may safely be created.
    try { fs.lstatSync(directory); throw new Error(`目录链接不可用：${directory}`) } catch (missing) { if (missing.code !== 'ENOENT') throw missing }
    const parent = path.dirname(directory)
    if (parent === directory) throw error
    return path.join(physicalPrefix(parent), path.basename(directory))
  }
}
export function trustedHome(configuredHome) {
  const logical = path.resolve(configuredHome)
  const logicalParent = path.dirname(logical), physicalParent = physicalPrefix(logicalParent)
  const home = path.join(physicalParent, path.basename(logical))
  // Sibling custom app directories share the same trusted user-home ancestry.
  // Never realpath descendants: managed links still require explicit registration.
  const map = value => { const absolute = path.resolve(value); return withinPath(absolute, logicalParent) ? path.join(physicalParent, path.relative(logicalParent, absolute)) : absolute }
  const ordinary = (value, includeLeaf = true) => {
    let current = map(includeLeaf ? value : path.dirname(path.resolve(value)))
    for (;;) {
      try {
        const stat = fs.lstatSync(current)
        if (stat.isSymbolicLink()) throw new Error(`不支持经过未登记链接的路径：${current}`)
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  ordinary(home)
  try { if (!fs.lstatSync(home).isDirectory()) throw new Error(`DSH 目录不是独立文件夹：${home}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
  return { logical, home, physical: home, map, ordinary }
}
