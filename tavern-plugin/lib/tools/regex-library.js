import { defineTool } from '@deepseek-ai/dsh-tools'

function summarize(entry) {
  return {
    key: entry.key,
    name: entry.name,
    enabled: entry.enabled,
    sourceEnabled: entry.sourceEnabled,
    overridden: entry.overridden,
    findRegex: entry.findRegex,
    replaceString: entry.replaceString,
    placement: entry.placement,
    markdownOnly: entry.markdownOnly,
    promptOnly: entry.promptOnly,
    runOnEdit: entry.runOnEdit,
    minDepth: entry.minDepth,
    maxDepth: entry.maxDepth
  }
}

export function registerRegexLibraryTools({ regexManager, tools }) {
  tools.register(defineTool({
    name: 'tavern_read_regex_library',
    description: '读取本局正在使用的正则：全局、本局预设快照、本局人物卡，以及本局覆盖开关。enabled 表示这一条在本局是否真正参与渲染；预设/人物卡条目可能被本局开关停用，但不会改动来源文件。用户要求把某条正则写进人物卡或预设时，仍使用 tavern_update_card 的 rawOperations 或 tavern_update_preset；本工具只读。',
    parameters: {
      source: { type: 'string', enum: ['all', 'global', 'preset', 'card'], description: '可选；只读取某一层，默认全部' },
      key: { type: 'string', description: '可选；只读取这一条（正则的 key）' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.report }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const data = await regexManager.read(exec?.agent?.session?.id || '')
      const source = args?.source === 'global' || args?.source === 'preset' || args?.source === 'card' ? args.source : 'all'
      const key = String(args?.key || '').trim()
      const pick = entries => (entries || []).map(summarize).filter(entry => key === '' || entry.key === key)
      const report = {
        session: {
          mode: data.mode,
          preset: data.preset ? { name: data.preset.name, path: data.preset.path } : null,
          card: data.card ? { name: data.card.name, path: data.card.path } : null
        },
        overrides: data.overrides,
        global: source === 'all' || source === 'global' ? pick(data.global) : [],
        preset: source === 'all' || source === 'preset' ? pick(data.preset?.scripts) : [],
        card: source === 'all' || source === 'card' ? pick(data.card?.scripts) : []
      }
      if (key !== '' && report.global.length + report.preset.length + report.card.length === 0) throw new Error('没有这条正则: ' + key)
      return { report: JSON.stringify(report, null, 2) }
    }
  }))
}
