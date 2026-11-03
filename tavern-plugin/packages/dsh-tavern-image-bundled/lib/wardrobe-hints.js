import { isPlayerCharacter } from './planner.js'

const RULE = '【可选服装】玩家指定的穿着和已写明的剧情优先。只有剧情需要换装且玩家未指定时，才参考该人物的服装。写颜色和款式，别在正文加目录标注；没有合适的选项时照常写作。'
const MAX_CONTEXT = 1200
const MAX_OUTFITS = 12
const clean = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length)

export function wardrobeSection(people, shared, input = '') {
  const byId = new Map(shared.filter(outfit => outfit.enabled !== false).map(outfit => [outfit.id, outfit]))
  const mentioned = clean(input, 3000).toLowerCase()
  const namedChoices = [], defaults = [], others = []
  for (const person of people) {
    if (person.enabled === false || !clean(person.name, 45) || (!person.cards?.length && !isPlayerCharacter(person))) continue
    const seen = new Set()
    for (const outfit of [...(person.outfits ?? []), ...(person.outfitRefs ?? []).map(id => byId.get(id))]) {
      if (!outfit || outfit.enabled === false) continue
      const name = clean(outfit.name, 55)
      if (!name || seen.has(name)) continue
      seen.add(name)
      const named = name.length >= 2 && mentioned.includes(name.toLowerCase())
      if (outfit.nsfw === true && !named) continue
      const choices = named ? namedChoices : outfit.default === true ? defaults : others
      if (choices.length === MAX_OUTFITS) continue
      const description = [outfit.upper || outfit.body, outfit.lower, outfit.shoes, outfit.accessory, outfit.full]
        .map(value => clean(value, 48)).filter(Boolean).join('，').slice(0, 105)
      if (!description) continue
      choices.push(clean(person.name, 45) + ' · ' + name + (outfit.nsfw === true ? '（仅私密场合）' : '') + '：' + description)
    }
  }
  const lines = [RULE]
  let length = RULE.length
  for (const line of [...namedChoices, ...defaults, ...others].slice(0, MAX_OUTFITS)) {
    if (length + 1 + line.length > MAX_CONTEXT) break
    lines.push(line)
    length += 1 + line.length
  }
  return lines.length > 1 ? lines.join('\n') : ''
}
