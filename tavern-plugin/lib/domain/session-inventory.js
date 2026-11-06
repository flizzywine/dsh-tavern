import { stat } from 'node:fs/promises'

// Observational only: never resume, inspect/load logs, or materialize Chat histories.
export function createSessionInventory({ persistence, sessions, agents, references, archived, fileStat = stat, memory = () => process.memoryUsage(), now = Date.now }) {
  let inFlight
  async function collect() {
    const [headers, links] = await Promise.all([persistence.list(), references()])
    const currentBindings = new Map(links.map(link => [link.chatId, link.backgroundSessionId]))
    const historyBindings = new Map(links.map(link => [link.chatId, new Set(link.backgroundHistoryIds || [])]))
    const storedIds = new Set(headers.map(header => header.id))
    const bySession = new Map()
    for (const link of links) {
      const refs = bySession.get(link.sessionId) || []
      refs.push({ chatId: link.chatId, title: link.title || link.cardName, lastOpenedAt: link.lastOpenedAt || null, relation: 'direct' })
      bySession.set(link.sessionId, refs)
    }
    const live = new Map((sessions.list?.() || []).map(session => [session.id, session]))
    const metas = new Map(headers.map(header => [header.id, header]))
    for (const [id, session] of live) if (!metas.has(id)) metas.set(id, session.header || { id })
    for (const link of links) if (!metas.has(link.sessionId)) metas.set(link.sessionId, { id: link.sessionId })
    // Resolve the nearest linked ancestor from headers only. Cache each traversed
    // path, and terminate missing parents/cycles without loading their histories.
    const inherited = new Map()
    function related(id) {
      if (bySession.has(id)) return bySession.get(id)
      if (inherited.has(id)) return inherited.get(id)
      const path = [], seen = new Set()
      let current = id, refs = []
      while (current && !seen.has(current)) {
        if (bySession.has(current)) {
          refs = bySession.get(current).map(ref => ({ ...ref, relation: 'ancestor', viaSessionId: current }))
          break
        }
        if (inherited.has(current)) { refs = inherited.get(current); break }
        seen.add(current); path.push(current)
        const parent = metas.get(current)?.parentSession
        current = typeof parent === 'string' ? parent : ''
      }
      for (const item of path) inherited.set(item, refs)
      return refs
    }
    const archiveList = archived?.()
    const archivedIds = archiveList ? new Set(archiveList) : null
    const rows = []
    for (const [id, meta] of metas) {
      const agent = agents.get(id)
      const session = live.get(id) || sessions.get(id) || agent?.session
      const refs = related(id)
      let diskBytes = null, fileModifiedAt = null, storageError = null
      if (storedIds.has(id)) {
        try {
          const artifact = persistence.locate?.(meta)
          if (artifact?.path) {
            const info = await fileStat(artifact.path)
            diskBytes = info.size
            fileModifiedAt = info.mtimeMs
          }
        } catch (error) { storageError = error.code === 'ENOENT' ? '文件已不存在' : '文件属性读取失败' }
      }
      const isBackground = meta.agentPreset === 'tavern-background' || refs.some(ref => currentBindings.get(ref.chatId) === id || historyBindings.get(ref.chatId)?.has(id))
      const backgroundState = !isBackground ? null : refs.some(ref => currentBindings.get(ref.chatId) === id) ? 'current'
        : refs.length && refs.every(ref => typeof currentBindings.get(ref.chatId) === 'string') && refs.some(ref => historyBindings.get(ref.chatId)?.has(id)) ? (agent?.phase?.kind === 'running' ? 'transitioning' : 'historical') : 'unknown'
      rows.push({ backgroundState, sessionId: id, parentSessionId: typeof meta.parentSession === 'string' ? meta.parentSession : null, loaded: Boolean(session), running: agent?.phase?.kind === 'running',
        archived: archivedIds ? archivedIds.has(id) : null, eventCount: Number.isSafeInteger(session?.seq) ? session.seq : null,
        diskBytes, fileModifiedAt, references: refs, storageError })
    }
    rows.sort((a, b) => Number(b.loaded) - Number(a.loaded) || (b.diskBytes || 0) - (a.diskBytes || 0) || a.sessionId.localeCompare(b.sessionId))
    const usage = memory()
    return { capturedAt: now(), rows, memory: { rss: usage.rss, heapUsed: usage.heapUsed },
      totals: { sessions: rows.length, loaded: rows.filter(row => row.loaded).length, archived: rows.filter(row => row.archived).length,
        knownDiskBytes: rows.reduce((sum, row) => sum + (row.diskBytes || 0), 0), unknownDiskSize: rows.filter(row => row.diskBytes === null).length } }
  }
  return { read() {
    if (!inFlight) inFlight = collect().finally(() => { inFlight = null })
    return inFlight
  } }
}
