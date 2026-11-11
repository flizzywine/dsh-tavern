/** Page tool text with one-based offsets and a bounded character count. */
export function readTextPage(text, request) {
  const offset = Number.isInteger(request.offset) && request.offset > 0 ? request.offset : 1
  const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(request.limit, 12000)) : 6000
  const start = Math.min(offset - 1, text.length)
  const chunk = text.slice(start, start + limit)
  return {
    text: chunk,
    totalChars: text.length,
    from: chunk.length > 0 ? start + 1 : 0,
    to: chunk.length > 0 ? start + chunk.length : 0,
    done: start + chunk.length >= text.length
  }
}
