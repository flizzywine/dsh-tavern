// Structural gate, not a CSS property validator. Browsers silently recover malformed blocks.
export function checkCssSyntax(source, filename = 'stylesheet') {
  const blocks = [], parens = [], brackets = []
  let quote = '', quotedAt = 0, commentAt = -1
  const fail = (message, at) => {
    const before = source.slice(0, at)
    throw new SyntaxError(`${filename}:${before.split('\n').length}:${at - before.lastIndexOf('\n')}: ${message}`)
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1]
    if (commentAt >= 0) {
      if (c === '*' && next === '/') { commentAt = -1; i++ }
      continue
    }
    if (c === '\\') { i += next === '\r' && source[i + 2] === '\n' ? 2 : 1; continue }
    if (quote) {
      if (c === quote) quote = ''
      else if (/[\r\n\f]/.test(c)) fail('Unterminated CSS string', quotedAt)
      continue
    }
    if (c === '/' && next === '*') { commentAt = i; i++; continue }
    if (c === '"' || c === "'") { quote = c; quotedAt = i; continue }
    if (c === '(') parens.push(i)
    else if (c === ')') { if (!parens.length) fail('Unexpected CSS )', i); parens.pop() }
    // Unquoted URL payloads can contain braces; they are not rule delimiters.
    else if (!parens.length) {
      if (c === '[') brackets.push(i)
      else if (c === ']') { if (!brackets.length) fail('Unexpected CSS ]', i); brackets.pop() }
      else if (c === '{' || c === '}') {
        if (brackets.length) fail('Unclosed CSS [', brackets.at(-1))
        if (c === '{') blocks.push(i)
        else { if (!blocks.length) fail('Unexpected CSS }', i); blocks.pop() }
      }
    }
  }
  if (commentAt >= 0) fail('Unterminated CSS comment', commentAt)
  if (quote) fail('Unterminated CSS string', quotedAt)
  if (parens.length) fail('Unclosed CSS (', parens.at(-1))
  if (brackets.length) fail('Unclosed CSS [', brackets.at(-1))
  if (blocks.length) fail('Unclosed CSS {', blocks.at(-1))
}
