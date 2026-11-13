import { promptSection } from './prompt-section.js'
import { sessionEvents, appendSessionEvent } from './session-events.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "A one-time index of variable paths and types, taken after initialization. It holds no current values and may be incomplete; arrays list only the container. For latest values or more paths, call tavern_read_variables with list, search or read; paths are relative to stat_data. The background maintains variables; the foreground only reads them.\n"
})


const name = 'tavern:variable-directory'
export function sessionVariableDirectorySection(session) {
  const event = sessionEvents(session).find(event => event.type === 'user/message' && event.data?.id === 'tavern-variable-directory:' + session.id)
  return event?.data?.source?.sections?.find(section => section.name === name) || null
}

/**
 * The directory sits in the system prompt, which must stay byte-identical once a
 * model has answered under it (prompt cache, reasoning signatures). So it can only
 * be frozen before the session's first request; later stat_data never adds it.
 */
export function variableDirectoryOpen(session) {
  return !sessionVariableDirectorySection(session) && !sessionEvents(session).some(event => event.type === 'request/header')
}

/** Freeze discovery once; current values remain available through the read tool. */
export function ensureSessionVariableDirectory(session, chat) {
  if (!['story', 'script'].includes(chat?.mode || 'story') || !variableDirectoryOpen(session)) return null
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
      text: promptSection('variable_directory', PROMPT_PROSE.p001 + JSON.stringify(entries)) }] }
  }, { surfaceOp: 'append' })
}
