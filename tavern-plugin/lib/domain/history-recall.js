import { createHash } from 'node:crypto'
import { promptSection } from './prompt-section.js'
import { bm25Scores, buildBm25Index, hasPosting, tokenizeBigram } from './bm25.js'

// —— 补丁（19号清单 §1，2026-11-18）——
// #1 检索打分：整词子串 → bigram-BM25（中文单字+双字滑窗，k1=1.5/b=0.75，参数照 ACU 17号文档 §2.1）。
//    保留：全句命中加成 1000、输出 schema、searchKey 去重、termTurns 分布、read 模式全部行为。
// #2 冷却放行：搜索模式不再跳过冷却轮（读全文才记冷却，搜索本就只出 240 字摘要），
//    冷却轮的命中加前缀标记，notice 同步改口。
// 原文件备份：D:\酒馆修复工作区\dsh-patch\history-recall.js.orig

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

// Like grep's context lines: a short window around every hit, nearby hits merged, at most `count` windows.
function hitExcerpts(text, terms, radius = 60, count = 3) {
  const source = str(text).replace(/\s+/g, ' ').trim()
  const lower = source.toLocaleLowerCase()
  const windows = []
  for (const term of terms) {
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) windows.push([Math.max(0, at - radius), Math.min(source.length, at + term.length + radius)])
  }
  if (!windows.length) return excerpt(text, terms)
  windows.sort((left, right) => left[0] - right[0])
  const merged = []
  for (const window of windows) {
    const last = merged.at(-1)
    if (last && window[0] <= last[1] && window[1] - last[0] <= radius * 4) last[1] = Math.max(last[1], window[1])
    else if (last && window[0] < last[1]) continue
    else merged.push(window.slice())
  }
  return merged.slice(0, count).map(([start, end]) => (start > 0 ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '')).join(' ')
    + (merged.length > count ? ` （本轮另有 ${merged.length - count} 处命中）` : '')
}

// Which rounds mention each keyword, so a narrow query still shows where else the story touched it.
function termTurns(rounds, terms) {
  const texts = rounds.map(round => ({ turn: round.turn, text: searchable(round.messages.map(message => message.text).join('\n')) }))
  return terms.map(term => ({ term, turns: texts.filter(item => item.text.includes(searchable(term))).map(item => item.turn) }))
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

// Keep only the two most recent chat corpora.
const bm25CorpusCache = new Map()

function buildBm25Corpus(rounds, cacheKey) {
  if (bm25CorpusCache.has(cacheKey)) return bm25CorpusCache.get(cacheKey)
  const texts = rounds.map(round => round.messages.map(message => message.text).join('\n'))
  const corpus = { ...buildBm25Index(texts), texts }
  bm25CorpusCache.set(cacheKey, corpus)
  if (bm25CorpusCache.size > 2) bm25CorpusCache.delete(bm25CorpusCache.keys().next().value)
  return corpus
}

// 摘要窗口的锚词：本轮命中的查询词里挑 IDF 最低（最稀有）的，双字词优先——常见虚词不当锚
function excerptAnchors(queryTokens, corpus, docIdx) {
  const present = queryTokens.filter(token => hasPosting(corpus.index.get(token), docIdx))
  present.sort((left, right) => (corpus.index.get(left)?.length || 0) - (corpus.index.get(right)?.length || 0))
  const strong = present.filter(token => token.length >= 2).slice(0, 5)
  return strong.length ? strong : present.slice(0, 2)
}

export const HISTORY_RECALL_TOOL = Object.freeze({
  name: 'tavern_recall_history',
  description: '检索或读取当前对话已经正式发生的历史正文。剧情摘要省略了大部分数字、原话和次要情节；用到摘要里没有原文的细节时先查，不要凭摘要推断。query 用要找的人物、物品、事件本身的词，不要用摘要里已有的结论或数字当关键词（那只会查回你已知的内容）；问「第一次」「最早」时留意轮次靠前的结果。query 和 turn 二选一，只填一个。每次生成最多召回 6 次；完整正文召回后冷却 10 个剧情轮次，冷却期间不可重复读取。已有信息足够时直接继续任务，不要重复读取同一轮。检索结果是已经发生过的事，不是当前场景：用它确认细节，正文从当前场景接着写，不重演、不照搬旧台词。',
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
    notice: { type: 'string', required: true },
    found: { type: 'boolean', required: true },
    chatId: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    mode: { type: 'string', required: true },
    query: { type: 'string', required: true },
    requestedTurn: { type: 'integer', required: true },
    terms: {
      type: 'array', required: true,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          term: { type: 'string', required: true },
          turns: { type: 'array', required: true, items: { type: 'integer' } }
        }
      }
    },
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
  const scopes = new WeakMap()
  function stateFor(scope) {
    if (!scope || typeof scope !== 'object') return null
    if (!scopes.has(scope)) scopes.set(scope, { calls: 0, rounds: new Set(), searches: new Set() })
    return scopes.get(scope)
  }
  function recall(input = {}) {
    const chat = input.chat
    if (chat === null || typeof chat !== 'object') throw new Error('历史正文检索缺少 Tavern Chat')
    const query = str(input.query).trim()
    const hasQuery = query !== ''
    const hasTurn = input.turn !== undefined && input.turn !== null
    if (Number(hasQuery) + Number(hasTurn) !== 1) throw new Error('历史正文检索必须且只能提供 query 或 turn')
    const rounds = committedRounds(chat)
    const currentTurn = rounds.reduce((maximum, round) => Math.max(maximum, round.turn), 0)
    const branch = str(chat.timeline?.branchId)
    const signature = round => createHash('sha256').update(JSON.stringify(round.messages)).digest('hex')
    const audience = input.audience === 'background' ? 'background' : 'foreground'
    const cooldowns = input.trackCooldown && Array.isArray(chat.historyRecallCooldowns)
      ? chat.historyRecallCooldowns.filter(item => item && (item.audience === 'foreground' || item.audience === 'background') && item.branch === branch && currentTurn >= item.at && currentTurn - item.at <= 10)
      : []
    const cooling = round => cooldowns.some(item => item.audience === audience && item.turn === round.turn && item.hash === signature(round))
    const base = {
      notice: '',
      found: false,
      chatId: str(chat.id),
      revision: Math.max(0, Number(chat._storageRevision) || 0),
      mode: hasQuery ? 'search' : 'read',
      query: hasQuery ? query : '',
      requestedTurn: hasTurn ? Number(input.turn) : 0,
      terms: [],
      matches: [],
      rounds: []
    }
    const state = stateFor(input.scope)
    if (state && state.calls++ >= 6) {
      return Object.assign(base, { notice: '本次生成的历史召回预算已用尽。请使用已经返回的资料继续当前任务，不要再调用历史召回。' })
    }
    if (hasQuery) {
      const terms = termsOf(query)
      if (terms.length === 0) throw new Error('历史正文检索关键词不能为空')
      const searchKey = JSON.stringify([str(chat.id), [...terms].sort(), clampInteger(input.limit, 5, 1, 8)])
      if (state?.searches.has(searchKey)) return Object.assign(base, { notice: '相同关键词已检索，请使用之前的结果；仅在缺少必要细节时读取对应轮次。' })
      state?.searches.add(searchKey)
      const limit = clampInteger(input.limit, 5, 1, 8)
      const corpus = buildBm25Corpus(rounds, str(chat.id) + ':' + Math.max(0, Number(chat._storageRevision) || 0) + ':' + rounds.length)
      const queryTokens = Array.from(new Set(tokenizeBigram(query)))
      const scores = bm25Scores(queryTokens, corpus)
      const full = searchable(query)
      const matches = []
      for (let docIdx = 0; docIdx < corpus.count; docIdx++) {
        if (!(scores[docIdx] > 0)) continue
        const score = scores[docIdx] + (full !== '' && searchable(corpus.texts[docIdx]).includes(full) ? 1000 : 0)
        matches.push({ docIdx, turn: rounds[docIdx].turn, score })
      }
      matches.sort(function (left, right) {
        return right.score - left.score || right.turn - left.turn
      })
      const top = matches.slice(0, limit).map(function (match) {
        const anchors = excerptAnchors(queryTokens, corpus, match.docIdx)
        const cooledMark = cooling(rounds[match.docIdx]) ? '〔全文已读过·摘要复查〕' : ''
        return { turn: match.turn, excerpt: cooledMark + hitExcerpts(corpus.texts[match.docIdx], anchors.length ? anchors : terms) }
      })
      return Object.assign(base, { found: matches.length > 0, matches: top, terms: termTurns(rounds, terms), notice: cooldowns.some(item => item.audience === audience) ? '已召回全文的轮次处于 10 轮冷却期，本次命中只显示摘要复查。' : '' })
    }
    const requested = Number(input.turn)
    if (!Number.isInteger(requested) || requested < 1) throw new Error('历史正文轮次必须是大于 0 的整数')
    const radius = clampInteger(input.radius, 1, 0, 3)
    const selected = rounds.filter(function (round) { return Math.abs(round.turn - requested) <= radius })
    const cooled = selected.filter(cooling)
    const fresh = selected.filter(round => {
      if (cooling(round)) return false
      const key = JSON.stringify([str(chat.id), round.turn, round.messages])
      if (state?.rounds.has(key)) return false
      state?.rounds.add(key)
      return true
    })
    if (input.trackCooldown && fresh.length) {
      chat.historyRecallCooldowns = cooldowns.filter(item => item.audience !== audience || !fresh.some(round => round.turn === item.turn))
        .concat(fresh.map(round => ({ turn: round.turn, hash: signature(round), at: currentTurn, branch, audience })))
    }
    return Object.assign(base, {
      found: selected.some(round => round.turn === requested), rounds: fresh,
      notice: cooled.length ? '第 ' + cooled.map(round => round.turn).join('、') + ' 轮已召回，处于 10 轮冷却期；请使用已有资料继续任务。' : fresh.length < selected.length ? '重叠轮次已读取，本次只补充未返回的正文。请使用之前的资料，不要重复召回。' : ''
    })
  }

  return Object.freeze({ recall })
}

const recalledRound = (turn, text) => `<round turn="${turn}">\n${text}\n</round>`

export function renderHistoryRecall(value) {
  return promptSection('history_recall', historyRecallText(value))
}

function historyRecallText(value) {
  let warning = '以下是已经发生的历史，用来确认和回忆细节；正文从当前场景接着写，不重演这一段。'
  if (value?.notice) warning += '\n\n' + value.notice
  if (value?.notice && !value.rounds?.length && !value.matches?.length) return warning
  if (!value || value.found !== true) return warning + '\n\n没有找到相关历史正文。'
  if (value.mode === 'search') {
    const spread = (value.terms || []).map(function (item) {
      const turns = item.turns.length > 40 ? item.turns.slice(0, 20).join('、') + '……' + item.turns.slice(-20).join('、') : item.turns.join('、')
      return '「' + item.term + '」' + (item.turns.length ? '逐字出现于第 ' + turns + ' 轮' : '没有逐字出现——这不代表没命中，下方命中有部分匹配的正常结果')
    }).join('\n')
    return warning + '\n\n（检索支持部分匹配：查询不需要与原文逐字一致，措辞相近即可命中。）' + (spread ? '\n\n逐字出现位置（可选参考）：\n' + spread : '') + '\n\n按相关度命中的轮次：\n\n' + value.matches.map(function (match) {
      return recalledRound(match.turn, match.excerpt)
    }).join('\n\n') + '\n\n只列出了最相关的几轮。信息足够就继续当前任务。'
  }
  return warning + '\n\n' + value.rounds.map(function (round) {
    return recalledRound(round.turn, round.messages.map(function (message) {
      return (message.role === 'user' ? '[玩家]' : '[正文]') + '\n' + message.text
    }).join('\n\n'))
  }).join('\n\n')
}
