function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function errorText(error) {
  return str(error && (error.message || error)) || '未知错误'
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
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const value = str(key).trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      const session = map.get(value)
      if (!session) throw new Error('日志不存在：' + value)
      const title = str(session.title) || str(session.cardName) || '未命名对话'
      let exported
      try { exported = await exportLogs(str(session.sessionId) || str(session.chatId)) } catch (error) { throw new Error('导出「' + title + '」日志失败：' + errorText(error)) }
      const base64 = str(exported && exported.base64)
      if (!base64) throw new Error('导出「' + title + '」日志失败：日志内容为空')
      const name = str(exported && exported.filename).trim() || title + '.zip'
      items.push({ key: value, title, fileName: /\.zip$/i.test(name) ? name : name + '.zip', content: Buffer.from(base64, 'base64') })
    }
    return items
  }

  return Object.freeze({ list, collect })
}
