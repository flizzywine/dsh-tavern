import { composeTavernRegexScripts } from './card-extension-reading.js'
import { projectTavernHostHtml } from './tavern-host-script-projection.js'
import { cardOpeningChoices, cardOpeningSwipes } from './card-openings.js'
import { projectOpeningPreview } from './runtime-content-projection.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isOpeningChooser(source) {
  // Choosers may resolve these APIs indirectly, e.g. api('setChatMessage').
  return (/\bgetChatMessages\b/.test(source) && /\bsetChatMessages?\b/.test(source))
    || (/<script\b/i.test(source) && /\bswipe\s*\.\s*to\s*\(/.test(source))
}

/** Static greeting projection; getCardOpenings attaches the preparation runtime afterwards. */
export async function projectCardOpeningPreviews(input = {}) {
  const card = input.card && typeof input.card === 'object' ? input.card : {}
  const extensions = input.extensions && typeof input.extensions === 'object' ? input.extensions : {}
  const openings = cardOpeningChoices(card)
  const userName = str(input.userName).trim() || '你'
  const presetRegexScripts = Array.isArray(input.presetRegexScripts) ? input.presetRegexScripts : []
  const regexScripts = composeTavernRegexScripts(extensions, presetRegexScripts)
  const { swipes, openingIds } = cardOpeningSwipes(card)
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
          text: projectTavernHostHtml(projection.displayText),
          mode: projection.displayMode,
          parts: projection.displayParts.map(part => part.kind === 'html' ? { ...part, content: projectTavernHostHtml(part.content) } : part),
          warnings: projection.warnings
        },
        openingPreview: isOpeningChooser(projection.displayText) ? {
          swipes, openingIds, selectedIndex: openingIds.indexOf(opening.id)
        } : null,
        frameSizing: extensions.frameSizing || null,
        helperContext: null
      }
    }),
    diagnostics: []
  }
}
