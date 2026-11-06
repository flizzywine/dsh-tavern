import { createHash } from 'node:crypto'

export const CHAT_IMPORT_MAX_BYTES = 8 * 1024 * 1024
export const CHAT_IMPORT_MAX_MESSAGES = 2000
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const copy = value => structuredClone(value)

/** Parse untrusted ST exports as data; never retain unselected swipes or reasoning. */
export function parseChatHistory(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > CHAT_IMPORT_MAX_BYTES) throw new Error('聊天文件最大支持 8 MB')
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const rows = []
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue
    let value
    try { value = JSON.parse(lines[index]) } catch { throw new Error(`第 ${index + 1} 行不是有效 JSON`) }
    if (!object(value)) throw new Error(`第 ${index + 1} 行必须是消息对象`)
    rows.push({ value, line: index + 1 })
  }
  const header = rows.shift()?.value
  if (!header || !['chat_metadata', 'user_name', 'character_name'].some(key => Object.hasOwn(header, key))) throw new Error('缺少 SillyTavern 聊天文件头部')
  const warnings = []
  const messages = []
  let previous, previousLine = null, missing = 0, excluded = 0
  for (const { value: row, line } of rows) {
    const fail = reason => { throw new Error(`第 ${line} 行：${reason}`) }
    if (row.is_system === true) { excluded++; continue }
    if (row.extra?.type === 'narrator' || row.extra?.tool_invocations?.length) fail('暂不支持旁白或工具消息')
    if (row.extra?.media?.length || row.extra?.image || row.extra?.file) fail('暂不支持依赖附件的消息')
    if (typeof row.is_user !== 'boolean' || typeof row.mes !== 'string') fail('缺少有效的 is_user 或 mes')
    if (!row.mes.trim()) fail('消息正文为空')
    const swipe = row.swipe_id === undefined ? 0 : row.swipe_id
    if (!Number.isSafeInteger(swipe) || swipe < 0) fail('候选回复编号无效')
    if (Array.isArray(row.swipes) && swipe >= row.swipes.length) fail('候选回复编号越界')
    if (row.variables !== undefined && !Array.isArray(row.variables)) fail('变量快照必须为数组')
    const raw = row.variables?.[swipe]
    const valid = object(raw) && object(raw.stat_data)
    if (raw != null && !object(raw)) fail('变量快照格式无效')
    if (object(raw) && Object.hasOwn(raw, 'stat_data') && !valid) fail('stat_data 必须为对象')
    if (valid) { previous = copy(raw); previousLine = line } else missing++
    messages.push({ role: row.is_user ? 'user' : 'assistant', text: row.mes,
      name: typeof row.name === 'string' ? row.name : '',
      timestamp: typeof row.send_date === 'string' ? row.send_date : '',
      sourceLine: line, sourceSwipe: swipe,
      ...(previous === undefined ? {} : { variables: copy(previous) }),
      stateSourceLine: previousLine, stateInherited: !valid })
    if (messages.length > CHAT_IMPORT_MAX_MESSAGES) fail('最多支持 2000 条消息')
  }
  if (!messages.length) throw new Error('文件中没有可导入的聊天消息')
  if (excluded) warnings.push(`已跳过 ${excluded} 条系统提示消息`)
  if (messages.some((message, index) => index > 0 && messages[index - 1].role === message.role)) warnings.push('连续同角色消息将按原顺序合并为一条，使用合并末尾的状态，以保持原生轮次结构')
  const names = new Set(messages.filter(m => m.role === 'assistant' && m.name).map(m => m.name))
  if (names.size > 1) throw new Error('暂不支持多角色群聊记录')
  const hasMvu = messages.some(m => m.variables !== undefined)
  if (hasMvu && missing) warnings.push(`${missing} 条消息缺少 MVU 快照，将沿用此前状态；尚无快照时使用人物卡初值，状态可能滞后`)
  const normalized = { messages, warnings, hasMvu,
    userName: messages.find(m => m.role === 'user' && m.name)?.name || '你' }
  // Identity describes the imported content, excluding discarded variants and reasoning.
  return { ...normalized, digest: createHash('sha256').update(JSON.stringify(messages)).digest('hex') }
}

export function chatHistoryPreview(parsed) {
  return { digest: parsed.digest, count: parsed.messages.length, userName: parsed.userName,
    hasMvu: parsed.hasMvu, warnings: parsed.warnings,
    lastMessage: parsed.messages.at(-1).text.slice(0, 500) }
}
