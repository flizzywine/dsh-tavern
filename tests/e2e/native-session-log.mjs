import { parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'

// DSH persistence stores consecutive sourceEventSeqs as [start, end] ranges.
// Session.create expects the expanded seq list, so decode them like the host does.
export function parseNativeSessionLog(buffer) {
  const parsed = parseSessionLog(buffer)
  for (const event of parsed.events) {
    if (!event.sourceEventSeqs?.some(Array.isArray)) continue
    event.sourceEventSeqs = event.sourceEventSeqs.flatMap(entry => {
      if (!Array.isArray(entry)) return [entry]
      const [start, end] = entry
      return Array.from({ length: end - start + 1 }, (_, index) => start + index)
    })
  }
  return parsed
}
