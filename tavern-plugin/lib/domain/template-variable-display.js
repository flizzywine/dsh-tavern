import { createRequire } from 'node:module'

// parse5 is jsdom's own HTML parser, so the reply render path keeps jsdom's exact
// offsets and serialization without loading the browser-DOM graph.
// Plain replies and host startup do not need the DOM parser's dependency graph.
const require = createRequire(import.meta.url)
const cache = new Map()
let cacheBytes = 0
const skipTags = new Set(['pre', 'code', 'textarea', 'template'])
function collectVariableRanges(node, skipped, nested, ranges) {
  const children = node.childNodes
  if (!children) return
  for (const child of children) {
    const tagName = child.tagName
    if (tagName === 'initvar' || tagName === 'updatevariable') {
      const location = child.sourceCodeLocation
      if (!skipped && !nested && location && typeof location.startOffset === 'number') {
        ranges.push([location.startOffset, location.endOffset])
      }
      collectVariableRanges(child, skipped, true, ranges)
      continue
    }
    const childSkipped = skipped || skipTags.has(tagName)
    collectVariableRanges(child, childSkipped, nested, ranges)
    // Template contents live off the element tree; walk them only to keep them skipped.
    if (tagName === 'template' && child.content) collectVariableRanges(child.content, true, nested, ranges)
  }
}
function hideVariableBlocks(html) {
  if (typeof html !== 'string' || !/<(?:initvar|updatevariable)\b/i.test(html)) return html
  if (cache.has(html)) return cache.get(html)
  const source = html
  // Template HTML has already passed through Markdown and may wrap the protocol
  // in paragraphs. Parse without executing scripts; remove exact source ranges
  // rather than serializing the DOM and changing author markup or status keys.
  const { parse } = require('parse5')
  const document = parse(html, { sourceCodeLocationInfo: true })
  const ranges = []
  collectVariableRanges(document, false, false, ranges)
  for (const [start, end] of ranges.sort((a,b)=>b[0]-a[0])) html = html.slice(0,start) + html.slice(end)
  const bytes = (source.length + html.length) * 2
  if (bytes <= 4 * 1024 * 1024) {
    while (cache.size >= 64 || cacheBytes + bytes > 4 * 1024 * 1024) {
      const key = cache.keys().next().value
      cacheBytes -= (key.length + cache.get(key).length) * 2
      cache.delete(key)
    }
    cache.set(source,html); cacheBytes += bytes
  }
  return html
}

// Apply at the consumption boundary too: previously persisted render snapshots
// must become safe to display without replaying EJS or modifying MVU source data.
export function visibleTemplateDisplay(display) {
  const result = { ...display, html: hideVariableBlocks(display.html) }
  if (Array.isArray(display.parts)) result.parts = display.parts.map(part => part.kind === 'html'
    ? { ...part, content: hideVariableBlocks(part.content) }
    : part)
  return result
}

// Ordinary Markdown stays native, but its declared status fragments still need
// stable identities so a newer card template can replace an older captured one.
const statusPartsCache = new Map()
function collectStatusDeclarations(node, declarations) {
  const children = node.childNodes
  if (!children) return declarations
  const { serialize } = require('parse5')
  for (const child of children) {
    const attribute = (child.attrs || []).find(item => item.name === 'data-dsh-status-key')
    if (attribute) declarations.push({ key: decodeURIComponent(attribute.value), content: serialize(child) })
    // Matches document order, and like querySelectorAll it does not descend into template contents.
    collectStatusDeclarations(child, declarations)
  }
  return declarations
}
export function annotateTemplateStatusParts(parts, html) {
  if (!String(html).includes('data-dsh-status-key')) return structuredClone(parts)
  const key = JSON.stringify([html, parts])
  if (statusPartsCache.has(key)) return structuredClone(statusPartsCache.get(key))
  const { parse, parseFragment, serialize } = require('parse5')
  const declarations = collectStatusDeclarations(parse(html), [])
  const fragmentContext = { nodeName: 'div', tagName: 'div', attrs: [], namespaceURI: 'http://www.w3.org/1999/xhtml', childNodes: [] }
  const result = parts.map(part => {
    if (part.kind !== 'html') return structuredClone(part)
    const markup = part.content === undefined ? 'undefined' : (part.content === null ? '' : String(part.content))
    const content = serialize(parseFragment(fragmentContext, markup)).trim()
    const match = declarations.find(declaration => declaration.content.trim() === content)
    return match ? {...structuredClone(part),statusKey:match.key} : structuredClone(part)
  })
  // Bound both entry count and individual size for large imported cards.
  if (key.length < 32768) {
    if (statusPartsCache.size >= 64) statusPartsCache.delete(statusPartsCache.keys().next().value)
    statusPartsCache.set(key,structuredClone(result))
  }
  return result
}
