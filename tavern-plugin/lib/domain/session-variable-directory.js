import { sessionEvents, appendSessionEvent } from './session-events.js'

const name = 'tavern:variable-directory'
export function sessionVariableDirectorySection(session) {
  const event = sessionEvents(session).find(event => event.type === 'user/message' && event.data?.id === 'tavern-variable-directory:' + session.id)
  return event?.data?.source?.sections?.find(section => section.name === name) || null
}

/** Freeze discovery once; current values remain available through the read tool. */
export function ensureSessionVariableDirectory(session, chat) {
  if (!['story', 'script'].includes(chat?.mode || 'story') || sessionVariableDirectorySection(session)) return null
  let state
  for (const message of [...(chat.messages || [])].reverse()) {
    if (message.role === 'tavern-helper') continue
    const value = message.variables?.[message.swipeId || 0]?.stat_data
    if (value && typeof value === 'object') { state = value; break }
  }
  if (!state) return null
  const entries = []
  let bytes = 0
  const escape = key => key.replace(/~/g, '~0').replace(/\//g, '~1')
  function visit(value, path, depth) {
    if (entries.length >= 100 || depth > 8) return
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.startsWith('__') || key === 'constructor') continue
      const child = value[key], pointer = path + '/' + escape(key)
      if (entries.length >= 100) break
      const type = child === null ? 'null' : Array.isArray(child) ? 'array' : typeof child
      const entry = { path: pointer, type }
      const size = JSON.stringify(entry).length
      if (pointer.length > 1024 || bytes + size > 6000) continue
      bytes += size
      entries.push(entry)
      if (child && type === 'object') visit(child, pointer, depth + 1)
    }
  }
  visit(state, '', 0)
  if (!entries.length) return null
  return appendSessionEvent(session, 'user/message', {
    id: 'tavern-variable-directory:' + session.id, role: 'user', content: [],
    source: { kind: 'plugin:dsh-tavern', form: 'snapshot', sections: [{ name,
      text: '【变量目录】\n以下是初始化后的一次性变量路径与类型索引，不代表当前值，也可能未列全。数组仅列容器。需要最新值或更多路径时，调用 tavern_read_variables 的 list、search 或 read；路径相对于 stat_data。变量由后台维护，前台只读查询。\n' + JSON.stringify(entries) }] }
  }, { surfaceOp: 'append' })
}
