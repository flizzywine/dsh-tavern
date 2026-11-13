import { sessionVariableDirectorySection } from './session-variable-directory.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { ensureSessionSystemHead, sessionEvents, appendSessionEvent } from './session-events.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'
import { isProducerSource } from './message-source.js'

const EVENT = 'dsh-tavern/stable-prefix'
const pending = new WeakMap()
const MESSAGE_FORM = 'snapshot'
const LEGACY_MESSAGE_FORM = 'session-prefix'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

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

function sectionText(message) {
  if (!Array.isArray(message?.source?.sections)) return ''
  return message.source.sections.map(section => typeof section?.text === 'string' ? section.text.trim() : '').filter(Boolean).join('\n\n')
}

function prefixRevision(message) {
  const match = /:revision-(\d+)$/.exec(String(message?.id || ''))
  if (match) return Number(match[1])
  // Legacy archives may still carry this non-released key until migration strips it.
  const legacy = Number(message?.source?.cardContextRevision || 0)
  return Number.isFinite(legacy) ? legacy : 0
}

function hasReleasedSnapshot(message) {
  return message?.source?.form === MESSAGE_FORM && Array.isArray(message.source.sections) && message.source.sections.length > 0
}

function messageRecord(event) {
  const message = event && event.type === 'user/message' ? event.data : null
  if (!str(message?.id).startsWith('tavern-session-prefix:') || message.role !== 'user' || !isProducerSource(message.source, 'dsh-tavern') || ![MESSAGE_FORM, LEGACY_MESSAGE_FORM].includes(message.source?.form) || !Array.isArray(message.content)) return null
  // Prefer released snapshot sections. fixedSystemText is legacy only (issue #71).
  const text = typeof message.source.fixedSystemText === 'string' && message.source.fixedSystemText.trim()
    ? message.source.fixedSystemText
    : (sectionText(message) || message.content.filter(block => block?.type === 'text').map(block => str(block.text)).join('').trim())
  if (text === '') return null
  return {
    version: hasReleasedSnapshot(message) || typeof message.source.fixedSystemText === 'string' ? 3 : 2,
    id: message.id,
    text,
    revision: prefixRevision(message),
    message,
    event,
  }
}

function sourceSections(text) {
  // Chats opened between 11-03 and 11-12 froze the English envelopes.
  const boundaries = [
    { marker: text.includes('<user_preferences>\n') ? '<user_preferences>' : '【用户已确认的长期偏好】', name: 'tavern:user-preference' },
    { marker: text.includes('<character_card>\n') ? '<character_card>' : '【故事设定 · 人物卡】', name: 'tavern:character-card' },
    { marker: text.includes('<card_system>\n') ? '<card_system>' : '【人物卡系统提示】', name: 'tavern:card-system-prompt' },
    { marker: text.includes('<constant_worldbook>\n') ? '<constant_worldbook>' : '【常驻世界书】', name: 'tavern:constant-worldbook' }
  ]
  const starts = boundaries.map(function (boundary) {
    return { ...boundary, index: text.indexOf(boundary.marker) }
  }).filter(function (boundary) { return boundary.index >= 0 }).sort(function (left, right) { return left.index - right.index })
  if (starts.length === 0) return [{ name: 'tavern:session-context', text }]
  const sections = []
  if (starts[0].index > 0 && text.slice(0, starts[0].index).trim() !== '') {
    sections.push({ name: 'tavern:session-context', text: text.slice(0, starts[0].index).trim() })
  }
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const end = starts[index + 1]?.index ?? text.length
    sections.push({ name: start.name, text: text.slice(start.index, end).trim() })
  }
  return sections
}

/** Read the immutable snapshot from original events, even after its Surface node was compacted. */
export function readSessionStablePrefix(session) {
  if (!session) return null
  let legacy = null, fixed = null
  for (const event of sessionEvents(session)) {
    const record = messageRecord(event)
    if (!record) continue
    if (hasReleasedSnapshot(record.message) || typeof record.message.source.fixedSystemText === 'string') {
      if (!fixed || record.revision > fixed.revision) fixed = record
      continue
    }
    legacy ||= record
  }
  return fixed || legacy
}

function legacyEventText(session) {
  const event = sessionEvents(session).find(item => item.type === EVENT && item.data?.version === 1 && item.data.id === 'tavern-session-prefix:' + session.id)
  return str(event && event.data && event.data.text).trim()
}

function fixedContextMessage(session, text) {
  // Only released plugin source members. fixedSystemText / cardContextRevision are
  // rejected by DSH 0.1.5-rc.2 v0→v1 migration (issue #71).
  return {
    id: 'tavern-session-prefix:' + session.id,
    role: 'user',
    content: [],
    source: {
      kind: 'plugin:dsh-tavern',
      form: MESSAGE_FORM,
      sections: sourceSections(text)
    }
  }
}

/** Persist fixed system text in native snapshot metadata; empty content cannot become summary material. */
export async function ensureSessionStablePrefix(session, text, storage, revision = 0) {
  ensureSessionSystemHead(session)
  const existing = readSessionStablePrefix(session)
  if (existing && revision > existing.revision && str(text).trim()) {
    const message = fixedContextMessage(session, str(text).trim())
    message.id += ':revision-' + revision
    return messageRecord(appendSessionEvent(session, 'user/message', message, { surfaceOp: 'append' }))
  }
  if (existing) {
    const activeLegacy = sessionEvents(session).find(event => messageRecord(event)?.message.content.length && session.surface?.nodes.includes(event.seq))
    const needsSnapshot = !hasReleasedSnapshot(existing.message)
    if (needsSnapshot || activeLegacy) {
      // Old EJS prefixes used the saved play-card snapshot at the request boundary.
      // Freeze that same evaluated snapshot once when migrating, never reevaluate per turn.
      const context = needsSnapshot && /<%[\s\S]*?%>/.test(existing.text) && str(text).trim() ? str(text).trim() : existing.text
      const message = { ...fixedContextMessage(session, context), id: 'tavern-session-prefix:' + session.id + ':system-migration' }
      const event = activeLegacy
        ? replaceSessionSurface(session, 'user/message', message, { start: activeLegacy.seq, end: activeLegacy.seq, sourceEventSeqs: [activeLegacy.seq] })
        : appendSessionEvent(session, 'user/message', message, { surfaceOp: 'append' })
      return messageRecord(event)
    }
    return existing
  }
  if (!session || typeof session.append !== 'function') throw new Error('无法写入 Session 固定背景')
  if (pending.has(session)) return pending.get(session)
  const operation = (async function () {
    const saved = storage ? await storage.read(session.id) : null
    const context = (revision > 0 ? str(text).trim() : '') || legacyEventText(session) || str(saved && saved.text).trim() || str(text).trim()
    if (context === '') return null
    const message = fixedContextMessage(session, context)
    if (revision > 0) message.id += ':revision-' + revision
    const event = appendSessionEvent(session, 'user/message', message, { surfaceOp: 'append' })
    return messageRecord(event)
  })()
  pending.set(session, operation)
  try { return await operation } finally { pending.delete(session) }
}

/** Native system assembly is the only model-visible owner of fixed background. */
export function sessionStablePrefixSections(session, openingText = '') {
  const prefix = readSessionStablePrefix(session)
  // Imports prepare their events before a native Session is published.
  const sections = prefix ? sourceSections(prefix.text) : openingText ? sourceSections(openingText) : []
  const directory = sessionVariableDirectorySection(session)
  return directory ? [...sections, directory] : sections
}

/** Replace only the request projection; persisted opening events remain immutable. */
export function withCurrentWorldbook(sections, context) {
  const fixed = sections.filter(section => section.name !== 'tavern:constant-worldbook')
  const text = str(context).trim()
  return text ? [{ name: 'tavern:constant-worldbook', text: '【常驻世界书】\n' + text }, ...fixed] : fixed
}
