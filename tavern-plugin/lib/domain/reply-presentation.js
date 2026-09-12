import { createHash } from 'node:crypto'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { marked } from 'marked'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Display refreshes resolve identity only; never replay stateful/random macros. */
export function resolveDisplayIdentityMacros(value, options = {}) {
  return str(value).replace(/\{\{\s*(user|char)\s*\}\}/gi, (token, name) => {
    if (name.toLowerCase() === 'user') return str(options.macroState?.userName) || '你'
    return str(options.charName) || token
  })
}

function isHtmlSource(value, info = '') {
  const content = str(value)
  const language = str(info).trim().split(/\s+/, 1)[0].toLowerCase()
  // Some imported card regexes label whole UI documents as text. Keep snippets
  // and narrative protocol tags literal; only promote a complete HTML document.
  if (language === 'text') return /^\s*(?:<!doctype\s+html\s*>\s*)?<html(?:\s[^<>]*?)?>[\s\S]*<\/html>\s*$/i.test(content)
  if (language !== '') return language === 'html' || language === 'htm'
  return /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(content)
}

function fencedSegments(value) {
  const lines = str(value).match(/.*(?:\r?\n|$)/g) || []
  const segments = []
  let plain = ''
  let fence = null
  let fenced = ''
  let content = ''
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '')
    if (fence === null) {
      const opening = bare.match(/^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/)
      if (opening !== null) {
        fence = { character: opening[1][0], length: opening[1].length, info: opening[2] }
        fenced = line
        content = ''
      } else {
        plain += line
      }
      continue
    }
    fenced += line
    const closing = bare.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/)
    if (closing !== null && closing[1][0] === fence.character && closing[1].length >= fence.length) {
      if (isHtmlSource(content, fence.info)) {
        if (plain !== '') segments.push({ kind: 'text', text: plain })
        segments.push({ kind: 'html', content, raw: fenced })
        plain = ''
      } else {
        plain += fenced
      }
      fence = null
      fenced = ''
      content = ''
      continue
    }
    content += line
  }
  if (fence !== null) plain += fenced
  if (plain !== '') segments.push({ kind: 'text', text: plain })
  return segments
}

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
    if (!editing && start < 0 && /^<!--/.test(token[0])) {
      append('text', source.slice(cursor, token.index))
      append('marker', token[0])
      cursor = tokens.lastIndex
      continue
    }
    if (isNarrativeTag(tag, token[0])) {
      if (start < 0) {
        append('text', source.slice(cursor, token.index))
        append('marker', token[0])
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

/** Lossless editing ranges: HTML (including its fences) remains opaque. */
export function editableReplyParts(value) {
  return fencedSegments(value).flatMap(segment => segment.kind === 'html'
    ? [{ kind: 'html', text: segment.raw }]
    : splitPlainSegment(segment.text, true).map(part => ({ kind: part.kind, text: part.kind === 'html' ? part.content : part.text })))
}

/** Native prose and isolated block HTML share one ordered projection; keep element interiors intact. */
export function projectDisplayParts(value) {
  const segments = fencedSegments(value)
  return {
    parts: segments.flatMap(function (segment) {
      if (segment.kind === 'html') return { kind: 'html', content: segment.content }
      return splitPlainSegment(segment.text).filter(part => part.kind !== 'marker').map(function (part) {
        return part.kind === 'html'
          ? { kind: 'html', content: part.content }
          : { kind: 'markdown', text: part.text }
      })
    }),
    warnings: []
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

function targetOptions(options, isMarkdown) {
  return {
    placement: options.placement,
    isMarkdown,
    isEdit: options.isEdit,
    depth: options.depth
  }
}

/**
 * Project one authoritative model reply independently for Session and display.
 * Regex execution only transforms strings; it never extracts HTML or changes
 * where matched content belongs in the message.
 */
export function projectReplyLayers(value, options = {}) {
  const sourceText = str(value)
  const projectionText = Object.prototype.hasOwnProperty.call(options, 'projectionText')
    ? str(options.projectionText)
    : sourceText
  const scripts = Array.isArray(options.regexScripts) ? options.regexScripts : []
  const session = applyTavernRegexText(projectionText, scripts, targetOptions(options, false))
  const displayOptions = targetOptions(options, true)
  let display = applyTavernRegexText(projectionText, scripts, displayOptions)
  // Some cards encode dialogue inside now_plot. Recover an omitted wrapper
  // only when that card's own active renderer recognizes the repaired text.
  // Never persist this display repair into model context or editable source.
  if (/^\s*@bubble:/m.test(projectionText) && !/<\/?now_plot\b/i.test(projectionText)) {
    const candidates = scripts.filter(script =>
      str(script.findRegex).includes('<now_plot>') &&
      str(script.replaceString).includes('@bubble')
    )
    const wrapped = '<now_plot>\n' + projectionText + '\n</now_plot>'
    const probe = applyTavernRegexText(wrapped, candidates, displayOptions)
    if (probe.applied.length > 0) {
      display = applyTavernRegexText(wrapped, scripts, displayOptions)
      display.warnings.push('气泡显示：已为卡片渲染规则补齐缺失的 now_plot 标签（仅显示）')
    }
  }
  display.text = resolveDisplayIdentityMacros(display.text, options)
  const displayProjection = projectDisplayParts(display.text)
  const displayMode = displayProjection.parts.some(part => part.kind === 'html') ? 'html' : 'markdown'

  return {
    sourceText,
    projectionText,
    sessionText: session.text,
    displayText: display.text,
    displayMode,
    displayParts: displayProjection.parts,
    applied: {
      session: session.applied,
      display: display.applied
    },
    warnings: session.warnings.map(function (warning) { return 'Session：' + warning })
      .concat(display.warnings.map(function (warning) { return '展示：' + warning }))
      .concat(displayProjection.warnings)
  }
}

function isNativeMarkdownProjection(parts, sessionText) {
  return Array.isArray(parts) && parts.length === 1 && parts[0]?.kind === 'markdown' && str(parts[0].text) === str(sessionText)
}

/** Bound retained projection data as well as entry count; oversized replies bypass caching. */
export function createReplyHistoryProjector({ maxCacheBytes = 16 * 1024 * 1024, maxCacheEntries = 2048 } = {}) {
  const cache = new Map()
  let bytes = 0, hits = 0, misses = 0
  function digest(value) { return createHash('sha256').update(value).digest('hex') }
  function projectCached(sourceText, projectionText, options, signature) {
    const key = createHash('sha256').update(signature).update(String(sourceText.length) + ':')
      .update(sourceText).update(String(projectionText.length) + ':').update(projectionText).digest('hex')
    let item = cache.get(key)
    if (item) {
      hits++
      cache.delete(key)
      cache.set(key, item)
    } else {
      misses++
      const projected = projectReplyLayers(sourceText, Object.assign({}, options, { projectionText }))
      const value = { displayText: projected.displayText, displayMode: projected.displayMode,
        displayParts: projected.displayParts, warnings: projected.warnings }
      // This is a conservative payload estimate, not a measurement of V8 heap usage.
      const size = value.displayText.length * 2 > maxCacheBytes ? Infinity : JSON.stringify(value).length * 2 + 256
      if (size > maxCacheBytes || maxCacheEntries <= 0) return value
      while (cache.size && (bytes + size > maxCacheBytes || cache.size >= maxCacheEntries)) {
        const oldest = cache.keys().next().value
        bytes -= cache.get(oldest).size
        cache.delete(oldest)
      }
      item = { value, size }
      cache.set(key, item)
      bytes += size
    }
    // Callers may annotate returned parts; never expose mutable cached objects.
    return structuredClone(item.value)
  }
  function projectHistory(messages, options = {}) {
    const signature = digest(JSON.stringify({ regexScripts: options.regexScripts || [],
      charName: options.charName, userName: options.macroState?.userName,
      placement: options.placement, isEdit: options.isEdit, depth: options.depth }))
    const projections = []
    let inferredTurn = 1
    let latestSourceBacked = false

    for (const message of Array.isArray(messages) ? messages : []) {
      if (message === null || typeof message !== 'object') continue
      if (message.role === 'user') {
        inferredTurn += 1
        continue
      }
      if (message.role !== 'assistant') continue

      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : inferredTurn))
      if (turn === 0) continue
      const hasSource = Object.prototype.hasOwnProperty.call(message, 'sourceText')
      const sourceText = hasSource ? str(message.sourceText) : str(message.text)
      const projectionText = Object.prototype.hasOwnProperty.call(message, 'projectionText')
        ? str(message.projectionText)
        : sourceText
      const projected = projectCached(sourceText, projectionText, options, signature)
      const sessionText = str(message.text)

      if (message.bodyEdit || !isNativeMarkdownProjection(projected.displayParts, sessionText) || (Array.isArray(message.swipes) && message.swipes.length > 1)) {
        projections.push({
          version: 2,
          turn,
          text: projected.displayText,
          mode: projected.displayMode,
          parts: projected.displayParts,
          warnings: projected.warnings
        })
      }
      latestSourceBacked = hasSource
    }

    return { projections, presentation: null, latestSourceBacked }
  }
  projectHistory.cacheStats = () => ({ entries: cache.size, estimatedBytes: bytes, hits, misses })
  return projectHistory
}

export const projectReplyHistory = createReplyHistoryProjector()

/**
 * Transitional old-shape adapter. New callers should use projectReplyLayers().
 * presentationHtml stays empty because HTML now remains inside displayText.
 */
export function projectReplyPresentation(value, options = {}) {
  const layers = projectReplyLayers(value, options)
  return Object.assign({}, layers, {
    bodyText: layers.sessionText,
    presentationHtml: '',
    regexApplied: layers.applied.display.length > 0,
    appliedRegexes: layers.applied.display
  })
}
