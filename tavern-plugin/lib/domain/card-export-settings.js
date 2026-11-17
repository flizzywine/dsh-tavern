import {rawData} from './card-preparation.js'

// the player's own choices for a card (stage.skinChoice, CONFIG 「本卡皮肤」)
// stay with this install: a card leaving it (card ZIP, card JSON) or arriving (import) carries only the author's settings.
export function withoutPlayerChoices(raw) {
  const stage = rawData(raw)?.extensions?.dsh_tavern?.stage
  if (stage && Object.hasOwn(stage, 'skinChoice')) delete stage.skinChoice
  return raw
}
