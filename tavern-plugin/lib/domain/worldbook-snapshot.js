import { sessionEvents } from './session-events.js'
import { isProducerSource } from './message-source.js'

// Entries are already rendered. Only structural tags spanning entry boundaries
// may be repeated around a delta; unchanged bodies never travel with them.
function renderDelta(entries, changed) {
  const stack = [], spans = []
  entries.forEach((entry, index) => {
    const tags = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)\s*([\p{L}_][\p{L}\p{N}_:.-]*)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*?)?\s*(\/?)>/gu
    for (const match of entry.text.matchAll(tags)) {
      const [, closing, name, selfClosing] = match
      if (!name || selfClosing || /^(?:br|hr|img|input|meta|link)$/i.test(name)) continue
      const tag = { index, offset: match.index, text: match[0], name }
      if (!closing) stack.push(tag)
      else if (stack.at(-1)?.name === name) {
        const start = stack.pop()
        if (start.index !== index) spans.push([start, tag])
      }
    }
  })
  const scaffolding = new Map()
  for (const [start, end] of spans) {
    if (!entries.some((_, index) => index >= start.index && index <= end.index && changed.has(index))) continue
    for (const tag of [start, end]) {
      if (changed.has(tag.index)) continue
      if (!scaffolding.has(tag.index)) scaffolding.set(tag.index, new Map())
      scaffolding.get(tag.index).set(tag.offset, tag.text)
    }
  }
  const parts = entries.map((entry, index) => changed.has(index) ? entry.text
    : [...(scaffolding.get(index) || [])].sort(([a], [b]) => a - b).map(([, text]) => text).join(''))
  return { text: parts.filter(Boolean).join('\n\n'),
    // A tags-only entry can also be fully visible as scaffolding after compaction.
    entries: entries.filter((entry, index) => entry.text && entry.text === parts[index]).map(({ ref, text }) => ({ ref, text })) }

}

// Surface, not Chat read/cooldown records, is the reusable version authority.
// Rewinding or compacting a node removes its entries from this derived index.
export function worldbookSnapshot(session, entries, pendingMessages = []) {
  const events = typeof session?.eventAt === 'function' ? null : new Map(sessionEvents(session).map(event => [event.seq, event]))
  const messages = (session?.surface?.nodes || []).map(seq => events ? events.get(seq) : session.eventAt(seq))
    .filter(event => event?.type === 'user/message').map(event => event.data).concat(pendingMessages)
  const visible = new Map()
  for (const message of messages) {
    const record = message?.source?.worldbookSnapshot
    if (!isProducerSource(message?.source, 'dsh-tavern') || record?.schemaVersion !== 2) continue
    const content = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('')
    if (content.includes(record.rendered)) for (const entry of record.entries) visible.set(entry.ref, entry.text)
  }
  const changed = new Set()
  entries.forEach((entry, index) => {
    if (entry.text && visible.get(entry.ref) !== entry.text) changed.add(index)
    visible.set(entry.ref, entry.text)
  })
  if (!changed.size) return null
  const delta = renderDelta(entries, changed)
  const rendered = `【本轮世界书上下文】\n${delta.text}`
  return { schemaVersion: 2, ...delta, rendered }
}
