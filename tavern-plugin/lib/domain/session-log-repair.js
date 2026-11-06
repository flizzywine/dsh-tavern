import { access, copyFile, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseSessionLog, encodeCurrentGeneration } from './session-log-codec.js'

// DSH refuses a whole log for two kinds of damage older Tavern versions wrote, and
// the session can then never be opened again:
// - a turn/start reusing the number of a closed turn ("turn/start does not open the
//   expected turn"): a live Agent never learned its reserved opening turn. Turns are
//   renumbered in order.
// - a reply written after its step closed ("assistant/message does not match an open
//   turn and step", #247). Settlement wrote the copy just before opening the edit
//   step for its replacement: the two rows swap places. Native repair wrote whole
//   rounds after the last turn ended: that tail is dropped, it only copied the save
//   and the next reconcile writes it again.
// Neither inserts a row or moves an earlier event, so anchors into the log stay valid.
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
  let events = parsed.events.map(event => structuredClone(event))
  const renumbered = assignTurnNumbers(events)
  const placed = placeStrayReplies(events)
  if (placed === null) return refuse(healthy.reason)
  events = placed.events
  if (!renumbered && !placed.changed) return refuse(healthy.reason)
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
export async function findSessionDirectory(sessionsRoot, sessionId) {
  if (!SESSION_ID.test(sessionId)) return { ok: false, reason: '无效的会话编号' }
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

/**
 * Repair a stored log at the moment the host fails to read it. DSH reads a log only
 * when something needs its contents (history pane, resume, query), and those reads
 * report corruption asynchronously, never through the UI call that switched to the
 * session, so the repair has to sit on the persistence read itself. Each failing
 * session is repaired at most once at a time and retried once; a log the repair
 * cannot fix keeps failing with the host's original error.
 */
export function installSessionLogAutoRepair({ persistence, repair }) {
  if (typeof persistence?.open !== 'function' || typeof repair !== 'function') return () => {}
  const original = persistence.open
  const ownOpen = Object.hasOwn(persistence, 'open')
  const pending = new Map()
  const unrepairable = new Set()
  function repairOnce(id) {
    if (!pending.has(id)) {
      pending.set(id, Promise.resolve().then(() => repair(id)).then(result => Boolean(result?.repaired), () => false).finally(() => pending.delete(id)))
    }
    return pending.get(id)
  }
  const open = async function (id, access, options) {
    try {
      return await original.call(this, id, access, options)
    } catch (error) {
      if (error?.name !== 'SessionPersistenceCorruptionError' || options?.signal?.aborted || unrepairable.has(id)) throw error
      if (!await repairOnce(id)) {
        unrepairable.add(id)
        throw error
      }
      return await original.call(this, id, access, options)
    }
  }
  persistence.open = open
  return () => {
    if (persistence.open !== open) return
    if (ownOpen) persistence.open = original
    else delete persistence.open
  }
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

const NEEDS_STEP = new Set(['assistant/message', 'tool/result'])

// Seq references a stored row may carry: replacement ranges and their sources.
function remapSeqs(events, from, to) {
  const map = seq => seq === from ? to : seq === to ? from : seq
  for (const event of events) {
    const op = event.surfaceOp
    if (op && typeof op === 'object') {
      for (const key of ['startSeq', 'endSeq', 'start', 'end']) if (Number.isSafeInteger(op[key])) op[key] = map(op[key])
    }
    if (Array.isArray(event.sourceEventSeqs)) event.sourceEventSeqs = event.sourceEventSeqs.map(map)
    if (Array.isArray(event.data?.tavernRestoredSurfaceSeqs)) event.data.tavernRestoredSurfaceSeqs = event.data.tavernRestoredSurfaceSeqs.map(map)
  }
}

/** Move replies written outside an open step into place; null when one cannot be. */
function placeStrayReplies(input) {
  let events = input
  let changed = false
  let turn = null
  let step = null
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event.type === 'turn/start') { turn = event.data?.turn ?? null; step = null; continue }
    if (event.type === 'turn/end') { turn = null; step = null; continue }
    if (event.type === 'step/start') { step = event.data?.step ?? null; continue }
    if (event.type === 'step/end') { step = null; continue }
    if (!NEEDS_STEP.has(event.type)) continue
    if (turn !== null && step !== null) {
      if (event.data?.turn !== turn || event.data?.step !== step) { event.data = { ...event.data, turn, step }; changed = true }
      continue
    }
    const next = events[index + 1]
    if (turn !== null && next?.type === 'step/start' && next.data?.turn === turn) {
      // The reply belongs to the step opened right after it: swap the two rows.
      const [reply, opening] = [event.seq, next.seq]
      events[index] = { ...next, seq: reply }
      events[index + 1] = { ...event, seq: opening, data: { ...event.data, turn, step: next.data.step } }
      remapSeqs(events, reply, opening)
      changed = true
      index -= 1
      continue
    }
    if (events.slice(index + 1).some(row => row.type === 'turn/start')) return null
    // Rounds written after the last turn ended: keep the log up to that turn's end.
    const lastEnd = events.findLastIndex((row, position) => position < index && row.type === 'turn/end')
    if (lastEnd < 0) return null
    events = events.slice(0, lastEnd + 1)
    return { events, changed: true }
  }
  return { events, changed }
}

function refuse(reason) {
  return { ok: false, changed: false, written: false, reason }
}

