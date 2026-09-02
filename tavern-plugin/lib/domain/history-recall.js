function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.max(minimum, Math.min(maximum, number))
}

function searchable(value) {
  return str(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

function termsOf(query) {
  return Array.from(new Set(str(query).toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) || []))
}

function excerpt(text, terms, maximum = 240) {
  const source = str(text).replace(/\s+/g, ' ').trim()
  if (source.length <= maximum) return source
  const lower = source.toLocaleLowerCase()
  let found = -1
  for (const term of terms) {
    const index = lower.indexOf(term)
    if (index >= 0 && (found < 0 || index < found)) found = index
  }
  const start = Math.max(0, (found < 0 ? 0 : found) - Math.floor(maximum / 3))
  const end = Math.min(source.length, start + maximum)
  return (start > 0 ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '')
}

function committedRounds(chat) {
  const rounds = []
  let pendingUsers = []
  let inferredTurn = 1
  for (const message of Array.isArray(chat && chat.messages) ? chat.messages : []) {
    if (message === null || typeof message !== 'object') continue
    if (message.role === 'user') {
      const text = str(message.text).trim()
      if (text !== '') pendingUsers.push({ role: 'user', text })
      inferredTurn++
      continue
    }
    if (message.role !== 'assistant') continue
    const text = str(message.text).trim()
    if (text === '') continue
    const turn = Math.max(1, Number(message.turn) || (message.greeting === true ? 1 : inferredTurn))
    rounds.push({
      turn,
      messages: pendingUsers.concat([{ role: 'assistant', text }])
    })
    pendingUsers = []
  }
  return rounds
}

function scoreRound(round, query, terms) {
  const text = round.messages.map(function (message) { return message.text }).join('\n')
  const normalized = searchable(text)
  const full = searchable(query)
  let score = full !== '' && normalized.includes(full) ? 1000 : 0
  let matched = 0
  for (const term of terms) {
    if (normalized.includes(searchable(term))) matched++
  }
  if (matched === 0 && score === 0) return null
  score += matched * 100 + Math.round(matched / Math.max(1, terms.length) * 10)
  return { score, text }
}

export const HISTORY_RECALL_TOOL = Object.freeze({
  name: 'tavern_recall_history',
  description: '检索或读取当前对话已经正式发生的历史正文，仅用于回忆细节和剧情。query 与 turn 必须且只能提供一个。检索结果不是当前场景，不得重复演绎、照搬旧台词或让已经发生的事件再次发生。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, description: '要回忆的人物、地点、物品、承诺或事件关键词；多个关键词用空格分隔。' },
      turn: { type: 'integer', minimum: 1, description: '读取指定剧情轮次及其附近原文。' },
      radius: { type: 'integer', minimum: 0, maximum: 3, description: '按轮读取时包含前后多少轮，默认 1。' },
      limit: { type: 'integer', minimum: 1, maximum: 8, description: '关键词检索最多返回多少条命中，默认 5。' }
    }
  })
})

export const HISTORY_RECALL_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean', required: true },
    chatId: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    mode: { type: 'string', required: true },
    query: { type: 'string', required: true },
    requestedTurn: { type: 'integer', required: true },
    matches: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          turn: { type: 'integer', required: true },
          excerpt: { type: 'string', required: true }
        }
      }
    },
    rounds: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          turn: { type: 'integer', required: true },
          messages: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                role: { type: 'string', required: true },
                text: { type: 'string', required: true }
              }
            }
          }
        }
      }
    }
  }
})

export function createHistoryRecall() {
  function recall(input = {}) {
    const chat = input.chat
    if (chat === null || typeof chat !== 'object') throw new Error('历史正文检索缺少 Tavern Chat')
    const query = str(input.query).trim()
    const hasQuery = query !== ''
    const hasTurn = input.turn !== undefined && input.turn !== null
    if (Number(hasQuery) + Number(hasTurn) !== 1) throw new Error('历史正文检索必须且只能提供 query 或 turn')
    const rounds = committedRounds(chat)
    const base = {
      found: false,
      chatId: str(chat.id),
      revision: Math.max(0, Number(chat._storageRevision) || 0),
      mode: hasQuery ? 'search' : 'read',
      query: hasQuery ? query : '',
      requestedTurn: hasTurn ? Number(input.turn) : 0,
      matches: [],
      rounds: []
    }
    if (hasQuery) {
      const terms = termsOf(query)
      if (terms.length === 0) throw new Error('历史正文检索关键词不能为空')
      const limit = clampInteger(input.limit, 5, 1, 8)
      const matches = rounds.map(function (round) {
        const scored = scoreRound(round, query, terms)
        if (scored === null) return null
        return { turn: round.turn, score: scored.score, excerpt: excerpt(scored.text, terms) }
      }).filter(Boolean).sort(function (left, right) {
        return right.score - left.score || right.turn - left.turn
      }).slice(0, limit).map(function (match) {
        return { turn: match.turn, excerpt: match.excerpt }
      })
      return Object.assign(base, { found: matches.length > 0, matches })
    }
    const requested = Number(input.turn)
    if (!Number.isInteger(requested) || requested < 1) throw new Error('历史正文轮次必须是大于 0 的整数')
    const radius = clampInteger(input.radius, 1, 0, 3)
    const selected = rounds.filter(function (round) { return Math.abs(round.turn - requested) <= radius })
    return Object.assign(base, { found: selected.some(function (round) { return round.turn === requested }), rounds: selected })
  }

  return Object.freeze({ recall })
}

export function renderHistoryRecall(value) {
  const warning = '【历史回忆资料】\n以下是已经发生的历史，只用于确认和回忆；不得当作当前场景继续输出，不得重复演绎。'
  if (!value || value.found !== true) return warning + '\n\n没有找到相关历史正文。'
  if (value.mode === 'search') {
    return warning + '\n\n' + value.matches.map(function (match) {
      return '[第 ' + match.turn + ' 轮]\n' + match.excerpt
    }).join('\n\n') + '\n\n需要完整上下文时，请用 turn 读取对应轮次。'
  }
  return warning + '\n\n' + value.rounds.map(function (round) {
    return '【第 ' + round.turn + ' 轮】\n' + round.messages.map(function (message) {
      return (message.role === 'user' ? '[玩家]' : '[正文]') + '\n' + message.text
    }).join('\n\n')
  }).join('\n\n')
}
