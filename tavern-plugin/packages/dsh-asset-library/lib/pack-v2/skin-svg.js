// a skin image may be a static SVG -
// vector UI art (frames, plates, bars, icons) that stays sharp at any screen density. Only inert drawing is accepted: an
// allowlist of shape, paint, clip/mask and filter elements; no script, event attributes, style sheets or style attributes,
// animation, text (glyphs are drawn as paths), embedded or external resources (every reference is a same-document #id),
// DTD, entity declarations or CDATA. The root <svg> carries the SVG namespace, a viewBox and a px width and height: its
// natural size, as a PNG's pixels, so `scale` and every size rule apply unchanged.
import {decodeSvg} from './skin-svg-native.js'

const ELEMENTS = new Set(['svg', 'g', 'defs', 'title', 'desc', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'use', 'symbol', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'filter', 'feGaussianBlur', 'feOffset',
  'feFlood', 'feComposite', 'feMerge', 'feMergeNode', 'feColorMatrix', 'feMorphology', 'feDropShadow', 'feBlend',
  'feComponentTransfer', 'feFuncA', 'feFuncR', 'feFuncG', 'feFuncB'])
const NAMESPACES = {xmlns: 'http://www.w3.org/2000/svg', 'xmlns:xlink': 'http://www.w3.org/1999/xlink'}
const MAX_BYTES = 2 * 1024 ** 2
const fail = message => { throw Object.assign(new Error('Skin SVG rejected: ' + message), {code: 'INVALID_SKIN'}) }
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[\da-f]{1,6});)/i
const px = value => /^\d+(?:\.\d+)?(?:px)?$/.test(value || '') ? Number.parseFloat(value) : NaN

export async function decodeSkinSvg(bytes) {
  const size = validateSkinSvg(bytes)
  // The inert-markup allowlist is not an XML parser or an image decoder.
  try {
    await decodeSvg(bytes)
  } catch (error) { fail('image decode failed: ' + error.message) }
  return size
}

export function validateSkinSvg(bytes) {
  if (!(bytes?.length > 0) || bytes.length > MAX_BYTES) fail('empty or over 2 MiB')
  let text
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes) } catch { fail('not UTF-8') }
  text = text.replace(/^\uFEFF/, '')
  // Sticky tokens: every character belongs to a comment, the XML declaration, a tag or text - nothing is skipped.
  const stack = [], token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[^<>]*>|[^<]+/y
  let root = null, seen = 0, pos = 0
  while (pos < text.length) {
    token.lastIndex = pos
    const match = token.exec(text)
    if (!match) fail('malformed markup')
    const part = match[0], at = pos
    pos += part.length
    if (part.startsWith('<!--')) { if (part.slice(4, -3).includes('--')) fail('malformed comment'); continue }
    if (part.startsWith('<?')) { if (at !== 0 || !/^<\?xml\s[^?]*\?>$/.test(part)) fail('processing instruction'); continue }
    if (part.startsWith('<!')) fail('DTD, entity or CDATA')
    if (!part.startsWith('<')) {
      if (part.includes('>') || ENTITY.test(part)) fail('stray markup or entity')
      if (part.trim() && !['title', 'desc'].includes(stack.at(-1))) fail('text outside title / desc')
      continue
    }
    if (part.startsWith('</')) {
      const name = part.slice(2, -1).trim()
      if (stack.pop() !== name) fail('unbalanced </' + name + '>')
      continue
    }
    const tag = /^<([A-Za-z][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>$/.exec(part)
    if (!tag) fail('malformed tag')
    const [, name, rawAttributes, selfClosing] = tag
    if (!ELEMENTS.has(name)) fail('element <' + name + '>')
    if (!stack.length && seen++) fail('more than one root')
    if (!stack.length && name !== 'svg') fail('root is not <svg>')
    const attributes = {}
    for (const [, key, quoted] of rawAttributes.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("[^"<]*"|'[^'<]*')/g)) {
      if (Object.hasOwn(attributes, key)) fail('duplicate attribute ' + key)
      const value = quoted.slice(1, -1)
      if (ENTITY.test(value)) fail('entity in ' + key)
      if (value.includes('\\')) fail('CSS escape in ' + key)
      if (/^on/i.test(key) || key === 'style') fail('attribute ' + key)
      if (key.includes(':') && !['xlink:href', 'xmlns:xlink', 'xml:space'].includes(key)) fail('attribute ' + key)
      if (key.startsWith('xmlns') && value !== NAMESPACES[key]) fail('namespace ' + key)
      if (/(?:^|:)href$/.test(key) && !/^#[\w.-]+$/.test(value)) fail('reference outside the document')
      // Character references could spell a scheme or url( inside a value; paint and filter references stay #ids.
      if (/&#/.test(value) && /href|fill|stroke|filter|mask|clip|marker/i.test(key)) fail('character reference in ' + key)
      const url = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi
      for (const [, , target] of value.matchAll(url)) if (!/^#[\w.-]+$/.test(target)) fail('url() outside the document')
      if (/url\(/i.test(value.replace(url, ''))) fail('malformed url()')
      attributes[key] = value
    }
    if (!stack.length) {
      if (attributes.xmlns !== NAMESPACES.xmlns) fail('root without the SVG namespace')
      const width = px(attributes.width), height = px(attributes.height)
      if (!(width >= 1 && width <= 8192 && height >= 1 && height <= 8192)) fail('root width / height must be px in 1..8192')
      const box = (attributes.viewBox || '').trim().split(/[\s,]+/).map(Number)
      if (box.length !== 4 || box.some(n => !Number.isFinite(n)) || !(box[2] > 0 && box[3] > 0)) fail('root viewBox')
      root = {width, height}
    }
    if (!selfClosing) stack.push(name)
  }
  if (!root || stack.length) fail('unclosed elements')
  return root
}
