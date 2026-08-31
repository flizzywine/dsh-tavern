import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

const EVENT = 'dsh-tavern/stable-prefix'
const cached = new WeakMap()
const pending = new WeakMap()

export function createSessionStablePrefixStorage(directory) {
  const files = createDurableFilePromotion()
  function file(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('无效的固定背景 Session ID')
    return path.join(directory, id + '.json')
  }
  return {
    async read(id) {
      let value
      try { value = JSON.parse(await readFile(file(id), 'utf8')) } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
      if (value?.version !== 1 || value.id !== 'tavern-session-prefix:' + id || typeof value.text !== 'string' || !value.text.trim()) throw new Error('固定背景文件格式无效：' + id)
      return value
    },
    async write(id, value) { await files.write(file(id), JSON.stringify(value) + '\n') }
  }
}

/** Session metadata, not a turn message: never compacted or appended again on resume. */
export function readSessionStablePrefix(session) {
  if (!session) return null
  if (cached.has(session)) return cached.get(session)
  const event = (session.events || []).find(item => item.type === EVENT && item.data?.version === 1)
  if (!event) return null
  cached.set(session, event.data)
  return event.data
}

export async function ensureSessionStablePrefix(session, text, storage) {
  const existing = readSessionStablePrefix(session)
  if (existing) return existing
  if (!session) throw new Error('无法保存 Session 固定背景')
  if (pending.has(session)) return pending.get(session)
  const operation = (async function () {
    const saved = storage ? await storage.read(session.id) : null
    if (saved) { cached.set(session, saved); return saved }
    if (typeof text !== 'string' || !text.trim()) return null
    if (!storage) throw new Error('缺少 Session 固定背景存储')
    const data = { version: 1, id: 'tavern-session-prefix:' + session.id, text: text.trim() }
    // Not a model message or a custom DSH event. Commit before exposing it to requests.
    await storage.write(session.id, data)
    cached.set(session, data)
    return data
  })()
  pending.set(session, operation)
  try { return await operation } finally { pending.delete(session) }
}

function textOf(message) {
  return message.content.map(block => block.text).join('')
}

function stripLegacyCardContext(message) {
  // Only rewrite Tavern-owned text inputs. Never touch player prose or tool traffic.
  if (message?.role !== 'user' || message.source?.kind !== 'plugin' || message.source.plugin !== 'dsh-tavern' ||
      message.tool_call_id !== undefined || message.tool_calls?.length ||
      !Array.isArray(message.content) || !message.content.every(block => block.type === 'text')) return message
  const text = textOf(message)
  const sections = message.source.sections
  if (message.source.form === 'foreground-frame' && Array.isArray(sections) &&
      sections.map(section => section.text).join('\n\n') === text) {
    const kept = sections.filter(section => section.source?.sectionKind !== 'card')
    if (kept.length === sections.length) return message
    return { ...message, content: [{ type: 'text', text: kept.map(section => section.text).join('\n\n') }], source: { ...message.source, sections: kept } }
  }
  // Pre-prefix candidate messages embedded the entire card in the task protocol.
  if (!text.startsWith('【最近剧情与本次任务】\n任务类型：候选生成\n') || !text.includes('【DSH 后台任务协议（最终指令）】')) return message
  const start = text.indexOf('\n\n【故事设定 · 人物卡】\n名字: ')
  if (start < 0) return message
  const rest = text.slice(start + 2)
  const boundary = /\n\n【(?:附加要求|特殊指令|用户指导 Guide · 优先遵循|现场 · 主要人物状态（每轮结算更新，务必与之一致）|剧本候选参考[^】]*)】/.exec(rest)
  const end = boundary ? start + 2 + boundary.index : text.length
  return { ...message, content: [{ type: 'text', text: text.slice(0, start) + text.slice(end) }] }
}

/** Put the saved background before all conversation history, never into request.system. */
export function projectSessionStablePrefix(request, prefix) {
  if (!prefix || request?.purpose !== undefined) return request
  const messages = Array.isArray(request.messages) ? request.messages : []
  const ordinary = messages.filter(message => message.id !== prefix.id).map(stripLegacyCardContext)
  const head = {
    id: prefix.id,
    role: 'user',
    content: [{ type: 'text', text: prefix.text }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'session-prefix' }
  }
  return { ...request, messages: [head, ...ordinary] }
}
