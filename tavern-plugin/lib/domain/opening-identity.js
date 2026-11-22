import { tokenizer } from 'acorn'
import { editableReplyParts } from './display-source.js'

const identity = /\{\{\s*(user|char)\s*\}\}|<(user|char)>/gi
const scriptBlock = /(<script\b(?:[^>"']|"[^"]*"|'[^']*')*>)([\s\S]*?)(<\/script\s*>)/gi
const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function encodeOpeningIdentity(value, syntax) {
  if (syntax === 'html') return value.replace(/[&<>"']/g, char => htmlEntities[char])
  if (syntax === 'text') return value
  // This content is valid inside single quotes, double quotes, template
  // literals, and JSON script blocks. Keep it inside the HTML script element.
  const quoted = JSON.stringify(value).replace(/[<'`$\u2028\u2029]/g, char =>
    '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
  return syntax === 'script-string' ? quoted.slice(1, -1) : quoted
}

function replaceIdentity(source, replace, syntaxAt) {
  return source.replace(identity, (token, macro, legacy, offset) =>
    replace((macro || legacy).toLowerCase(), syntaxAt(offset), token))
}

function replaceScriptIdentity(source, replace) {
  if (!source.match(identity)) return source
  const strings = []
  // Keep offsets while making even an unquoted identity slot lexically valid.
  const masked = source.replace(identity, slot => 'x'.repeat(slot.length))
  try {
    for (const token of tokenizer(masked, { ecmaVersion: 'latest' })) {
      if (token.type.label === 'string' || token.type.label === 'template') strings.push(token)
    }
  } catch {
    // The author can use other macros in script source. Keep the ranges read
    // before a lexer error and treat the remaining slots as standalone values.
  }
  let index = 0
  return replaceIdentity(source, replace, offset => {
    while (strings[index]?.end <= offset) index++
    return strings[index]?.start <= offset ? 'script-string' : 'script-value'
  })
}

function replaceHtmlIdentity(source, replace) {
  const html = text => replaceIdentity(text, replace, () => 'html')
  let result = '', offset = 0
  for (const match of source.matchAll(scriptBlock)) {
    const [block, open, body, close] = match
    result += html(source.slice(offset, match.index) + open) + replaceScriptIdentity(body, replace) + close
    offset = match.index + block.length
  }
  return result + html(source.slice(offset))
}

/** Map named slots without reserializing the author's HTML or Markdown. */
export function replaceOpeningIdentities(source, replace) {
  if (!source.match(identity)) return source
  if (!/<[a-z!][^>]*>/i.test(source)) return replaceIdentity(source, replace, () => 'text')
  return editableReplyParts(source).map(part => part.kind === 'html'
    ? replaceHtmlIdentity(part.text, replace)
    : replaceIdentity(part.text, replace, () => 'text')).join('')
}
