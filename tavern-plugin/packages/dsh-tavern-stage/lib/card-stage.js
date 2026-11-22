import {figureCatalogue} from '../../../lib/domain/figure-catalogue.js'
import {rawData} from '../../../lib/domain/card-preparation.js'
import {readCardAssetExtension} from '../../../lib/domain/card-asset-bindings.js'
export {cardBubbleConfig, createCardStage, cardStageSkinView, stageSkinPreview, syncPreparedCardBubbles} from '../../../lib/domain/card-dialogue.js'

// Every figure a card can resolve, enabled or not: the automatic figure writer checks speakers against these rows.
export const cardFigureRows = ({raw, snapshots, globalEnabledPackIds}) => figureCatalogue({snapshots, bindings:readCardAssetExtension(raw)?.assetBindings, globalEnabledPackIds})
// 自动选角's 选角助理 searches the card's text as pieces: its own fields, each world book entry, and the game's 人物档案.
export function cardLorePieces(raw, chat) {
  const data = rawData(raw) || {}, pieces = []
  for (const [key, label] of [['description', '卡描述'], ['personality', '性格'], ['scenario', '场景'], ['first_mes', '开场白'], ['mes_example', '对话示例']])
    for (const text of String(data[key] || '').split(/\n\s*\n/)) if (text.trim()) pieces.push({source:label, text:text.trim()})
  for (const entry of data.character_book?.entries || []) if (String(entry.content || '').trim())
    pieces.push({source:'世界书：' + (entry.comment || [].concat(entry.keys || []).join('、') || '条目'), text:String(entry.content).trim(), keys:[].concat(entry.keys || [])})
  for (const character of chat?.characterDesignDocument?.characters || [])
    pieces.push({source:'人物档案：' + character.name, text:JSON.stringify(character)})
  return pieces
}
