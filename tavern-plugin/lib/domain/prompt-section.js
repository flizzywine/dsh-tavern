// section boundaries never normalize or translate their payload.
export function promptSection(tag, text) {
  return text === '' ? '' : `<${tag}>\n${text}\n</${tag}>`
}

// Read only our generated envelope; legacy snapshots retain their original bytes.
export function promptSectionBody(tag, text) {
  const start = `<${tag}>\n`, end = `\n</${tag}>`
  return text.startsWith(start) && text.endsWith(end) ? text.slice(start.length, -end.length) : text
}
