// Who speaks each quoted line of a turn and how they feel (docs/design/cast-presentation.md).
// Settlement annotates the story text it already reads; the story itself is never rewritten.

export const CAST_SUBMIT_TOOL_NAME = 'cast_submit'
// Data owner in the per-game turn data store shared with plugins.
export const CAST_DATA_OWNER = 'dsh-tavern.cast'

// SillyTavern's Character Expressions labels, so an ST sprite pack's file names match.
export const CAST_EMOTIONS = Object.freeze({
  admiration: '钦佩', amusement: '逗乐', anger: '生气', annoyance: '烦躁', approval: '赞同', caring: '关心',
  confusion: '困惑', curiosity: '好奇', desire: '渴望', disappointment: '失望', disapproval: '不满', disgust: '嫌弃',
  embarrassment: '害羞', excitement: '兴奋', fear: '害怕', gratitude: '感激', grief: '悲痛', joy: '开心',
  love: '爱慕', nervousness: '紧张', neutral: '平静', optimism: '期待', pride: '得意', realization: '恍然',
  relief: '释然', remorse: '懊悔', sadness: '难过', surprise: '惊讶'
})
const EMOTION_NAMES = Object.keys(CAST_EMOTIONS)
const MAX_SPEAKER = 24
const QUOTE_PREVIEW = 40

export const CAST_SUBMIT_TOOL = Object.freeze({
  name: CAST_SUBMIT_TOOL_NAME,
  description: '标注本轮正文里每句编号台词的说话人和情绪。只按正文判断；看不出说话人的台词不要列出。返回 ok=true 后不再重复提交。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      lines: {
        type: 'array',
        description: '按编号列出台词；没有台词时提交空数组。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            n: { type: 'integer', description: '【本轮台词】里的编号' },
            speaker: { type: 'string', description: '说话人在正文中的名字' },
            emotion: { type: 'string', enum: EMOTION_NAMES, description: '说这句话时的情绪' }
          },
          required: ['n', 'speaker', 'emotion']
        }
      }
    },
    required: ['lines']
  })
})

// Same-line quote pairs, the delimiters the client colours as dialogue.
const QUOTE_PATTERN = /"([^"\r\n]+)"|“([^”\r\n]+)”|«([^»\r\n]+)»|「([^」\r\n]+)」|『([^』\r\n]+)』|＂([^＂\r\n]+)＂/g

/** Quoted lines of a story text, in reading order, without their delimiters. */
export function dialogueQuotes(text) {
  const quotes = []
  for (const match of String(text ?? '').matchAll(QUOTE_PATTERN)) {
    const quote = match.slice(1).find(group => group !== undefined).trim()
    if (quote) quotes.push(quote)
  }
  return quotes
}

/** The settlement note listing this turn's quotes; '' when there is nothing to annotate. */
export function castSettlementText(quotes, { speakers = [] } = {}) {
  if (!quotes.length) return ''
  const preview = quote => [...quote].length > QUOTE_PREVIEW ? [...quote].slice(0, QUOTE_PREVIEW).join('') + '…' : quote
  return ['【本轮台词】',
    '在提交姿势或变量之前，调用 cast_submit 标注下列台词的说话人与情绪。说话人用正文里的名字，同一人物前后保持同一个名字；看不出是谁说的就不要列出。情绪从工具给出的英文名里选最贴近的一个。',
    ...(speakers.length ? ['已出现的人物：' + speakers.join('、')] : []),
    ...quotes.map((quote, index) => (index + 1) + '. ' + preview(quote))].join('\n')
}

function cleanSpeaker(value) {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return [...name].slice(0, MAX_SPEAKER).join('')
}

/** Validated lines keyed back to the quote text, so the client can find them in the display. */
export function normalizeCastSubmission(args, quotes) {
  const source = Array.isArray(args?.lines) ? args.lines : null
  if (source === null) throw new Error('cast_submit 需要 lines 数组')
  const lines = []
  const seen = new Set()
  for (const item of source) {
    const n = Number(item?.n)
    if (!Number.isInteger(n) || n < 1 || n > quotes.length || seen.has(n)) continue
    const speaker = cleanSpeaker(item.speaker)
    if (!speaker) continue
    seen.add(n)
    lines.push({ n, quote: quotes[n - 1], speaker, emotion: Object.hasOwn(CAST_EMOTIONS, item.emotion) ? item.emotion : 'neutral' })
  }
  if (source.length && !lines.length) throw new Error('cast_submit 的台词编号或说话人都无效，请按【本轮台词】的编号重新提交')
  return lines.sort((left, right) => left.n - right.n)
}

/**
 * An edited reply keeps its speakers: a line whose quote is unchanged keeps its speaker and
 * emotion; when the edit kept the number of quotes, a reworded quote keeps the speaker of the
 * quote at its place. Quotes the edit added stay unannotated.
 */
export function carryCastLines(lines, oldQuoteCount, quotes) {
  const old = [...(Array.isArray(lines) ? lines : [])].sort((left, right) => left.n - right.n)
  const taken = new Map()
  let cursor = 0
  quotes.forEach((quote, index) => {
    for (let at = cursor; at < old.length; at++) {
      if (old[at].quote !== quote) continue
      taken.set(index, old[at])
      old[at] = null
      cursor = at + 1
      return
    }
  })
  if (oldQuoteCount === quotes.length) {
    for (const line of old) if (line && !taken.has(line.n - 1)) taken.set(line.n - 1, line)
  }
  return [...taken.entries()].sort((left, right) => left[0] - right[0])
    .map(([index, line]) => ({ n: index + 1, quote: quotes[index], speaker: line.speaker, emotion: line.emotion }))
}

/** Distinct speakers, most recent first, for keeping names consistent across turns. */
export function recentSpeakers(records, limit = 20) {
  const names = []
  for (const record of records) {
    for (const line of [...(record?.data?.lines || [])].reverse()) {
      const name = cleanSpeaker(line?.speaker)
      if (name && !names.includes(name)) names.push(name)
      if (names.length >= limit) return names
    }
  }
  return names
}
