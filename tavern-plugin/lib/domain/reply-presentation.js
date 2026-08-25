import { applyTavernRegexText } from './tavern-regex-display.js'
import { marked } from 'marked'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isHtmlSource(value, info = '') {
  const content = str(value)
  const language = str(info).trim().split(/\s+/, 1)[0].toLowerCase()
  return language === 'html' || language === 'htm'
    || /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(content)
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

function withoutFencedCode(value) {
  const lines = str(value).match(/.*(?:\r?\n|$)/g) || []
  let visible = ''
  let fence = null
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '')
    if (fence === null) {
      const opening = bare.match(/^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*$/)
      if (opening === null) visible += line
      else fence = { character: opening[1][0], length: opening[1].length }
      continue
    }
    const closing = bare.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/)
    if (closing !== null && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null
  }
  return visible
}

function hasRawHtml(value) {
  return /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(withoutFencedCode(value))
}

function compileTextPart(value) {
  if (!hasRawHtml(value)) return { part: { kind: 'markdown', text: str(value) }, warning: '' }
  try {
    return { part: { kind: 'html', content: marked.parse(str(value), { async: false, breaks: true, gfm: true }) }, warning: '' }
  } catch (error) {
    return {
      part: { kind: 'markdown', text: str(value) },
      warning: '展示：Markdown/HTML 编译失败：' + str(error && error.message ? error.message : error)
    }
  }
}

/** Build ordered Markdown and executable HTML display parts. */
export function projectDisplayParts(value) {
  const parts = []
  const warnings = []
  for (const segment of fencedSegments(value)) {
    if (segment.kind === 'html') {
      parts.push(segment)
      continue
    }
    const compiled = compileTextPart(segment.text)
    parts.push(compiled.part)
    if (compiled.warning !== '') warnings.push(compiled.warning)
  }
  return { parts, warnings }
}

/** Match renderable HTML regardless of whether it came from regex or model output. */
export function hasHtmlCodeBlock(value) {
  return fencedSegments(value).some(function (segment) { return segment.kind === 'html' })
}

/** Classify whether the display projection needs isolated rich rendering. */
export function displayModeOf(value) {
  const projected = projectDisplayParts(value)
  return projected.parts.some(function (part) { return part.kind !== 'markdown' }) ? 'rich' : 'markdown'
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
  const displayMode = displayProjection.parts.some(function (part) { return part.kind !== 'markdown' }) ? 'rich' : 'markdown'

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

    if (projected.displayText !== sessionText || projected.displayMode === 'rich') {
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
