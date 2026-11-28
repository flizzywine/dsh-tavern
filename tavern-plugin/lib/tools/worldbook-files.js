import { defineTool } from '@deepseek-ai/dsh-tools'
import { GREP_LOREBOOK_TOOL, LIST_LOREBOOK_TOOL, QUERY_LOREBOOK_TOOL, READ_LOREBOOK_TOOL } from '../domain/foreground-tools.js'

export function registerWorldbookFileTools(tools, files) {
  const lookup = exec => ({ scope: exec.agent, signal: exec.signal })
  const render = (_args, value) => [{ type: 'text', text: value.text }]
  const readMeta = (_args, value) => value.id ? { worldbookRead: { id: value.id, title: value.title } } : {}
  const searchMeta = (_args, value) => ({ lorebookGrepIds: value.ids })
  const readFields = { text: { type: 'string', required: true }, id: { type: 'string' }, title: { type: 'string' } }
  const ids = { type: 'array', items: { type: 'string' } }
  const pagination = {
    offset: { type: 'integer', description: '从 0 开始的结果偏移；默认 0。' },
    limit: { type: 'integer', description: '每页 1–100 项，默认 30。' }
  }
  const searchOptions = {
    exactPhrase: { type: 'boolean', description: '匹配整段搜索文本，包括其中的空白。默认按关键词搜索。' },
    caseSensitive: { type: 'boolean', description: '是否区分大小写，默认不区分。' }
  }

  async function read(args, exec, { field = 'keyword', prefix = '' } = {}) {
    const result = await files.readByKeyword({ keyword: args[field], offset: args.offset }, lookup(exec))
    if (result.status === 'not_found') return { text: '没有匹配的世界书条目。' }
    if (result.status === 'multiple') return { text: [
      `找到 ${result.total} 条。用候选 ID 作为 ${field} 读取：`,
      ...result.candidates.map(entry => `- ${entry.title}（${entry.category}） ${entry.id}`)
    ].join('\n') }
    if (!result.text) return { text: '该位置之后没有正文。' }
    const continuation = result.nextOffset == null ? '' : `\n\n（续读参数 ${prefix}${field}: "${result.id}", offset: ${result.nextOffset}）`
    return { text: result.text + continuation, id: result.id, title: result.title }
  }

  async function list(args, exec) {
    const page = await files.listFiles(args, lookup(exec))
    return page.files.map(file => file.title).join('\n') || '没有更多条目。'
  }

  async function search(args, exec) {
    const matches = await files.searchFiles(args, lookup(exec))
    const entries = new Map()
    const matchedIds = new Set()
    for (const match of matches) {
      if (!entries.has(match.id)) entries.set(match.id, [match.title])
      // Line one is the generated heading, which is already shown as the title.
      if (match.line > 2 && match.text.trim()) {
        entries.get(match.id).push(match.text)
        matchedIds.add(match.id)
      }
    }
    return { text: [...entries.values()].map(entry => entry.join('\n')).join('\n\n') || '没有匹配的世界书条目。', ids: [...matchedIds] }
  }

  tools.register(defineTool({
    name: QUERY_LOREBOOK_TOOL,
    description: '查询本局世界书。read 按标题、别名、短关键词或候选 ID 读正文；search 搜索标题和原文片段；list 浏览条目标题。search 和 list 页满时把 offset 增加一页。',
    parameters: {
      action: { type: 'string', enum: ['read', 'search', 'list'], required: true },
      query: { type: 'string', description: 'read 和 search 必填。search 可用空格分隔短词，任一词命中即可。' },
      offset: { type: 'integer', description: '默认 0。read 用返回的 offset 续读；search 和 list 从该条结果开始。' },
      limit: pagination.limit,
      ...searchOptions
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ...readFields, ids } },
      render,
      presentationMeta: (args, value) => args.action === 'search' ? searchMeta(args, value) : readMeta(args, value)
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.action === 'list') return { text: await list(args, exec) }
      if (!args.query?.trim()) throw Error('读取或搜索世界书时需要填写 query')
      if (args.action === 'read') return read(args, exec, { field: 'query', prefix: 'action: "read", ' })
      return search(args, exec)
    }
  }))

  // Existing background tasks still use the three individual tool schemas.
  tools.register(defineTool({
    name: READ_LOREBOOK_TOOL,
    description: '按标题、别名或短关键词读取本局世界书正文。遇到多个匹配时可用候选 ID 读取。',
    parameters: {
      keyword: { type: 'string', required: true },
      offset: { type: 'integer', description: '从结果给出的 offset 续读' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: readFields },
      render,
      presentationMeta: readMeta
    },
    isConcurrencySafe: () => true,
    execute: read
  }))

  tools.register(defineTool({
    name: LIST_LOREBOOK_TOOL,
    description: '浏览本局世界书标题，每行一个。页满时可用 offset 加上本页条数继续浏览。',
    parameters: pagination,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    isConcurrencySafe: () => true,
    execute: list
  }))

  tools.register(defineTool({
    name: GREP_LOREBOOK_TOOL,
    description: '在本局世界书中搜索字面关键词，返回命中条目的标题和片段。需要正文时用 read_lorebook 按标题读取。',
    parameters: {
      query: { type: 'string', required: true, description: '多个短关键词用空格分隔，匹配任意一个即可。' },
      ...searchOptions,
      ...pagination
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        text: readFields.text, ids: { ...ids, required: true }
      } },
      render,
      presentationMeta: searchMeta
    },
    isConcurrencySafe: () => true,
    execute: search
  }))
}
