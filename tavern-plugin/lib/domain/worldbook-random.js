import { randomBytes } from 'node:crypto'
export { entryRandom } from './worldbook-random-sequence.js'

export function hasWorldbookRandom(content) {
  return /\{\{\s*(?:random|roll)\b|\bMath\s*(?:\.\s*random|\[\s*['"]random['"]\s*\])/i.test(String(content || ''))
}

export function worldbookRandomState(chat, turn) {
  return chat.worldBookRandomState?.turn === turn ? chat.worldBookRandomState : { turn, seed: randomBytes(16).toString('hex') }
}

export function renderWorldbookRandom(text, random) {
  // SillyTavern accepts {{roll::d6}}, {{roll:d6}}, {{roll: d6}} and {{roll d6}}; a bare number means 1dN.
  return String(text).replace(/\{\{\s*roll\s*(?:::|:|\s)\s*(?:(\d*)d(\d+)|(\d+))(?:\s*([+-])\s*(\d+))?\s*\}\}/gi, (raw, count, sides, bare, sign, modifier) => {
    const n = Number(count || 1), faces = Number(sides || bare)
    if (n < 1 || n > 1000 || faces < 1 || !Number.isSafeInteger(faces)) return raw
    let total = 0
    for (let i = 0; i < n; i++) total += 1 + Math.floor(random() * faces)
    return String(total + (sign === '-' ? -1 : 1) * Number(modifier || 0))
  }).replace(/\{\{\s*random\s*::?([^{}]*)\}\}/gi, (_raw, values) => {
    const choices = values.includes('::') ? values.split('::') : values.split(',')
    return choices[Math.floor(random() * choices.length)].trim()
  })
}
