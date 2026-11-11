import { cardOpeningPage } from './card-status-panel.js'
import { cardOpeningSetup } from './card-extension-reading.js'
import { cardOpeningChoices, openingInitialState } from './card-openings.js'
import { projectOpeningPreview } from './runtime-content-projection.js'

// What a card's opening page (card page opening: true, presets/tavern/skills/stage-status-panel/references/panel-contract.md「开局页」) draws its choices from:
// the card's greetings (text projected for userName by the host's own macro authority, the state its <initvar> starts
// in, its opening scene) and the openingSetup it completes. null when page is not the card's opening page. The stage
// reads it through its core contract (DshCardPage.opening); the start itself is opening-preparation.js.
export function projectCardPageOpening(card, { page, userName }) {
  const extension = card?.extensions?.dsh_tavern
  if (cardOpeningPage(extension?.pages)?.id !== page) return null
  const scenes = extension?.openings?.scenes || {}
  return {
    userName, setup: cardOpeningSetup(card.extensions)?.spec || null,
    openings: cardOpeningChoices(card).map(({ id, text }) => {
      const scene = scenes[id], state = openingInitialState(text)
      return { id, text: projectOpeningPreview(text, { charName: card.name, macroState: { userName, local: {}, global: {} } }).renderedText,
        ...(state !== undefined ? { state } : {}),
        ...(scene ? { scene: { ...(scene.title ? { title: scene.title } : {}), ...(scene.summary ? { summary: scene.summary } : {}), background: scene.background?.assetId || null, music: scene.music?.assetId || null, timeOfDay: scene.timeOfDay ?? null } } : {}) }
    })
  }
}
