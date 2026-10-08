function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function stripLegacyPresentationSuffix(value) {
  const text = str(value)
  const style = text.search(/(?:^|\n)\s*<style\b/i)
  const startsAsHtml = /^\s*(?:<!doctype\b|<!--|<html\b|<head\b|<body\b|<[A-Za-z][\w:-]*(?:\s|>))/i.test(text)
  return style < 0 || startsAsHtml ? text : text.slice(0, style)
}

function cleanMessageText(value) {
  return str(value).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dt', 'dd',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'li', 'main', 'maintext', 'nav', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul'
])

const HTML_ENTITIES = Object.freeze({
  amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"'
})

function decodeHtmlEntities(value) {
  return str(value).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, function (entity, decimal, hexadecimal, named) {
    if (named) return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, named.toLowerCase()) ? HTML_ENTITIES[named.toLowerCase()] : entity
    const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16)
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity
    return String.fromCodePoint(codePoint)
  })
}

function findTagEnd(text, start) {
  let quote = ''
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (quote !== '') {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '>') return index
  }
  return -1
}

function htmlToPlainText(value) {
  const text = str(value)
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
  let plain = ''

  for (let index = 0; index < text.length;) {
    if (text[index] !== '<') {
      plain += text[index]
      index += 1
      continue
    }
    const end = findTagEnd(text, index)
    if (end < 0) {
      plain += text[index]
      index += 1
      continue
    }
    const token = text.slice(index, end + 1)
    if (/^<!doctype\b/i.test(token) || /^<\?/.test(token) || /^<!\[CDATA\[/i.test(token)) {
      index = end + 1
      continue
    }
    const match = token.match(/^<\s*\/?\s*([A-Za-z][\w:-]*)\b/)
    if (!match) {
      plain += text[index]
      index += 1
      continue
    }
    const tag = match[1].toLowerCase()
    if (tag === 'br' || tag === 'hr') plain += '\n'
    else if (BLOCK_TAGS.has(tag)) plain += '\n\n'
    else if (tag === 'td' || tag === 'th') plain += '\t'
    index = end + 1
  }

  return decodeHtmlEntities(plain)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n[ \t\f\v]+/g, '\n')
    .replace(/[ \t\f\v]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function exportMessageText(value, options = {}) {
  const text = options.legacyPresentation === true ? stripLegacyPresentationSuffix(value) : str(value)
  return cleanMessageText(htmlToPlainText(text))
}

function safeFilename(value) {
  const name = str(value)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100)
  return name || '对话记录'
}

function storyTurn(message) {
  return Number(message.turn || (message.greeting ? 1 : 0))
}

/** Story turns whose illustration belongs in the export, in reading order. */
import { pluginAnchorInsertion } from './plugin-text-segments.js'

export function conversationStoryTurns(chat) {
  const turns = []
  for (const message of Array.isArray(chat?.messages) ? chat.messages : []) {
    if (message?.role === 'assistant' && storyTurn(message) > 0 && !turns.includes(storyTurn(message))) turns.push(storyTurn(message))
  }
  return turns
}

/**
 * The story as Markdown: player turns as quotes, story text as paragraphs, and each
 * turn's illustration linked right after its text. `images` maps a story turn to the
 * relative path the caller stores that picture under.
 */
export function createConversationMarkdownExport(chat, options = {}) {
  const source = chat !== null && typeof chat === 'object' ? chat : {}
  const images = options.images instanceof Map ? options.images : new Map()
  const title = safeFilename(options.title || source.title || (source.cardName ? source.cardName + '的对话' : '对话记录'))
  const sections = []
  for (const message of Array.isArray(source.messages) ? source.messages : []) {
    if (message === null || typeof message !== 'object') continue
    if (message.role === 'user') {
      const text = exportMessageText(message.text)
      if (text !== '') sections.push(text.split('\n').map(line => line === '' ? '>' : '> ' + line).join('\n'))
    } else if (message.role === 'assistant') {
      const text = exportMessageText(message.text, { legacyPresentation: true })
      // An image is a path, or { path, anchor }: placed after the anchor's paragraph as in play, else after the text.
      const entry = images.get(storyTurn(message))
      const image = typeof entry === 'string' ? { path: entry, anchor: '' } : entry
      if (text === '' && !image) continue
      if (!image) { sections.push(text); continue }
      const markdown = '![第 ' + storyTurn(message) + ' 轮配图](' + encodeURI(image.path) + ')'
      const at = image.anchor ? pluginAnchorInsertion(text, image.anchor) : -1
      sections.push(at < 0 || at >= text.length ? [text, markdown].filter(Boolean).join('\n\n')
        : text.slice(0, at).trimEnd() + '\n\n' + markdown + '\n\n' + text.slice(at).trimStart())
    }
  }
  return {
    title,
    filename: title + '.md',
    text: sections.length ? '# ' + title + '\n\n' + sections.join('\n\n---\n\n') + '\n' : '',
    messageCount: sections.length
  }
}
