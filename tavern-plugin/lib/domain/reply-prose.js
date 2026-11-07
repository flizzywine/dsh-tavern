// Prose fields of a saved reply row (assistant replies, greetings, Tavern Helper floors).
//
//   sourceText      What the model wrote, or what the player edited it into. The one
//                   authoritative text; the body editor opens it.
//   projectionText  sourceText with Tavern macros rendered. Macros such as {{setvar}} have
//                   side effects, so it is rendered once when the row is written and then
//                   frozen; equal to sourceText when the reply has no macros. Every regex
//                   projection below starts from it.
//   text            projectionText through the prompt-placement regex: exactly what the
//                   native session (the model context) holds for this row. Reconcile and
//                   edits compare against it.
//   displayText     projectionText through the display regex. Story/script views recompute
//                   it on every read; the stored copy is a cache for other modes and debug.
//                   displayMode, projectionVersion and projectionWarnings travel with it.
//   swipes[swipeId] The selected swipe as Tavern Helper scripts read it: sourceText or
//                   projectionText.
//
// Invariants: text and displayText derive from projectionText, which derives from
// sourceText, under the same regex scripts. Write them together through replyProse(),
// never one at a time. Writers that only change variables (MVU settlement, …) leave every
// prose field untouched (#306). Rows written before this module may carry sessionText, a
// copy of text; nothing reads it and replyProse() never writes it.

import { projectReplyLayers } from './reply-presentation.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Every stored prose field, for code that copies or compares a row's prose as a whole. */
export const REPLY_PROSE_FIELDS = Object.freeze(['swipes', 'sourceText', 'projectionText', 'text', 'displayText', 'displayMode', 'projectionVersion', 'projectionWarnings'])

/**
 * The prose fields of one row, from its source and a projection of it: projectReplyLayers()
 * output ({ projectionText, sessionText, displayText, … }) or a runtime projection
 * ({ renderedText, sessionText, displayText, … }).
 */
export function replyProse(sourceText, projected) {
  return {
    sourceText: str(sourceText),
    projectionText: str(projected.projectionText ?? projected.renderedText),
    text: str(projected.sessionText),
    displayText: str(projected.displayText),
    displayMode: str(projected.displayMode) || 'markdown',
    projectionVersion: 2,
    projectionWarnings: Array.isArray(projected.warnings) ? structuredClone(projected.warnings) : []
  }
}

/** Prose of a row whose text passes through unprojected (imports, Helper-created floors). */
export function plainReplyProse(text) {
  const value = str(text)
  return replyProse(value, { projectionText: value, sessionText: value, displayText: value, displayMode: 'markdown', warnings: [] })
}

/** Write a row's prose in place, dropping the retired sessionText copy. */
export function writeReplyProse(message, sourceText, projected) {
  Object.assign(message, replyProse(sourceText, projected))
  delete message.sessionText
  return message
}

/**
 * Broken invariants of one saved row, as readable strings (empty when consistent).
 * With options.regexScripts, also re-derive text from projectionText the way a round
 * save does and compare. For tests and diagnostics; it runs the card's regex.
 */
export function replyProseProblems(message, options = {}) {
  if (!message || typeof message !== 'object') return ['不是消息对象']
  const problems = []
  if (Object.hasOwn(message, 'sessionText') && message.sessionText !== message.text) problems.push('sessionText 与 text 不一致')
  if (!Object.hasOwn(message, 'sourceText')) return problems
  const source = str(message.sourceText), projection = str(message.projectionText ?? source)
  if (!source.includes('{{') && !/<(?:user|char)>/i.test(source) && projection !== source) problems.push('原文没有宏，projectionText 却不同于 sourceText')
  if (Array.isArray(message.swipes)) {
    const swipe = message.swipes[Math.max(0, Number(message.swipeId) || 0)]
    if (swipe !== undefined && swipe !== source && swipe !== projection) problems.push('当前 swipe 既不是 sourceText 也不是 projectionText')
  }
  if (Array.isArray(options.regexScripts)) {
    const expected = projectReplyLayers(projection, { regexScripts: options.regexScripts, placement: 2, isEdit: false, depth: 0, charName: options.charName })
    if (str(expected.sessionText).trim() !== str(message.text).trim()) problems.push('text 不是 projectionText 经提示词正则后的结果')
  }
  return problems
}
