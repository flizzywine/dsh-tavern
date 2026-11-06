// Only native tool events are evidence of loading/reading, never prose adoption.
export function worldbookReadHistory(events, directory, skillNames = [], inlineEntries = []) {
  const calls = new Map()
  for (const event of events || []) {
    const d = event.data || {}
    if (event.type === 'tool/call') {
      let args
      try { args = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : d.arguments } catch { continue }
      const navigation = ['worldbook_list', 'worldbook_grep'].includes(d.name)
      const target = navigation ? (args?.query || '世界书文件列表') : d.name === 'skill' ? args?.name : d.name === 'read' ? args?.file_path : null
      const normalized = typeof target === 'string' ? target.replaceAll('\\', '/') : ''
      const physical = directory && normalized.startsWith(directory.replaceAll('\\', '/') + '/')
      if (typeof target !== 'string' || !(navigation || d.name === 'skill' ? true : target.startsWith('/__tavern_worldbook__/') || physical)) continue
      calls.set(d.callId, { id: d.callId, seq: event.seq, turn: d.turn, step: d.step, kind: d.name, target, reference: (physical && !normalized.includes('/references/') || /\/(?:entries|references)\//.test(normalized)) && !normalized.endsWith('/references/资料目录.md'), offset: args.offset, limit: args.limit, status: 'pending' })
    } else if (event.type === 'tool/result' && calls.has(d.message?.toolCallId)) {
      const item = calls.get(d.message.toolCallId)
      item.status = d.message.isError ? 'error' : 'success'
      item.result = (d.message.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n')
      if (!item.result && d.meta?.lines) item.result += '\n' + d.meta.lines.map(l => `${l.number}: ${l.text}`).join('\n')
      item.inlineRefs = item.kind === 'skill' ? inlineEntries.filter(entry => entry.inlineText && item.result.includes(entry.inlineText)).map(entry => entry.ref) : []
      if (item.result.length > 60000) item.result = item.result.slice(0, 60000) + '\n[排查面板显示已截断]'
      item.totalLines = d.meta?.totalLines
    }
  }
  return [...calls.values()].filter(r => r.kind !== 'skill' || r.target.startsWith('wb-') || skillNames.includes(r.target) || (directory && r.result?.includes(directory))).reverse()
}

export function createWorldbookInspectorHandlers({ agentRegistry, chatForSession, worldbookSkillProvider, sessionDebugEvidence }) {
  async function scope(args) {
    const id = String(args?.sessionId || '')
    const chat = id && await chatForSession(id)
    if (!chat || chat.sessionId !== id) throw Error('请先打开一个游玩对局')
    const agent = agentRegistry.get(id)
    if (!agent) throw Error('本局尚未加载，请先打开对话后刷新')
    return agent
  }
  return {
    async inspectWorldbookSkills(args) {
      const agent = await scope(args)
      const catalog = await worldbookSkillProvider.inspect({ scope: agent })
      const evidence = sessionDebugEvidence(agent.session.id)
      const records = worldbookReadHistory(evidence.events, worldbookSkillProvider.directory, (catalog?.clusters || []).map(c => c.name), (catalog?.clusters || []).flatMap(c => c.entries))
      const labels = new Map()
      for (const entry of catalog?.files || []) {
        entry.readCount = records.filter(r => r.target === entry.path && r.status === 'success').length
        labels.set(entry.path, entry.title)
      }
      for (const cluster of catalog?.clusters || []) {
        cluster.readCount = records.filter(r => [cluster.name, cluster.legacyName].includes(r.target) && r.status === 'success').length
        labels.set(cluster.name, cluster.title)
        if (cluster.legacyName) labels.set(cluster.legacyName, cluster.title)
        for (const entry of cluster.entries) {
          entry.readCount = records.filter(r => [entry.referencePath || entry.path, entry.previousIdPath, entry.previousRootPath, entry.previousPath, entry.previousShortPath, entry.legacyPath].includes(r.target) && r.status === 'success').length
          entry.inlineReadCount = records.filter(r => r.status === 'success' && r.inlineRefs?.includes(entry.ref)).length
          delete entry.inlineText
          if (!entry.inline) labels.set(entry.path, entry.title)
          if (entry.previousRootPath) labels.set(entry.previousRootPath, entry.title)
          if (entry.previousShortPath) labels.set(entry.previousShortPath, entry.title)
          if (entry.previousPath) labels.set(entry.previousPath, entry.title)
          if (entry.legacyPath) labels.set(entry.legacyPath, entry.title)
        }
      }
      for (const record of records) record.title = labels.get(record.target) || record.target
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0))
      return { catalog, historyLoaded: evidence.loaded, total: records.length, offset,
        counts: { skills: records.filter(r => r.kind === 'skill' && r.status === 'success').length,
          inlineEntries: records.filter(r => r.status === 'success').reduce((n, r) => n + (r.inlineRefs?.length || 0), 0),
          entries: records.filter(r => r.kind === 'read' && r.reference && r.status === 'success').length,
          errors: records.filter(r => r.status === 'error').length },
        records: records.slice(offset, offset + 40) }
    },
    async readWorldbookSkillSource(args) {
      const agent = await scope(args)
      const content = args.ref !== undefined
        ? await worldbookSkillProvider.readEntry(String(args.ref), { scope: agent })
        : await worldbookSkillProvider.readResource(String(args.path || ''), { scope: agent })
      if (content === undefined) throw Error('此条目已变更、停用，或不属于本局，请刷新目录')
      return { content }
    }
  }
}
