export const name = 'dsh-tavern-style-recall'
export const inject = ['tavern']

function formatReference(excerpt) {
  if (!excerpt?.trim()) return ''
  return '<文风参考>\n模仿以下文风。\n\n' + excerpt + '\n</文风参考>'
}

function styleSettings(value) {
  const source = typeof value?.source === 'string' ? value.source : ''
  // A saved model mode must never opt the player into novel excerpts on upgrade.
  return {
    source,
    enabled: Boolean(source) && value?.enabled === true && (value.mode === undefined || value.mode === 'novel')
  }
}

export function apply(ctx) {
  if (ctx.tavern.capabilities?.scriptLibrary !== 1) return
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  let enabledLifetime = new AbortController()
  let writes = Promise.resolve()
  const readSettings = async () => styleSettings((await ctx.tavern.readPluginData())?.settings)
  ctx.tavern.handle(name + '/settings', async () => {
    const [sources, settings] = await Promise.all([ctx.tavern.listScriptSources(), writes.then(readSettings)])
    return { sources, settings }
  })

  // Both settings entry points update the same document.
  ctx.tavern.handle(name + '/save', patch => {
    const save = writes.then(async () => {
      const data = await ctx.tavern.readPluginData()
      const current = styleSettings(data?.settings)
      const { source = current.source, enabled = current.enabled, mode } = patch
      if (typeof source !== 'string' || typeof enabled !== 'boolean') throw new TypeError('请选择参考小说并设置文风参考开关')
      if (mode !== undefined && mode !== 'novel') throw new Error('文风参考只支持从剧本库选段')
      if (source && (enabled || source !== current.source)) {
        const sources = await ctx.tavern.listScriptSources()
        if (!sources.some(item => item.path === source)) throw new Error('剧本库里已找不到这本小说')
      }
      const settings = { source, enabled: enabled && Boolean(source) }
      await ctx.tavern.savePluginData({ data: { ...data, settings } })
      if (current.enabled && !settings.enabled) {
        enabledLifetime.abort()
        enabledLifetime = new AbortController()
      }
      return settings
    })
    writes = save.catch(() => {})
    return save
  })

  ctx.tavern.turnSection({ name: 'style-reference', writingReference: true, async text({ gameId, turn, storyTurn = turn, input, signal }) {
    await writes
    const turnSignal = AbortSignal.any([lifetime.signal, enabledLifetime.signal, ...(signal ? [signal] : [])])
    if (turnSignal.aborted) return ''
    const settings = await readSettings()
    if (!settings.enabled || turnSignal.aborted) return ''
    const previous = storyTurn > 1
      ? await ctx.tavern.getHistory({ gameId, from: Math.max(1, storyTurn - 12), to: storyTurn - 1 })
      : []
    if (turnSignal.aborted) return ''
    const query = [input.slice(0, 1200), (previous.at(-1)?.text || '').slice(-800)].join('\n').slice(0, 2000)
    const book = await ctx.tavern.searchScriptSource({
      path: settings.source, query, limit: 1, selection: 'best-match'
    })
    const excerpt = book?.chunks[0]?.text
    if (!excerpt || turnSignal.aborted) return ''
    const current = await readSettings()
    if (turnSignal.aborted || !current.enabled || current.source !== settings.source) return ''

    return formatReference(excerpt)
  } })
}
