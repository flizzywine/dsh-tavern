import { composeTavernRegexScripts } from './card-extension-reading.js'
import { projectTavernHostHtml } from './tavern-host-script-projection.js'
import { cardOpeningChoices, cardOpeningSwipes } from './card-openings.js'
import { projectOpeningPreview } from './runtime-content-projection.js'
import { projectDisplayParts, resolveDisplayIdentityMacros } from './reply-presentation.js'
import { compileOpeningTemplate, openingThemeVariables } from './opening-setup.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function isOpeningChooser(source) {
  // Choosers may resolve these APIs indirectly, e.g. api('setChatMessage').
  return (/\bgetChatMessages\b/.test(source) && /\bsetChatMessages?\b/.test(source))
    || (/<script\b/i.test(source) && /\bswipe\s*\.\s*to\s*\(/.test(source))
}

// What the prep page shows for a v2 spec: display text with {{user}}/{{char}} resolved, the compiled
// template and the theme tokens. Values, variables and the message stay with the host (resolveOpeningSetup).
function projectOpeningSetup(spec, { userName, charName }) {
  const macros = { charName, macroState: { userName } }
  const show = value => typeof value === 'string' ? resolveDisplayIdentityMacros(value, macros) : value
  const fields = spec.fields.map(function (field) {
    const shown = { ...field, label: show(field.label), help: show(field.help), text: show(field.text), placeholder: show(field.placeholder), fold: show(field.fold),
      default: show(field.type === 'name' ? (field.default ?? '{{user}}') : field.default) }
    if (Array.isArray(field.options)) shown.options = field.options.map(option => typeof option === 'string' ? option : { ...option, label: show(option.label), desc: show(option.desc), text: show(option.text) })
    return JSON.parse(JSON.stringify(shown))
  })
  return { version: 2, title: show(spec.title), intro: show(spec.intro), theme: spec.theme || {}, style: openingThemeVariables(spec.theme || {}), fields,
    template: compileOpeningTemplate(spec, { userName, charName }) }
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
  // the card's opening form replaces every greeting preview.
  const setup = extensions.openingSetup?.spec ? projectOpeningSetup(extensions.openingSetup.spec, { userName, charName: str(card.name) }) : null
  const setupParts = extensions.openingSetup?.form
    ? projectDisplayParts(resolveDisplayIdentityMacros(extensions.openingSetup.form, { charName: str(card.name), macroState: { userName } })).parts
    : []
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
      if (setupParts.length) Object.assign(projection, { displayParts: setupParts, displayText: extensions.openingSetup.form, displayMode: 'html' })
      return {
        id: opening.id,
        openingSetup: setupParts.length > 0 || setup !== null,
        ...(setup ? { setup } : {}),
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
