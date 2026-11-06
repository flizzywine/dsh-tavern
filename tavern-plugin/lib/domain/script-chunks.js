function str(value) { return typeof value === 'string' ? value : '' }
function clampInt(value, min, max, fallback) { return Number.isInteger(value) && value >= min && value <= max ? value : fallback }

function splitLegacyText(source, requestedSize) {
    const target = clampInt(requestedSize, 300, 800, 500)
    const minSize = Math.max(220, Math.floor(target * 0.7))
    const maxSize = Math.min(1000, Math.floor(target * 1.4))
    const text = str(source).replace(/\r\n?/g, '\n').trim()
    if (text === '') return []
    const units = []
    for (const paragraph of text.split(/\n+/).map(function (item) { return item.trim() }).filter(Boolean)) {
      if (paragraph.length <= maxSize) {
        units.push(paragraph)
        continue
      }
      let rest = paragraph
      while (rest.length > maxSize) {
        let cut = -1
        const lower = Math.max(minSize, target - 120)
        const upper = Math.min(rest.length, maxSize)
        for (let i = upper; i >= lower; i--) {
          if ('。！？；…!?;'.includes(rest[i - 1])) { cut = i; break }
        }
        if (cut < 0) cut = Math.min(target, rest.length)
        units.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut).trim()
      }
      if (rest !== '') units.push(rest)
    }
    const packed = []
    let current = ''
    for (const unit of units) {
      if (current !== '' && current.length + 1 + unit.length > maxSize) {
        packed.push(current)
        current = ''
      }
      current = current === '' ? unit : current + '\n' + unit
      if (current.length >= target && current.length >= minSize) {
        packed.push(current)
        current = ''
      }
    }
    if (current !== '') {
      if (packed.length > 0 && current.length < Math.floor(minSize / 2) && packed[packed.length - 1].length + 1 + current.length <= maxSize) packed[packed.length - 1] += '\n' + current
      else packed.push(current)
    }
    return packed.map(function (text, index) { return { id: 'chunk-' + String(index + 1).padStart(5, '0'), order: index, text: text } })
  }

export function splitNovelText(source, requestedSize = 500, { preserveWhitespace = false } = {}) {
  const target = clampInt(requestedSize, 100, 10000, 500)
  const ceiling = Math.ceil(target * 1.1)
  const normalized = str(source).replace(/\r\n?/g, '\n')
  const text = preserveWhitespace ? normalized : normalized.trim()
  const chunks = []
  let start = 0, count = 0, scalarCount = 0, boundary = 0
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i))
    i += char.length; scalarCount++
    if (/\p{Script=Han}/u.test(char)) count++
    if (count >= target * .9 && /[。！？；…!?;\n]/u.test(char)) boundary = i
    if ((count >= target && boundary === i) || count >= ceiling || scalarCount >= Math.max(4000, target * 4)) {
      const end = boundary > start ? boundary : i
      const body = text.slice(start, end)
      chunks.push(body)
      start = end; i = end; count = 0; scalarCount = 0; boundary = 0
    }
  }
  if (start < text.length) chunks.push(text.slice(start))
  return chunks.map((text, order) => ({ id: 'chunk-' + String(order + 1).padStart(5, '0'), order, text }))
}

// Old saves identify blocks by ordinal. These offsets let continuity translate
// the old position into the new layout without editing the original history.
export function scriptChunkLayout(source) {
  const chunks = splitNovelText(source)
  function offsets(items) {
    let offset = 0
    return items.map(chunk => { const start = offset; offset += chunk.text.replace(/\s/gu, '').length; return start })
  }
  return { chunks, chunkSize: 500, chunkUnit: 'han', chunkingVersion: 'han-v1',
    chunkStarts: offsets(chunks), legacyChunkStarts: offsets(splitLegacyText(source, 500)) }
}
