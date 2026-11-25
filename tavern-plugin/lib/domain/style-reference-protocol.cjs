const STYLE_REFERENCE_TOOL_NAME = 'style_reference_submit'
const STYLE_REFERENCE_SYSTEM_TAG = 'foreground_style_reference'
const STYLE_REFERENCE_REMINDER_TAG = 'style_reference_reminder'
const STYLE_REFERENCE_SECTION = 'tavern:foreground-style-reference'

const STYLE_REFERENCE_TAGS = [
  STYLE_REFERENCE_TOOL_NAME, STYLE_REFERENCE_SYSTEM_TAG, STYLE_REFERENCE_REMINDER_TAG,
  'style_reference', 'style_reference_recall', 'style_reference_preference'
]
const STYLE_REFERENCE_MARKUP = new RegExp(
  "<(/?)(" + STYLE_REFERENCE_TAGS.join('|') + ")(?:[ \\t]+[^<>\\r\\n]*|[\"'])?/?>", 'gi'
)

function stripStyleReferenceMarkup(text) {
  const tags = [...text.matchAll(STYLE_REFERENCE_MARKUP)]
  if (tags.length === 0) return text

  // A closing tag belongs to its nearest opener. A stray opener can precede
  // ordinary prose or a later complete block, so remove only that opener.
  const open = new Map()
  const ends = new Map()
  for (const tag of tags) {
    const [markup, closing, name] = tag
    const key = name.toLowerCase()
    const starts = open.get(key)
    if (closing) {
      const start = starts?.pop()
      if (start !== undefined) ends.set(start, tag.index + markup.length)
    } else if (!markup.endsWith('/>')) {
      if (starts) starts.push(tag.index)
      else open.set(key, [tag.index])
    }
  }

  let result = '', cursor = 0
  for (const tag of tags) {
    if (tag.index < cursor) continue
    result += text.slice(cursor, tag.index)
    cursor = ends.get(tag.index) ?? tag.index + tag[0].length
  }
  return result + text.slice(cursor)
}

if (typeof window === 'undefined' && typeof module !== 'undefined') {
  module.exports = { STYLE_REFERENCE_TOOL_NAME, STYLE_REFERENCE_SYSTEM_TAG, STYLE_REFERENCE_REMINDER_TAG,
    STYLE_REFERENCE_SECTION, stripStyleReferenceMarkup }
}
