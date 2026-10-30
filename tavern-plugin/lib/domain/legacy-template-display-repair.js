import {createHash} from 'node:crypto'
import {Script} from 'node:vm'
import {createRequire} from 'node:module'
import {marked} from 'marked'

const require = createRequire(import.meta.url)
const cache = new Map()
let cacheBytes = 0
const damage = /<(?:pre|code|p|br)(?:\s[^>]*|)>/i
export function mayHaveLegacyTemplateDamage(display) {
  return typeof display?.html === 'string' && /<(?:script|style)\b/i.test(display.html) && /<pre>\s*<code>/i.test(display.html)
}
function validScript(text) { try { new Script(text); return true } catch { return false } }
function executable(node) { return !node.getAttribute('src') && /^(?:|text\/javascript|application\/javascript)$/.test(node.getAttribute('type') || '') }
function key(node) { return node.tagName + '\0' + (node.getAttribute('type') || '') + '\0' + node.textContent }

/** Repair only byte-matching damage reproduced by the old Markdown formatter.
 * Never evaluate templates, change narrative/history, or substitute a newer card.
 */
export function repairLegacyTemplateDisplay(display, candidate) {
  if (!mayHaveLegacyTemplateDamage(display) || /<%|&(?:amp;)*lt;%/.test(candidate.displayText)
    || !candidate.displayParts.some(part => part.kind === 'html' && /<(?:script|style)\b/i.test(part.content))) return display
  const digest = createHash('sha256').update(JSON.stringify(display)).update(candidate.displayText).digest('hex')
  if (cache.has(digest)) return structuredClone(cache.get(digest).value)
  const {JSDOM} = require('jsdom')
  const legacy = new JSDOM(marked.parse(candidate.displayText, {gfm:true}))
  const correct = new JSDOM(candidate.displayParts.filter(part=>part.kind==='html').map(part=>part.content).join('\n'))
  const replacements = new Map(), ambiguous = new Set()
  try {
    const oldNodes = [...legacy.window.document.querySelectorAll('script,style')]
    const newNodes = [...correct.window.document.querySelectorAll('script,style')]
    if (oldNodes.length === newNodes.length) oldNodes.forEach((oldNode, index) => {
      const next = newNodes[index], oldText = oldNode.textContent, newText = next.textContent
      if (oldNode.tagName !== next.tagName || oldText === newText || !damage.test(oldText)) return
      if (oldNode.tagName === 'SCRIPT' && (!executable(oldNode) || !executable(next) || validScript(oldText) || !validScript(newText))) return
      if (oldNode.tagName === 'STYLE' && damage.test(newText)) return
      const signature = key(oldNode)
      if (replacements.has(signature) && replacements.get(signature) !== newText) ambiguous.add(signature)
      replacements.set(signature,newText)
    })
  } finally { legacy.window.close(); correct.window.close() }
  for (const signature of ambiguous) replacements.delete(signature)
  let changed = false
  function repair(html) {
    if (typeof html !== 'string' || !replacements.size) return html
    const dom = new JSDOM(html, {includeNodeLocations:true})
    try {
      const edits = []
      for (const node of dom.window.document.querySelectorAll('script,style')) {
        const replacement = replacements.get(key(node)), location = dom.nodeLocation(node)
        if (replacement !== undefined && location?.startTag && location?.endTag) edits.push({start:location.startTag.endOffset,end:location.endTag.startOffset,replacement})
      }
      for (const edit of edits.sort((a,b)=>b.start-a.start)) html = html.slice(0,edit.start)+edit.replacement+html.slice(edit.end)
      changed ||= edits.length > 0
      return html
    } finally { dom.window.close() }
  }
  const result = {...display,html:repair(display.html)}
  if (Array.isArray(display.parts)) result.parts = display.parts.map(part=>part.kind==='html' ? {...part,content:repair(part.content)} : part)
  const value = changed ? result : display
  const bytes = JSON.stringify(value).length * 2
  if (bytes <= 4 * 1024 * 1024) {
    while (cache.size >= 32 || cacheBytes + bytes > 4 * 1024 * 1024) {
      const first = cache.keys().next().value
      cacheBytes -= cache.get(first).bytes; cache.delete(first)
    }
    cache.set(digest,{value:structuredClone(value),bytes}); cacheBytes += bytes
  }
  return value
}
