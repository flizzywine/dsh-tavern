import { projectDisplayParts, projectReplyHistory, projectReplyLayers } from './reply-presentation.js'
import { renderTavernMacros } from './tavern-macro-engine.js'
import { applyTavernRegexText, renderTavernRegexDisplay } from './tavern-regex-display.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function macroSnapshot(value = {}) {
  return {
    userName: str(value.userName) || '你',
    local: Object.assign({}, value.local && typeof value.local === 'object' ? value.local : {}),
    global: Object.assign({}, value.global && typeof value.global === 'object' ? value.global : {})
  }
}

function macroProjection(value, options = {}) {
  const state = macroSnapshot(options.macroState)
  const rendered = renderTavernMacros(str(value), {
    charName: str(options.charName),
    userName: state.userName,
    localVariables: state.local,
    globalVariables: state.global
  })
  return {
    text: rendered.text,
    diagnostics: rendered.diagnostics,
    macroState: {
      userName: state.userName,
      local: rendered.localVariables,
      global: rendered.globalVariables
    }
  }
}

/** Remove failed/unknown Tavern macro delimiters before text crosses into DSH. */
export function sanitizeAgentProjectionText(value) {
  return str(value).replaceAll('{{', '').replaceAll('}}', '')
}

function contentProjection(value, options, preview, sanitizeForAgent) {
  const rendered = macroProjection(value, options)
  const renderedText = sanitizeForAgent ? sanitizeAgentProjectionText(rendered.text) : rendered.text
  const layers = projectReplyLayers(renderedText, {
    regexScripts: options && options.regexScripts,
    placement: options && options.regexPlacement,
    isEdit: options && options.isEdit,
    depth: options && options.depth
  })
  return {
    agentText: preview ? renderedText : layers.sessionText,
    bodyText: layers.sessionText,
    renderedText,
    sessionText: layers.sessionText,
    displayText: layers.displayText,
    displayMode: layers.displayMode,
    displayParts: layers.displayParts,
    presentationHtml: '',
    presentationOnly: false,
    warnings: layers.warnings,
    applied: layers.applied,
    diagnostics: rendered.diagnostics,
    macroState: rendered.macroState
  }
}

/** Preserve authoritative editable source without executing compatibility syntax. */
export function preserveRuntimeSource(value, options = {}) {
  const raw = str(value)
  return {
    agentText: raw, bodyText: raw, renderedText: raw,
    sessionText: raw, displayText: raw, displayMode: 'markdown', displayParts: [{ kind: 'markdown', text: raw }],
    presentationHtml: '', presentationOnly: false,
    warnings: [], diagnostics: [], macroState: macroSnapshot(options.macroState)
  }
}

/** Resolve Tavern macros and remove presentation-only content before Agent input. */
export function projectAgentContent(value, options = {}) {
  return contentProjection(value, options, false, true)
}

/** Render a chooser preview while keeping the complete rendered opening. */
export function projectOpeningPreview(value, options = {}) {
  const projection = contentProjection(value, options, true, false)
  const display = renderTavernRegexDisplay(projection.renderedText, options && options.regexScripts, {
    placement: options && options.regexPlacement,
    isMarkdown: true,
    isEdit: options && options.isEdit,
    depth: options && options.depth
  })
  if (!display.changed || !display.presentationText.trim()) return projection

  const parts = []
  if (display.bodyText.trim()) parts.push({ kind: 'markdown', text: display.bodyText })
  if (/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*(?:\s[^<>]*?)?>/i.test(display.presentationText)) {
    parts.push(...projectDisplayParts(display.presentationText).parts)
  } else {
    parts.push({ kind: 'markdown', text: display.presentationText })
  }
  return Object.assign({}, projection, { displayParts: parts })
}

/** Commit an opening as story text plus an isolated presentation projection. */
export function projectOpeningCommit(value, options = {}) {
  return contentProjection(value, options, false, true)
}

/** Resolve macros only, for compatibility assets whose structure must stay intact. */
export function resolveRuntimeMacroText(value, options = {}) {
  return macroProjection(value, options)
}

/** Project one model reply for visible story/UI presentation. */
export function projectRuntimeReply(value, options = {}) {
  return projectReplyLayers(value, options)
}

/** Rebuild visible history from authoritative reply sources. */
export function projectRuntimeReplyHistory(messages, options = {}) {
  return projectReplyHistory(messages, options)
}

/** Apply compatibility regexes to ephemeral background input. */
export function projectBackgroundInput(value, scripts, placement = 1) {
  return applyTavernRegexText(value, scripts, { placement, isMarkdown: false, isEdit: false, depth: 0 })
}

/** Apply compatibility regexes to a background model result or visible history. */
export function projectBackgroundOutput(value, scripts) {
  return applyTavernRegexText(value, scripts, { placement: 2, isMarkdown: true, isEdit: false, depth: 0 })
}
