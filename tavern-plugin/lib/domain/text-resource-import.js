import { extractEpubText } from './epub-text.js'

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function prepareTextImport(payload, emptyMessage) {
  const source = payload !== null && typeof payload === 'object' ? payload : {}
  const name = str(source.name).trim()
  const isEpub = /\.epub$/i.test(name) || str(source.type).toLowerCase() === 'application/epub+zip'
  let text
  let originalText
  if (isEpub) {
    const encoded = str(source.fileB64).replace(/\s+/g, '')
    if (encoded === '') throw new Error('EPUB 文件内容为空')
    if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 !== 0) throw new Error('EPUB 文件编码无效')
    text = extractEpubText(Buffer.from(encoded, 'base64'))
  } else {
    originalText = str(source.text)
    text = originalText
  }
  text = text.replace(/\r\n?/g, '\n').trim()
  if (text === '') throw new Error(emptyMessage)
  return Object.assign({}, source, { name, text, ...(originalText === undefined ? {} : { originalText }) })
}
