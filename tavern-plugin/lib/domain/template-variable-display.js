import { createRequire } from 'node:module'

// Plain replies and host startup do not need the DOM parser's dependency graph.
const require = createRequire(import.meta.url)
const cache = new Map()
let cacheBytes = 0
function hideVariableBlocks(html) {
  if (typeof html !== 'string' || !/<(?:initvar|updatevariable)\b/i.test(html)) return html
  if (cache.has(html)) return cache.get(html)
  const source = html
  // Template HTML has already passed through Markdown and may wrap the protocol
  // in paragraphs. Parse without executing scripts; remove exact source ranges
  // rather than serializing the DOM and changing author markup or status keys.
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM(html, { includeNodeLocations: true })
  try {
    const ranges = []
    for (const node of dom.window.document.querySelectorAll('initvar, updatevariable')) {
      if (node.closest('pre, code, textarea, template') || node.parentElement?.closest('initvar, updatevariable')) continue
      const location = dom.nodeLocation(node)
      if (location) ranges.push([location.startOffset, location.endOffset])
    }
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
  } finally { dom.window.close() }
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
export function annotateTemplateStatusParts(parts, html) {
  if (!String(html).includes('data-dsh-status-key')) return structuredClone(parts)
  const key = JSON.stringify([html, parts])
  if (statusPartsCache.has(key)) return structuredClone(statusPartsCache.get(key))
  const { JSDOM } = require('jsdom')
  const dom = new JSDOM(html)
  try {
    const declarations = [...dom.window.document.querySelectorAll('[data-dsh-status-key]')].map(node => ({
      key: decodeURIComponent(node.getAttribute('data-dsh-status-key')), content: node.innerHTML
    }))
    const result = parts.map(part => {
      if (part.kind !== 'html') return structuredClone(part)
      const fragment = dom.window.document.createElement('div')
      fragment.innerHTML = part.content
      const content = fragment.innerHTML.trim()
      const match = declarations.find(declaration => declaration.content.trim() === content)
      return match ? {...structuredClone(part),statusKey:match.key} : structuredClone(part)
    })
    // Bound both entry count and individual size for large imported cards.
    if (key.length < 32768) {
      if (statusPartsCache.size >= 64) statusPartsCache.delete(statusPartsCache.keys().next().value)
      statusPartsCache.set(key,structuredClone(result))
    }
    return result
  } finally { dom.window.close() }
}
