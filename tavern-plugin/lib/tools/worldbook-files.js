import { defineTool } from '@deepseek-ai/dsh-tools'
import { GREP_LOREBOOK_TOOL, LIST_LOREBOOK_TOOL, READ_LOREBOOK_TOOL } from '../domain/foreground-tools.js'

export function registerWorldbookFileTools(tools, files) {
  tools.register(defineTool({
    name: READ_LOREBOOK_TOOL,
    description: '按标题、别名或短关键词读取本局世界书正文。遇到多个匹配时可用候选 ID 读取。',
    parameters: {
      keyword: { type: 'string', required: true },
      offset: { type: 'integer', description: '从结果给出的 offset 续读' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        text: { type: 'string', required: true }, id: { type: 'string' }, title: { type: 'string' }
      } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
      presentationMeta: (_args, value) => value.id ? { worldbookRead: { id: value.id, title: value.title } } : {}
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await files.readByKeyword(args, { scope: exec.agent, signal: exec.signal })
      if (result.status === 'not_found') return { text: '没有匹配的世界书条目。' }
      if (result.status === 'multiple') return { text: [
        `找到 ${result.total} 条。用候选 ID 作为 keyword 读取：`,
        ...result.candidates.map(entry => `- ${entry.title}（${entry.category}） ${entry.id}`)
      ].join('\n') }
      if (!result.text) return { text: '该位置之后没有正文。' }
      const continuation = result.nextOffset == null ? '' : `\n\n（续读参数 keyword: "${result.id}", offset: ${result.nextOffset}）`
      return { text: result.text + continuation, id: result.id, title: result.title }
    }
  }))

  const pagination = {
    offset: { type: 'integer', description: '从 0 开始的结果偏移；默认 0。' },
    limit: { type: 'integer', description: '每页 1–100 项，默认 30。' }
  }
  tools.register(defineTool({
    name: LIST_LOREBOOK_TOOL,
    description: '浏览本局世界书标题，每行一个。页满时可用 offset 加上本页条数继续浏览。',
    parameters: pagination,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const page = await files.listFiles(args, { scope: exec.agent, signal: exec.signal })
      return page.files.map(file => file.title).join('\n') || '没有更多条目。'
    }
  }))

  tools.register(defineTool({
    name: GREP_LOREBOOK_TOOL,
    description: '在本局世界书中搜索字面文本，返回命中条目的标题和片段。需要正文时用 read_lorebook 按标题读取。',
    parameters: { query: { type: 'string', required: true }, caseSensitive: { type: 'boolean', description: '是否区分大小写，默认不区分' }, ...pagination },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        text: { type: 'string', required: true }, ids: { type: 'array', items: { type: 'string' }, required: true }
      } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
      presentationMeta: (_args, value) => ({ lorebookGrepIds: value.ids })
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const matches = await files.searchFiles(args, { scope: exec.agent, signal: exec.signal })
      const entries = new Map()
      const ids = new Set()
      for (const match of matches) {
        if (!entries.has(match.id)) entries.set(match.id, [match.title])
        // Line one is the generated heading, which is already shown as the title.
        if (match.line > 2 && match.text.trim()) {
          entries.get(match.id).push(match.text)
          ids.add(match.id)
        }
      }
      return { text: [...entries.values()].map(entry => entry.join('\n')).join('\n\n') || '没有匹配的世界书条目。', ids: [...ids] }
    }
  }))
}
