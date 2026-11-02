import { placementKey, promptOrder } from './worldbook-activation.js'
import { hasWorldbookRandom } from './worldbook-random.js'

// Every EJS body is executable and may change, even without a known state-read helper.
export function hasWorldbookStateReads(content) {
  const text = String(content || '')
  if (/\{\{\s*(?:lastmessage|lastusermessage|lastcharmessage|lastmessageid)\b/i.test(text)) return true
  return /<%[\s\S]*?%>/.test(text)
}

// Separate fixed bodies from changing bodies while keeping both projections wrapped.
export function worldbookPlacement(entries, renderedEntries = []) {
  const rendered = new Map(renderedEntries.map(entry => [entry.ref, entry.content]))
  const ordered = promptOrder(entries.filter(entry => entry.enabled !== false))
  const refs = new Set(ordered.filter(entry => !entry.constant || entry.group || (hasWorldbookRandom(entry.content) || hasWorldbookStateReads(entry.content))).map(entry => entry.ref))
  const buckets = new Map()
  for (const entry of ordered) {
    const key = placementKey(entry)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(entry)
  }
  const wrapperSpans = []
  for (const bucket of buckets.values()) {
    const stack = [], spans = []
    bucket.forEach((entry, index) => {
      const text = String(rendered.get(entry.ref) ?? entry.content ?? '').replace(/<%[\s\S]*?%>/g, '')
      for (const match of text.matchAll(/<(\/?)\s*([\p{L}_][\p{L}\p{N}_:.-]*)(?:\s[^<>]*?)?\s*(\/?)>/gu)) {
        const [, closing, name, selfClosing] = match
        if (selfClosing || /^(?:br|hr|img|input|meta|link)$/i.test(name)) continue
        if (!closing) stack.push({ name, index })
        else if (stack.at(-1)?.name === name) {
          const start = stack.pop().index
          if (start !== index) spans.push([start, index])
        }
      }
    })
    // Only split standalone tag entries; prose or executable boundary templates
    // remain intact with their span rather than losing their original scope.
    for (const [start, end] of spans) if (bucket.slice(start, end + 1).some(entry => refs.has(entry.ref))) {
      const boundary = [bucket[start], bucket[end]]
      const tagsOnly = boundary.every(entry => entry.constant && !entry.group && !(hasWorldbookRandom(entry.content) || hasWorldbookStateReads(entry.content)) && !String(entry.content).replace(/<\/?[\p{L}_][\p{L}\p{N}_:.-]*\s*>/gu, '').trim())
      if (tagsOnly) {
        boundary.forEach(entry => refs.add(entry.ref))
        wrapperSpans.push(bucket.slice(start, end + 1))
      } else for (const entry of bucket.slice(start, end + 1)) refs.add(entry.ref)
    }
  }
  const prefixRefs = new Set(ordered.filter(entry => !refs.has(entry.ref)).map(entry => entry.ref))
  for (const span of wrapperSpans) if (span.some(entry => prefixRefs.has(entry.ref))) {
    prefixRefs.add(span[0].ref)
    prefixRefs.add(span.at(-1).ref)
  }
  return { foregroundRefs: refs, prefixRefs }
}
