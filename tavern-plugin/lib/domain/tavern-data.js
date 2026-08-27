import { access, copyFile, cp, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

const MIGRATION_MARKER = '.legacy-data-migration-v1.json'
const MERGED_JSON_FILES = new Set(['index.json', 'sessions.json', '.material-bindings.json', '.file-resources-v1.json'])
const durableFiles = createDurableFilePromotion()

function safeLabel(value) {
  const label = String(value || 'legacy').replace(/[^0-9A-Za-z._-]+/g, '-').replace(/^-+|-+$/g, '')
  return label || 'legacy'
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function readJson(file, fallback) {
  if (!await exists(file)) return fallback
  return JSON.parse(await readFile(file, 'utf8'))
}

async function writeJsonAtomic(file, value) {
  await durableFiles.write(file, `${JSON.stringify(value, null, 2)}\n`)
}

function keyedRows(rows) {
  const result = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row && typeof row === 'object' ? String(row.id || row.path || '') : ''
    if (key !== '' && !result.has(key)) result.set(key, row)
  }
  return result
}

function mergeIndex(current, incoming) {
  const result = { ...(incoming || {}), ...(current || {}) }
  result.schemaVersion = Math.max(Number(current?.schemaVersion) || 0, Number(incoming?.schemaVersion) || 0)
  for (const field of ['cards', 'chats']) {
    const rows = keyedRows(current?.[field])
    for (const [key, row] of keyedRows(incoming?.[field])) if (!rows.has(key)) rows.set(key, row)
    if (rows.size > 0 || Array.isArray(current?.[field]) || Array.isArray(incoming?.[field])) result[field] = [...rows.values()]
  }
  return result
}

function mergeDeep(current, incoming) {
  if (Array.isArray(current) || Array.isArray(incoming)) {
    const result = []
    const seen = new Set()
    for (const value of [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      const key = JSON.stringify(value)
      if (!seen.has(key)) {
        seen.add(key)
        result.push(value)
      }
    }
    return result
  }
  if (current && typeof current === 'object' && incoming && typeof incoming === 'object') {
    const result = { ...incoming, ...current }
    for (const key of new Set([...Object.keys(incoming), ...Object.keys(current)])) {
      if (key in current && key in incoming) result[key] = mergeDeep(current[key], incoming[key])
    }
    if ('schemaVersion' in result) result.schemaVersion = Math.max(Number(current.schemaVersion) || 0, Number(incoming.schemaVersion) || 0)
    return result
  }
  return current === undefined ? incoming : current
}

async function mergeJson(source, target, relative) {
  const incoming = await readJson(source, {})
  const current = await readJson(target, {})
  let merged
  if (relative === 'index.json') merged = mergeIndex(current, incoming)
  else if (relative === '.file-resources-v1.json') merged = mergeDeep(current, incoming)
  else merged = { ...(incoming || {}), ...(current || {}) }
  await writeJsonAtomic(target, merged)
}

async function sameFile(left, right) {
  const [a, b] = await Promise.all([readFile(left), readFile(right)])
  return a.equals(b)
}

async function conflictPath(targetRoot, label, relative) {
  const base = path.join(targetRoot, 'migration-conflicts', label, relative)
  if (!await exists(base)) return base
  let index = 2
  while (await exists(`${base}.${index}`)) index += 1
  return `${base}.${index}`
}

async function mergeTree(sourceRoot, targetRoot, label, relative = '') {
  let conflicts = 0
  for (const entry of await readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name)
    if (relative === '' && (entry.name === MIGRATION_MARKER || entry.name === 'migration-conflicts')) continue
    const source = path.join(sourceRoot, child)
    const target = path.join(targetRoot, child)
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true })
      conflicts += await mergeTree(sourceRoot, targetRoot, label, child)
      continue
    }
    if (relative === '' && MERGED_JSON_FILES.has(entry.name)) {
      await mergeJson(source, target, entry.name)
      continue
    }
    await mkdir(path.dirname(target), { recursive: true })
    if (!await exists(target)) {
      await copyFile(source, target)
    } else if (!await sameFile(source, target)) {
      const preserved = await conflictPath(targetRoot, label, child)
      await mkdir(path.dirname(preserved), { recursive: true })
      await copyFile(source, preserved)
      conflicts += 1
    }
  }
  return conflicts
}

async function uniqueBackupPath(backupRoot, stamp, label) {
  const base = path.join(backupRoot, `${stamp}-${label}`)
  if (!await exists(base)) return base
  let index = 2
  while (await exists(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

export function resolveTavernDataRoot(options = {}) {
  const dshHome = options.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(path.resolve(dshHome), 'profile-data', 'tavern', 'data')
}

export async function migrateLegacyTavernData(options) {
  const targetRoot = path.resolve(options.targetRoot)
  const backupRoot = path.resolve(options.backupRoot)
  const now = typeof options.now === 'function' ? options.now : Date.now
  await mkdir(targetRoot, { recursive: true })
  const markerPath = path.join(targetRoot, MIGRATION_MARKER)
  const marker = await readJson(markerPath, { schemaVersion: 1, sources: [] })
  const migrated = new Set((Array.isArray(marker.sources) ? marker.sources : []).map((item) => path.resolve(item.path)))
  let migratedSources = 0
  let conflicts = 0

  for (const candidate of options.legacyRoots || []) {
    const source = path.resolve(candidate.path)
    if (source === targetRoot || migrated.has(source) || !await exists(source) || !(await stat(source)).isDirectory()) continue
    const label = safeLabel(candidate.label || path.basename(path.dirname(source)))
    const stamp = String(now())
    const backup = await uniqueBackupPath(backupRoot, stamp, label)
    await mkdir(backup, { recursive: true })
    await cp(source, path.join(backup, 'data'), { recursive: true, errorOnExist: true, force: false })
    const sourceConflicts = await mergeTree(source, targetRoot, label)
    marker.sources.push({ path: source, label, migratedAt: Number(stamp), backup, conflicts: sourceConflicts })
    await writeJsonAtomic(markerPath, marker)
    migrated.add(source)
    migratedSources += 1
    conflicts += sourceConflicts
  }

  return { targetRoot, migratedSources, conflicts, sources: marker.sources }
}
