import { cardOpeningChoices } from './card-openings.js'
import { projectOpeningPreview } from './runtime-content-projection.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function previewRegexScript(script) {
  const source = str(script && script.replaceString)
  const scripts = Array.from(source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi))
  const needsMvu = scripts.some(function (match) {
    return /\bwaitGlobalInitialized\s*\(\s*(['"])Mvu\1|\bMvu\s*(?:\.|\[)/.test(match[1])
  })
  if (!needsMvu) return script
  // Only the chooser's display rule changes; the stored card and committed opening keep the real UI.
  return Object.assign({}, script, {
    replaceString: ''
  })
}

/** Compile greetings for selection; official MVU initializes only after commit. */
export async function projectCardOpeningPreviews(input = {}) {
  const card = input.card && typeof input.card === 'object' ? input.card : {}
  const extensions = input.extensions && typeof input.extensions === 'object' ? input.extensions : {}
  const openings = cardOpeningChoices(card)
  const userName = str(input.userName).trim() || '你'
  const cardRegexScripts = Array.isArray(extensions.regexScripts) ? extensions.regexScripts : []
  const presetRegexScripts = Array.isArray(input.presetRegexScripts) ? input.presetRegexScripts : []
  const regexScripts = cardRegexScripts.concat(presetRegexScripts).map(previewRegexScript)
  return {
    openings: openings.map(function (opening, index) {
      const projection = projectOpeningPreview(opening.text, {
        charName: str(card.name),
        macroState: { userName, local: {}, global: {} },
        regexScripts,
        regexPlacement: 2,
        isEdit: false,
        depth: 0
      })
      return {
        id: opening.id,
        text: projection.renderedText,
        usesUser: /\{\{\s*user\s*\}\}/i.test(opening.text),
        presentationOnly: projection.presentationOnly,
        projection: {
          version: 2,
          turn: 1,
          text: projection.displayText,
          mode: projection.displayMode,
          parts: projection.displayParts,
          warnings: projection.warnings
        },
        helperContext: null
      }
    }),
    diagnostics: []
  }
}
