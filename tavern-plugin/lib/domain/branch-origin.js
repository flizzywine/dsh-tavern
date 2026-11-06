// A Tavern branch is a forked conversation, not a delegated subagent.
// The host's own fork writes `parentSession` + `isSeeded` and no `origin`; the page
// then reads the branch's history like any other Session and keeps the game's
// composer. Branches forked by older Tavern versions carried `origin: "subagent"`
// without the `subagent/descriptor` that marker now requires, so DSH 0.2.1 answers
// every history read with "subagent descriptor is corrupt" and replaces the game's
// composer with its read-only subagent seat. The stale marker is dropped here; a
// session that really was delegated keeps its descriptor and is left untouched.
import { access, copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { parseSessionLog, encodeCurrentGeneration } from './session-log-codec.js'

const BACKUP_SUFFIX = '.bak-tavern-branch-origin'

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
  if (parsed.events.some(event => event?.type === 'subagent/descriptor')) {
    return { ok: true, changed: false, reason: '会话带子智能体描述，保持原样' }
  }
  let artifact
  try {
    const restore = catalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    // One row at a time: never hold two copies of a whole log.
    for (const event of parsed.events) restore.decodeRow(structuredClone(event))
    artifact = restore.finish()
  } catch (error) {
    return refuse(error.message || String(error))
  }
  const { origin: _stale, ...restored } = artifact.header
  let bytes
  try {
    bytes = encodeCurrentGeneration({ ...artifact, header: restored }, catalog)
  } catch (error) {
    return refuse(error.message || String(error))
  }
  // The rewritten generation must open exactly like the one it replaces.
  try {
    const verify = parseSessionLog(bytes)
    if (Object.hasOwn(verify.header, 'origin')) throw new Error('头部仍带子智能体标记')
    const restore = catalog.createRestore(verify.header, { recovery: 'strict', validation: 'current' })
    for (const event of verify.events) restore.decodeRow(structuredClone(event))
    restore.finish()
  } catch (error) {
    return refuse('改写后无法读回：' + (error.message || String(error)))
  }
  return { ok: true, changed: true, bytes, reason: '已把分支恢复成普通分叉会话' }
}

/**
 * Rewrite one stored branch log without the stale marker. A healthy log is never
 * touched, and the original generation is kept beside it.
 */
export async function repairBranchOriginFile(file, catalog) {
  let original
  try { original = await readFile(file) }
  catch (error) { return { ...refuse(error.message || String(error)), written: false } }
  const decided = withoutBranchSubagentOrigin(original, catalog)
  if (!decided.ok || !decided.changed) return { ...decided, written: false, file }
  const backup = file + BACKUP_SUFFIX
  try { await access(backup) } catch { await copyFile(file, backup) }
  const temporary = file + '.tmp-tavern-branch-origin'
  await writeFile(temporary, decided.bytes)
  await rename(temporary, file)
  return { ...decided, written: true, backup, file }
}
