import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerWorldbookFileTools(tools, files) {
  const pagination = {
    offset: { type: 'integer', description: '从 0 开始的结果偏移；默认 0。' },
    limit: { type: 'integer', description: '每页 1–100 项，默认 30。' },
    version: { type: 'string', description: '翻页时传上次返回的 version，避免混用不同资料版本。' }
  }
  for (const spec of [
    { name: 'worldbook_list', description: '分页列出本局世界书的真实文件路径、标题及类型（静态资料、常驻资料、动态快照）。不知道搜索词时浏览；需要具体资料时优先全文搜索。', parameters: pagination, method: 'listFiles' },
    { name: 'worldbook_grep', description: '在本局世界书真实文件中进行 grep 式全文搜索（字面文本，默认忽略大小写）。动态内容是最近一次运行时渲染的快照，搜索不执行代码。返回文件路径、行号和匹配片段；用 read 读取上下文或全文。零结果时尝试别名或更短的词；nextOffset 非空表示还有结果。', parameters: { query: { type: 'string', required: true }, caseSensitive: { type: 'boolean' }, ...pagination }, method: 'searchFiles' }
  ]) tools.register(defineTool({
    name: spec.name, description: spec.description, parameters: spec.parameters,
    output: { schema: { type: 'object', additionalProperties: false, properties: { result: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) { return { result: JSON.stringify(await files[spec.method](args, { scope: exec.agent, signal: exec.signal })) } }
  }))
}
