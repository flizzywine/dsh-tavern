// A Tavern branch is a forked conversation, not a delegated subagent.
// The host's own fork writes `parentSession` + `isSeeded` and no `origin`; the page
// then reads the branch's history like any other Session and keeps the game's
// composer. Branches forked by older Tavern versions carried `origin: "subagent"`
// without the `subagent/descriptor` that marker now requires, so DSH 0.2.1 answers
// every history read with "subagent descriptor is corrupt" and replaces the game's
// composer with its read-only subagent seat. The stale marker is dropped here; a
// session that really was delegated keeps its descriptor and is left untouched.
import { matchesEventType } from './session-events.js'
import { access, copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { parseSessionLog, encodeCurrentGeneration } from './session-log-codec.js'

function refuse(reason) {
  return { ok: false, changed: false, reason: reason || '未知原因' }
}

/**
 * Decide whether one stored branch log still carries the stale subagent marker.
 * @param buffer - current-generation session log bytes.
 * @param catalog - host session format catalog.
 * @returns `{ ok, changed, bytes?, reason }`; bytes only when the header changed.
 */
export function withoutBranchSubagentOrigin(buffer, catalog) {
  if (typeof catalog?.createRestore !== 'function' || typeof catalog?.encodeCurrentHeader !== 'function') {
    return refuse('宿主会话格式目录不可用')
  }
  let parsed
  try { parsed = parseSessionLog(buffer) } catch (error) { return refuse(error.message || String(error)) }
  const header = parsed.header
  if (header?.version !== catalog.currentVersion) return refuse('不是当前版本会话日志')
  if (header.origin !== 'subagent') return { ok: true, changed: false, reason: '不是按子智能体记录的会话' }
  // The host delegated this session: its descriptor is the record both sides rely on.
  if (parsed.events.some(event => matchesEventType(event, 'subagent/descriptor'))) {
    return { ok: true, changed: false, reason: '会话带子智能体描述，保持原样' }
  }
  return rewriteParsedLog(parsed, catalog, artifact => {
    const { origin: _stale, ...restored } = artifact.header
    return { ...artifact, header: restored }
  }, '已把分支恢复成普通分叉会话')
}

/**
 * Re-encode one parsed current-generation log with `edit` applied to its strictly
 * restored artifact. The rewritten generation must open exactly like the one it replaces.
 * @returns `{ ok, changed, bytes?, reason }` like {@link withoutBranchSubagentOrigin}.
 */
export function rewriteParsedLog(parsed, catalog, edit, reason) {
  let artifact
  try {
    const restore = catalog.createRestore(parsed.header, { recovery: 'strict', validation: 'current' })
    // One row at a time: never hold two copies of a whole log.
    for (const event of parsed.events) restore.decodeRow(structuredClone(event))
    artifact = restore.finish()
  } catch (error) {
    return refuse(error.message || String(error))
  }
  let bytes
  try {
    bytes = encodeCurrentGeneration(edit(artifact), catalog)
  } catch (error) {
    return refuse(error.message || String(error))
  }
  try {
    const verify = parseSessionLog(bytes)
    const restore = catalog.createRestore(verify.header, { recovery: 'strict', validation: 'current' })
    for (const event of verify.events) restore.decodeRow(structuredClone(event))
    restore.finish()
  } catch (error) {
    return refuse('改写后无法读回：' + (error.message || String(error)))
  }
  return { ok: true, changed: true, bytes, reason }
}

/**
 * Rewrite one stored log with `decide(bytes)`'s result. A healthy log is never
 * touched, and the original generation is kept beside it.
 */
export async function rewriteStoredLog(file, decide, label = 'tavern-branch-origin') {
  let original
  try { original = await readFile(file) }
  catch (error) { return { ...refuse(error.message || String(error)), written: false } }
  const decided = decide(original)
  if (!decided.ok || !decided.changed) return { ...decided, written: false, file }
  const backup = file + '.bak-' + label
  try { await access(backup) } catch { await copyFile(file, backup) }
  const temporary = file + '.tmp-' + label
  await writeFile(temporary, decided.bytes)
  await rename(temporary, file)
  return { ...decided, written: true, backup, file }
}

/** Rewrite one stored branch log without the stale marker. */
export function repairBranchOriginFile(file, catalog) {
  return rewriteStoredLog(file, bytes => withoutBranchSubagentOrigin(bytes, catalog))
}
