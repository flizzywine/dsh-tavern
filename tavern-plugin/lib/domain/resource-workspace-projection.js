import { createHash } from 'node:crypto'
import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

const SPEC_PATH = '.tavern/README.md'
const BINDINGS_PATH = '.tavern/bindings.json'

const SPEC = `# DSH Tavern 资源工作区

本目录由用户和 Tavern 共同使用。\`.tavern/\` 下的文件由 Tavern 生成并自动刷新，会被后续刷新覆盖；它们是只读投影，不是新的事实来源。

## 资源目录

- \`cards/\`：人物卡工作副本，JSON 文件可以用通用文件工具读取、复制和修改。
- \`materials/\`：小说、剧本和其他长文本材料。
- \`scripts/\`：旧版分块剧本资源。
- \`worldbooks/\`：独立世界书 JSON。
- \`presets/\`：Tavern 预设 JSON。

人物卡工作文件使用 \`dsh-tavern-character-workspace\` 外壳时，资源 ID 位于 \`meta.id\`。复制人物卡时，应复制完整 JSON、给副本生成新的 \`meta.id\`，并把后续修改写入副本。不要逐段手工转录大型 JSON。内嵌世界书随人物卡 JSON 一起复制；独立世界书需要单独复制时，写入 \`worldbooks/\` 下的新文件。

## Tavern 投影

- \`.tavern/bindings.json\`：全部人物卡当前绑定的剧本与世界书。
- \`.tavern/sessions/<id>/context.json\`：某个 Agent Session 当前绑定的人物卡与挂载资源。
- \`.tavern/sessions/<id>/diagnostics.json\`：该 Session 已挂载诊断的有界摘要。

不要把这些投影当成聊天历史，也不要通过改写投影来伪造 Tavern 状态。对话与 Frame 时间线仍由宿主保存，并保持追加式演进。
`

function safeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > 12000 ? value.slice(0, 12000) + '…[已截断]' : value
  if (typeof value !== 'object') return String(value)
  if (depth >= 6) return '[深度已截断]'
  if (seen.has(value)) return '[循环引用]'
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 100).map(function (item) { return safeValue(item, depth + 1, seen) })
  const result = {}
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/authorization|cookie|api[-_]?key|secret|password|access[-_]?token/i.test(key)) result[key] = '[已隐藏]'
    else result[key] = safeValue(item, depth + 1, seen)
  }
  return result
}

function sessionDirectory(sessionId) {
  return '.tavern/sessions/' + createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 24)
}

/** Publishes rebuildable Tavern state through one filesystem-facing interface. */
export function createResourceWorkspaceProjection(options = {}) {
  const root = path.resolve(String(options.root || ''))
  const files = options.files || createDurableFilePromotion(options.filePromotion)
  const now = typeof options.now === 'function' ? options.now : Date.now

  async function write(relative, value) {
    await files.write(path.join(root, ...relative.split('/')), value)
  }

  async function publish(snapshot = {}) {
    const sessionId = String(snapshot.sessionId || '').trim()
    if (sessionId === '') throw new Error('资源工作区投影缺少 Session ID')
    const directory = sessionDirectory(sessionId)
    const contextPath = directory + '/context.json'
    const diagnosticsPath = directory + '/diagnostics.json'
    const generatedAt = Math.max(0, Number(now()) || 0)
    const context = safeValue(snapshot.context || {})

    await Promise.all([
      write(SPEC_PATH, SPEC),
      write(BINDINGS_PATH, JSON.stringify({
        schema: 'dsh-tavern.resource-bindings', version: 1, generatedAt,
        notice: 'generated-read-only', cards: safeValue(Array.isArray(snapshot.bindings) ? snapshot.bindings : [])
      }, null, 2) + '\n'),
      write(contextPath, JSON.stringify({
        ...context,
        schema: 'dsh-tavern.session-context', version: 1, generatedAt, notice: 'generated-read-only', sessionId,
        files: { specification: SPEC_PATH, bindings: BINDINGS_PATH, context: contextPath, diagnostics: diagnosticsPath }
      }, null, 2) + '\n'),
      write(diagnosticsPath, JSON.stringify({
        schema: 'dsh-tavern.session-diagnostics', version: 1, generatedAt, notice: 'generated-read-only',
        sessionId, items: safeValue(Array.isArray(snapshot.diagnostics) ? snapshot.diagnostics : [])
      }, null, 2) + '\n')
    ])
    return { specPath: SPEC_PATH, bindingsPath: BINDINGS_PATH, contextPath, diagnosticsPath }
  }

  return Object.freeze({ publish })
}
