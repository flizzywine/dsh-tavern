import { applyTavernRegexText } from './tavern-regex-display.js'
import { marked } from 'marked'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isHtmlSource(value, info = '') {
  const content = str(value)
  const language = str(info).trim().split(/\s+/, 1)[0].toLowerCase()
  if (language !== '') return language === 'html' || language === 'htm'
  return /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(content)
}

function fencedSegments(value) {
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
        segments.push({ kind: 'html', content })
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

function hasRawHtml(value) {
  if (!/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(str(value))) return false
  try {
    // Code examples are Markdown, not active HTML. Inspect nested inline tokens
    // as well, so raw HTML in lists/emphasis still retains iframe isolation.
    let found = false
    marked.walkTokens(marked.lexer(str(value), { gfm: true }), function (token) {
      if (token.type === 'html') found = true
    })
    return found
  } catch (_error) {
    return true
  }
}

/** Native prose and isolated HTML share one ordered projection; never split a raw HTML document. */
export function projectDisplayParts(value) {
  const segments = fencedSegments(value)
  return {
    parts: segments.map(function (segment) {
      if (segment.kind === 'html') return { kind: 'html', content: segment.content }
      return hasRawHtml(segment.text)
        ? { kind: 'html', content: segment.text }
        : { kind: 'markdown', text: segment.text }
    }),
    warnings: []
  }
}

/** Match renderable HTML regardless of whether it came from regex or model output. */
export function hasHtmlCodeBlock(value) {
  return fencedSegments(value).some(function (segment) { return segment.kind === 'html' })
}

/** Classify whether the display projection needs isolated rich rendering. */
export function displayModeOf(value) {
  return projectDisplayParts(value).parts.some(part => part.kind === 'html') ? 'html' : 'markdown'
}

function targetOptions(options, isMarkdown) {
  return {
    placement: options.placement,
    isMarkdown,
    isEdit: options.isEdit,
    depth: options.depth
  }
}

/**
 * Project one authoritative model reply independently for Session and display.
 * Regex execution only transforms strings; it never extracts HTML or changes
 * where matched content belongs in the message.
 */
export function projectReplyLayers(value, options = {}) {
  const sourceText = str(value)
  const projectionText = Object.prototype.hasOwnProperty.call(options, 'projectionText')
    ? str(options.projectionText)
    : sourceText
  const scripts = Array.isArray(options.regexScripts) ? options.regexScripts : []
  const session = applyTavernRegexText(projectionText, scripts, targetOptions(options, false))
  const display = applyTavernRegexText(projectionText, scripts, targetOptions(options, true))
  const displayProjection = projectDisplayParts(display.text)
  const displayMode = displayProjection.parts.some(part => part.kind === 'html') ? 'html' : 'markdown'

  return {
    sourceText,
    projectionText,
    sessionText: session.text,
    displayText: display.text,
    displayMode,
    displayParts: displayProjection.parts,
    applied: {
      session: session.applied,
      display: display.applied
    },
    warnings: session.warnings.map(function (warning) { return 'Session：' + warning })
      .concat(display.warnings.map(function (warning) { return '展示：' + warning }))
      .concat(displayProjection.warnings)
  }
}

/** Rebuild per-turn display projections from authoritative reply sources. */
export function projectReplyHistory(messages, options = {}) {
  const projections = []
  let inferredTurn = 1
  let latestSourceBacked = false

  for (const message of Array.isArray(messages) ? messages : []) {
    if (message === null || typeof message !== 'object') continue
    if (message.role === 'user') {
      inferredTurn += 1
      continue
    }
    if (message.role !== 'assistant') continue

    const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : inferredTurn))
    if (turn === 0) continue
    const hasSource = Object.prototype.hasOwnProperty.call(message, 'sourceText')
    const sourceText = hasSource ? str(message.sourceText) : str(message.text)
    const projectionText = Object.prototype.hasOwnProperty.call(message, 'projectionText')
      ? str(message.projectionText)
      : sourceText
    const projected = projectReplyLayers(sourceText, Object.assign({}, options, { projectionText }))
    const sessionText = str(message.text)

    if (projected.displayText !== sessionText || projected.displayMode !== 'markdown' || (Array.isArray(message.swipes) && message.swipes.length > 1)) {
      projections.push({
        version: 2,
        turn,
        text: projected.displayText,
        mode: projected.displayMode,
        parts: projected.displayParts,
        warnings: projected.warnings
      })
    }
    latestSourceBacked = hasSource
  }

  return { projections, presentation: null, latestSourceBacked }
}

/**
 * Transitional old-shape adapter. New callers should use projectReplyLayers().
 * presentationHtml stays empty because HTML now remains inside displayText.
 */
export function projectReplyPresentation(value, options = {}) {
  const layers = projectReplyLayers(value, options)
  return Object.assign({}, layers, {
    bodyText: layers.sessionText,
    presentationHtml: '',
    regexApplied: layers.applied.display.length > 0,
    appliedRegexes: layers.applied.display
  })
}
