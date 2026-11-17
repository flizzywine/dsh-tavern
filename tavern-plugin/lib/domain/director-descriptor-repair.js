// Stage-director children written between the director's parallel-task release and this
// repair published a one-shot descriptor with a `persona` field. The host's parser allows
// only version, mode, provider and label on a one-shot descriptor, so it reads those
// children as having no identity and their page fails with "subagent descriptor is
// corrupt". The stored descriptor is replaced by the current one (background-descriptors.js);
// nothing else in the log changes. Runs once over the install on startup.
import path from 'node:path'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { STAGE_DIRECTOR_DESCRIPTOR, STAGE_DIRECTOR_PROVIDER } from './background-descriptors.js'
import { rewriteParsedLog, rewriteStoredLog } from './branch-origin.js'
import { matchesEventType } from './session-events.js'
import { parseSessionLog } from './session-log-codec.js'
import { findSessionDirectory } from './session-log-repair.js'

function unreadableDirectorDescriptor(event) {
  if (!matchesEventType(event, 'subagent/descriptor') || event.data?.provider !== STAGE_DIRECTOR_PROVIDER) return false
  try { foldSubagentDescriptor([{ type: 'subagent/descriptor', data: event.data }]) } catch { return true }
  return false
}

/**
 * Decide whether one stored log carries a stage-director descriptor the host rejects.
 * @returns `{ ok, changed, bytes?, reason }`; bytes only when the descriptor changed.
 */
export function withReadableDirectorDescriptor(buffer, catalog) {
  let parsed
  try { parsed = parseSessionLog(buffer) } catch (error) { return { ok: false, changed: false, reason: error.message || String(error) } }
  if (parsed.header?.version !== catalog.currentVersion) return { ok: false, changed: false, reason: '不是当前版本会话日志' }
  if (!parsed.events.some(unreadableDirectorDescriptor)) return { ok: true, changed: false, reason: '舞台导演描述可读' }
  return rewriteParsedLog(parsed, catalog, artifact => ({
    ...artifact,
    events: artifact.events.map(event => unreadableDirectorDescriptor(event) ? { ...event, data: STAGE_DIRECTOR_DESCRIPTOR } : event)
  }), '已修好舞台导演的子智能体描述')
}

/**
 * Build the startup repair for one Tavern install.
 * @param options.dataRoot - Tavern data root; its sibling `sessions` directory holds the logs.
 * @param options.loadCatalog - resolves the host session format catalog.
 * @param options.listSessions - host Session listing.
 * @param options.hostIdentity - the host's cached `subagent` identity for a header
 *   (`null` when the host could not read one, `undefined` when it has no cached view).
 * @param options.forgetProjections - drops the host's cached projections for a Session,
 *   so its next read folds the repaired descriptor instead of the cached empty identity.
 * @param options.isLive - whether the host still holds that Session (never rewrite one).
 */
export function createDirectorDescriptorRepair({ dataRoot, loadCatalog, listSessions, hostIdentity, forgetProjections, isLive = () => false, logger = console }) {
  async function sweep() {
    const records = await listSessions()
    // Only children the host itself already reads as having no identity are opened.
    const candidates = records.map(record => record?.header)
      .filter(header => header?.origin === 'subagent' && !isLive(header.id) && hostIdentity(header) === null)
    if (!candidates.length) return { checked: 0, changed: 0 }
    const catalog = await loadCatalog()
    const sessionsRoot = path.join(path.dirname(dataRoot), 'sessions')
    let changed = 0
    for (const header of candidates) {
      const found = await findSessionDirectory(sessionsRoot, header.id)
      if (!found.ok) continue
      const file = path.join(found.path, `session.v${catalog.currentVersion}.jsonl.zstd`)
      const result = await rewriteStoredLog(file, bytes => withReadableDirectorDescriptor(bytes, catalog), 'tavern-director-descriptor')
      if (!result.ok) logger.warn?.(`dsh-tavern: 舞台导演会话 ${header.id} 无法检查：${result.reason}`)
      if (!result.written) continue
      await forgetProjections(header.id)
      changed++
    }
    if (changed) logger.warn?.(`dsh-tavern: 已修好 ${changed} 个舞台导演会话的子智能体描述（共检查 ${candidates.length} 个）`)
    return { checked: candidates.length, changed }
  }
  return { sweep }
}
