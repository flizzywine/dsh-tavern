import { defineTool } from '@deepseek-ai/dsh-tools'
import { normalizeResourcePath, resourceKind } from '../domain/file-resources.js'
import { WORLD_BOOK_PATCH_FIELDS } from '../domain/worldbook-resource.js'
import { VALIDATION_SCHEMA, validationText } from './card-validation-check.js'

const ENTRY_ALIASES = { keys: 'primaryKeys', key: 'primaryKeys', secondary_keys: 'secondaryKeys', keysecondary: 'secondaryKeys', insertion_order: 'order', title: 'comment', name: 'comment', disable: 'disable' }

const HIDDEN_FIELDS = new Set(['ref', 'rawEntry', 'sourceUid', 'sourcePath', 'title', 'comment', 'content'])

// The model reads entries to edit them: the prose stays verbatim, unset
// settings and the duplicated raw source entry are left out.
function entryText(ref, entry) {
  const settings = {}
  for (const [key, value] of Object.entries(entry || {})) {
    if (HIDDEN_FIELDS.has(key) || value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue
    settings[key] = value
  }
  return '[' + ref + '] ' + text(entry && entry.comment) + '\n设置：' + JSON.stringify(settings) + '\n正文：\n' + text(entry && entry.content)
}

function text(value) { return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value)) }

export function registerWorldbookTools({
  chatForSession,
  checkCard,
  readChatCard,
  str,
  tools,
  worldBooks,
}) {
  tools.register(defineTool({
    name: 'tavern_read_worldbook',
    description: '在卡片设定对话中按编号、关键词或分页读取世界书正文。省略 path 时读取当前人物卡绑定的世界书。',
    parameters: {
      path: { type: 'string', description: '世界书相对路径；独立世界书为 worldbooks/...，人物卡内置世界书为 cards/...' },
      ref: { type: 'string', description: '目录中的条目编号，例如 entry:0' },
      query: { type: 'string', description: '可选关键词' },
      offset: { type: 'integer', description: '可选的 1 起始条目序号' },
      limit: { type: 'integer', description: '读取 1~10 条，默认 3' }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          name: { type: 'string', required: true },
          total: { type: 'integer', required: true },
          entries: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { ref: { type: 'string', required: true }, entry: { type: 'json', required: true } }
            }
          }
        }
      },
      render: function (_args, value) {
        if (!value.found) return [{ type: 'text', text: value.message }]
        const body = value.entries.map(function (item) { return entryText(item.ref, item.entry) }).join('\n\n')
        return [{ type: 'text', text: '世界书《' + (value.name || '未命名') + '》· 共 ' + value.total + ' 条\n\n' + body }]
      }
    },
    isConcurrencySafe: function () { return true },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined) return { found: false, message: '尚未选择人物卡。', name: '', total: 0, entries: [] }
      if ((chat.mode || 'story') !== 'card') throw new Error('世界书只能在卡片工作台中读取')
      const requestedPath = str(args.path).trim()
      let record
      if (requestedPath !== '') {
        const normalized = normalizeResourcePath(requestedPath)
        const kind = resourceKind(normalized)
        if (kind !== 'worldbook' && kind !== 'card') throw new Error('世界书引用路径类型不正确')
        record = await worldBooks.get(kind === 'card' ? { kind: 'card', cardPath: normalized } : { kind: 'standalone', path: normalized })
      } else {
        if (str(chat.cardPath) === '') return { found: false, message: '当前工作台尚未引用世界书。', name: '', total: 0, entries: [] }
        record = await worldBooks.bound(chat.cardPath, await readChatCard(chat), chat)
        if (record === null) return { found: false, message: '当前人物卡没有世界书。', name: '', total: 0, entries: [] }
      }
      const allEntries = Array.isArray(record.view.entries) ? record.view.entries : []
      const query = str(args.query).trim().toLowerCase()
      const ref = str(args.ref).trim()
      const filtered = allEntries.filter(function (entry) {
        if (ref !== '') return str(entry.ref) === ref
        if (query === '') return true
        return JSON.stringify(entry).toLowerCase().includes(query)
      })
      const offset = Math.max(1, Number(args.offset) || 1)
      const limit = Math.min(10, Math.max(1, Number(args.limit) || 3))
      const entries = filtered.slice(offset - 1, offset - 1 + limit).map(function (entry) { return { ref: str(entry.ref), entry } })
      if (entries.length === 0) return { found: false, message: '没有找到符合条件的世界书条目。', name: str(record.view.displayName), total: allEntries.length, entries: [] }
      return { found: true, message: '', name: str(record.view.displayName), total: allEntries.length, entries }
    }
  }))

  tools.register(defineTool({
    name: 'tavern_update_worldbook',
    description: '按用户要求，对世界书提交条目级最小修改。支持独立世界书和人物卡内置世界书；省略 path 时修改当前人物卡绑定的世界书。不要重写整本世界书。修改人物卡内置世界书时结果附带整卡格式校验，无需再调用 tavern_validate_card。',
    parameters: {
      path: { type: 'string', description: '可选的世界书路径；省略时使用当前人物卡，或填写 worldbooks/...、cards/...' },
      name: { type: 'string', description: '可选的新世界书名称' },
      description: { type: 'string', description: '可选的新世界书说明' },
      operations: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            op: { type: 'string', required: true, enum: ['update', 'add', 'delete'] },
            ref: { type: 'string' },
            patch: { type: 'object', additionalProperties: true, description: 'update 的字段，与 entry 使用相同字段名' },
            entry: { type: 'object', additionalProperties: true, description: 'add 的新条目字段：comment 标题、content 正文、primaryKeys 关键词数组（也接受 keys）、secondaryKeys、enabled、constant、order 等' }
          }
        }
      }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          name: { type: 'string', required: true },
          entryCount: { type: 'integer', required: true },
          saved: { type: 'boolean', required: true },
          validation: VALIDATION_SCHEMA
        }
      },
      render: function (_args, value) { return [{ type: 'text', text: '世界书《' + value.name + '》已修改并生效 · ' + value.entryCount + ' 条' + (value.validation ? '\n' + validationText(value.validation) : '') }] }
    },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('世界书只能在卡片工作台中修改')
      const requestedPath = str(args.path).trim()
      if (requestedPath === '' && str(chat.cardPath) === '') throw new Error('当前工作台尚未绑定人物卡，无法修改世界书')
      const normalized = requestedPath === '' ? normalizeResourcePath(chat.cardPath, 'card') : normalizeResourcePath(requestedPath)
      const kind = resourceKind(normalized)
      if (kind !== 'worldbook' && kind !== 'card') throw new Error('世界书引用路径类型不正确')
      const source = kind === 'card' ? { kind: 'card', cardPath: normalized } : { kind: 'standalone', path: normalized }
      // Accept the SillyTavern spellings models naturally use; only fields that
      // would otherwise be silently dropped are reported.
      const operations = (Array.isArray(args.operations) ? args.operations : []).map(operation => {
        const next = { ...operation }
        for (const key of ['entry', 'patch']) {
          if (!operation || typeof operation[key] !== 'object' || operation[key] === null) continue
          const fields = {}
          for (const [field, value] of Object.entries(operation[key])) {
            const alias = ENTRY_ALIASES[field]
            if (alias === 'disable') fields.enabled = value !== true
            else fields[alias || field] = value
          }
          const unknown = Object.keys(fields).filter(field => !WORLD_BOOK_PATCH_FIELDS.includes(field))
          if (unknown.length) throw new Error('世界书条目不认识字段 ' + unknown.join('、') + '，写入会丢失。可用字段：' + WORLD_BOOK_PATCH_FIELDS.join('、'))
          next[key] = fields
        }
        return next
      })
      const request = { operations }
      if (Object.prototype.hasOwnProperty.call(args, 'name')) request.name = args.name
      if (Object.prototype.hasOwnProperty.call(args, 'description')) request.description = args.description
      const result = await worldBooks.update(source, request)
      const saved = { path: normalized, name: str(result.view.displayName), entryCount: Number(result.view.entryCount) || 0, saved: true }
      return kind === 'card' ? { ...saved, validation: await checkCard(chat, normalized) } : saved
    }
  }))
}
