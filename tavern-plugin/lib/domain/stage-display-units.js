import { parseBubbles, stripBubbleCodeQuote } from '../../src/client/bubble-line.cjs'
// Host-only paragraph authority. Preserve original dialogue spelling and speech fields.
export function stageDisplayUnits(parts, stripCodeQuote = stripBubbleCodeQuote, parse = parseBubbles, streaming = false) {
  const units = []
  // Use the same projected Markdown part boundaries as BubbleMarkdown. Never
  // scan HTML interiors: a status frame may contain blank lines or bubble syntax.
  for (const part of parts) {
    if (part.kind !== 'markdown') continue
    let buffer = []
    function flush() {
      for (const block of buffer.join('\n').split(/\n\s*\n/)) {
        if (!block.trim() || /^\s*</.test(block) || /^\s*[-*_]{3,}\s*$/.test(block)) continue
        units.push({ kind: 'narration', text: block.trim() })
      }
      buffer = []
    }
    const lines = String(part.text || '').split('\n')
    for (const [index, original] of lines.entries()) {
      const line = stripCodeQuote(original)
      const segments = parse(line, streaming && part === parts.at(-1) && index === lines.length - 1)
      const bubble = segments.find(segment => segment.kind === 'bubble')
      if (bubble || !segments.length) {
        flush()
        if (bubble) units.push({ kind: 'line', alias: bubble.alias, name: bubble.name, text: original.trim() })
        continue
      }
      // an unparseable @bubble line is narration of its degraded text, never its raw syntax.
      buffer.push(segments.map(segment => segment.text).join('\n'))
    }
    flush()
  }
  return units
}

