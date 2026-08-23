function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function cleanBody(value) {
  return str(value).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function isCompletePresentationHtml(value) {
  const text = str(value).trim()
  if (text === '') return false
  if (/^(?:<!doctype\s+html\b|<html\b)/i.test(text)) return /<\/html\s*>\s*$/i.test(text)
  if (/^<style\b/i.test(text)) return /<\/style\s*>/i.test(text) && /<\/?(?:details|div|section|aside|table|form)\b/i.test(text)
  if (/^<details\b/i.test(text)) return /<\/details\s*>\s*$/i.test(text)
  const root = text.match(/^<(div|section|aside|table|form)\b/i)
  if (root === null) return false
  return new RegExp('<\\/' + root[1] + '\\s*>\\s*$', 'i').test(text) && /\b(?:style|class|id)\s*=/i.test(text)
}

function findPresentationSuffix(source) {
  const starts = []
  const marker = /<(?:!doctype\s+html\b|html\b|style\b|details\b|div\b|section\b|aside\b|table\b|form\b)/gi
  let match
  while ((match = marker.exec(source)) !== null) starts.push(match.index)
  for (const index of starts) {
    const candidate = source.slice(index).trim()
    if (isCompletePresentationHtml(candidate)) return { index, html: candidate }
  }
  return null
}

/**
 * Split one model reply into authoritative story text and an optional UI
 * projection. Only complete, high-confidence block HTML is extracted; inline
 * prose markup and malformed fragments remain in the story with a warning.
 */
export function projectReplyPresentation(value, options = {}) {
  const sourceText = str(value)
  let body = sourceText
  const html = []
  const warnings = []

  body = body.replace(/```(?:html)?[ \t]*\r?\n([\s\S]*?)\r?\n```/gi, function (whole, content) {
    const candidate = str(content).trim()
    if (!isCompletePresentationHtml(candidate)) return whole
    html.push(candidate)
    return ''
  })

  const suffix = findPresentationSuffix(body)
  if (suffix !== null) {
    html.push(suffix.html)
    body = body.slice(0, suffix.index)
  }

  if (html.length === 0 && /<(?:!doctype\s+html\b|html\b|style\b|details\b|div\b|section\b|aside\b|table\b|form\b)/i.test(body)) {
    warnings.push('检测到未闭合或无法安全分离的 HTML，已保留在正文中')
  }

  const regex = renderTavernRegexDisplay(body, options.regexScripts, options)
  if (regex.changed) {
    body = regex.bodyText
    if (regex.presentationText !== '') html.push(regex.presentationText)
  }
  warnings.push.apply(warnings, regex.warnings)

  return {
    sourceText,
    bodyText: cleanBody(body),
    presentationHtml: html.join('\n'),
    warnings,
    regexApplied: regex.changed,
    appliedRegexes: regex.applied
  }
}

/** Rebuild the visible transcript from authoritative reply sources. */
export function projectReplyHistory(messages, options = {}) {
  const projections = []
  let presentation = null
  let inferredTurn = 1
  let latestSourceBacked = false
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message === null || typeof message !== 'object') continue
    if (message.role === 'user') {
      inferredTurn += 1
      continue
    }
    if (message.role !== 'assistant' || message.greeting === true) continue
    const turn = Math.max(0, Number(message.turn) || inferredTurn)
    if (turn === 0) continue
    const hasSource = Object.prototype.hasOwnProperty.call(message, 'sourceText')
    const source = hasSource ? str(message.sourceText) : str(message.text)
    const projected = projectReplyPresentation(source, options)
    if (hasSource || projected.bodyText !== cleanBody(source)) projections.push({ turn, text: projected.bodyText })
    if (projected.presentationHtml !== '') {
      presentation = {
        html: projected.presentationHtml,
        source: 'reply',
        turn,
        warnings: projected.warnings,
        updatedAt: Number(message.ts) || 0
      }
    }
    latestSourceBacked = hasSource
  }
  return { projections, presentation, latestSourceBacked }
}
import { renderTavernRegexDisplay } from './tavern-regex-display.js'
