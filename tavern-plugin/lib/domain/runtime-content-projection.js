import { randomUUID } from 'node:crypto'
import { projectReplyLayers } from './reply-presentation.js'
import { renderTavernMacros } from './tavern-macro-engine.js'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { renderWorldbookRandom } from './worldbook-random.js'
import { encodeOpeningIdentity, replaceOpeningIdentities } from './opening-identity.js'

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

function openingMacroProjection(value, options) {
  const names = { user: str(options.macroState?.userName) || '你', char: str(options.charName) }
  const slots = new Map()
  let prefix
  const source = replaceOpeningIdentities(str(value), (name, syntax, token) => {
    const raw = names[name]
    const encoded = encodeOpeningIdentity(raw, syntax)
    if (raw === encoded) return token
    prefix ??= 'TavernIdentity' + randomUUID().replaceAll('-', '') + 'X'
    const marker = prefix + slots.size + 'Z'
    slots.set(marker, { raw, encoded })
    return marker
  })
  const rendered = macroProjection(source, options)
  if (slots.size === 0) return rendered
  const pattern = new RegExp(prefix + '\\d+Z', 'g')
  rendered.text = rendered.text.replace(pattern, marker => slots.get(marker)?.encoded ?? marker)
  // A name used as a macro argument still represents the player's literal name.
  for (const scope of [rendered.macroState.local, rendered.macroState.global]) {
    for (const key of Object.keys(scope)) {
      if (typeof scope[key] === 'string') scope[key] = scope[key].replace(pattern, marker => slots.get(marker)?.raw ?? marker)
    }
  }
  return rendered
}

function contentProjection(value, options, { opening = false, preview = false } = {}) {
  const rendered = opening ? openingMacroProjection(value, options) : macroProjection(value, options)
  // Dice/random macros left after per-turn worldbook rendering (e.g. keyword entries)
  // still roll like SillyTavern instead of reaching the model as "roll: d8".
  // The host marks Tavern prompt sections literal at assembly time.
  const renderedText = preview ? rendered.text : renderWorldbookRandom(rendered.text, Math.random)
  const layers = projectReplyLayers(renderedText, {
    charName: options && options.charName,
    macroState: options && options.macroState,
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
  return contentProjection(value, options)
}

/** Return the single macro-projected text that a chat message may expose to an Agent. */
export function projectAgentMessageText(message, options = {}) {
  const value = message !== null && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, 'text')
    ? message.text
    : (message !== null && typeof message === 'object' && Object.prototype.hasOwnProperty.call(message, 'projectionText')
        ? message.projectionText
        : message && message.sourceText)
  return projectAgentContent(value, options).agentText
}

/** Render a chooser preview while keeping the complete rendered opening. */
export function projectOpeningPreview(value, options = {}) {
  return contentProjection(value, options, { opening: true, preview: true })
}

/** Commit an opening as story text plus an isolated presentation projection. */
export function projectOpeningCommit(value, options = {}) {
  return contentProjection(value, options, { opening: true })
}

/** Resolve macros only, for compatibility assets whose structure must stay intact. */
export function resolveRuntimeMacroText(value, options = {}) {
  return macroProjection(value, options)
}

/** Project one model reply for visible story/UI presentation. */
export function projectRuntimeReply(value, options = {}) {
  return projectReplyLayers(value, options)
}

/** Apply compatibility regexes to ephemeral background input. */
export function projectBackgroundInput(value, scripts, placement = 1) {
  return applyTavernRegexText(value, scripts, { placement, isMarkdown: false, isEdit: false, depth: 0 })
}
