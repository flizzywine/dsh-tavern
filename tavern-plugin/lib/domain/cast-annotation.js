// Who speaks each quoted line of a turn and how they feel, as settlement annotated it before the story model wrote
// its lines as dialogue bubbles (docs/design/cast-presentation.md). Earlier turns keep the annotation they have.
import { CAST_EMOTIONS } from './dialogue-bubbles.js'

export { CAST_EMOTIONS }
// Data owner in the per-game turn data store shared with plugins.
export const CAST_DATA_OWNER = 'dsh-tavern.cast'

// Same-line quote pairs, the delimiters the client colours as dialogue.
const QUOTE_PATTERN = /"([^"\r\n]+)"|“([^”\r\n]+)”|«([^»\r\n]+)»|「([^」\r\n]+)」|『([^』\r\n]+)』|＂([^＂\r\n]+)＂/g

/** Quoted lines of a story text, in reading order, without their delimiters. */
export function dialogueQuotes(text) {
  const quotes = []
  for (const match of String(text ?? '').matchAll(QUOTE_PATTERN)) {
    const quote = match.slice(1).find(group => group !== undefined).trim()
    if (quote) quotes.push(quote)
  }
  return quotes
}

/**
 * An edited reply keeps its speakers: a line whose quote is unchanged keeps its speaker and
 * emotion; when the edit kept the number of quotes, a reworded quote keeps the speaker of the
 * quote at its place. Quotes the edit added stay unannotated.
 */
export function carryCastLines(lines, oldQuoteCount, quotes) {
  const old = [...(Array.isArray(lines) ? lines : [])].sort((left, right) => left.n - right.n)
  const taken = new Map()
  let cursor = 0
  quotes.forEach((quote, index) => {
    for (let at = cursor; at < old.length; at++) {
      if (old[at].quote !== quote) continue
      taken.set(index, old[at])
      old[at] = null
      cursor = at + 1
      return
    }
  })
  if (oldQuoteCount === quotes.length) {
    for (const line of old) if (line && !taken.has(line.n - 1)) taken.set(line.n - 1, line)
  }
  return [...taken.entries()].sort((left, right) => left[0] - right[0])
    .map(([index, line]) => ({ n: index + 1, quote: quotes[index], speaker: line.speaker, emotion: line.emotion }))
}
