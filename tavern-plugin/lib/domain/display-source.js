import { marked } from 'marked'
import { fencedSegments } from './html-fenced-segments.js'

function str(value) { return value == null ? '' : String(value) }

function hasRawHtml(value) {
  if (!/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(str(value))) return false
  try {
    // Code examples are Markdown, not active HTML. Inspect nested inline tokens
    // as well, so raw HTML in lists/emphasis still retains iframe isolation.
    let found = false
    marked.walkTokens(marked.lexer(str(value), { gfm: true }), function (token) {
      if (token.type === 'html') found = true
    })
    return found
  } catch (_error) {
    return true
  }
}

// Markdown HTML blocks may extend past a closing tag until the next blank line.
// Recover element boundaries without parsing/re-serializing author scripts or markup.
// Bare non-HTML tags are narrative protocol delimiters. HTML elements and
// custom elements/attribute-bearing UI stay opaque, including everything inside.
const HTML_ELEMENTS = new Set(('html head body title base link meta style script noscript template slot ' +
  'address article aside footer header h1 h2 h3 h4 h5 h6 hgroup main nav search section ' +
  'blockquote dd div dl dt figcaption figure hr li menu ol p pre ul a abbr b bdi bdo br cite code data dfn em i kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr ' +
  'area audio img map track video embed iframe object picture source canvas svg math portal ' +
  'del ins caption col colgroup table tbody td tfoot th thead tr button datalist fieldset form input label legend meter optgroup option output progress select textarea ' +
  'details dialog summary acronym applet big center dir font frame frameset marquee noframes param strike tt xmp').split(' '))
function isNarrativeTag(tag, token) {
  return tag && !HTML_ELEMENTS.has(tag) && !/[-:]/.test(tag) && /^<\/?[a-z][\w]*\s*\/?\s*>$/i.test(token)
}

function splitHtmlBoundaries(source, editing = false) {
  const segments = []
  const stack = []
  const voidTags = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
  const tokens = /<!--[\s\S]*?(?:-->|$)|<!doctype\b[^>]*>|<\/?([a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*?>|(`+)[\s\S]*?\2/gi
  let cursor = 0
  let start = -1
  function append(kind, value) {
    if (!value) return
    const previous = segments[segments.length - 1]
    if (previous && (previous.kind === kind || !value.trim())) {
      previous[previous.kind === 'html' ? 'content' : 'text'] += value
    } else segments.push(kind === 'html' ? { kind, content: value } : { kind, text: value })
  }
  let token
  while ((token = tokens.exec(source))) {
    if (token[2]) continue // Inline code is prose, never executable HTML.
    const tag = (token[1] || '').toLowerCase()
    const closing = /^<\//.test(token[0])
    // Variable protocols contain runtime data, not narrative prose. Keep the
    // complete block in editable/source history, but omit it from display.
    // Author HTML/script interiors and Markdown code examples stay opaque.
    // hidden reasoning/status protocols must not become stage prose.
    if (!editing && start < 0 && ['think', 'thinking', 'analysis', 'reasoning', 'updatevariable', 'initvar', 'variable-update'].includes(tag)) {
      append('text', source.slice(cursor, token.index))
      if (!closing && !/\/\s*>$/.test(token[0])) {
        const boundary = new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi')
        boundary.lastIndex = tokens.lastIndex
        let depth = 1, next
        while (depth && (next = boundary.exec(source))) {
          if (/^<\//.test(next[0])) depth--
          else if (!/\/\s*>$/.test(next[0])) depth++
        }
        tokens.lastIndex = depth ? source.length : boundary.lastIndex
      }
      append('marker', source.slice(token.index, tokens.lastIndex))
      cursor = tokens.lastIndex
      continue
    }
    if (!editing && start < 0 && /^<!--/.test(token[0])) {
      append('text', source.slice(cursor, token.index))
      append('marker', token[0])
      cursor = tokens.lastIndex
      continue
    }
    if (isNarrativeTag(tag, token[0])) {
      if (start < 0) {
        append('text', source.slice(cursor, token.index))
        // Editing shows the card's protocol tags inline; splitting at each one
        // scattered one reply over many boxes (<now_plot>, <LiveRoom>, <pic>…).
        append(editing ? 'text' : 'marker', token[0])
        cursor = tokens.lastIndex
      }
      continue
    }
    if (start < 0) {
      append('text', source.slice(cursor, token.index))
      start = token.index
    }
    if (closing) {
      const index = stack.lastIndexOf(tag)
      if (index >= 0) stack.length = index
    } else if (tag && !voidTags.has(tag) && !/\/\s*>$/.test(token[0])) {
      stack.push(tag)
      // Script/style strings can contain arbitrary tags; only their end tag matters.
      if (['script', 'style', 'textarea', 'title'].includes(tag)) {
        const end = new RegExp('</' + tag + '\\s*>', 'gi')
        end.lastIndex = tokens.lastIndex
        const match = end.exec(source)
        if (!match) { tokens.lastIndex = source.length; break }
        tokens.lastIndex = end.lastIndex
        stack.pop()
      }
    }
    if (!stack.length) {
      append('html', source.slice(start, tokens.lastIndex))
      cursor = tokens.lastIndex
      start = -1
    }
  }
  if (start >= 0) append('html', source.slice(start)) // Unclosed UI remains isolated.
  else append('text', source.slice(cursor))
  return segments
}

// These are narrative protocol markers, not author-provided HTML UI containers.
function unwrapNarrativeContent(value) {
  const match = str(value).match(/^\s*<(content|gametxt)>\s*\r?\n?([\s\S]*?)\r?\n?\s*<\/\1>([\s\S]*)$/i)
  return match === null ? null : { body: match[2], rest: match[3] }
}

function splitPlainSegment(value, editing = false) {
  const source = str(value)
  const narrative = editing ? null : unwrapNarrativeContent(source)
  if (narrative !== null) {
    const parts = splitPlainSegment(narrative.body)
    if (narrative.rest.trim()) parts.push(...splitPlainSegment(narrative.rest))
    return parts.filter(part => (part.text ?? part.content).trim())
  }
  if (!hasRawHtml(source)) return [{ kind: 'text', text: source }]
  try {
    // Protect Markdown code blocks before scanning; retain exact source offsets.
    const normalized = source.replace(/\r\n?/g, '\n')
    const tokens = marked.lexer(normalized, { gfm: true })
    const masked = tokens.map(token => token.type === 'code'
      ? str(token.raw).replace(/[^\r\n]/g, 'x') : str(token.raw)).join('')
    if (masked.length !== normalized.length) return [{ kind: 'html', content: source }]
    let offset = 0
    return splitHtmlBoundaries(masked, editing).map(part => {
      const key = part.kind === 'html' ? 'content' : 'text'
      const start = offset
      for (let index = 0; index < part[key].length; index += 1) {
        offset += source[offset] === '\r' && source[offset + 1] === '\n' ? 2 : 1
      }
      const original = source.slice(start, offset)
      return { kind: part.kind, [key]: original }
    })
  } catch (_error) {
    return [{ kind: 'html', content: source }]
  }
}

/** Shared, lossless classification for editing, visible replies and template mirrors. */
export function displaySourceSegments(value, {editing = false} = {}) {
  return fencedSegments(value).flatMap(segment => segment.kind === 'html'
    ? [{...segment, fenced:true}]
    : splitPlainSegment(segment.text, editing))
}

/** Lossless editing ranges: HTML (including its fences) remains opaque. */
export function editableReplyParts(value) {
  return displaySourceSegments(value, {editing:true}).map(part => ({
    kind:part.kind, text:part.kind === 'html' ? (part.fenced ? part.raw : part.content) : part.text
  }))
}

/** Native prose and isolated HTML share one ordered projection. */
export function projectDisplayParts(value) {
  return {
    parts:displaySourceSegments(value).filter(part=>part.kind!=='marker').map(part=>part.kind==='html'
      ? {kind:'html',content:part.content} : {kind:'markdown',text:part.text}),
    warnings:[]
  }
}

/** Match renderable HTML regardless of whether it came from regex or model output. */
export function hasHtmlCodeBlock(value) {
  return fencedSegments(value).some(function (segment) { return segment.kind === 'html' })
}

/** Classify whether the display projection needs isolated rich rendering. */
export function displayModeOf(value) {
  return projectDisplayParts(value).parts.some(part => part.kind === 'html') ? 'html' : 'markdown'
}
