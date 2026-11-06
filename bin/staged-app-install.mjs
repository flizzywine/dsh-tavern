#!/usr/bin/env node
// CLI updates prepare the new release beside the running one and switch only at
// the end. Download and dependency installation (the slow, failure-prone and
// cancellable part) never touch the live app, so the service stays online; a
// failure after the switch restores the previous directory exactly.
//
//   prepare  --app A --source S [--commit C]          build A.staging from S
//   swap     --app A                                   A -> A.previous, A.staging -> A, carry user files
//   rollback --app A                                   undo swap: user files back, A.previous -> A
//   commit   --app A                                   drop A.previous after a verified install
//   discard  --app A                                   drop an unused A.staging
//
// User files are everything in the app directory that the previous release did
// not install (recorded in INVENTORY) and the new release does not ship, e.g.
// legacy data/. They are moved, never copied, so large data costs nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { preserveInstallationFonts } from './preserve-font-assets.mjs'
import { INVENTORY, sourceFiles } from './prune-installed-files.mjs'
import { copyTreeSync, removeTreeSync } from './portable-fs.mjs'

const SWAP_RECORD = '.dsh-tavern-swap.json'
const RELEASE_RECORD = '.dsh-tavern-release.json'
const NEVER_CARRIED = new Set([INVENTORY, RELEASE_RECORD, SWAP_RECORD])

export function stagedPaths(app) {
  const resolved = path.resolve(app)
  return { app: resolved, staging: resolved + '.staging', previous: resolved + '.previous' }
}

// Windows may briefly hold handles (antivirus, indexer) right after the service exits.
function rename(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { return renameSync(from, to) } catch (error) {
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
  }
}

function remove(target) {
  removeTreeSync(target, { retries: 10, retryDelay: 250 })
}

// An interrupted earlier attempt may leave the app missing (killed mid-swap) or
// a stale previous/staging copy. Restore a usable app before starting again.
export function recover(app) {
  const paths = stagedPaths(app)
  // Killed between the two renames: the previous app is complete, move it back.
  if (!existsSync(paths.app) && existsSync(paths.previous)) rename(paths.previous, paths.app)
  // An unfinished switch still owns user files in previous: undo it properly.
  if (existsSync(path.join(paths.app, SWAP_RECORD))) rollback(paths.app)
  // Without a record, previous is what a committed switch had not yet deleted.
  if (existsSync(paths.previous)) remove(paths.previous)
  if (existsSync(paths.staging)) remove(paths.staging)
}

export function prepare({ app, source, commit = '' }) {
  const paths = stagedPaths(app)
  recover(paths.app)
  copyTreeSync(path.resolve(source), paths.staging)
  removeTreeSync(path.join(paths.staging, RELEASE_RECORD))
  if (/^[0-9a-f]{40}$/i.test(commit)) {
    writeFileSync(path.join(paths.staging, RELEASE_RECORD), JSON.stringify({ commit, installedAt: new Date().toISOString() }) + '\n')
  }
  writeFileSync(path.join(paths.staging, INVENTORY), sourceFiles(path.resolve(source)).join('\n') + '\n')
  return paths.staging
}

// Paths (relative, '/'-separated) to move from the old app into the new one.
export function carriedEntries(app, staging) {
  const inventoryFile = path.join(app, INVENTORY)
  const installed = new Set(existsSync(inventoryFile)
    ? readFileSync(inventoryFile, 'utf8').split('\n').map(line => line.trim()).filter(Boolean) : [])
  const installedDirectories = new Set()
  for (const file of installed) for (let index = file.indexOf('/'); index > 0; index = file.indexOf('/', index + 1)) installedDirectories.add(file.slice(0, index))
  const carried = []
  function walk(relative) {
    for (const entry of readdirSync(path.join(app, ...relative.split('/').filter(Boolean)), { withFileTypes: true })) {
      const next = relative ? relative + '/' + entry.name : entry.name
      // Dependencies belong to the release that installed them; the new one has its own.
      if (entry.name === 'node_modules' || entry.name === '.git' || (!relative && NEVER_CARRIED.has(entry.name))) continue
      const inNew = existsSync(path.join(staging, ...next.split('/')))
      if (entry.isDirectory()) {
        if (!inNew && !installedDirectories.has(next)) carried.push(next)
        else walk(next)
      } else if (!installed.has(next) && !inNew) carried.push(next)
    }
  }
  walk('')
  return carried
}

export function swap(app) {
  const paths = stagedPaths(app)
  if (!existsSync(paths.staging)) throw new Error('缺少已准备的新版本：' + paths.staging)
  if (!existsSync(paths.app)) {
    writeFileSync(path.join(paths.staging, SWAP_RECORD), JSON.stringify({ fresh: true, moved: [] }) + '\n')
    rename(paths.staging, paths.app)
    return []
  }
  const moved = carriedEntries(paths.app, paths.staging)
  // Persist the complete plan in staging before either rename. The record moves
  // with the new app; every planned target is absent until its user file moves.
  // Recovery can therefore inspect the paths instead of relying on a progress
  // record written after a move (which could be interrupted).
  writeFileSync(path.join(paths.staging, SWAP_RECORD), JSON.stringify({ fresh: false, moved }) + '\n')
  try {
    rename(paths.app, paths.previous)
    rename(paths.staging, paths.app)
    for (const relative of moved) {
      const target = path.join(paths.app, ...relative.split('/'))
      mkdirSync(path.dirname(target), { recursive: true })
      rename(path.join(paths.previous, ...relative.split('/')), target)
    }
  } catch (error) {
    rollback(paths.app)
    throw error
  }
  return moved
}

export function rollback(app) {
  const paths = stagedPaths(app)
  const recordFile = path.join(paths.app, SWAP_RECORD)
  if (!existsSync(recordFile)) {
    // Nothing was switched (or it was already undone); just make the app usable.
    recover(paths.app)
    return false
  }
  const record = JSON.parse(readFileSync(recordFile, 'utf8'))
  if (!record.fresh && !existsSync(paths.previous)) {
    // commit() removes previous first: the switch was already committed.
    removeTreeSync(recordFile)
    return false
  }
  const failed = paths.app + '.failed'
  remove(failed)
  if (record.fresh) {
    rename(paths.app, failed)
    remove(failed)
    return true
  }
  if (!existsSync(paths.previous)) throw new Error('无法恢复原版本：缺少 ' + paths.previous)
  for (const relative of [...record.moved].reverse()) {
    const from = path.join(paths.app, ...relative.split('/'))
    if (!existsSync(from)) continue
    const target = path.join(paths.previous, ...relative.split('/'))
    mkdirSync(path.dirname(target), { recursive: true })
    rename(from, target)
  }
  rename(paths.app, failed)
  rename(paths.previous, paths.app)
  remove(failed)
  return true
}

export function commit(app) {
  const paths = stagedPaths(app)
  // Previous first: a record without previous then unambiguously means committed.
  if (existsSync(paths.previous)) remove(paths.previous)
  removeTreeSync(path.join(paths.app, SWAP_RECORD))
}

export function discard(app) {
  const paths = stagedPaths(app)
  if (existsSync(paths.staging)) remove(paths.staging)
}

function argument(args, name) {
  const index = args.indexOf('--' + name)
  return index >= 0 ? args[index + 1] : undefined
}

// Installers run this from a temp directory whose path may be a symlink (macOS
// /var -> /private/var); compare real paths or the command silently does nothing.
let isEntryPoint = false
try { isEntryPoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch {}
if (isEntryPoint) {
  const [command, ...args] = process.argv.slice(2)
  const app = argument(args, 'app')
  try {
    if (!app) throw new Error('缺少 --app')
    // prepare may clean an interrupted .previous; commit removes the old release.
    if (command === 'prepare' || command === 'commit') await preserveInstallationFonts(app)
    if (command === 'prepare') console.log(prepare({ app, source: argument(args, 'source'), commit: argument(args, 'commit') || '' }))
    else if (command === 'swap') { const moved = swap(app); console.log(`已切换到新版本，保留用户文件 ${moved.length} 项。`) }
    else if (command === 'rollback') { if (rollback(app)) console.log('已恢复原版本。') }
    else if (command === 'commit') commit(app)
    else if (command === 'discard') discard(app)
    else throw new Error('未知命令：' + (command || '(空)'))
  } catch (error) {
    console.error(String(error?.message || error))
    process.exitCode = 1
  }
}
