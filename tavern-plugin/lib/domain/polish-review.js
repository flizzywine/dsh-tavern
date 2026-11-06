// 精修: an editor reads the latest reply against the principles and returns edits, exact
// replacements of a phrase, sentence or whole paragraphs, applied through the body editor.

function str(value) { return typeof value === 'string' ? value : value == null ? '' : String(value) }
function replyText(message) { return str(message && (message.projectionText ?? message.sourceText ?? message.text)) }

/** The player input and the reply before the latest one, read from the Chat tail. */
export function polishReviewContext(messages) {
  const rows = messages || []
  let input = '', previous = ''
  for (let index = rows.length - 2, seenUser = false; index >= 0; index -= 1) {
    const message = rows[index]
    if (!message) continue
    if (!seenUser && message.role === 'user') { input = str(message.text); seenUser = true; continue }
    if (seenUser && message.role === 'assistant') { previous = replyText(message); break }
  }
  return { input, previous }
}

function occurrences(texts, find) {
  const hits = []
  texts.forEach((text, part) => { for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + 1)) hits.push({ part, at }) })
  return hits
}

/** The editor's JSON. Unreadable output comes back as text for the guidance box (guided regeneration). */
export function parsePolishReview(output, texts) {
  const raw = str(output).trim()
  const body = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value
  try { value = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)) } catch { value = undefined }
  if (!value || typeof value !== 'object' || !Array.isArray(value.edits)) return { edits: [], fallback: raw }
  const taken = []
  const edits = value.edits.flatMap(edit => {
    const find = str(edit?.find)
    if (!find.trim()) return []
    const hits = occurrences(texts, find)
    let status = hits.length === 1 ? 'ok' : hits.length === 0 ? 'missing' : 'ambiguous'
    if (status === 'ok') {
      const { part, at } = hits[0], end = at + find.length
      // An earlier (more important) edit already covers part of this text.
      if (taken.some(range => range.part === part && range.at < end && at < range.end)) status = 'overlap'
      else taken.push({ part, at, end })
    }
    return [{ reason: str(edit?.reason).trim(), find, replace: str(edit?.replace), status }]
  })
  return { edits, fallback: '' }
}

/** Apply chosen edits to the reply's text parts; each must still match exactly once. */
export function applyPolishEdits(texts, edits) {
  const next = texts.slice(), placed = []
  for (const edit of edits) {
    const find = str(edit?.find)
    const hits = find ? occurrences(texts, find) : []
    if (hits.length !== 1) throw new Error('正文里找不到要改的原句，可能已经改过，请重新审稿：' + find.slice(0, 30))
    const { part, at } = hits[0], end = at + find.length
    if (placed.some(item => item.part === part && item.at < end && at < item.end)) throw new Error('精修修改范围重叠，请重新审稿')
    placed.push({ part, at, end, replace: str(edit.replace) })
  }
  // Apply against immutable source offsets; a replacement may contain another edit's find.
  for (const edit of placed.sort((a, b) => b.at - a.at)) {
    next[edit.part] = next[edit.part].slice(0, edit.at) + edit.replace + next[edit.part].slice(edit.end)
  }
  return next
}

/**
 * The record of a 精修 in two passes, as edits of the original: the review's edits apply to the
 * original, the guidance's to the reviewed text. Each guidance edit is mapped back onto the
 * original; one that touches a review's change merges with it into a single change, reasons kept.
 */
export function composePolishEdits(original, reviewEdits, guidanceEdits) {
  const text = str(original)
  // The review's changes in reading order, with where each sits in the original and in the reviewed text.
  const placed = reviewEdits.map(edit => ({ find: str(edit.find), replace: str(edit.replace), reasons: [str(edit.reason)], at: text.indexOf(str(edit.find)) }))
    .filter(edit => edit.at >= 0).sort((left, right) => left.at - right.at)
  let shift = 0
  for (const edit of placed) { edit.start = edit.at + shift; shift += edit.replace.length - edit.find.length; edit.end = edit.start + edit.replace.length }
  let reviewed = '', cursor = 0
  for (const edit of placed) { reviewed += text.slice(cursor, edit.at) + edit.replace; cursor = edit.at + edit.find.length }
  reviewed += text.slice(cursor)
  // A reviewed-text position back in the original; inside a review change it widens to that change.
  function back(position, side) {
    let delta = 0
    for (const edit of placed) {
      const inside = side === 'start' ? edit.start <= position && position < edit.end : edit.start < position && position <= edit.end
      if (inside) return side === 'start' ? edit.at : edit.at + edit.find.length
      if (side === 'start' ? position < edit.end : position <= edit.start) break
      delta = edit.end - (edit.at + edit.find.length)
    }
    return position - delta
  }
  const groups = placed.map(edit => ({ from: edit.at, to: edit.at + edit.find.length, reasons: edit.reasons.slice(), guided: [] }))
  for (const guided of guidanceEdits) {
    const find = str(guided.find), at = reviewed.indexOf(find)
    if (!find || at < 0) continue
    groups.push({ from: back(at, 'start'), to: back(at + find.length, 'end'), reasons: ['按意见：' + str(guided.reason)], guided: [guided] })
  }
  groups.sort((left, right) => left.from - right.from || left.to - right.to)
  const merged = []
  for (const group of groups) {
    const last = merged.at(-1)
    if (last && group.from < last.to) { last.to = Math.max(last.to, group.to); last.reasons.push(...group.reasons); last.guided.push(...group.guided) }
    else merged.push({ ...group, reasons: group.reasons.slice(), guided: group.guided.slice() })
  }
  return merged.map(group => {
    let replace = text.slice(group.from, group.to)
    for (const edit of placed.filter(edit => edit.at >= group.from && edit.at + edit.find.length <= group.to).reverse()) {
      const at = edit.at - group.from
      replace = replace.slice(0, at) + edit.replace + replace.slice(at + edit.find.length)
    }
    for (const guided of group.guided) replace = replace.replace(str(guided.find), () => str(guided.replace))
    // The review's reasons first, then the guidance's.
    const reasons = group.reasons.filter(Boolean), guidedReason = reason => reason.startsWith('按意见：')
    return { reason: [...reasons.filter(reason => !guidedReason(reason)), ...reasons.filter(guidedReason)].join('；'), find: text.slice(group.from, group.to), replace }
  })
}
