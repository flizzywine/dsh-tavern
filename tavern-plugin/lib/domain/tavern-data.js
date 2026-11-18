import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createProfileDataStore, TAVERN_SETTINGS_PATH } from '../profile-data-store.js'

const MIGRATION_MARKER = '.legacy-data-migration-v1.json'
const MERGED_JSON_FILES = ['index.json', 'sessions.json', '.material-bindings.json', '.file-resources-v1.json', TAVERN_SETTINGS_PATH]
const MANAGED_JSON_FILES = [...MERGED_JSON_FILES, MIGRATION_MARKER]

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

async function mergeJson(sourceData, targetData, relative) {
  const incoming = await sourceData.readJson(relative)
  await targetData.updateJson(relative, current => {
    if (relative === 'index.json') return mergeIndex(current, incoming)
    if (relative === '.file-resources-v1.json' || relative === TAVERN_SETTINGS_PATH) {
      const merged = mergeDeep(current, incoming)
      return merged === undefined ? {} : merged
    }
    return { ...incoming, ...current }
  })
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

async function mergeTree(sourceRoot, targetRoot, label) {
  let conflicts = 0
  async function visit(relative) {
    for (const entry of await readdir(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (relative === '' && (entry.name === 'migration-conflicts' || MANAGED_JSON_FILES.some(file =>
        entry.name === file || entry.name === file + '.write-lock' || entry.name.startsWith(file + '.pending-')))) continue
      const source = path.join(sourceRoot, child)
      const target = path.join(targetRoot, child)
      if (entry.isDirectory()) {
        await mkdir(target, { recursive: true })
        await visit(child)
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
  }
  await visit('')
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
  const targetData = createProfileDataStore({ dataRoot: targetRoot })
  const previousMarker = await targetData.readJson(MIGRATION_MARKER)
  const marker = previousMarker === undefined ? { schemaVersion: 1, sources: [] } : previousMarker
  const migrated = new Set((Array.isArray(marker.sources) ? marker.sources : []).map((item) => path.resolve(item.path)))
  let migratedSources = 0
  let conflicts = 0
  let backup
  const originalFiles = new Set()
  for (const name of MANAGED_JSON_FILES) if (await targetData.version(name)) originalFiles.add(name)

  async function backUpOriginal(name) {
    if (!originalFiles.has(name)) return
    const bytes = await targetData.readBytes(name)
    if (bytes !== undefined) {
      const directory = path.join(backup, 'data')
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, name), bytes, { flag: 'wx', flush: true })
    }
    originalFiles.delete(name)
  }

  for (const candidate of options.legacyRoots || []) {
    const source = path.resolve(candidate.path)
    if (source === targetRoot || migrated.has(source) || !await exists(source) || !(await stat(source)).isDirectory()) continue
    const label = safeLabel(candidate.label || path.basename(path.dirname(source)))
    const stamp = String(now())
    if(!backup) {
      backup = await uniqueBackupPath(backupRoot, stamp, 'legacy-data')
      await mkdir(backup, { recursive: true })
    }
    const sourceData = createProfileDataStore({ dataRoot: source })
    await backUpOriginal(MIGRATION_MARKER)
    for (const name of MERGED_JSON_FILES) {
      if (!await sourceData.version(name)) continue
      await backUpOriginal(name)
      await mergeJson(sourceData, targetData, name)
    }
    const sourceConflicts = await mergeTree(source, targetRoot, label)
    marker.sources.push({ path: source, label, migratedAt: Number(stamp), backup, conflicts: sourceConflicts })
    await targetData.writeJson(MIGRATION_MARKER, marker)
    migrated.add(source)
    migratedSources += 1
    conflicts += sourceConflicts
  }

  return { targetRoot, migratedSources, conflicts, sources: marker.sources }
}
