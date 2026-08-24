import { applyTavernRegexText } from './tavern-regex-display.js'
import { marked } from 'marked'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function withoutFencedCode(value) {
  return str(value).replace(/```[^\r\n]*\r?\n[\s\S]*?\r?\n```/g, '')
}

/** Classify a display projection without moving or rewriting any content. */
export function displayModeOf(value) {
  const visible = withoutFencedCode(value)
  return /<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(visible) ? 'html' : 'markdown'
}

function compileDisplayHtml(value) {
  try {
    return { html: marked.parse(str(value), { async: false, breaks: true, gfm: true }), warning: '' }
  } catch (error) {
    return { html: '', warning: '展示：Markdown/HTML 编译失败：' + str(error && error.message ? error.message : error) }
  }
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
  const displayMode = displayModeOf(display.text)
  const compiled = displayMode === 'html' ? compileDisplayHtml(display.text) : { html: '', warning: '' }

  return {
    sourceText,
    projectionText,
    sessionText: session.text,
    displayText: display.text,
    displayMode,
    displayHtml: compiled.html,
    applied: {
      session: session.applied,
      display: display.applied
    },
    warnings: session.warnings.map(function (warning) { return 'Session：' + warning })
      .concat(display.warnings.map(function (warning) { return '展示：' + warning }))
      .concat(compiled.warning === '' ? [] : [compiled.warning])
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

    if (projected.displayText !== sessionText || projected.displayMode === 'html') {
      projections.push({
        version: 1,
        turn,
        text: projected.displayText,
        mode: projected.displayMode,
        html: projected.displayHtml,
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
