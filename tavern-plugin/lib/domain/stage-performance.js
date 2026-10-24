import { dialogueQuotes } from './cast-annotation.js'

// Host-owned pages: annotations decorate a row, but cannot change its address.
export function stagePages(text, lines = []) {
  let cursor = 0
  if (/^\s*(```|~~~)/m.test(text)) lines = []
  return text.split('\n').map(row => row.trim()).filter(Boolean).map((text, index) => {
    let speaker
    const quotes = []
    for (const quote of dialogueQuotes(text)) {
      const next = lines.findIndex((line, i) => i >= cursor && line.quote === quote)
      if (next < 0) continue
      speaker ||= lines[next]
      cursor = next + 1
      quotes.push(quote)
    }
    return { at: index + 1, text, kind: speaker ? 'line' : 'narration',
      ...(speaker ? { speaker: speaker.speaker, emotion: speaker.emotion, quotes } : {}) }
  })
}

const ACT_SCHEMA = { type: 'object', additionalProperties: false, required: ['at', 'op', 'actor', 'motion'], properties: {
  at: { type: 'integer', minimum: 1 }, op: { const: 'actor.act.play' }, actor: { type: 'string' }, motion: { enum: ['nod', 'jump'] } } }
const SCREEN_SCHEMA = { type: 'object', additionalProperties: false, required: ['at', 'op', 'effect'], properties: {
  at: { type: 'integer', minimum: 1 }, op: { const: 'screen.play' }, effect: { const: 'shake-1' } } }
// 物品 (stageToggles.items): an item of the card's packs shown once on its page, by its name in the turn's `items` list.
const ITEM_SCHEMA = { type: 'object', additionalProperties: false, required: ['at', 'op', 'item'], properties: {
  at: { type: 'integer', minimum: 1 }, op: { const: 'item.play' }, item: { type: 'string', description: '物品清单里的名称' } } }
// 音效 (stageToggles.sfx): a sound of the card's packs played once on its page, by its name in the turn's `sfx` list.
const SFX_SCHEMA = { type: 'object', additionalProperties: false, required: ['at', 'op', 'sfx'], properties: {
  at: { type: 'integer', minimum: 1 }, op: { const: 'sfx.play' }, sfx: { type: 'string', description: '音效清单里的名称' } } }
// 舞台模式 › 可用演出: a switched-off command leaves the schema; with none, the director has no performances. `items` / `sfx`:
// the turn offers items / sound effects (物品 / 音效 on and some lit entry recalled).
export function stagePerformancesSchema({ acts = true, screenEffects = true, items = false, sfx = false } = {}) {
  const kinds = [acts && ACT_SCHEMA, screenEffects && SCREEN_SCHEMA, items && ITEM_SCHEMA, sfx && SFX_SCHEMA].filter(Boolean)
  return kinds.length ? { type: 'array', maxItems: 12, description: '一次性演出，不跨轮继承。at 是本轮正文页号，从 1 开始。', items: kinds.length > 1 ? { oneOf: kinds } : kinds[0] } : null
}
export const STAGE_PERFORMANCES_SCHEMA = stagePerformancesSchema()

// `rules`: the switched-on commands and 每轮上限 (`beat`: screen effects in the whole reply, `earlier` the turn's
// already accepted windows); `items` / `sfx` the names of the items / sound effects this turn offers.
export function acceptStagePerformances(value = [], pages, stage, { acts = true, screenEffects = true, items = [], sfx = [], beat = Infinity, earlier = [] } = {}) {
  if (!Array.isArray(value) || value.length > 12) throw Error('performances 需要至多十二项一次性演出，省略或 [] 表示没有')
  const occupied = new Set()
  let beats = earlier.filter(event => event?.op === 'screen.play').length
  for (const event of value) {
    const actor = event?.op === 'actor.act.play', item = event?.op === 'item.play', sound = event?.op === 'sfx.play'
    const keys = actor ? ['at', 'op', 'actor', 'motion'] : item ? ['at', 'op', 'item'] : sound ? ['at', 'op', 'sfx'] : ['at', 'op', 'effect']
    if (!event || typeof event !== 'object' || Object.keys(event).some(key => !keys.includes(key)) || !Number.isSafeInteger(event.at) || event.at < 1 || event.at > pages.length) throw Error('演出 at 请使用本轮正文页号，且只提交该命令列出的字段')
    if (item) {
      if (!items.length) throw Error('本轮没有可用物品，请删去 item.play')
      if (items.filter(name => name === event.item).length !== 1) throw Error('item 请使用物品清单里的唯一名称')
    } else if (sound) {
      if (!sfx.length) throw Error('本轮没有可用音效，请删去 sfx.play')
      if (sfx.filter(name => name === event.sfx).length !== 1) throw Error('sfx 请使用音效清单里的唯一名称')
    } else {
      if (actor ? !acts : event.op === 'screen.play' && !screenEffects) throw Error(event.op + ' 已在可用演出里关闭，请删去这一项')
      if (actor ? !['nod', 'jump'].includes(event.motion) || !stage.figures.some(figure => figure.speaker === event.actor) : event.op !== 'screen.play' || event.effect !== 'shake-1') throw Error('演出请使用' + [acts && '在场人物完整名称 + nod/jump', screenEffects && 'screen.play + shake-1', items.length && 'item.play + 物品名称', sfx.length && 'sfx.play + 音效名称'].filter(Boolean).join('，或 '))
    }
    // One item per page: the showcase holds one thing at a time. Different sounds may share a page, each once.
    const target = JSON.stringify([event.at, actor ? event.actor : sound ? event.sfx : null, item, sound])
    if (occupied.has(target)) throw Error('同页同一目标只安排一个短演出；不同页可重复')
    occupied.add(target)
    if (event.op === 'screen.play' && ++beats > beat) throw Error('画面效果每轮至多 ' + beat + ' 次，请删去多余的 screen.play')
  }
  return structuredClone(value)
}
