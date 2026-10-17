import { access, copyFile, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseSessionLog, encodeCurrentGeneration } from './session-log-codec.js'

// DSH refuses a whole log when a turn/start reuses the number of an already closed
// turn ("turn/start does not open the expected turn"), so the card history row can
// never be opened again. A live Agent that never learned its reserved opening turn
// numbered its next turn that way. Renumbering the turns in order repairs exactly
// that and leaves every other byte of the log alone.
const TURN_REPAIR_SUFFIX = '.bak-tavern-turnrepair'
const SESSION_ID = /^[a-zA-Z0-9_-]+$/

function openCurrentSession(catalog, header, events) {
  try {
    const restore = catalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    // One row at a time: validation must never hold two copies of a whole log.
    for (const event of events) restore.decodeRow(structuredClone(event))
    return { ok: true, artifact: restore.finish() }
  } catch (error) {
    return { ok: false, reason: error.message || String(error) }
  }
}

/**
 * Repair a current-format log the host can no longer open. changed: false means the
 * log already opens and was left alone.
 */
export function repairCurrentSessionBuffer(buffer, catalog) {
  const version = catalog?.currentVersion
  if (typeof version !== 'number') return refuse('宿主会话格式目录不可用')
  let parsed
  try { parsed = parseSessionLog(buffer) } catch (error) { return refuse(error.message || String(error)) }
  if (parsed.header?.version !== version) return refuse('不是当前版本会话日志')
  const healthy = openCurrentSession(catalog, parsed.header, parsed.events)
  if (healthy.ok) return { ok: true, changed: false, artifact: healthy.artifact, reason: '会话日志可以打开' }
  const events = parsed.events.map(event => structuredClone(event))
  if (!assignTurnNumbers(events)) return refuse(healthy.reason)
  const repaired = openCurrentSession(catalog, parsed.header, events)
  if (!repaired.ok) return refuse(repaired.reason)
  return { ok: true, changed: true, artifact: repaired.artifact, reason: healthy.reason }
}

export async function repairCurrentSessionFile(file, catalog) {
  let original
  try { original = await readFile(file) }
  catch (error) { return { ...refuse(error.message || String(error)), written: false } }
  const repaired = repairCurrentSessionBuffer(original, catalog)
  if (!repaired.ok || !repaired.changed) return { ...repaired, written: false }
  const backup = file + TURN_REPAIR_SUFFIX
  try { await access(backup) } catch { await copyFile(file, backup) }
  const temporary = file + '.tmp-tavern-turnrepair'
  await writeFile(temporary, encodeCurrentGeneration(repaired.artifact, catalog))
  await rename(temporary, file)
  return { ok: true, changed: true, written: true, backup, reason: repaired.reason }
}

/**
 * Find one native session directory by session id. The id is the directory name;
 * the project directory above it is derived from the session working directory and
 * differs between installs, so every project is searched.
 */
async function findSessionDirectory(sessionsRoot, sessionId) {
  let projects
  try { projects = await readdir(sessionsRoot, { withFileTypes: true }) }
  catch (error) { return { ok: false, reason: error.code === 'ENOENT' ? '没有会话存档目录' : (error.message || String(error)) } }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const directory = path.join(sessionsRoot, project.name, sessionId)
    try {
      if ((await stat(directory)).isDirectory()) return { ok: true, path: directory }
    } catch { /* another project directory holds it */ }
  }
  return { ok: false, reason: '找不到会话目录' }
}

/**
 * Repair the stored log of one session the host could not open. Only a log that is
 * currently invalid is rewritten; anything else is reported and left alone.
 */
export async function repairStoredSessionLog(dataRoot, sessionId, loadCatalog) {
  const id = typeof sessionId === 'string' ? sessionId : ''
  if (!SESSION_ID.test(id)) return { ok: false, repaired: false, reason: '无效的会话编号' }
  let catalog
  try {
    catalog = await loadCatalog()
    if (!catalog?.createRestore) throw new Error('宿主会话格式目录不可用')
  } catch (error) {
    return { ok: false, repaired: false, reason: error.message || String(error) }
  }
  const found = await findSessionDirectory(path.join(path.dirname(dataRoot), 'sessions'), id)
  if (!found.ok) return { ok: false, repaired: false, reason: found.reason }
  const file = path.join(found.path, `session.v${catalog.currentVersion}.jsonl.zstd`)
  const result = await repairCurrentSessionFile(file, catalog)
  if (!result.ok) console.warn(`dsh-tavern: 会话日志修复失败 ${id}：${result.reason || '未知原因'}`)
  return { ok: result.ok, repaired: Boolean(result.ok && result.changed), reason: result.reason, file }
}

function assignTurnNumbers(events) {
  let next = 1
  let changed = false
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].type !== 'turn/start') continue
    const assigned = next
    next += 1
    let depth = 0
    for (let cursor = index; cursor < events.length; cursor += 1) {
      const event = events[cursor]
      if (event.type === 'turn/start') depth += 1
      if (event.data && Object.hasOwn(event.data, 'turn') && event.data.turn !== assigned) {
        event.data.turn = assigned
        changed = true
      }
      if (event.type === 'turn/end') {
        depth -= 1
        if (depth === 0) break
      }
    }
  }
  return changed
}

function refuse(reason) {
  return { ok: false, changed: false, written: false, reason }
}

