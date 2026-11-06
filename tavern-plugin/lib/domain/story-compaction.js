import { sessionEvents } from './session-events.js'
import { isPluginSource, isProducerSource } from './message-source.js'

export function usesStoryCompaction(chat) {
  return chat !== null && typeof chat === 'object' && (chat.mode === 'story' || chat.mode === 'script')
}

export function createStoryCompactionRequest(options, instruction) {
  if (options === null || typeof options !== 'object' || options.purpose !== 'compaction') return options
  if (!Array.isArray(options.messages) || options.messages.length === 0) return options
  if (typeof instruction !== 'string' || instruction.trim() === '') throw new TypeError('剧情压缩提示词不能为空')

  const lastIndex = options.messages.length - 1
  const message = options.messages[lastIndex]
  const source = message && message.source
  // The summarization directive is the final user message DSH appends. DSH 0.1.x tagged it
  // with its producer; DSH 0.2.x sends it with no source at all. Missing the second shape
  // left every story compaction on DSH's English engineering-summary prompt.
  if (message === null || typeof message !== 'object' || message.role !== 'user' ||
    (source !== undefined && source !== null && !isProducerSource(source, 'dsh-compaction-basic'))) return options

  const messages = options.messages.slice()
  messages[lastIndex] = Object.freeze(Object.assign({}, message, {
    content: Object.freeze([Object.freeze({ type: 'text', text: instruction })])
  }))
  return Object.freeze(Object.assign({}, options, { messages: Object.freeze(messages) }))
}

// Story compaction keeps the latest rounds verbatim. DSH's idle (manual) compaction
// can only retain the final surface node, so the older history is summarized and
// these rounds are appended to the summary as an original-text transcript block.
// A later compaction splits that block back into rounds, so the quota always
// counts the latest rounds whether they are live messages or carried transcript.
export const RETAINED_STORY_ROUNDS = 10
// Kept rounds may use at most this share of the model's context window.
export const RETAINED_ROUNDS_WINDOW_SHARE = 0.25

const TRANSCRIPT_HEADER = /^【最近 \d+ 轮原文（未压缩，按时间顺序）】\n\n/
const transcriptHeader = count => `【最近 ${count} 轮原文（未压缩，按时间顺序）】\n\n`

const textOf = message => (Array.isArray(message?.content) ? message.content : [])
  .filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').trim()
const isPlayerMessage = message => message?.role === 'user' && !isPluginSource(message.source) && textOf(message) !== ''

/** A message as story units: itself (without a carried transcript) plus that transcript's rounds. */
function storyUnits(message) {
  const blocks = message?.role === 'user' && Array.isArray(message.content) ? message.content : []
  const index = blocks.findIndex(block => block?.type === 'text' && TRANSCRIPT_HEADER.test(block.text || ''))
  if (index < 0) return [{ message, player: isPlayerMessage(message) }]
  const rounds = blocks[index].text.replace(TRANSCRIPT_HEADER, '').split(/\n\n(?=\[玩家\]\n)/).filter(text => text.trim())
  return [{ message: { ...message, content: blocks.filter((_, i) => i !== index) } }, ...rounds.map(text => ({ text, player: true }))]
}

function surfaceMessages(session) {
  const nodes = session?.surface?.nodes
  if (!nodes) return []
  const bySeq = typeof session.eventAt === 'function' ? null : new Map(sessionEvents(session).map(event => [event.seq, event]))
  return [...nodes].flatMap(seq => {
    const event = bySeq ? bySeq.get(seq) : session.eventAt(seq)
    return event?.type === 'user/message' ? [event.data] : event?.type === 'assistant/message' ? [event.data.message] : []
  })
}

/**
 * Player rounds the native engine already keeps outside this request: automatic
 * pressure compaction retains its own recent tail, which counts toward the quota.
 */
export function nativelyRetainedRounds(session, request) {
  if (!Array.isArray(request?.messages)) return 0
  const inRequest = new Set(request.messages.map(message => message?.id).filter(Boolean))
  return surfaceMessages(session).filter(message => message?.role === 'user' && !inRequest.has(message.id) && isPlayerMessage(message)).length
}

const lineOf = unit => {
  if (unit.text !== undefined) return unit.text
  if (unit.message?.role === 'system') return ''
  const text = textOf(unit.message)
  return text === '' ? '' : (unit.message.role === 'user' ? '[玩家]\n' : '[正文]\n') + text
}

/** How many of the newest rounds fit both the round quota and the token budget. */
function retentionPlan(history, rounds, { budget = Infinity, estimate = text => Math.ceil(text.length / 4) } = {}) {
  const units = history.flatMap((message, source) => storyUnits(message).map(unit => ({ ...unit, source })))
  const starts = units.flatMap((unit, index) => unit.player ? [index] : [])
  let fit = 0, used = 0
  while (fit < Math.min(rounds, starts.length)) {
    const start = starts[starts.length - 1 - fit], end = fit === 0 ? units.length : starts[starts.length - fit]
    used += estimate(units.slice(start, end).map(lineOf).filter(Boolean).join('\n\n'))
    if (used > budget) break
    fit++
  }
  return { units, starts, fit }
}

/**
 * Whether retention would keep every round of this session verbatim, leaving
 * nothing worth summarizing. Manual and scheduled compaction then skip.
 */
export function storyHistoryFullyRetained(session, rounds, options) {
  const plan = retentionPlan(surfaceMessages(session), rounds, options)
  return rounds > 0 && plan.fit === plan.starts.length
}

/**
 * Split a story compaction request: the summarizer sees only history older than
 * the latest `rounds` rounds (as many as fit `budget` tokens); those rounds come
 * back as `appendix` text. At least one round is always left to summarize
 * (capacity recovery must make progress).
 */
export function retainRecentStoryRounds(request, rounds = RETAINED_STORY_ROUNDS, options = {}) {
  if (!(rounds > 0) || request?.purpose !== 'compaction' || !Array.isArray(request.messages) || request.messages.length < 2) return { request }
  const history = request.messages.slice(0, -1)
  const { units, starts, fit } = retentionPlan(history, rounds, options)
  const keep = Math.min(fit, starts.length - 1)
  if (keep <= 0) return { request }
  const cut = units[starts[starts.length - keep]]
  // The summarizer input stays a byte-identical prefix of the foreground request
  // (prompt cache). A previous summary is kept whole even when some of its carried
  // rounds are kept again; that small overlap is cheaper than a cache miss.
  const boundary = cut.text !== undefined ? cut.source + 1 : cut.source
  const transcript = units.slice(starts[starts.length - keep]).map(lineOf).filter(Boolean)
  return {
    request: { ...request, messages: [...history.slice(0, boundary), ...history.slice(boundary).filter(message => message?.role === 'system'), request.messages.at(-1)] },
    appendix: transcriptHeader(keep) + transcript.join('\n\n'),
    kept: keep
  }
}

// Story summaries are kept as volumes (分卷). Each compaction writes one new volume for
// the rounds it folds and carries the earlier volumes verbatim, so what was summarized
// once is not summarized again (and worn down) by every later compaction. Only when the
// carried volumes outgrow their budget are they merged once into a 前情总览.
export const STORY_SUMMARY_NOTE = '【剧情摘要说明】以下按轮次分卷记录已经压缩的剧情，只是索引。需要原话、细节或确认某件事时，用 tavern_recall_history 按关键词或轮次查原文。'
// Carried volumes may use at most this share of the model's context window.
export const STORY_VOLUMES_WINDOW_SHARE = 0.15
const VOLUME_HEADER = /^【[^】\n]*(?:剧情摘要|前情总览)[^】\n]*】/gm
const isCheckpoint = message => message?.role === 'user' && message.source !== null && typeof message.source === 'object' && 'compactionId' in message.source

/** The volumes the latest summary holds; a summary written before volumes counts as one 前情总览. */
export function storySummaryVolumes(history) {
  const checkpoint = (Array.isArray(history) ? history : []).findLast(isCheckpoint)
  const texts = (Array.isArray(checkpoint?.content) ? checkpoint.content : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text)
    // The native framing (preamble + tags), the note and the carried transcript are not volumes.
    .filter(text => text.trim() && !text.includes('compacted-summary>') && !text.startsWith('【剧情摘要说明】') && !TRANSCRIPT_HEADER.test(text))
  const volumes = []
  const legacy = text => ({ text: '【前情总览】\n' + text.trim(), through: null })
  for (const text of texts) {
    const starts = [...text.matchAll(VOLUME_HEADER)].map(match => match.index)
    if (!starts.length) { volumes.push(legacy(text)); continue }
    if (text.slice(0, starts[0]).trim()) volumes.push(legacy(text.slice(0, starts[0])))
    starts.forEach((start, index) => {
      const piece = text.slice(start, starts[index + 1] ?? text.length).trim()
      const numbers = piece.match(/^【[^】]*】/)[0].match(/\d+/g)
      volumes.push({ text: piece, through: numbers ? Number(numbers.at(-1)) : null })
    })
  }
  return volumes
}

/**
 * How this compaction writes its summary: the instruction tail for the summarizer and the
 * blocks placed before its output (the note and the carried volumes). `through` is the last
 * story turn being folded, when known.
 */
export function storyVolumePlan(request, { through, budget = Infinity, estimate = text => Math.ceil(text.length / 4) } = {}) {
  const volumes = storySummaryVolumes(Array.isArray(request?.messages) ? request.messages.slice(0, -1) : [])
  const last = volumes.at(-1)
  const from = volumes.length === 0 ? 1 : (Number.isInteger(last.through) ? last.through + 1 : null)
  const end = Number.isInteger(through) && through > 0 ? through : null
  const range = end === null ? '' : from !== null && from <= end ? `第 ${from}–${end} 轮` : `截至第 ${end} 轮`
  const header = `【${range || '新一卷'}剧情摘要】`
  const instruction = volumes.length === 0
    ? `【本次摘要的写法】第一行单独写「${header}」。`
    : `【本次摘要的写法】<compacted-summary> 中的旧卷会原样保留在新摘要里，不要复述旧卷内容。只总结旧卷之后的新剧情，第一行单独写「${header}」，写成新的一卷：只写本段新增和变化的内容，人物、关系、物品等只记本段有变化的条目；与旧卷冲突时以本卷为准。`
  // Over budget, only the oldest volumes are merged (by a separate call, see storyVolumeMerge):
  // as few as leave the newer ones within half the budget, so recent volumes stay word for word.
  const size = list => estimate(list.map(volume => volume.text).join('\n\n'))
  let count = 0
  if (volumes.length && size(volumes) > budget) while (count < volumes.length && (count === 0 || size(volumes.slice(count)) > budget / 2)) count++
  const kept = volumes.slice(count)
  return {
    prefix: [STORY_SUMMARY_NOTE, ...kept.map(volume => volume.text)],
    instruction,
    ...(count ? { merge: { volumes: volumes.slice(0, count), through: volumes[count - 1].through } } : {})
  }
}

/** The request that merges the oldest volumes into one 前情总览 of about half their length. */
export function storyVolumeMerge(merge) {
  const text = merge.volumes.map(volume => volume.text).join('\n\n')
  const header = `【前情总览${Number.isInteger(merge.through) ? `（截至第 ${merge.through} 轮）` : ''}】`
  return {
    header,
    prompt: `以下是按时间顺序排列的旧剧情摘要卷。把它们合并成一份前情总览，第一行单独写「${header}」，之后沿用原来的分段。\n`
      + `保留所有专名、数字、约定、人物关系、未解决的伏笔和用户意志；删去各卷之间的重复，省略已经失效的细节；篇幅约为原文的一半（约 ${Math.round(text.length / 2)} 字），不要压得更短。只输出总览本身。\n\n${text}`
  }
}
