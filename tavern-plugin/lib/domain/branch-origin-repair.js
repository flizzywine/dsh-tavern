// Repair the branch logs an older Tavern forked with a subagent marker
// (branch-origin.js explains the marker). Runs once per Session before the page
// reads it, and once over the whole install on startup while nothing is loaded.
import path from 'node:path'
import { repairBranchOriginFile } from './branch-origin.js'
import { findSessionDirectory } from './session-log-repair.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/**
 * Build the branch-marker repair for one Tavern install.
 * @param options.dataRoot - Tavern data root; its sibling `sessions` directory holds the logs.
 * @param options.loadCatalog - resolves the host session format catalog.
 * @param options.isLive - whether the host still holds that Session (never rewrite one).
 * @param options.ownsChat - whether the Session is one of Tavern's own conversations.
 * @param options.listSessions - optional host Session listing for the startup sweep.
 * @param options.logger - logger for the one line a successful pass prints.
 * @returns `{ ensure, sweep }`: `ensure` repairs one Session once per process.
 */
export function createBranchOriginRepair({ dataRoot, loadCatalog, isLive = () => false, ownsChat, listSessions, logger = console } = {}) {
  const done = new Set()
  const running = new Map()

  async function repair(id) {
    // A loaded Session keeps its own log open; its header is fixed for the process.
    // Answer without remembering: the next open, once the host let go, can still fix it.
    if (isLive(id)) return { ok: true, changed: false, retry: true, reason: '会话仍在运行，下次打开时处理' }
    // Another plugin's delegated child is none of Tavern's business.
    if (typeof ownsChat === 'function' && !(await ownsChat(id))) return { ok: true, changed: false, reason: '不是酒馆对话' }
    let catalog
    try {
      catalog = await loadCatalog()
      if (typeof catalog?.createRestore !== 'function') throw new Error('宿主会话格式目录不可用')
    } catch (error) {
      return { ok: false, changed: false, reason: error?.message || String(error) }
    }
    const found = await findSessionDirectory(path.join(path.dirname(dataRoot), 'sessions'), id)
    if (!found.ok) return { ok: false, changed: false, reason: found.reason }
    const file = path.join(found.path, `session.v${catalog.currentVersion}.jsonl.zstd`)
    const result = await repairBranchOriginFile(file, catalog)
    // The pass that repairs many branches reports one line of its own (sweep).
    if (!result.ok) logger.warn?.(`dsh-tavern: 分支 ${id} 的会话头部无法检查：${result.reason}`)
    return result
  }

  /** Repair one Session at most once per process; concurrent callers share the work. */
  function ensure(sessionId) {
    const id = str(sessionId)
    if (!id || done.has(id)) return Promise.resolve({ ok: true, changed: false, reason: '已检查' })
    if (running.has(id)) return running.get(id)
    const task = Promise.resolve().then(() => repair(id))
      .then(result => { if (!result.retry) done.add(id); return result })
      .catch(error => ({ ok: false, changed: false, reason: error?.message || String(error) }))
      .finally(() => { running.delete(id) })
    running.set(id, task)
    return task
  }

  /** Check every child Session the host still lists as a subagent (startup pass). */
  async function sweep() {
    if (typeof listSessions !== 'function') return { checked: 0, changed: 0 }
    let records
    try { records = await listSessions() } catch { return { checked: 0, changed: 0 } }
    let checked = 0, changed = 0
    for (const record of Array.isArray(records) ? records : []) {
      const header = record?.header
      if (!header?.parentSession || header.origin !== 'subagent') continue
      checked++
      const result = await ensure(header.id)
      if (result.changed) changed++
    }
    if (changed) logger.warn?.(`dsh-tavern: 已修复 ${changed} 个旧分支会话的头部标记（共检查 ${checked} 个子会话）`)
    return { checked, changed }
  }

  return { ensure, sweep }
}
