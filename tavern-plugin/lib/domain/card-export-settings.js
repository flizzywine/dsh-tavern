import {rawData} from './card-preparation.js'

// the player's own choices for a card (stage.skinChoice, CONFIG 「本卡皮肤」; stage.switches, 基础设置's 本卡开启 / 本卡关闭)
// stay with this install: a card leaving it (card ZIP, card JSON) or arriving (import) carries only the author's settings.
export function withoutPlayerChoices(raw) {
  const stage = rawData(raw)?.extensions?.dsh_tavern?.stage
  for (const key of ['skinChoice', 'switches']) if (stage && Object.hasOwn(stage, key)) delete stage[key]
  return raw
}
