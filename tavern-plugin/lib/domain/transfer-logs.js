import { createHash } from 'node:crypto'
import { readZipEntries, writeZipEntries } from './zip-entries.js'

const UPDATE_DIAGNOSTICS_ENTRY = 'update/diagnostics.json'
const DEDUP_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024
const DEDUP_EXPANDED_MAX_BYTES = 512 * 1024 * 1024
const DEDUP_MIN_BYTES = 1024

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function errorText(error) {
  return str(error && (error.message || error)) || '未知错误'
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function deduplicateDiagnosticsZip(buffer, fileName, seenGlobalEntries) {
  try {
    const entries = readZipEntries(buffer, {
      label: '诊断日志',
      maxArchiveBytes: DEDUP_ARCHIVE_MAX_BYTES,
      maxExpandedBytes: DEDUP_EXPANDED_MAX_BYTES
    })
    const updateBytes = entries.get(UPDATE_DIAGNOSTICS_ENTRY)
    if (!updateBytes || updateBytes.length < DEDUP_MIN_BYTES) return buffer
    const digest = sha256(updateBytes)
    const owner = seenGlobalEntries.get(UPDATE_DIAGNOSTICS_ENTRY)
    if (!owner) {
      seenGlobalEntries.set(UPDATE_DIAGNOSTICS_ENTRY, { digest, fileName })
      return buffer
    }
    if (owner.digest !== digest) return buffer
    const stub = JSON.stringify({
      version: 1,
      deduplicatedFrom: owner.fileName,
      sha256: digest,
      records: []
    }, null, 2) + '\n'
    const rewritten = []
    for (const [entryPath, content] of entries) {
      rewritten.push({
        path: entryPath,
        content: entryPath === UPDATE_DIAGNOSTICS_ENTRY ? stub : content
      })
    }
    return writeZipEntries(rewritten, {
      label: '诊断日志',
      maxArchiveBytes: DEDUP_ARCHIVE_MAX_BYTES,
      maxExpandedBytes: DEDUP_EXPANDED_MAX_BYTES
    })
  } catch {
    return buffer
  }
}

/**
 * Diagnostics are export-only: a zip of one game's session / MVU / image logs for bug reports.
 * They are never imported back — they would add no playable data.
 */
export function createTransferLogs(deps) {
  const { listSessions, exportLogs } = deps

  async function games() {
    const map = new Map()
    for (const session of await listSessions()) {
      if (!session || str(session.requestMode) === 'sillytavern') continue
      // Card workbench sessions have no game behind them, so there are no logs to bundle.
      if (str(session.mode) === 'card') continue
      const key = str(session.sessionId) || str(session.chatId)
      if (key) map.set(key, session)
    }
    return map
  }

  async function list() {
    const items = []
    for (const [key, session] of await games()) {
      items.push({ key, title: str(session.title) || str(session.cardName) || '未命名对话', meta: '诊断日志', bytes: 0 })
    }
    return items
  }

  async function collect(keys) {
    const map = await games()
    const items = []
    const seen = new Set()
    const requested = (Array.isArray(keys) ? keys : [keys]).map(k => str(k).trim()).filter(Boolean)
    const deduplicateGlobals = requested.length > 1
    const seenGlobalEntries = new Map()
    for (const value of requested) {
      if (seen.has(value)) continue
      seen.add(value)
      const session = map.get(value)
      if (!session) throw new Error('日志不存在：' + value)
      const title = str(session.title) || str(session.cardName) || '未命名对话'
      let exported
      try { exported = await exportLogs(str(session.sessionId) || str(session.chatId)) } catch (error) { throw new Error('导出「' + title + '」日志失败：' + errorText(error)) }
      const base64 = str(exported && exported.base64)
      if (!base64) throw new Error('导出「' + title + '」日志失败：日志内容为空')
      const name = str(exported && exported.filename).trim() || title + '.zip'
      const fileName = /\.zip$/i.test(name) ? name : name + '.zip'
      const rawBytes = Buffer.from(base64, 'base64')
      const content = deduplicateGlobals ? deduplicateDiagnosticsZip(rawBytes, fileName, seenGlobalEntries) : rawBytes
      items.push({ key: value, title, fileName, content })
    }
    return items
  }

  return Object.freeze({ list, collect })
}
