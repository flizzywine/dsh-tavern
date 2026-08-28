import { cardOpeningChoices } from './card-openings.js'
import { projectTavernHelperContext } from './tavern-helper-context.js'
import { readMvuWorldBookInitialState } from './tavern-mvu-runtime.js'
import { projectOpeningPreview } from './runtime-content-projection.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function enabledMvuResources(extensions) {
  return Array.isArray(extensions && extensions.mvuResources)
    && extensions.mvuResources.some(function (item) { return item && item.enabled !== false })
}

function sourceUsesMvu(openings) {
  return openings.some(function (opening) {
    return /<(?:initvar|json_?patch)>|_\.(?:set|insert|assign|remove|unset|delete|add)\(/i.test(opening.text)
  })
}

function previewHelperContext(openings, variables, selectedSwipeId) {
  return projectTavernHelperContext({
    messages: [{
      role: 'assistant',
      sourceText: openings[selectedSwipeId].text,
      text: openings[selectedSwipeId].text,
      swipes: openings.map(function (opening) { return opening.text }),
      variables,
      swipeId: selectedSwipeId,
      greeting: true,
      turn: 1
    }]
  })
}

/** Compile every greeting through the same regex and MVU inputs used by a committed opening. */
export async function projectCardOpeningPreviews(input = {}) {
  const card = input.card && typeof input.card === 'object' ? input.card : {}
  const extensions = input.extensions && typeof input.extensions === 'object' ? input.extensions : {}
  const openings = cardOpeningChoices(card)
  const userName = str(input.userName).trim() || '你'
  const cardRegexScripts = Array.isArray(extensions.regexScripts) ? extensions.regexScripts : []
  const presetRegexScripts = Array.isArray(input.presetRegexScripts) ? input.presetRegexScripts : []
  const regexScripts = cardRegexScripts.concat(presetRegexScripts)
  const usesMvu = enabledMvuResources(extensions) || sourceUsesMvu(openings)
  let initialized = null
  let diagnostics = []

  if (usesMvu && openings.length > 0) {
    if (!input.runtime || typeof input.runtime.initializeChat !== 'function') throw new Error('开局预览缺少 MVU runtime')
    const worldBookInitial = readMvuWorldBookInitialState(card.character_book, { userName, charName: str(card.name) })
    initialized = await input.runtime.initializeChat({
      swipes: openings.map(function (opening) { return opening.text }),
      selectedSwipeId: 0,
      baseStatData: worldBookInitial.statData,
      initializedLorebooks: worldBookInitial.initializedLorebooks,
      macroContext: { userName, charName: str(card.name) }
    })
    diagnostics = worldBookInitial.diagnostics.concat(Array.isArray(initialized.diagnostics) ? initialized.diagnostics : [])
  }

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
        helperContext: initialized === null ? null : previewHelperContext(openings, initialized.variables, index)
      }
    }),
    diagnostics
  }
}
