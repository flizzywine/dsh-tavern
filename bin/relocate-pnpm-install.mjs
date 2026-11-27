import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { removeTreeSync } from './portable-fs.mjs'

export function relocatePnpmInstall(moves) {
  function mapPath(target) {
    for (const [from, to] of moves) {
      const relative = path.relative(from, target)
      if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) return path.join(to, relative)
    }
    return target
  }

  // pnpm uses absolute Windows junctions, even within one dependency tree.
  // Collect targets before changing any links, while staging still resolves them.
  const links = []
  function visit(file) {
    const stat = lstatSync(file)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(file)) visit(path.join(file, entry))
    } else if (stat.isSymbolicLink()) {
      const target = readlinkSync(file)
      const absolute = path.resolve(path.dirname(file), target)
      const final = mapPath(absolute)
      const parent = path.dirname(mapPath(file))
      if (path.resolve(parent, target) !== final) links.push({ file, target, final, parent, isDirectory: statSync(absolute).isDirectory() })
    }
  }
  for (const [from] of moves) visit(from)
  for (const { file, target, final, parent, isDirectory } of links) {
    removeTreeSync(file)
    if (process.platform === 'win32' && isDirectory) symlinkSync(final, file, 'junction')
    else symlinkSync(path.isAbsolute(target) ? final : path.relative(parent, final), file, isDirectory ? 'dir' : 'file')
  }

  for (const [from] of moves) {
    // Change the store location metadata last. If relocation fails before this
    // step, offline pnpm still sees the old location and rebuilds the links.
    for (const name of ['.pnpm-workspace-state-v1.json', '.modules.yaml']) {
      const file = path.join(from, 'node_modules', name)
      if (!existsSync(file)) continue
      const before = readFileSync(file, 'utf8')
      let after = before
      for (const [from, to] of moves) {
        after = after.replaceAll(from, to)
          .replaceAll(from.split(path.sep).join('/'), to.split(path.sep).join('/'))
          .replaceAll(JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1))
      }
      if (after === before) continue
      const temporary = file + '.relocating'
      try {
        writeFileSync(temporary, after)
        renameSync(temporary, file)
      } finally { removeTreeSync(temporary) }
    }
  }
}
