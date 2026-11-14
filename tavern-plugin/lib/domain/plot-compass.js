import { randomUUID } from 'node:crypto'
import { promptSection } from './prompt-section.js'
import { classifyWorldbookEntry } from './worldbook-entry-classification.js'
import { currentVariableSnapshot } from './read-variables.js'
import { readLedger } from './story-ledger.js'
import { decodeLiteralUnicodeEscapes } from './candidate-generation.js'

export const PLOT_COMPASS_SUBMIT_TOOL_NAME = 'plot_compass_submit'
export const PLOT_COMPASS_HORIZONS = Object.freeze(['shortTerm', 'midTerm', 'longTerm'])
export const PLOT_COMPASS_SCOPES = Object.freeze(['all', 'shortTerm', 'midTerm', 'longTerm'])

const MAX_ROUTES_PER_HORIZON = 4
const MAX_STEPS_PER_ROUTE = 4
const MAX_ARCHETYPES = 5
const MAX_ARCHIVED = 8

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function copy(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function cleanText(value, { card, chat, maxLength = 240 } = {}) {
  const userName = str(chat?.macroState?.userName).trim() || '你'
  const charName = str(card?.name).trim()
  const decoded = decodeLiteralUnicodeEscapes(str(value)).replace(/\{\{\s*(user|char)\s*\}\}/gi, (_match, name) =>
    String(name).toLowerCase() === 'user' ? userName : charName
  ).replace(/\s+/g, ' ').trim()
  return maxLength > 0 && decoded.length > maxLength ? decoded.slice(0, maxLength).trim() : decoded
}

function cleanSteps(rawSteps, options = {}) {
  const items = Array.isArray(rawSteps) ? rawSteps : []
  const result = []
  const seen = new Set()
  for (const raw of items) {
    if (result.length >= MAX_STEPS_PER_ROUTE) break
    const text = cleanText(typeof raw === 'string' ? raw : raw?.text, { ...options, maxLength: 90 })
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push({ text, done: Boolean(typeof raw === 'object' && raw?.done === true) })
  }
  return result
}

function normalizeTag(rawTag, fallbackTitle, options = {}) {
  const cleaned = cleanText(rawTag, { ...options, maxLength: 10 }).replace(/^[【〔\[]+|[】〕\]]+$/g, '').trim()
  if (cleaned) return cleaned
  const fromTitle = cleanText(fallbackTitle, { ...options, maxLength: 6 }).replace(/[：:·—\-\s].*$/, '').trim()
  return fromTitle || '分支'
}

function normalizeShortRoute(raw, index, options = {}) {
  const item = object(raw)
  if (!item) return null
  const title = cleanText(item.title || item.name, { ...options, maxLength: 40 })
  const summary = cleanText(item.summary || item.description || item.premise, { ...options, maxLength: 180 })
  const beats = cleanSteps(item.beats || item.steps, options)
  if (!title && !summary && beats.length === 0) return null
  const finalTitle = title || (beats[0]?.text ? beats[0].text.slice(0, 18) : `近期方向 ${index + 1}`)
  const id = cleanText(item.id, { maxLength: 40 }) || `st-${index + 1}-${randomUUID().slice(0, 6)}`
  const sourceHook = cleanText(item.sourceHook || item.hookSource, { ...options, maxLength: 16 })
  const direction = cleanText(item.direction || item.angle, { ...options, maxLength: 32 })
  return {
    id,
    tag: normalizeTag(item.tag || item.routeTag, finalTitle, options),
    title: finalTitle,
    ...(direction ? { direction } : {}),
    summary: summary || beats.map(b => b.text).join(' → '),
    beats: beats.length > 0 ? beats : [{ text: summary || finalTitle, done: false }],
    ...(sourceHook ? { sourceHook } : {})
  }
}

function normalizeMidRoute(raw, index, options = {}) {
  const item = object(raw)
  if (!item) return null
  const title = cleanText(item.title || item.name, { ...options, maxLength: 40 })
  const summary = cleanText(item.summary || item.conflict || item.description, { ...options, maxLength: 200 })
  const entryHook = cleanText(item.entryHook || item.trigger || item.entry, { ...options, maxLength: 120 })
  const milestones = cleanSteps(item.milestones || item.steps || item.beats, options)
  const stakes = cleanText(item.stakes || item.payoffAndRisk, { ...options, maxLength: 140 })
  if (!title && !summary && milestones.length === 0) return null
  const finalTitle = title || `中期篇章 ${index + 1}`
  const id = cleanText(item.id, { maxLength: 40 }) || `mt-${index + 1}-${randomUUID().slice(0, 6)}`
  const sourceHook = cleanText(item.sourceHook || item.hookSource, { ...options, maxLength: 16 })
  const direction = cleanText(item.direction || item.angle, { ...options, maxLength: 32 })
  return {
    id,
    tag: normalizeTag(item.tag || item.routeTag, finalTitle, options),
    title: finalTitle,
    ...(direction ? { direction } : {}),
    summary: summary || entryHook || finalTitle,
    ...(entryHook ? { entryHook } : {}),
    milestones: milestones.length > 0 ? milestones : [{ text: summary || finalTitle, done: false }],
    ...(stakes ? { stakes } : {}),
    ...(sourceHook ? { sourceHook } : {})
  }
}

function normalizeLongRoute(raw, index, options = {}) {
  const item = object(raw)
  if (!item) return null
  const title = cleanText(item.title || item.name, { ...options, maxLength: 40 })
  const vision = cleanText(item.vision || item.summary || item.ending || item.description, { ...options, maxLength: 220 })
  const tone = cleanText(item.tone || item.direction, { ...options, maxLength: 32 })
  const toneGuidance = cleanText(item.toneGuidance || item.antiSpoilerNote, { ...options, maxLength: 140 })
  const prerequisites = (Array.isArray(item.prerequisites) ? item.prerequisites : [])
    .map(entry => cleanText(typeof entry === 'string' ? entry : entry?.text, { ...options, maxLength: 90 }))
    .filter(Boolean)
    .slice(0, 3)
  if (!title && !vision) return null
  const finalTitle = title || `远期终局 ${index + 1}`
  const id = cleanText(item.id, { maxLength: 40 }) || `lt-${index + 1}-${randomUUID().slice(0, 6)}`
  const sourceHook = cleanText(item.sourceHook || item.hookSource, { ...options, maxLength: 16 })
  return {
    id,
    tag: normalizeTag(item.tag || item.routeTag, finalTitle, options),
    title: finalTitle,
    ...(tone ? { tone } : {}),
    vision: vision || finalTitle,
    prerequisites,
    toneGuidance: toneGuidance || (tone ? `维持「${tone}」的长线叙事伏脉，渐进蓄力，不提前挑明终局结果` : ''),
    ...(sourceHook ? { sourceHook } : {})
  }
}

export function normalizeArchetypeList(values, options = {}) {
  const list = Array.isArray(values) ? values : []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (out.length >= MAX_ARCHETYPES) break
    const item = cleanText(raw, { ...options, maxLength: 20 })
    if (!item || seen.has(item.toLowerCase())) continue
    seen.add(item.toLowerCase())
    out.push(item)
  }
  return out
}

export function emptyPlotCompass() {
  return {
    version: 1,
    updatedAt: 0,
    basedOnTurn: 0,
    playArchetypes: [],
    customArchetypes: [],
    situationDigest: '',
    shortTerm: [],
    midTerm: [],
    longTerm: [],
    pinned: { shortTerm: null, midTerm: null, longTerm: null },
    archived: []
  }
}

export function readPlotCompass(value) {
  const src = object(value)
  if (!src || src.version !== 1) return emptyPlotCompass()
  const shortTerm = (Array.isArray(src.shortTerm) ? src.shortTerm : []).map((item, i) => normalizeShortRoute(item, i)).filter(Boolean).slice(0, MAX_ROUTES_PER_HORIZON)
  const midTerm = (Array.isArray(src.midTerm) ? src.midTerm : []).map((item, i) => normalizeMidRoute(item, i)).filter(Boolean).slice(0, MAX_ROUTES_PER_HORIZON)
  const longTerm = (Array.isArray(src.longTerm) ? src.longTerm : []).map((item, i) => normalizeLongRoute(item, i)).filter(Boolean).slice(0, MAX_ROUTES_PER_HORIZON)
  const rawPinned = object(src.pinned) || {}
  const resolvePin = (list, id) => {
    const target = str(id).trim()
    return target && list.some(item => item.id === target) ? target : null
  }
  const archived = (Array.isArray(src.archived) ? src.archived : [])
    .map(entry => {
      const row = object(entry)
      if (!row) return null
      const title = cleanText(row.title, { maxLength: 40 })
      const reason = cleanText(row.reason, { maxLength: 140 })
      if (!title && !reason) return null
      return {
        horizon: PLOT_COMPASS_HORIZONS.includes(row.horizon) ? row.horizon : 'shortTerm',
        title: title || '旧路线',
        reason,
        turn: Math.max(0, Number(row.turn) || 0)
      }
    })
    .filter(Boolean)
    .slice(-MAX_ARCHIVED)
  return {
    version: 1,
    updatedAt: Math.max(0, Number(src.updatedAt) || 0),
    basedOnTurn: Math.max(0, Number(src.basedOnTurn) || 0),
    playArchetypes: normalizeArchetypeList(src.playArchetypes),
    customArchetypes: normalizeArchetypeList(src.customArchetypes),
    situationDigest: cleanText(src.situationDigest, { maxLength: 240 }),
    shortTerm,
    midTerm,
    longTerm,
    pinned: {
      shortTerm: resolvePin(shortTerm, rawPinned.shortTerm),
      midTerm: resolvePin(midTerm, rawPinned.midTerm),
      longTerm: resolvePin(longTerm, rawPinned.longTerm)
    },
    archived
  }
}

function parseJsonLenient(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  let source = str(raw).trim()
  if (!source) return {}
  if (source.startsWith('```')) {
    const nl = source.indexOf('\n')
    if (nl >= 0) source = source.slice(nl + 1)
    if (source.endsWith('```')) source = source.slice(0, -3)
    source = source.trim()
  }
  try {
    const parsed = JSON.parse(source)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {}
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(source.slice(start, end + 1))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch {}
  }
  return {}
}

const STEP_ITEM_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', minLength: 1 },
    done: { type: 'boolean' }
  },
  required: ['text']
})

export const PLOT_COMPASS_SUBMIT_TOOL = Object.freeze({
  name: PLOT_COMPASS_SUBMIT_TOOL_NAME,
  description: '提交今期（2-5轮）、中期（5-20轮）、长期（20+轮至结局）的多路线剧情发展规划。必须基于当前人物卡游玩类型、已发生剧情、变量状态及未触发暗线生成差异化分支路线。',
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      playArchetypes: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'string', minLength: 1 },
        description: '识别出的 1-3 个本局核心游玩类型母题（如：权谋博弈、情感修罗场、副本探索、经营养成、高自由沙盒）'
      },
      situationDigest: {
        type: 'string',
        minLength: 1,
        description: '一句话概括当前剧情张力焦点与待破局悬念（不超过120字）'
      },
      shortTerm: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        description: '今期规划（未来 2-5 轮）：3-4 条节奏与破局角度截然不同的近期路线',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            tag: { type: 'string', minLength: 1, description: '2-6字路线短签（将直接作为下一轮候选项角标，如：顺势破防、暗查异响、掀桌试探、切场夜访）' },
            title: { type: 'string', minLength: 1 },
            direction: { type: 'string', description: '路线戏剧维度（如：顺水推舟、反客为主、支线切入）' },
            summary: { type: 'string', minLength: 1 },
            beats: { type: 'array', minItems: 1, maxItems: 4, items: STEP_ITEM_SCHEMA },
            sourceHook: { type: 'string', description: '灵感来源标签（如：伏笔回收、世界书暗线、数值临界、原著主线、IF偏离）' }
          },
          required: ['tag', 'title', 'summary', 'beats']
        }
      },
      midTerm: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        description: '中期规划（未来 5-20 轮）：3-4 条平行篇章弧（主流推进、反差拐点、隐藏暗线）',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            tag: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            direction: { type: 'string' },
            summary: { type: 'string', minLength: 1 },
            entryHook: { type: 'string', description: '入线契机：玩家近期做什么就能拐入此篇章' },
            milestones: { type: 'array', minItems: 1, maxItems: 4, items: STEP_ITEM_SCHEMA },
            stakes: { type: 'string', description: '潜在收获与代价风险' },
            sourceHook: { type: 'string' }
          },
          required: ['tag', 'title', 'summary', 'milestones']
        }
      },
      longTerm: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        description: '长期规划（20+ 轮至终局）：3-4 条命运归宿或世界终局蓝图',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            tag: { type: 'string', minLength: 1 },
            title: { type: 'string', minLength: 1 },
            tone: { type: 'string', description: '终局基调标签（如：王道破局、共犯沉沦、颠覆规则、归隐日常）' },
            vision: { type: 'string', minLength: 1, description: '远期命运与世界状态假想' },
            prerequisites: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', minLength: 1 } },
            toneGuidance: { type: 'string', description: '无剧透的前台氛围指引（仅供正文模型把握长线暗流，不暴露终局结果）' },
            sourceHook: { type: 'string' }
          },
          required: ['tag', 'title', 'vision']
        }
      },
      divergedNote: {
        type: 'string',
        description: '若此前点亮的路线因玩家实际行动已偏离分流，简述分流原因（无则留空）'
      }
    },
    required: ['playArchetypes', 'situationDigest', 'shortTerm', 'midTerm', 'longTerm']
  })
})

export function parsePlotCompassSubmission(rawArgs, { scope = 'all', card, chat } = {}) {
  const payload = parseJsonLenient(rawArgs)
  const opts = { card, chat }
  const shortTerm = (Array.isArray(payload.shortTerm) ? payload.shortTerm : [])
    .map((item, index) => normalizeShortRoute(item, index, opts))
    .filter(Boolean)
    .slice(0, MAX_ROUTES_PER_HORIZON)
  const midTerm = (Array.isArray(payload.midTerm) ? payload.midTerm : [])
    .map((item, index) => normalizeMidRoute(item, index, opts))
    .filter(Boolean)
    .slice(0, MAX_ROUTES_PER_HORIZON)
  const longTerm = (Array.isArray(payload.longTerm) ? payload.longTerm : [])
    .map((item, index) => normalizeLongRoute(item, index, opts))
    .filter(Boolean)
    .slice(0, MAX_ROUTES_PER_HORIZON)

  if ((scope === 'all' || scope === 'shortTerm') && shortTerm.length < 2) {
    throw new Error('今期规划（shortTerm）至少需要提供 2 条不同方向的路线')
  }
  if ((scope === 'all' || scope === 'midTerm') && midTerm.length < 2) {
    throw new Error('中期规划（midTerm）至少需要提供 2 条不同方向的篇章路线')
  }
  if ((scope === 'all' || scope === 'longTerm') && longTerm.length < 2) {
    throw new Error('长期规划（longTerm）至少需要提供 2 条不同方向的终局蓝图')
  }

  return {
    playArchetypes: normalizeArchetypeList(payload.playArchetypes, opts),
    situationDigest: cleanText(payload.situationDigest, { ...opts, maxLength: 240 }),
    shortTerm,
    midTerm,
    longTerm,
    divergedNote: cleanText(payload.divergedNote, { ...opts, maxLength: 140 })
  }
}

export function mergePlotCompassUpdate(previousRaw, submitted, { scope = 'all', turn = 0, now = Date.now() } = {}) {
  const prev = readPlotCompass(previousRaw)
  const next = copy(prev)
  next.updatedAt = now
  next.basedOnTurn = Math.max(0, Number(turn) || 0)
  if (submitted.situationDigest) next.situationDigest = submitted.situationDigest
  if (submitted.playArchetypes?.length) {
    const merged = [...prev.customArchetypes]
    for (const tag of submitted.playArchetypes) {
      if (merged.length >= MAX_ARCHETYPES) break
      if (!merged.some(existing => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag)
    }
    next.playArchetypes = merged
  } else if (prev.customArchetypes.length && !next.playArchetypes.length) {
    next.playArchetypes = [...prev.customArchetypes]
  }

  const updateHorizon = horizon => {
    const incoming = submitted[horizon]
    if (!Array.isArray(incoming) || incoming.length === 0) return
    const prevPinnedId = prev.pinned[horizon]
    const prevPinnedRoute = prevPinnedId ? prev[horizon].find(item => item.id === prevPinnedId) : null
    next[horizon] = incoming
    if (prevPinnedId) {
      // Match by preserved id first, then by matching tag or title if the model regenerated ids.
      const matched = incoming.find(item => item.id === prevPinnedId) ||
        (prevPinnedRoute && incoming.find(item => item.title === prevPinnedRoute.title || item.tag === prevPinnedRoute.tag))
      if (matched) {
        next.pinned[horizon] = matched.id
      } else {
        next.pinned[horizon] = null
        if (prevPinnedRoute && submitted.divergedNote) {
          next.archived = [...next.archived, {
            horizon,
            title: prevPinnedRoute.title,
            reason: submitted.divergedNote,
            turn: next.basedOnTurn
          }].slice(-MAX_ARCHIVED)
        }
      }
    }
  }

  if (scope === 'all') {
    updateHorizon('shortTerm')
    updateHorizon('midTerm')
    updateHorizon('longTerm')
  } else if (PLOT_COMPASS_HORIZONS.includes(scope)) {
    updateHorizon(scope)
  }

  return readPlotCompass(next)
}

export function applyPlotCompassPin(previousRaw, { horizon, routeId, now = Date.now() } = {}) {
  if (!PLOT_COMPASS_HORIZONS.includes(horizon)) throw new Error('无效的规划层级：' + str(horizon))
  const next = readPlotCompass(previousRaw)
  const target = str(routeId).trim()
  if (!target) {
    next.pinned[horizon] = null
  } else {
    if (!next[horizon].some(item => item.id === target)) throw new Error('未找到对应的剧情路线，请刷新面板后重试')
    next.pinned[horizon] = next.pinned[horizon] === target ? null : target
  }
  next.updatedAt = now
  return next
}

export function setPlotCompassPin(previousRaw, { horizon, routeId, now = Date.now() } = {}) {
  if (!PLOT_COMPASS_HORIZONS.includes(horizon)) throw new Error('无效的规划层级：' + str(horizon))
  const next = readPlotCompass(previousRaw)
  const target = str(routeId).trim()
  if (!target) next.pinned[horizon] = null
  else if (next[horizon].some(item => item.id === target)) next.pinned[horizon] = target
  next.updatedAt = now
  return next
}

export function applyPlotCompassStepToggle(previousRaw, { horizon, routeId, stepIndex, now = Date.now() } = {}) {
  if (!['shortTerm', 'midTerm'].includes(horizon)) throw new Error('只有今期和中期路线包含可勾选节点')
  const next = readPlotCompass(previousRaw)
  const route = next[horizon].find(item => item.id === str(routeId))
  if (!route) throw new Error('未找到对应的剧情路线')
  const listKey = horizon === 'shortTerm' ? 'beats' : 'milestones'
  const steps = Array.isArray(route[listKey]) ? route[listKey] : []
  const idx = Number(stepIndex)
  if (!Number.isInteger(idx) || idx < 0 || idx >= steps.length) throw new Error('节点序号无效')
  steps[idx] = { ...steps[idx], done: !steps[idx].done }
  next.updatedAt = now
  return next
}

export function applyPlotCompassCustomArchetypes(previousRaw, archetypes, { now = Date.now() } = {}) {
  const next = readPlotCompass(previousRaw)
  const cleaned = normalizeArchetypeList(archetypes)
  next.customArchetypes = cleaned
  const merged = [...cleaned]
  for (const existing of next.playArchetypes) {
    if (merged.length >= MAX_ARCHETYPES) break
    if (!merged.some(item => item.toLowerCase() === existing.toLowerCase())) merged.push(existing)
  }
  next.playArchetypes = merged
  next.updatedAt = now
  return next
}

export function activePlotCompassRoutes(compassRaw) {
  const compass = readPlotCompass(compassRaw)
  const pick = horizon => compass.pinned[horizon]
    ? compass[horizon].find(item => item.id === compass.pinned[horizon]) || null
    : null
  return {
    compass,
    shortTerm: pick('shortTerm'),
    midTerm: pick('midTerm'),
    longTerm: pick('longTerm')
  }
}

/**
 * Extract untriggered, non-constant static/lore worldbook entries as inspiration seeds
 * so the Plot Compass planner can offer mysterious Teaser Hooks without spoiling secrets.
 */
export function extractDormantWorldbookHooks(entries = [], chat = {}, { limit = 8 } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  const triggeredTitles = new Set()
  const recall = object(chat?.lastWorldBookRecall) || object(chat?.preparedWorldBook)
  for (const item of Array.isArray(recall?.activated) ? recall.activated : []) {
    const name = str(typeof item === 'string' ? item : item?.title || item?.comment || item?.uid).trim()
    if (name) triggeredTitles.add(name.toLowerCase())
  }
  const reads = object(chat?.worldBookReads)
  for (const key of Object.keys(reads || {})) triggeredTitles.add(key.toLowerCase())

  const candidates = []
  for (const entry of entries) {
    if (!entry || entry.enabled === false || entry.constant === true || entry.channel === 'prefix') continue
    const classified = classifyWorldbookEntry(entry)
    if (classified.nativeFallback) continue
    const title = str(entry.title || entry.comment).trim()
    const keys = (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : [])
      .map(k => str(k).trim())
      .filter(Boolean)
      .slice(0, 4)
    const content = str(entry.content).replace(/\s+/g, ' ').trim()
    if (!content || content.length < 15) continue
    if (title && triggeredTitles.has(title.toLowerCase())) continue
    candidates.push({
      title: title || keys[0] || '未命名设定',
      keys,
      snippet: content.length > 140 ? content.slice(0, 140) + '…' : content
    })
  }
  return candidates.slice(0, Math.max(1, limit))
}

/**
 * Soft-guidance section for foreground story body (`purpose === 'body'`).
 * Zero injection when nothing is pinned. Strictly hides long-term ending spoilers!
 */
export function plotCompassBodySection(chat) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) return null
  const { shortTerm, midTerm, longTerm } = activePlotCompassRoutes(chat.plotCompass)
  if (!shortTerm && !midTerm && !longTerm) return null

  const lines = [
    'Active Plot Compass (soft narrative direction chosen by the player; weave naturally into pacing and foreshadowing, NEVER rush future milestones in a single turn, and always yield to the player\'s immediate turn input if they pivot):'
  ]
  if (longTerm) {
    const toneLine = longTerm.toneGuidance || (longTerm.tone ? `长线基调「${longTerm.tone}」` : longTerm.title)
    lines.push(`- Long-term atmosphere (foreshadowing tone only, do NOT reveal or jump to endgame): ${toneLine}`)
  }
  if (midTerm) {
    const nextMilestone = (midTerm.milestones || []).find(step => !step.done)?.text || midTerm.summary
    lines.push(`- Current chapter arc [${midTerm.title}]: ${midTerm.summary}${nextMilestone ? ` | Current phase focus: ${nextMilestone} (plant seeds gradually; do not resolve later chapter milestones prematurely).` : ''}`)
  }
  if (shortTerm) {
    const nextBeat = (shortTerm.beats || []).find(step => !step.done)?.text || shortTerm.summary
    lines.push(`- Near-term scene direction [${shortTerm.title}]: ${nextBeat}`)
  }

  return {
    kind: 'plot-compass',
    required: false,
    text: promptSection('plot_compass', lines.join('\n'))
  }
}

/**
 * Dynamic section for candidate choice generation (`purpose === 'candidate'`).
 * Feeds short-term route beats & diverse entry hooks so next-turn choices span real arcs and carry `routeTag` badges!
 */
export function plotCompassCandidateSection(chat) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) return null
  const { compass, shortTerm: pinnedShort, midTerm: pinnedMid } = activePlotCompassRoutes(chat.plotCompass)
  if (compass.shortTerm.length === 0 && !pinnedMid) return null

  const lines = [
    'Plot Compass routes are available for this session. Align distinct candidate choices with these routes where natural, and attach the matching short `routeTag` (2–6 chars) on `actors[].routeTags` or `featured[].routeTag` so the player sees which arc each choice advances:'
  ]
  if (pinnedShort) {
    const nextBeat = (pinnedShort.beats || []).find(step => !step.done)?.text || pinnedShort.summary
    lines.push(`- [PRIMARY PINNED NEAR-TERM ROUTE] tag="${pinnedShort.tag}" (${pinnedShort.title}): next beat → ${nextBeat}. Ensure at least 1–2 strong choices advance this beat!`)
    const alternatives = compass.shortTerm.filter(item => item.id !== pinnedShort.id).slice(0, 2)
    for (const alt of alternatives) {
      const beat = (alt.beats || []).find(step => !step.done)?.text || alt.summary
      lines.push(`- [Alternative pivot] tag="${alt.tag}" (${alt.title}): ${beat}`)
    }
  } else {
    for (const route of compass.shortTerm.slice(0, 4)) {
      const beat = (route.beats || []).find(step => !step.done)?.text || route.summary
      lines.push(`- Route tag="${route.tag}" (${route.title}): ${beat}`)
    }
  }
  if (pinnedMid) {
    const hook = pinnedMid.entryHook || (pinnedMid.milestones || []).find(step => !step.done)?.text || pinnedMid.summary
    lines.push(`- [Pinned Mid-Term Arc: ${pinnedMid.title}] tag="${pinnedMid.tag}": keep subtle hooks aligned with "${hook}".`)
  }
  return {
    kind: 'plot-compass',
    required: false,
    text: promptSection('plot_compass_candidates', lines.join('\n'))
  }
}

/**
 * Compaction preservation note so volume summaries never drop clues tied to active mid/long-term arcs.
 */
export function plotCompassCompactionNote(chat) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) return ''
  const { shortTerm, midTerm, longTerm } = activePlotCompassRoutes(chat.plotCompass)
  if (!shortTerm && !midTerm && !longTerm) return ''
  const items = []
  if (shortTerm) items.push(`近期锚定方向「${shortTerm.title}」：${shortTerm.summary}`)
  if (midTerm) items.push(`中期锚定篇章「${midTerm.title}」：${midTerm.summary}`)
  if (longTerm) items.push(`长期基调方向「${longTerm.title}」（${longTerm.tone || '远期伏脉'}）`)
  return `玩家当前在剧情罗盘中点亮了以下发展方向，压缩摘要时务必在 Foreshadowing and promises / Relationships 中完整保留与之相关的伏笔、约定与暗线线索（但只记录已发生的剧情事实，不要把未发生的规划当成既成事实写进摘要）：\n- ` + items.join('\n- ')
}

/**
 * Assemble compact, high-signal context material for the background Plot Compass Agent.
 */
export function buildPlotCompassMaterial({ chat, card, worldbookEntries = [], constantWorldbookText = '', scriptWindow = null, scope = 'all', guidance = '' }) {
  const compass = readPlotCompass(chat?.plotCompass)
  const blocks = []

  const cardSummary = [
    card?.name ? `Character / Card Name: ${str(card.name)}` : '',
    card?.tags?.length ? `Card Tags: ${card.tags.join(', ')}` : '',
    card?.description ? `Description:\n${str(card.description).slice(0, 3500)}` : '',
    card?.personality ? `Personality:\n${str(card.personality).slice(0, 1500)}` : '',
    card?.scenario ? `Opening Scenario:\n${str(card.scenario).slice(0, 1500)}` : ''
  ].filter(Boolean).join('\n\n')
  if (cardSummary) blocks.push(promptSection('card_profile', cardSummary))

  if (constantWorldbookText) {
    blocks.push(promptSection('world_rules', str(constantWorldbookText).slice(0, 5000)))
  }

  const dormantHooks = extractDormantWorldbookHooks(worldbookEntries, chat, { limit: 8 })
  if (dormantHooks.length > 0) {
    const hookLines = dormantHooks.map((hook, index) =>
      `${index + 1}. [${hook.title}]${hook.keys.length ? ` (triggers: ${hook.keys.join(', ')})` : ''}: ${hook.snippet}`
    ).join('\n')
    blocks.push(promptSection('dormant_worldbook_hooks',
      'Untriggered lore entries hidden in this card\'s worldbook (turn 1–2 of the most fitting ones into mysterious Teaser Hooks without spoiling secret twists outright):\n' + hookLines))
  }

  if (scriptWindow && Array.isArray(scriptWindow.chunks) && scriptWindow.chunks.length > 0) {
    const scriptText = scriptWindow.chunks.map(chunk => `[${chunk.id}]\n${str(chunk.text).slice(0, 1200)}`).join('\n\n')
    blocks.push(promptSection('script_context',
      `Bound Script Mode (cursor ${Math.min((scriptWindow.cursor || 0) + 1, scriptWindow.total || 1)} / ${scriptWindow.total || 1}). Offer BOTH canonical script-aligned routes (sourceHook="原著主线") AND 1–2 creative What-If divergence routes (sourceHook="IF偏离"):\n` + scriptText))
  }

  // Variables, Posture, Guides & Ledger
  const stateParts = []
  if (chat?.posture) stateParts.push(`Current Posture / Scene State:\n${str(chat.posture).slice(0, 1200)}`)
  const { snapshot: vars } = currentVariableSnapshot(chat)
  if (vars && Object.keys(vars).length > 0) {
    stateParts.push(`Current MVU Variables (stat_data):\n${JSON.stringify(vars).slice(0, 3500)}`)
  }
  const ledger = readLedger(chat?.ledger)
  if (ledger.location || ledger.npcs.length || ledger.items.length) {
    stateParts.push(`Story Ledger Snapshot:\n${JSON.stringify({
      location: ledger.location,
      npcs: ledger.npcs.slice(0, 8).map(n => ({ name: n.name, relation: n.relation, condition: n.condition })),
      items: ledger.items.slice(0, 10).map(i => ({ name: i.name, desc: i.desc }))
    })}`)
  }
  const guides = (Array.isArray(chat?.guides) ? chat.guides : []).map(g => str(g?.text).trim()).filter(Boolean)
  if (guides.length > 0) {
    stateParts.push(`Player Active Guides:\n` + guides.map((g, i) => `${i + 1}. ${g}`).join('\n'))
  }
  if (stateParts.length > 0) blocks.push(promptSection('settled_state', stateParts.join('\n\n')))

  // Recent Story Turns (up to latest 8 rounds, ~12000 chars budget)
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  const recentLines = []
  let charUsed = 0
  for (let i = messages.length - 1; i >= 0 && recentLines.length < 16; i--) {
    const msg = messages[i]
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue
    const raw = str(msg.sourceText ?? msg.text).trim()
    if (!raw) continue
    const clipped = raw.length > 1500 ? raw.slice(0, 700) + '\n…[中间省略]…\n' + raw.slice(-700) : raw
    if (recentLines.length >= 4 && charUsed + clipped.length > 12000) break
    charUsed += clipped.length
    const prefix = msg.role === 'user' ? `[玩家 · 第${msg.turn || '?'}轮]` : `[正文 · 第${msg.turn || '?'}轮]`
    recentLines.unshift(`${prefix}\n${clipped}`)
  }
  if (recentLines.length > 0) {
    blocks.push(promptSection('recent_story', recentLines.join('\n\n')))
  }

  // Existing Plot Compass (for incremental evolution or scoped reroll)
  if (compass.shortTerm.length || compass.midTerm.length || compass.longTerm.length || compass.customArchetypes.length) {
    blocks.push(promptSection('existing_plot_compass', JSON.stringify({
      refreshScope: scope,
      playerCustomArchetypes: compass.customArchetypes,
      previousPlayArchetypes: compass.playArchetypes,
      pinned: compass.pinned,
      shortTerm: compass.shortTerm,
      midTerm: compass.midTerm,
      longTerm: compass.longTerm
    })))
  }

  const requestLines = [
    `Target refresh scope: "${scope}" (${scope === 'all' ? 'generate or evolve all 3 horizons: shortTerm, midTerm, longTerm' : `focus fresh divergent routes on "${scope}" while keeping the other two horizons consistent`}).`,
    compass.customArchetypes.length > 0
      ? `Player-specified Play Archetypes (MUST honor and build routes around these): ${compass.customArchetypes.join('、')}`
      : 'Infer 1–3 accurate Play Archetypes from the card, worldbook, variables, and story tone.',
    guidance.trim() ? `Extra player inspiration request / guidance:\n${guidance.trim().slice(0, 800)}` : '',
    'Call `plot_compass_submit` now with complete, concrete, inspiring multi-route plans.'
  ].filter(Boolean)
  blocks.push(promptSection('plot_compass_request', requestLines.join('\n\n')))

  return blocks.join('\n\n')
}
