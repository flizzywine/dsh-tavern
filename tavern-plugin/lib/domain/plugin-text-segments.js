// Split assistant text for third-party plugins: marker matches become plugin
// elements and anchored media is placed after the paragraph that holds its
// anchor sentence. Shared with the browser bundle (@include-domain): keep
// top-level names specific.
const pluginAnchorSkipped = /[\s*_~`#>|​]/

/** Text without markup and spacing, with a map from each kept char back to the source. */
function pluginAnchorProjection(text) {
  let normalized = ''
  const positions = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '<') {
      const close = text.indexOf('>', index)
      if (close > index && /^<\/?[a-zA-Z][^<>]*>$/.test(text.slice(index, close + 1))) { index = close; continue }
    }
    if (pluginAnchorSkipped.test(char)) continue
    normalized += char
    positions.push(index)
  }
  return { normalized, positions }
}

/** Source index just after the paragraph containing `anchor`, or -1. */
function pluginAnchorInsertion(text, anchor, projection = pluginAnchorProjection(text)) {
  const needle = pluginAnchorProjection(String(anchor || '')).normalized
  if (needle.length < 2) return -1
  const found = projection.normalized.indexOf(needle)
  if (found < 0) return -1
  const end = projection.positions[found + needle.length - 1] + 1
  // Card text often keeps Windows line endings: a blank line is then "\r\n\r\n".
  const paragraph = /\r?\n[ \t\r]*\n/g
  paragraph.lastIndex = end
  const next = paragraph.exec(text)
  return next ? next.index : text.length
}

function pluginGlobalPattern(pattern) {
  if (!(pattern instanceof RegExp)) return null
  const flags = pattern.flags.replace(/[gy]/g, '')
  return new RegExp(pattern.source, flags + 'g')
}

/**
 * @param text - assistant text as rendered
 * @param options.markers - RegExp list, in registration order
 * @param options.anchors - [{ id, anchor }] in display order
 * @returns {{ segments: Array, placed: string[] }} segments are
 *   { kind: 'text', text } | { kind: 'marker', marker, match } | { kind: 'media', ids }
 */
function segmentPluginText(text, { markers = [], anchors = [] } = {}) {
  const source = String(text || '')
  const matches = []
  markers.forEach((pattern, marker) => {
    const regex = pluginGlobalPattern(pattern)
    if (!regex) return
    let match
    while ((match = regex.exec(source)) !== null) {
      if (match[0] === '') { regex.lastIndex++; continue }
      matches.push({ start: match.index, end: match.index + match[0].length, marker, match: Array.from(match) })
    }
  })
  matches.sort((a, b) => a.start - b.start || a.marker - b.marker)
  const kept = []
  for (const item of matches) if (!kept.length || item.start >= kept[kept.length - 1].end) kept.push(item)
  const inserts = new Map()
  const placed = []
  const projection = anchors.length ? pluginAnchorProjection(source) : null
  for (const item of anchors) {
    let at = pluginAnchorInsertion(source, item.anchor, projection)
    if (at < 0) continue
    const inside = kept.find(match => match.start < at && at < match.end)
    if (inside) at = inside.end
    if (!inserts.has(at)) inserts.set(at, [])
    inserts.get(at).push(item.id)
    placed.push(item.id)
  }
  const cuts = [...new Set([...kept.flatMap(item => [item.start, item.end]), ...inserts.keys()])].sort((a, b) => a - b)
  const segments = []
  let cursor = 0
  const pushText = end => { if (end > cursor) segments.push({ kind: 'text', text: source.slice(cursor, end) }); cursor = Math.max(cursor, end) }
  for (const cut of cuts) {
    const marker = kept.find(item => item.start === cut)
    pushText(cut)
    if (inserts.has(cut)) segments.push({ kind: 'media', ids: inserts.get(cut) })
    if (marker) { segments.push({ kind: 'marker', marker: marker.marker, match: marker.match }); cursor = marker.end }
  }
  pushText(source.length)
  return { segments, placed }
}

/** Remove marker matches from HTML that Tavern cannot split; return them in order. */
function extractPluginMarkers(html, markers = []) {
  const found = segmentPluginText(html, { markers }).segments
  return {
    html: found.filter(segment => segment.kind === 'text').map(segment => segment.text).join(''),
    markers: found.filter(segment => segment.kind === 'marker')
  }
}

export { pluginAnchorInsertion, segmentPluginText, extractPluginMarkers }
