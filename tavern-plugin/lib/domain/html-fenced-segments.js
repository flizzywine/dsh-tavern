function str(value) { return value == null ? '' : String(value) }

function isHtmlSource(value, info = '') {
  const content = str(value)
  const language = str(info).trim().split(/\s+/, 1)[0].toLowerCase()
  // Some imported card regexes label whole UI documents as text. Keep snippets
  // and narrative protocol tags literal; only promote a complete document root.
  if (language === 'text') {
    if (/^\s*(?:<!doctype\s+html\s*>\s*)?<html(?:\s[^<>]*?)?>[\s\S]*<\/html>\s*$/i.test(content)) return true
    // SillyTavern status bars often ship as body-only shells that load a remote panel.
    return /^\s*<body(?:\s[^<>]*?)?>[\s\S]*<\/body>\s*$/i.test(content)
      && /<(?:script|iframe|object|embed)\b/i.test(content)
  }
  if (language !== '') return language === 'html' || language === 'htm'
  // Match JS-Slash-Runner: an unlabeled fence renders as a page only when it holds
  // a document (html>/<head>/<body). Protocol snippets such as <msg>…</msg> stay
  // code blocks, which card scripts (phone UIs) locate and replace in the message.
  return /html>|<head>|<body/i.test(content)
}

export function fencedSegments(value) {
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
