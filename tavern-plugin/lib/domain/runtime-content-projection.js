import { projectReplyPresentation } from './reply-presentation.js'
import { renderTavernMacros } from './tavern-macro-engine.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function macroSnapshot(value = {}) {
  return {
    userName: str(value.userName) || 'User',
    local: Object.assign({}, value.local && typeof value.local === 'object' ? value.local : {}),
    global: Object.assign({}, value.global && typeof value.global === 'object' ? value.global : {})
  }
}

/**
 * Compatibility boundary for content entering an Agent.
 *
 * `play` and `opening-commit` evaluate Tavern macros against an isolated
 * variable snapshot and remove presentation HTML from Agent-facing text.
 * `opening-preview` keeps the complete rendered result for the isolated
 * chooser. `source` preserves editable card/material source without executing
 * it.
 */
export function projectRuntimeContent(value, options = {}) {
  const raw = str(value)
  const state = macroSnapshot(options.macroState)
  if (options.policy === 'source') {
    return {
      agentText: raw,
      bodyText: raw,
      renderedText: raw,
      presentationHtml: '',
      presentationOnly: false,
      warnings: [],
      diagnostics: [],
      macroState: state
    }
  }

  const rendered = renderTavernMacros(raw, {
    charName: str(options.charName),
    userName: state.userName,
    localVariables: state.local,
    globalVariables: state.global
  })
  const presentation = projectReplyPresentation(rendered.text)
  const preview = options.policy === 'opening-preview'
  return {
    agentText: preview ? rendered.text : presentation.bodyText,
    bodyText: presentation.bodyText,
    renderedText: rendered.text,
    presentationHtml: presentation.presentationHtml,
    presentationOnly: presentation.presentationHtml !== '' && presentation.bodyText === '',
    warnings: presentation.warnings,
    diagnostics: rendered.diagnostics,
    macroState: {
      userName: state.userName,
      local: rendered.localVariables,
      global: rendered.globalVariables
    }
  }
}
