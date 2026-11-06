// Updates copy the new release over the app directory without deleting it, so user
// data and node_modules survive. Without pruning, files removed by a release stay
// behind: retired built-in skills keep loading and missing-file bugs stay hidden.
//
// Run from the NEW source before copying: delete what the previous install placed
// (recorded in INVENTORY) but the new source no longer ships, then record the new list.
// The first run after this file exists has no inventory and deletes nothing.
import { existsSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const INVENTORY = '.dsh-tavern-files.txt'
// Never touched even if an inventory were corrupted to name them.
const PROTECTED = new Set(['data', 'node_modules', '.git', INVENTORY, '.dsh-tavern-release.json'])

export function sourceFiles(sourceDir) {
  const files = []
  function walk(relative) {
    for (const entry of readdirSync(path.join(sourceDir, relative), { withFileTypes: true })) {
      const next = relative ? relative + '/' + entry.name : entry.name
      if (!relative && PROTECTED.has(entry.name)) continue
      if (entry.isDirectory()) walk(next)
      else if (entry.isFile()) files.push(next)
    }
  }
  walk('')
  return files.sort()
}

function safeRelative(value) {
  if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value) || value.includes('\\')) return false
  const parts = value.split('/')
  return !parts.some(part => part === '' || part === '.' || part === '..') && !PROTECTED.has(parts[0])
}

export function pruneInstalledFiles(sourceDir, appDir) {
  const next = sourceFiles(sourceDir)
  const keep = new Set(next)
  const inventory = path.join(appDir, INVENTORY)
  const removed = []
  if (existsSync(inventory)) {
    const previous = readFileSync(inventory, 'utf8').split('\n').map(line => line.trim()).filter(Boolean)
    for (const relative of previous) {
      if (keep.has(relative) || !safeRelative(relative)) continue
      const target = path.join(appDir, ...relative.split('/'))
      let stat
      try { stat = statSync(target) } catch { continue }
      if (!stat.isFile()) continue
      rmSync(target, { force: true })
      removed.push(relative)
      // Drop directories the removal emptied, never the app directory itself.
      let directory = path.dirname(target)
      while (directory !== appDir && directory.startsWith(appDir + path.sep)) {
        try { if (readdirSync(directory).length) break; rmdirSync(directory) } catch { break }
        directory = path.dirname(directory)
      }
    }
  }
  writeFileSync(inventory, next.join('\n') + '\n')
  return removed
}

// Installers run this from a temp directory whose path may be a symlink (macOS
// /var -> /private/var); compare real paths or the command silently does nothing.
let isEntryPoint = false
try { isEntryPoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch {}
if (isEntryPoint) {
  const [sourceDir, appDir] = process.argv.slice(2)
  if (!sourceDir || !appDir) { console.error('用法：node prune-installed-files.mjs <新版本源码目录> <程序目录>'); process.exit(2) }
  // The new pruner runs even when launched by an older installer. Preserve old
  // bundled faces before its inventory removes binaries absent from a core ZIP.
  const { preserveInstallationFonts } = await import('./preserve-font-assets.mjs')
  await preserveInstallationFonts(appDir)
  const removed = pruneInstalledFiles(path.resolve(sourceDir), path.resolve(appDir))
  if (removed.length) console.log(`已移除旧版本遗留文件 ${removed.length} 个`)
}
