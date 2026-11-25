import { marked } from 'marked'
import { stripWritingSystemReminders } from './writing-system-reminders.js'

const FRONT_MATTER = /^(?:\uFEFF)?---[ \t]*\r?\n(?:[^\r\n]*\r?\n)*?---[ \t]*(?:\r?\n|$)/
const PROSE_FENCE = /^(?:text|txt|plain|plaintext|md|markdown)$/i
const TERMINAL_LINE = /^(?:\$\s+|PS\s+[^>]*>\s*|[\w.-]+@[\w.-]+[^$]*\$\s+|(?:命令行|终端命令|command)\s*[:：]|(?:git|npm|npx|pnpm|yarn|curl|bash|zsh|powershell|node|python3?|mkdir|cd)\s+\S|(?:ls|rm|cat|cp|mv|grep|rg|find|echo|open|brew)\s+[-~./\\]|(?:ls|pwd|whoami)$)/i
const QUOTED_PATH = /(["'])(?:[a-z]:[/\\]|~[/\\]|\.{1,2}[/\\]|\/)[^"'<>]+\1/gi
const PATH = /(?<![\p{L}\p{N}_.:/\\])(?:[a-z]:[/\\]|~[/\\]|\.{1,2}[/\\]|\/(?=[\p{L}\p{N}_.-])|(?:references|scripts|config|resources|node_modules)[/\\])[^\s"'`<>()[\]{}，。！？；、：]+/giu
const FILE_NAME = /(?<![\p{L}\p{N}_.:/\\])(?:[\p{L}\p{N}_.-]+[/\\])*[\p{L}\p{N}_.-]+\.(?:jsonl?|ya?ml|toml|ini|conf|env|log|md|mjs|cjs|jsx?|tsx?|py|sh|ps1|bat|cmd|html|css|txt)\b/giu
const PATH_LABEL = /^(?:目录|路径|文件路径|文件目录|参考文件|配置文件|file(?: path)?|directory)\s*[:：]/i

function withoutJson(text) {
  const starts = /\{(?=\s*["}])|\[(?=\s*(?:["{\[\d\-\]]|(?:true|false|null)\b))/g
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}[\]]/g
  let output = '', copiedTo = 0
  for (let start; (start = starts.exec(text));) {
    let depth = 1, token
    tokens.lastIndex = starts.lastIndex
    while (depth && (token = tokens.exec(text))) {
      if (token[0] === '{' || token[0] === '[') depth++
      if (token[0] === '}' || token[0] === ']') depth--
    }
    if (depth) break
    const end = tokens.lastIndex
    starts.lastIndex = end
    try { JSON.parse(text.slice(start.index, end)) } catch { continue }
    output += text.slice(copiedTo, start.index)
    copiedTo = end
  }
  return output + text.slice(copiedTo)
}

function inlineText(tokens) {
  return tokens.map(token => {
    if (token.type === 'html' || token.type === 'image') return ''
    if (token.type === 'codespan' && TERMINAL_LINE.test(token.text.trim())) return ''
    if (token.type === 'br') return '\n'
    return token.tokens ? inlineText(token.tokens) : token.text ?? token.raw
  }).join('')
}

function proseBlocks(tokens) {
  return tokens.map(token => {
    if (token.type === 'code') return PROSE_FENCE.test(token.lang) ? token.text + '\n' : ''
    if (token.type === 'def' || token.type === 'hr') return ''
    if (token.type === 'space') return '\n'
    if (token.type === 'blockquote') return proseBlocks(token.tokens)
    if (token.type === 'list') return token.items.map(item => proseBlocks(item.tokens)).join('')
    if (token.type === 'table') return [token.header, ...token.rows]
      .map(row => row.map(cell => inlineText(cell.tokens)).join('　')).join('\n') + '\n'
    return (token.tokens ? inlineText(token.tokens) : token.text ?? token.raw) + '\n'
  }).join('')
}

export function writingMaterialText(value) {
  const text = stripWritingSystemReminders(String(value ?? '')).trimStart()
  const source = text.replace(FRONT_MATTER, '')
    .replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
  const prose = withoutJson(proseBlocks(marked.lexer(source)))
  return prose.split(/\r?\n/).map(line => {
    const text = line.trim()
    if (TERMINAL_LINE.test(text) || /^[├└│]/.test(text)) return ''
    const clean = text.replace(/<\/?[a-z][\w:-]*(?:\s[^<>]*)?\s*\/?>/gi, '')
      .replace(QUOTED_PATH, '').replace(PATH, '').replace(FILE_NAME, '').trim()
    return PATH_LABEL.test(text) && clean !== text ? '' : clean
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
