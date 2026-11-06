import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { isProducerSource } from './message-source.js'

const hash = text => createHash('sha256').update(text).digest('hex')
export function visibleContextMessages(session, pending = []) {
  const events = new Map(sessionEvents(session).map(event => [event.seq, event]))
  return (session?.surface?.nodes || []).map(seq => events.get(seq))
    .filter(event => event?.type === 'user/message').map(event => event.data).concat(pending)
}

// A delta is evidence only while its complete base chain remains on the surface.
// Metadata alone (after compaction or an edit) must never suppress restoration.
export function visibleWorldbookEntries(session, scope, pending = []) {
  const entries = new Map()
  for (const message of visibleContextMessages(session, pending)) {
    if (!isProducerSource(message?.source, 'dsh-tavern') || message.source.virtualWorldbook?.scope !== scope) continue
    const content = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('')
    for (const [ref, record] of Object.entries(message.source.worldbookEntrySnapshots || {})) {
      if (!record.rendered || !content.includes(record.rendered) ||
          (record.baseHash && entries.get(ref)?.hash !== record.baseHash) ||
          typeof record.text !== 'string' || record.hash !== hash(record.text)) {
        entries.delete(ref)
        continue
      }
      entries.set(ref, record)
    }
  }
  return entries
}

function deltaText(previous, text, ref) {
  const old = previous.split('\n'), next = text.split('\n')
  let start = 0, end = 0
  while (start < Math.min(old.length, next.length) && old[start] === next[start]) start++
  while (end < Math.min(old.length, next.length) - start && old[old.length - end - 1] === next[next.length - end - 1]) end++
  const removed = old.slice(start, old.length - end).join('\n')
  const added = next.slice(start, next.length - end).join('\n')
  // Never edit markup boundaries; unchanged markup in prose is safe to retain.
  if (/<\/?[A-Za-z][^>]*>/.test(removed + added)) return null
  // Only unambiguous replacements; insertion/deletion and large rewrites use a full snapshot.
  if (!removed || !added || previous.indexOf(removed) !== previous.lastIndexOf(removed)) return null
  const title = text.split('\n').find(line => /^#+\s/.test(line)) || `条目 ${ref}`
  const rendered = `【世界书局部更新：${title.replace(/^#+\s*/, '')}】\n将该条目中的以下旧段落替换为新段落；其他内容继续有效。\n旧段落：\n${removed}\n新段落：\n${added}`
  return rendered.length < text.length * 0.6 ? rendered : null
}

export function worldbookContextDelta(session, marker, text, pending = []) {
  const prior = visibleWorldbookEntries(session, marker.scope, pending)
  const records = {}, replacements = []
  for (const [ref, body] of Object.entries(marker.texts || {})) {
    if (!body || text.indexOf(body) < 0 || text.indexOf(body) !== text.lastIndexOf(body)) continue
    const previous = prior.get(ref)
    const delta = previous && previous.text !== body ? deltaText(previous.text, body, ref) : null
    const rendered = delta || body
    records[ref] = { text: body, hash: hash(body), rendered, ...(delta ? { baseHash: previous.hash } : {}) }
    if (delta) replacements.push({ body, rendered })
  }
  // Never patch overlapping entry bodies.
  if (replacements.some((a, i) => replacements.some((b, j) => i !== j && a.body.includes(b.body)))) {
    for (const record of Object.values(records)) { record.rendered = record.text; delete record.baseHash }
    return { text, records }
  }
  for (const { body, rendered } of replacements) text = text.replace(body, () => rendered)
  return { text, records }
}
