import { randomUUID } from 'node:crypto'

export const PLOT_COMPASS_SUBMIT_TOOL_NAME = 'plot_compass_submit'
export const PLOT_COMPASS_HORIZONS = Object.freeze(['shortTerm', 'midTerm', 'longTerm'])
export const PLOT_COMPASS_SCOPES = Object.freeze(['all', 'shortTerm', 'midTerm', 'longTerm'])
export const PLOT_COMPASS_PACES = Object.freeze(['foreshadow', 'natural', 'climax'])
export const PLOT_COMPASS_STRENGTHS = Object.freeze(['soft', 'guided', 'strict'])
export const PLOT_COMPASS_GOAL_HORIZON_LABELS = Object.freeze({
  shortTerm: '短期',
  midTerm: '中期',
  longTerm: '长期'
})
export const PLOT_COMPASS_MAX_AUTO_UPDATE_INTERVAL = 100
export const PLOT_COMPASS_MAX_GOAL_LENGTH = 300
export const PLOT_COMPASS_MIN_MAX_ROUTES = 1
export const PLOT_COMPASS_DEFAULT_MAX_ROUTES = 4
export const PLOT_COMPASS_MAX_MAX_ROUTES = 10

const MAX_STEPS_PER_ROUTE = 4
const MAX_ARCHETYPES = 5
const MAX_ARCHIVED = 8
const MAX_CUSTOM_DIRECTIVE_LENGTH = 240
const MAX_GOAL_TEXT_LENGTH = PLOT_COMPASS_MAX_GOAL_LENGTH
const MAX_COMPASS_CHAT_MESSAGES = 16

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function copy(value) {
  return value === undefined ? undefined : structuredClone(value)
}

export function promptSection(tag, text) {
  return text === '' ? '' : `<${tag}>\n${text}\n</${tag}>`
}

export function decodeLiteralUnicodeEscapes(value) {
  const text = str(value)
  if (!/\\u[0-9a-fA-F]{4}/.test(text)) return text
  return text.replace(/(?:\\u[0-9a-fA-F]{4})+/g, run => {
    try {
      const decoded = JSON.parse('"' + run + '"')
      return typeof decoded.isWellFormed !== 'function' || decoded.isWellFormed() ? decoded : run
    } catch {
      return run
    }
  })
}

function normalizePlotCompassPace(value) {
  return PLOT_COMPASS_PACES.includes(value) ? value : 'natural'
}

export function normalizePlotCompassStrength(value) {
  return PLOT_COMPASS_STRENGTHS.includes(value) ? value : 'guided'
}

export function normalizePlotCompassAutoUpdateInterval(value) {
  if (value === undefined || value === null || value === '' || value === false) return 0
  if (typeof value === 'boolean') return null
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0) return null
  return Math.min(PLOT_COMPASS_MAX_AUTO_UPDATE_INTERVAL, n)
}

export function normalizePlotCompassMaxRoutes(value) {
  if (value === undefined || value === null || value === '' || value === false) return PLOT_COMPASS_DEFAULT_MAX_ROUTES
  if (typeof value === 'boolean') return null
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < PLOT_COMPASS_MIN_MAX_ROUTES) return null
  return Math.min(PLOT_COMPASS_MAX_MAX_ROUTES, n)
}

function cleanText(value, { card, chat, playerName, maxLength = 240 } = {}) {
  const userName = str(playerName || chat?.macroState?.userName).trim() || '你'
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

function normalizeCausalBasis(item, options = {}) {
  return cleanText(item.causalBasis || item.causal || item.premiseBasis, { ...options, maxLength: 100 })
}

function normalizeDiegeticOmen(item, options = {}) {
  return cleanText(item.diegeticOmen || item.worldWhisper || item.omen, { ...options, maxLength: 100 })
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
  const causalBasis = normalizeCausalBasis(item, options)
  const sceneTrigger = cleanText(item.sceneTrigger || item.entryTrigger || item.catalyst, { ...options, maxLength: 90 })
  return {
    id,
    tag: normalizeTag(item.tag || item.routeTag, finalTitle, options),
    title: finalTitle,
    ...(direction ? { direction } : {}),
    summary: summary || beats.map(b => b.text).join(' → '),
    ...(causalBasis ? { causalBasis } : {}),
    ...(sceneTrigger ? { sceneTrigger } : {}),
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
  const causalBasis = normalizeCausalBasis(item, options)
  const diegeticOmen = normalizeDiegeticOmen(item, options)
  return {
    id,
    tag: normalizeTag(item.tag || item.routeTag, finalTitle, options),
    title: finalTitle,
    ...(direction ? { direction } : {}),
    summary: summary || entryHook || finalTitle,
    ...(causalBasis ? { causalBasis } : {}),
    ...(entryHook ? { entryHook } : {}),
    milestones: milestones.length > 0 ? milestones : [{ text: summary || finalTitle, done: false }],
    ...(stakes ? { stakes } : {}),
    ...(diegeticOmen ? { diegeticOmen } : {}),
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
  const diegeticOmen = normalizeDiegeticOmen(item, options)
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
    ...(diegeticOmen ? { diegeticOmen } : {}),
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

export function normalizePlotCompassGoal(raw, options = {}) {
  const src = typeof raw === 'string'
    ? { text: raw, enabled: Boolean(raw.trim()) }
    : object(raw)
  if (!src) {
    return { enabled: false, horizon: 'shortTerm', text: '' }
  }
  const horizon = PLOT_COMPASS_HORIZONS.includes(src.horizon) ? src.horizon : 'shortTerm'
  const text = cleanText(src.text, { ...options, maxLength: MAX_GOAL_TEXT_LENGTH })
  const enabled = text ? (typeof src.enabled === 'boolean' ? src.enabled : true) : false
  return { enabled, horizon, text }
}

export function activePlotCompassGoal(compassRaw) {
  const src = object(compassRaw)
  const goal = src && src.version === 1 && object(src.goal)
    ? normalizePlotCompassGoal(src.goal)
    : readPlotCompass(compassRaw).goal
  return goal?.enabled && goal?.text ? goal : null
}

export function emptyPlotCompass() {
  return {
    version: 1,
    updatedAt: 0,
    basedOnTurn: 0,
    lastCheckedTurn: 0,
    stalledTurns: 0,
    autoUpdateInterval: 0,
    maxRoutes: PLOT_COMPASS_DEFAULT_MAX_ROUTES,
    strength: 'guided',
    pace: 'natural',
    blindBox: false,
    customDirective: '',
    goal: { enabled: false, horizon: 'shortTerm', text: '' },
    playArchetypes: [],
    customArchetypes: [],
    situationDigest: '',
    shortTerm: [],
    midTerm: [],
    longTerm: [],
    pinned: { shortTerm: null, midTerm: null, longTerm: null },
    archived: [],
    chatHistory: []
  }
}

function normalizeCompassChatEntry(raw, index = 0) {
  const row = object(raw)
  if (!row) return null
  const role = row.role === 'assistant' ? 'assistant' : (row.role === 'user' ? 'user' : '')
  if (!role) return null
  const text = decodeLiteralUnicodeEscapes(str(row.text)).trim()
  if (!text) return null
  const maxLength = role === 'assistant' ? 1800 : 800
  const scopeApplied = PLOT_COMPASS_SCOPES.includes(row.scopeApplied) ? row.scopeApplied : ''
  return {
    id: str(row.id).trim() || `compass-msg-${index + 1}`,
    role,
    text: text.length > maxLength ? text.slice(0, maxLength).trim() : text,
    ...(scopeApplied ? { scopeApplied } : {}),
    turn: Math.max(0, Number(row.turn) || 0),
    createdAt: Math.max(0, Number(row.createdAt) || 0)
  }
}

export function readPlotCompass(value) {
  const src = object(value)
  if (!src || src.version !== 1) return emptyPlotCompass()
  const maxRoutes = normalizePlotCompassMaxRoutes(src.maxRoutes) ?? PLOT_COMPASS_DEFAULT_MAX_ROUTES
  const shortTerm = (Array.isArray(src.shortTerm) ? src.shortTerm : []).map((item, i) => normalizeShortRoute(item, i)).filter(Boolean).slice(0, maxRoutes)
  const midTerm = (Array.isArray(src.midTerm) ? src.midTerm : []).map((item, i) => normalizeMidRoute(item, i)).filter(Boolean).slice(0, maxRoutes)
  const longTerm = (Array.isArray(src.longTerm) ? src.longTerm : []).map((item, i) => normalizeLongRoute(item, i)).filter(Boolean).slice(0, maxRoutes)
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
  const chatHistory = (Array.isArray(src.chatHistory) ? src.chatHistory : [])
    .map((entry, idx) => normalizeCompassChatEntry(entry, idx))
    .filter(Boolean)
    .slice(-MAX_COMPASS_CHAT_MESSAGES)
  const basedOnTurn = Math.max(0, Number(src.basedOnTurn) || 0)
  const pinnedShort = resolvePin(shortTerm, rawPinned.shortTerm)
  return {
    version: 1,
    updatedAt: Math.max(0, Number(src.updatedAt) || 0),
    basedOnTurn,
    lastCheckedTurn: Math.max(basedOnTurn, Number(src.lastCheckedTurn) || 0),
    stalledTurns: pinnedShort ? Math.max(0, Math.min(99, Math.trunc(Number(src.stalledTurns) || 0))) : 0,
    autoUpdateInterval: normalizePlotCompassAutoUpdateInterval(src.autoUpdateInterval) ?? 0,
    maxRoutes,
    strength: normalizePlotCompassStrength(src.strength),
    pace: normalizePlotCompassPace(src.pace),
    blindBox: src.blindBox === true,
    customDirective: cleanText(src.customDirective, { maxLength: MAX_CUSTOM_DIRECTIVE_LENGTH }),
    goal: normalizePlotCompassGoal(src.goal),
    playArchetypes: normalizeArchetypeList(src.playArchetypes),
    customArchetypes: normalizeArchetypeList(src.customArchetypes),
    situationDigest: cleanText(src.situationDigest, { maxLength: 240 }),
    shortTerm,
    midTerm,
    longTerm,
    pinned: {
      shortTerm: pinnedShort,
      midTerm: resolvePin(midTerm, rawPinned.midTerm),
      longTerm: resolvePin(longTerm, rawPinned.longTerm)
    },
    archived,
    chatHistory
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
    text: {
      type: 'string',
      minLength: 1,
      description: '10-22字的态势/关系变化或待揭悬念短语（只锁定戏剧意图与结果，严禁写死琐碎肢体动作、固定台词或单一手段，把具体演法留给每轮候选项临场发挥）'
    },
    done: { type: 'boolean' }
  },
  required: ['text']
})

export function buildPlotCompassSubmitTool(maxRoutes = PLOT_COMPASS_DEFAULT_MAX_ROUTES) {
  const limit = normalizePlotCompassMaxRoutes(maxRoutes) ?? PLOT_COMPASS_DEFAULT_MAX_ROUTES
  const minItems = Math.min(2, limit)
  const countDesc = limit === 1 ? '1 条' : (limit === 2 ? '2 条' : `最多 ${limit} 条（建议 ${Math.max(2, limit - 1)}-${limit} 条）`)
  return Object.freeze({
    name: PLOT_COMPASS_SUBMIT_TOOL_NAME,
    description: '提交今期（2-5轮）、中期（5-20轮）、长期（20+轮至结局）的多路线剧情发展规划。必须基于当前人物卡游玩类型、已发生剧情、变量状态及未触发暗线生成差异化分支路线；各路线锚定戏剧张力与局势跃迁（What/Why），不预先锁死单一动作微操（How）。若上下文包含 <player_goal> 目标导向，整棵剧情树的所有分支路线必须殊途同归导向达成玩家设定的目标结果。',
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
          minItems,
          maxItems: limit,
          description: `今期规划（未来 2-5 轮）：${countDesc}戏剧切口与走向截然不同的近期路线（锁定态势跃迁，开放具体执行手段）`,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              tag: { type: 'string', minLength: 1, description: '2-6字路线短签（将直接作为下一轮候选项角标，如：顺势破防、暗查异响、掀桌试探、切场夜访）' },
              title: { type: 'string', minLength: 1 },
              direction: { type: 'string', description: '路线戏剧维度（如：顺水推舟、反客为主、支线切入）' },
              summary: { type: 'string', minLength: 1, description: '路线核心冲突焦点与态势变化（避免写成死板的逐动作剧本）' },
              causalBasis: { type: 'string', description: '因果出发点与物理/动机依据（说明为何此刻合理可达，禁止无铺垫的机械降神巧遇）' },
              sceneTrigger: { type: 'string', description: '备选破冰参考（12-35字）：仅当玩家连续被动空转时可供参考的一种现场引子示例，不限制正常临场发挥' },
              beats: { type: 'array', minItems: 1, maxItems: 4, items: STEP_ITEM_SCHEMA },
              sourceHook: { type: 'string', description: '灵感来源标签（如：伏笔回收、世界书暗线、数值临界、原著主线、IF偏离）' }
            },
            required: ['tag', 'title', 'summary', 'beats']
          }
        },
        midTerm: {
          type: 'array',
          minItems,
          maxItems: limit,
          description: `中期规划（未来 5-20 轮）：${countDesc}平行篇章弧（主流推进、反差拐点、隐藏暗线）`,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              tag: { type: 'string', minLength: 1 },
              title: { type: 'string', minLength: 1 },
              direction: { type: 'string' },
              summary: { type: 'string', minLength: 1 },
              causalBasis: { type: 'string', description: '因果出发点：触发此篇章的已知伏笔、人物动机或局势推力' },
              entryHook: { type: 'string', description: '开放式入线切口（15-38字）：追索哪条悬念或推动何种关系转向即可拐入此篇章，不限定单一动作剧本' },
              milestones: { type: 'array', minItems: 1, maxItems: 4, items: STEP_ITEM_SCHEMA },
              stakes: { type: 'string', description: '潜在收获与代价风险' },
              diegeticOmen: { type: 'string', description: '无剧透的世界内可闻风声/环境异象（如茶馆议论、街角告示、远处钟声），供正文自然渗透线索' },
              sourceHook: { type: 'string' }
            },
            required: ['tag', 'title', 'summary', 'milestones']
          }
        },
        longTerm: {
          type: 'array',
          minItems,
          maxItems: limit,
          description: `长期规划（20+ 轮至结局）：${countDesc}命运归宿或世界终局蓝图`,
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
              diegeticOmen: { type: 'string', description: '无剧透的远期命运征象或微弱世界涟漪，不提前剧透结局' },
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
}

export const PLOT_COMPASS_SUBMIT_TOOL = buildPlotCompassSubmitTool(PLOT_COMPASS_DEFAULT_MAX_ROUTES)

export function buildPlotCompassChatSubmitTool(maxRoutes = PLOT_COMPASS_DEFAULT_MAX_ROUTES) {
  const baseTool = buildPlotCompassSubmitTool(maxRoutes)
  return Object.freeze({
    name: PLOT_COMPASS_SUBMIT_TOOL_NAME,
    description: '仅当玩家明确要求生成、修改、重推或替换剧情路线时调用此工具；支持通过 targetScope 指定只刷新某一个时间层级（如 shortTerm / midTerm / longTerm）或 all。',
    parameters: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: {
        targetScope: {
          type: 'string',
          enum: ['shortTerm', 'midTerm', 'longTerm', 'all'],
          description: '本次要更新的时间层级。只改动某一层时选对应层级，未选中的层级会完整保留玩家已有路线。'
        },
        ...baseTool.parameters.properties
      },
      required: ['targetScope']
    })
  })
}

export const PLOT_COMPASS_CHAT_SUBMIT_TOOL = buildPlotCompassChatSubmitTool(PLOT_COMPASS_DEFAULT_MAX_ROUTES)

export function parsePlotCompassSubmission(rawArgs, { scope = 'all', card, chat, playerName, maxRoutes = PLOT_COMPASS_DEFAULT_MAX_ROUTES } = {}) {
  const payload = parseJsonLenient(rawArgs)
  const opts = { card, chat, playerName }
  const limit = normalizePlotCompassMaxRoutes(maxRoutes) ?? PLOT_COMPASS_DEFAULT_MAX_ROUTES
  const minRequired = Math.min(2, limit)
  const requestedTarget = PLOT_COMPASS_SCOPES.includes(payload.targetScope) ? payload.targetScope : ''
  const effectiveScope = scope === 'chat'
    ? (requestedTarget || 'all')
    : (PLOT_COMPASS_SCOPES.includes(scope) ? scope : 'all')

  const shortTerm = (Array.isArray(payload.shortTerm) ? payload.shortTerm : [])
    .map((item, index) => normalizeShortRoute(item, index, opts))
    .filter(Boolean)
    .slice(0, limit)
  const midTerm = (Array.isArray(payload.midTerm) ? payload.midTerm : [])
    .map((item, index) => normalizeMidRoute(item, index, opts))
    .filter(Boolean)
    .slice(0, limit)
  const longTerm = (Array.isArray(payload.longTerm) ? payload.longTerm : [])
    .map((item, index) => normalizeLongRoute(item, index, opts))
    .filter(Boolean)
    .slice(0, limit)

  if ((effectiveScope === 'all' || effectiveScope === 'shortTerm') && shortTerm.length < minRequired) {
    throw new Error(`今期规划（shortTerm）至少需要提供 ${minRequired} 条不同方向的路线`)
  }
  if ((effectiveScope === 'all' || effectiveScope === 'midTerm') && midTerm.length < minRequired) {
    throw new Error(`中期规划（midTerm）至少需要提供 ${minRequired} 条不同方向的篇章路线`)
  }
  if ((effectiveScope === 'all' || effectiveScope === 'longTerm') && longTerm.length < minRequired) {
    throw new Error(`长期规划（longTerm）至少需要提供 ${minRequired} 条不同方向的终局蓝图`)
  }

  return {
    targetScope: effectiveScope,
    playArchetypes: normalizeArchetypeList(payload.playArchetypes, opts),
    situationDigest: cleanText(payload.situationDigest, { ...opts, maxLength: 240 }),
    shortTerm,
    midTerm,
    longTerm,
    divergedNote: cleanText(payload.divergedNote, { ...opts, maxLength: 140 })
  }
}

export function mergePlotCompassUpdate(previousRaw, submitted, { scope = 'all', turn = 0, now = Date.now(), fresh = false } = {}) {
  const prev = readPlotCompass(previousRaw)
  const next = copy(prev)
  next.updatedAt = now
  next.basedOnTurn = Math.max(0, Number(turn) || 0)
  next.lastCheckedTurn = Math.max(next.basedOnTurn, Number(prev.lastCheckedTurn) || 0)
  // 全新生成：旧路线整体作废，点亮标记一并清空（不做 id/标题匹配，也不写入 archived）。
  if (fresh) {
    next.pinned = { shortTerm: null, midTerm: null, longTerm: null }
    next.stalledTurns = 0
  }
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
    const rawIncoming = submitted[horizon]
    if (!Array.isArray(rawIncoming) || rawIncoming.length === 0) return
    const incoming = rawIncoming.slice(0, next.maxRoutes || PLOT_COMPASS_DEFAULT_MAX_ROUTES)
    const prevPinnedId = fresh ? null : prev.pinned[horizon]
    const prevPinnedRoute = prevPinnedId ? prev[horizon].find(item => item.id === prevPinnedId) : null
    next[horizon] = incoming
    if (prevPinnedId) {
      // 优先按保留 id 匹配；若模型重生成了 id，则按同标签或同标题对齐。
      const matched = incoming.find(item => item.id === prevPinnedId) ||
        (prevPinnedRoute && incoming.find(item => item.title === prevPinnedRoute.title || item.tag === prevPinnedRoute.tag))
      if (matched) {
        next.pinned[horizon] = matched.id
        if (horizon === 'shortTerm') {
          const prevNextBeat = (prevPinnedRoute?.beats || []).find(step => !step.done)?.text || ''
          const newNextBeat = (matched.beats || []).find(step => !step.done)?.text || ''
          if (prevNextBeat !== newNextBeat) next.stalledTurns = 0
        }
      } else {
        next.pinned[horizon] = null
        if (horizon === 'shortTerm') next.stalledTurns = 0
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
  if (horizon === 'shortTerm') next.stalledTurns = 0
  next.updatedAt = now
  return next
}

export function setPlotCompassPin(previousRaw, { horizon, routeId, now = Date.now() } = {}) {
  if (!PLOT_COMPASS_HORIZONS.includes(horizon)) throw new Error('无效的规划层级：' + str(horizon))
  const next = readPlotCompass(previousRaw)
  const target = str(routeId).trim()
  const prevShort = next.pinned.shortTerm
  if (!target) next.pinned[horizon] = null
  else if (next[horizon].some(item => item.id === target)) next.pinned[horizon] = target
  if (horizon === 'shortTerm' && next.pinned.shortTerm !== prevShort) next.stalledTurns = 0
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
  if (horizon === 'shortTerm' && next.pinned.shortTerm === route.id) next.stalledTurns = 0
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

/**
 * 设置或更新剧情罗盘的目标导向配置（目标结果文本、短期/中期/长期跨度、启停状态）。
 */
export function applyPlotCompassGoal(previousRaw, { text, horizon, enabled, now = Date.now() } = {}) {
  const next = readPlotCompass(previousRaw)
  const prevGoal = next.goal || { enabled: false, horizon: 'shortTerm', text: '' }
  let nextHorizon = prevGoal.horizon
  if (horizon !== undefined) {
    if (!PLOT_COMPASS_HORIZONS.includes(horizon)) {
      throw new Error('无效的目标跨度选项：' + str(horizon))
    }
    nextHorizon = horizon
  }
  const nextText = text !== undefined
    ? cleanText(text, { maxLength: MAX_GOAL_TEXT_LENGTH })
    : prevGoal.text
  let nextEnabled
  if (!nextText) {
    if (enabled === true) throw new Error('请先输入目标内容后再开启目标导向')
    nextEnabled = false
  } else if (enabled !== undefined) {
    nextEnabled = Boolean(enabled)
  } else if (text !== undefined) {
    nextEnabled = true
  } else {
    nextEnabled = prevGoal.enabled
  }
  next.goal = {
    enabled: nextEnabled,
    horizon: nextHorizon,
    text: nextText
  }
  next.updatedAt = now
  return next
}

/**
 * 更新剧情罗盘的控制偏好（约束力度、推进节奏、盲盒防剧透开关、玩家自定义微调引导、定时自动更新间隔、每层规划条目上限、可选目标导向）。
 */
export function applyPlotCompassPreferences(previousRaw, { strength, pace, blindBox, customDirective, autoUpdateInterval, maxRoutes, goal, now = Date.now() } = {}) {
  let next = readPlotCompass(previousRaw)
  if (strength !== undefined) {
    if (!PLOT_COMPASS_STRENGTHS.includes(strength)) throw new Error('无效的约束力度选项：' + str(strength))
    next.strength = strength
  }
  if (pace !== undefined) {
    if (!PLOT_COMPASS_PACES.includes(pace)) throw new Error('无效的推进节奏选项：' + str(pace))
    next.pace = pace
  }
  if (blindBox !== undefined) {
    next.blindBox = Boolean(blindBox)
  }
  if (customDirective !== undefined) {
    next.customDirective = cleanText(customDirective, { maxLength: MAX_CUSTOM_DIRECTIVE_LENGTH })
  }
  if (autoUpdateInterval !== undefined) {
    if (typeof autoUpdateInterval === 'boolean' || autoUpdateInterval === null || (typeof autoUpdateInterval === 'string' && !autoUpdateInterval.trim())) {
      throw new Error(`自动更新间隔须为 0–${PLOT_COMPASS_MAX_AUTO_UPDATE_INTERVAL} 的整数（0 表示关闭）`)
    }
    const parsed = Number(autoUpdateInterval)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > PLOT_COMPASS_MAX_AUTO_UPDATE_INTERVAL) {
      throw new Error(`自动更新间隔须为 0–${PLOT_COMPASS_MAX_AUTO_UPDATE_INTERVAL} 的整数（0 表示关闭）`)
    }
    next.autoUpdateInterval = parsed
  }
  if (maxRoutes !== undefined) {
    if (typeof maxRoutes === 'boolean' || maxRoutes === null || (typeof maxRoutes === 'string' && !maxRoutes.trim())) {
      throw new Error(`剧情规划条目上限须为 ${PLOT_COMPASS_MIN_MAX_ROUTES}–${PLOT_COMPASS_MAX_MAX_ROUTES} 的整数`)
    }
    const parsed = Number(maxRoutes)
    if (!Number.isSafeInteger(parsed) || parsed < PLOT_COMPASS_MIN_MAX_ROUTES || parsed > PLOT_COMPASS_MAX_MAX_ROUTES) {
      throw new Error(`剧情规划条目上限须为 ${PLOT_COMPASS_MIN_MAX_ROUTES}–${PLOT_COMPASS_MAX_MAX_ROUTES} 的整数`)
    }
    next.maxRoutes = parsed
    next = readPlotCompass(next)
  }
  if (goal !== undefined) {
    const goalPatch = typeof goal === 'string' ? { text: goal } : (object(goal) || { text: '', enabled: false })
    next = applyPlotCompassGoal(next, { ...goalPatch, now })
  }
  next.updatedAt = now
  return next
}

/**
 * 向剧情罗盘的脑暴聊天记录追加一条对话消息（保留最近 16 条）。
 */
export function appendPlotCompassChat(previousRaw, entry = {}, { now = Date.now() } = {}) {
  const next = readPlotCompass(previousRaw)
  const normalized = normalizeCompassChatEntry({
    ...entry,
    id: entry.id || `compass-msg-${randomUUID().slice(0, 8)}`,
    createdAt: entry.createdAt ?? now
  }, next.chatHistory.length)
  if (!normalized) return next
  next.chatHistory = [...next.chatHistory, normalized].slice(-MAX_COMPASS_CHAT_MESSAGES)
  next.updatedAt = now
  return next
}

/**
 * 清空剧情罗盘脑暴聊天历史。
 */
export function clearPlotCompassChat(previousRaw, { now = Date.now() } = {}) {
  const next = readPlotCompass(previousRaw)
  next.chatHistory = []
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

export function isPlotCompassEnabled(source) {
  if (!source || typeof source !== 'object') return false
  if (typeof source.enabled === 'boolean') return source.enabled
  return source?.backgroundTasks?.plotCompass === true
}

/**
 * 仅从当前已点亮的剧情罗盘路线中提取纯剧情语义片段用于世界书关键词扫描，
 * 不含任何系统引导语，防止指令词误触绿灯条目。
 */
export function plotCompassWorldbookScanText(source) {
  if (!source) return ''
  const compassRaw = source.compass ?? source.plotCompass ?? source
  if (Object.hasOwn(source, 'enabled') || Object.hasOwn(source, 'backgroundTasks')) {
    if (!isPlotCompassEnabled(source)) return ''
  }
  if (source.mode && !['story', 'script'].includes(source.mode)) return ''
  const { compass, shortTerm, midTerm, longTerm } = activePlotCompassRoutes(compassRaw)
  const activeGoal = activePlotCompassGoal(compass)
  if (!shortTerm && !midTerm && !longTerm && !compass.customDirective && !activeGoal) return ''
  const snippets = []
  if (activeGoal?.text) snippets.push(activeGoal.text)
  if (longTerm) {
    if (longTerm.title) snippets.push(longTerm.title)
    if (longTerm.tone) snippets.push(longTerm.tone)
    if (longTerm.diegeticOmen) snippets.push(longTerm.diegeticOmen)
  }
  if (midTerm) {
    if (midTerm.title) snippets.push(midTerm.title)
    if (midTerm.summary) snippets.push(midTerm.summary)
    if (midTerm.entryHook) snippets.push(midTerm.entryHook)
    if (midTerm.diegeticOmen) snippets.push(midTerm.diegeticOmen)
    const nextMilestone = (midTerm.milestones || []).find(step => !step.done)?.text
    if (nextMilestone) snippets.push(nextMilestone)
  }
  if (shortTerm) {
    if (shortTerm.title) snippets.push(shortTerm.title)
    if (shortTerm.summary) snippets.push(shortTerm.summary)
    if (shortTerm.sceneTrigger) snippets.push(shortTerm.sceneTrigger)
    const nextBeat = (shortTerm.beats || []).find(step => !step.done)?.text
    if (nextBeat) snippets.push(nextBeat)
  }
  if (compass.customDirective) snippets.push(compass.customDirective)
  return snippets.join('\n')
}

function isNativeFallbackWorldbookEntry(entry = {}) {
  const body = str(entry.content)
  const comment = str(entry.comment || entry.title)
  if (/^@@/m.test(body) || /\[(?:GENERATE:|RENDER:|InitialVariables|Preprocessing)|@INJECT/.test(body + '\n' + comment)) return true
  if (/<%|%>/.test(body) || /<script\b|```\s*(?:javascript|js|typescript|ts|ejs)\b/i.test(body)) return true
  if (/\[(?:initvar|initialvariables|mvu[_ -](?!plot\]))/i.test(comment)) return true
  if (entry.constant === true && /\[mvu[_ -]plot\]/i.test(comment)) return true
  if (entry.mvu === true || /^\[?(?:mvu|变量更新)/i.test(comment)) return true
  return false
}

/**
 * 提取未触发、非常驻的静态/背景设定世界书条目作为暗线灵感种子。
 */
export function extractDormantWorldbookHooks(entries = [], context = {}, { limit = 8 } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  const triggeredTitles = new Set()
  if (Array.isArray(context?.activatedWorldbookTitles)) {
    for (const title of context.activatedWorldbookTitles) {
      const name = str(title).trim()
      if (name) triggeredTitles.add(name.toLowerCase())
    }
  }
  const recall = object(context?.lastWorldBookRecall) || object(context?.preparedWorldBook)
  for (const item of Array.isArray(recall?.activated) ? recall.activated : []) {
    const name = str(typeof item === 'string' ? item : item?.title || item?.comment || item?.uid).trim()
    if (name) triggeredTitles.add(name.toLowerCase())
  }
  const reads = object(context?.worldBookReads)
  for (const key of Object.keys(reads || {})) triggeredTitles.add(key.toLowerCase())

  const candidates = []
  for (const entry of entries) {
    if (!entry || entry.enabled === false || entry.constant === true) continue
    if (isNativeFallbackWorldbookEntry(entry)) continue
    const title = str(entry.title || entry.comment).trim()
    const keys = (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : (Array.isArray(entry.keys) ? entry.keys : []))
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

const STRENGTH_HEADERS = Object.freeze({
  soft: '【剧情罗盘 · 软铺垫模式】以下为玩家选定的剧情潜流方向。仅通过环境感官、人物潜台词与自然风声埋下伏笔，严禁跨越因果抢跑后续节点；若玩家本轮转向其他话题，完全顺应玩家输入：',
  guided: '【剧情罗盘 · 强牵引导演指令】以下为玩家明确锚定的主推剧情方向，优先级高于常规闲聊惯性。只要玩家本轮输入未与该路线正面违背，你必须在完整回应玩家行动的同时，主动调动在场角色动机、突发互动或环境契机，将【本轮推进目标】实质性向前推进至少半步至一步，并在段尾落向该节拍的张力钩子，禁止原地寒暄空转：',
  strict: '【剧情罗盘 · 硬性兑现裁定（本轮必达）】以下为玩家锁定的强制剧情推进目标。除非主角处于无法行动的物理受限绝境或玩家本轮明确反向掀桌，本轮正文必须正面触发并兑现【本轮推进目标】的核心戏剧事件或冲突转折，严禁仅做模糊铺垫或拖延至下一轮：'
})

const PACE_GUIDANCE = Object.freeze({
  foreshadow: '推进节奏〔只铺垫〕：本轮聚焦触发前兆、感官细节、试探交锋与悬念蓄势，把局面推至临界点，留白最终摊牌。',
  natural: '推进节奏〔自然推进〕：顺应人物性格与现场因果把当前目标节拍扎实演透，自然衔接后续走向，不跳步也不拖沓。',
  climax: '推进节奏〔尽快引爆〕：拉满戏剧张力，推动潜藏矛盾、关键人物或突发变故在本轮正面对撞，打出鲜明转折！'
})

function arcPhaseRoleLabel(index, total) {
  if (total <= 1 || index < 0) return ''
  if (index === total - 1) return '篇章收束高潮'
  if (total >= 3 && index === total - 2) return '核心抉择拐点'
  if (index === 0) return '入线铺垫'
  return '冲突升级'
}

function formatCompassStepChain(steps, { activeLabel = '本轮推进目标', phaseLabels = false } = {}) {
  const list = Array.isArray(steps) ? steps : []
  if (list.length === 0) return ''
  const nextIdx = list.findIndex(step => !step.done)
  return list.map((step, idx) => {
    const phase = phaseLabels ? arcPhaseRoleLabel(idx, list.length) : ''
    const prefix = phase ? `${phase}·` : ''
    if (step.done) return `[✓ ${idx + 1}.${prefix}${step.text}]`
    if (idx === nextIdx) return `【▶ ${idx + 1}.${prefix}${step.text}（${activeLabel}）】`
    return `[○ ${idx + 1}.${prefix}${step.text}（后续留白）]`
  }).join(' → ')
}

/**
 * 为前台正文生成剧情罗盘导演/引导段落文本（未开启且无锚定路线、目标导向与微调指令时返回空字符串）。严格隐藏远期终局剧透。
 */
export function plotCompassBodyText(compassRaw) {
  const { compass, shortTerm, midTerm, longTerm } = activePlotCompassRoutes(compassRaw)
  const activeGoal = activePlotCompassGoal(compass)
  const hasPinned = Boolean(shortTerm || midTerm || longTerm)
  if (!hasPinned && !compass.customDirective && !activeGoal) return ''

  const strength = normalizePlotCompassStrength(compass.strength)
  const lines = [
    STRENGTH_HEADERS[strength] || STRENGTH_HEADERS.guided,
    `- ${PACE_GUIDANCE[compass.pace] || PACE_GUIDANCE.natural}`
  ]

  if (activeGoal) {
    if (activeGoal.horizon === 'shortTerm') {
      const focusTag = !shortTerm
        ? ` ｜ 【▶ ${strength === 'strict' ? '本轮必达推进焦点' : '本轮推进目标'}：直接推动现场局势与人物互动朝此短期结果实质性收束】`
        : '（结合下方今期锚定节拍，在 2–5 轮内实质性收束兑现此结果）'
      lines.push(`- 🎯 玩家锁定目标导向〔短期 · 2–5轮内达成〕：${activeGoal.text}${focusTag}`)
    } else if (activeGoal.horizon === 'midTerm') {
      const focusTag = !shortTerm && !midTerm
        ? ` ｜ 【▶ ${strength === 'strict' ? '本轮入线必达切口' : '本轮推进目标'}：从当前现场切入并撬动通往该中期结果的关键契机】`
        : ''
      lines.push(`- 🎯 玩家锁定目标导向〔中期 · 5–20轮篇章结果〕：${activeGoal.text}${focusTag}（沿当前因果稳步铺垫并积累达成该中期目标所需的筹码与关系转向，严禁把局势写进背离该目标的方向；逐步推进，切勿脱离过程在一轮内硬跳终局）`)
    } else {
      lines.push(`- 🎯 玩家锁定目标导向〔长期 · 远期终局归宿〕：${activeGoal.text}（维持通向该远期目标结果的因果伏脉与人物演进航向，严禁制造不可逆阻断该目标的死局，同时严禁脱离当前阶段提前抢跑或跳向结局）`)
    }
  }

  if (shortTerm) {
    const beats = Array.isArray(shortTerm.beats) ? shortTerm.beats : []
    const nextIdx = beats.findIndex(step => !step.done)
    const nextBeat = nextIdx >= 0 ? beats[nextIdx].text : shortTerm.summary
    const targetLabel = strength === 'strict' ? '本轮必达目标' : '本轮推进目标'
    const chain = formatCompassStepChain(beats, { activeLabel: targetLabel })
    const causalHint = shortTerm.causalBasis ? ` ｜ 因果锚点：${shortTerm.causalBasis}` : ''
    lines.push(`- 今期锚定路线「${shortTerm.title}」(routeTag="${shortTerm.tag}")：${chain || nextBeat}${causalHint}`)
    if (shortTerm.sceneTrigger && nextIdx >= 0) {
      lines.push(`  · 备选破冰参考（仅在玩家被动空转时参考，若当下现场有更贴切的自然切口直接顺势发挥）：${shortTerm.sceneTrigger}`)
    }
    if (strength !== 'soft' && nextIdx >= 0 && (compass.stalledTurns || 0) >= 2) {
      lines.push(`  · ⚠ 久拖破局加压：节拍「${nextBeat}」已连续 ${compass.stalledTurns} 轮未达成！本轮严禁继续原地试探或重复气氛铺陈，必须由在场角色主动出招、外部声响/来人介入或局势变化直接促成该节拍的核心转折！`)
    }
  }

  if (midTerm) {
    const milestones = Array.isArray(midTerm.milestones) ? midTerm.milestones : []
    const nextIdx = milestones.findIndex(step => !step.done)
    const nextMilestone = nextIdx >= 0 ? milestones[nextIdx].text : midTerm.summary
    const roleTag = nextIdx >= 0 ? arcPhaseRoleLabel(nextIdx, milestones.length) : ''
    const phaseNote = roleTag ? `〔${roleTag}〕` : ''
    const omenHint = midTerm.diegeticOmen ? ` ｜ 世界内预兆风声（借传闻或环境自然透出，零剧透）：${midTerm.diegeticOmen}` : ''
    if (!shortTerm) {
      const entryFocus = midTerm.entryHook || nextMilestone
      const focusLabel = strength === 'strict' ? '本轮入线必达切口' : '本轮推进目标'
      lines.push(`- 中期锚定篇章「${midTerm.title}」(routeTag="${midTerm.tag}")：${midTerm.summary} ｜ 【▶ ${focusLabel}${phaseNote}：${entryFocus}】（逐步推进当前阶段，切勿在一轮内跳完后续章节里程碑）${omenHint}`)
    } else {
      lines.push(`- 中期篇章脉络「${midTerm.title}」(routeTag="${midTerm.tag}")：${midTerm.summary}${nextMilestone ? ` ｜ 当前阶段焦点${phaseNote}：${nextMilestone}（渐进埋线蓄势，勿提前抢跑后续章节节点）` : ''}${omenHint}`)
    }
  }

  if (longTerm) {
    const toneLine = longTerm.toneGuidance || (longTerm.tone ? `长线基调「${longTerm.tone}」` : longTerm.title)
    const omenHint = longTerm.diegeticOmen ? ` ｜ 远期世界回响（仅作细微感官呼应，零剧透）：${longTerm.diegeticOmen}` : ''
    lines.push(`- 长期暗流基调「${longTerm.title}」(routeTag="${longTerm.tag}"，仅维持伏脉氛围，严禁提前揭示或跳向结局)：${toneLine}${omenHint}`)
  }

  if (midTerm || shortTerm || activeGoal) {
    lines.push('- 目标锁定与手段开放：罗盘锁定的是「戏剧意图与关系/局势转折（What）」，而非死板的动作剧本（How）。具体采用何种肢体互动、对白锋芒或现场道具达成该推进，完全服从本轮玩家选定的演出方式与在场人物的即时反应，切勿无视当前站位生搬硬套字面表述。')
    lines.push('- 场外涟漪演绎许可：当玩家既往抉择或既定事件已在场外牵动上述路线因果时，可通过简短视角切镜、信使书信、不速之客或耳闻风声直接呈现场外局势推进，但不得越权替玩家做出尚未发生的主观抉择。')
  }

  if (compass.customDirective) {
    lines.push(`- 玩家微调导演要求（在不违背现场事实前提下优先贯彻）：${compass.customDirective}`)
  }

  if (strength !== 'soft' && (shortTerm || midTerm || compass.customDirective || activeGoal)) {
    lines.push('- 落笔前构思检核：在构思阶段（含思维链或 submit_story 的 think 参数）必须先敲定「玩家本轮输入 × 上述推进目标」的具体衔接点（由谁、借什么现场自然契机切入推进，段尾停在何处悬念钩子），再动笔输出正文。')
  }

  return promptSection('plot_compass', lines.join('\n'))
}

export function plotCompassBodySection(chat) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story') || !isPlotCompassEnabled(chat)) return null
  const text = plotCompassBodyText(chat.plotCompass)
  return text ? { kind: 'plot-compass', required: false, text } : null
}

/**
 * 为候选项生成任务提供路线角标与开放式意图引导段落（锁住方向角标，放开临场演出手段并保留即兴席位）。
 */
export function plotCompassCandidateText(compassRaw) {
  const { compass, shortTerm: pinnedShort, midTerm: pinnedMid, longTerm: pinnedLong } = activePlotCompassRoutes(compassRaw)
  const activeGoal = activePlotCompassGoal(compass)
  if (compass.shortTerm.length === 0 && !pinnedMid && !activeGoal) return ''

  const strength = normalizePlotCompassStrength(compass.strength)
  const lines = [
    'Plot Compass intent directions are available. Treat compass routes strictly as abstract DRAMATIC INTENT / OUTCOME GOALS—NEVER paraphrase or mechanically copy their wording! Invent fresh, vivid staging (`HOW`) rooted in the latest paragraph\'s exact posture, gaze, props, and emotional subtext, and attach matching short `routeTag` on `actors[].routeTags` / `featured[].routeTag` (`eventRouteTag` / `sceneRouteTag` when fitting):'
  ]
  if (activeGoal) {
    const scaleNote = activeGoal.horizon === 'shortTerm'
      ? 'Steer immediate choices so they actively push toward achieving this short-term outcome within 2–5 turns.'
      : activeGoal.horizon === 'midTerm'
        ? 'Ensure forward-moving choices build concrete leverage, clues, or relationship momentum toward this mid-term chapter outcome.'
        : 'Keep compass-aligned choices constructively aligned with the trajectory toward this long-term destiny without prematurely skipping arcs.'
    lines.push(`- [PLAYER GOAL ORIENTATION · ${activeGoal.horizon}]: Target outcome → "${activeGoal.text}". ${scaleNote}`)
  }
  if (pinnedShort) {
    const nextBeat = (pinnedShort.beats || []).find(step => !step.done)?.text || pinnedShort.summary
    const mandate = strength === 'strict'
      ? 'Ensure the top 2 featured/actor choices directly trigger or confront this beat via contrasting live tactics (e.g. direct pressure vs. subtle baiting / NPC initiative)!'
      : 'Offer 1–2 distinct, creatively varied tactics that advance toward this intent (spanning different emotional or physical angles rather than repeating one literal action)!'
    lines.push(`- [PRIMARY PINNED INTENT] tag="${pinnedShort.tag}" (${pinnedShort.title}): target shift → ${nextBeat}. ${mandate}`)
    const alternatives = compass.shortTerm.filter(item => item.id !== pinnedShort.id).slice(0, 2)
    for (const alt of alternatives) {
      const angle = alt.direction ? ` [${alt.direction}]` : ''
      lines.push(`- [Optional pivot tag] tag="${alt.tag}"${angle}: ${alt.title} (tag only if a natural choice pivots this way; do not force)`)
    }
  } else if (compass.shortTerm.length > 0) {
    lines.push('- Unpinned compass tags (invent organic choices from the latest scene first; attach a `routeTag` ONLY when an organic choice naturally aligns with one of these angles—do NOT force every route into the menu):')
    for (const route of compass.shortTerm.slice(0, compass.maxRoutes || PLOT_COMPASS_DEFAULT_MAX_ROUTES)) {
      const angle = route.direction ? ` [${route.direction}]` : ''
      lines.push(`  · tag="${route.tag}"${angle}: ${route.title}`)
    }
  }
  if (pinnedMid) {
    const hook = pinnedMid.entryHook || (pinnedMid.milestones || []).find(step => !step.done)?.text || pinnedMid.summary
    const omen = pinnedMid.diegeticOmen ? ` | Ambient in-world ripple (optional inspiration for event/scene): ${pinnedMid.diegeticOmen}` : ''
    lines.push(`- [Pinned Mid-Term Arc: ${pinnedMid.title}] tag="${pinnedMid.tag}": open entry thread "${hook}".${omen}`)
  } else if (pinnedLong?.diegeticOmen) {
    lines.push(`- [Long-Term In-World Omen] tag="${pinnedLong.tag}": ambient whisper "${pinnedLong.diegeticOmen}"`)
  }
  lines.push('- Free-improvisation quota: Always keep at least 1–2 `actors` / `featured` choices completely UNTAGGED and unbound by any compass route—purely improvising on immediate character chemistry, micro-expressions, or unexpected scene details.')
  return promptSection('plot_compass_candidates', lines.join('\n'))
}

export function plotCompassCandidateSection(chat) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story') || !isPlotCompassEnabled(chat)) return null
  const text = plotCompassCandidateText(chat.plotCompass)
  return text ? { kind: 'plot-compass', required: false, text } : null
}

/**
 * 后台现场姿态（posture）结算保鲜说明：保留本轮正文中已浮现的锚定路线线索与人物动向。
 */
export function plotCompassSettlementNote(source) {
  if (!source) return ''
  const compassRaw = source.compass ?? source.plotCompass ?? source
  if (Object.hasOwn(source, 'enabled') || Object.hasOwn(source, 'backgroundTasks')) {
    if (!isPlotCompassEnabled(source)) return ''
  }
  if (source.mode && !['story', 'script'].includes(source.mode)) return ''
  const { compass, shortTerm, midTerm } = activePlotCompassRoutes(compassRaw)
  const activeGoal = activePlotCompassGoal(compass)
  if (!shortTerm && !midTerm && !compass.customDirective && !activeGoal) return ''
  const focus = []
  if (activeGoal) {
    focus.push(`目标导向〔${PLOT_COMPASS_GOAL_HORIZON_LABELS[activeGoal.horizon] || '短期'}〕：「${activeGoal.text}」`)
  }
  if (shortTerm) {
    const nextBeat = (shortTerm.beats || []).find(step => !step.done)?.text || shortTerm.summary
    focus.push(`近期路线「${shortTerm.title}」（当前节拍：${nextBeat}）`)
  }
  if (midTerm) {
    const nextMilestone = (midTerm.milestones || []).find(step => !step.done)?.text || midTerm.summary
    focus.push(`中期篇章「${midTerm.title}」（阶段焦点：${nextMilestone}）`)
  }
  if (compass.customDirective) {
    focus.push(`微调关注：${compass.customDirective}`)
  }
  return '玩家当前在剧情罗盘中锚定了以下推进方向：' + focus.join('；') + '。若本轮正文中已出现与之相关的现场线索、异响动静、人物意图变化或未决悬念，请在更新现场状态（posture）时优先保留这些细节，避免浓缩时遗漏（切勿把正文尚未发生的未来规划写进当前现场状态）。'
}

/**
 * 归卷压缩摘要保留说明：防止压缩丢失与锚定路线或目标导向相关的伏笔。
 */
export function plotCompassCompactionNote(source) {
  if (!source) return ''
  const compassRaw = source.compass ?? source.plotCompass ?? source
  if (Object.hasOwn(source, 'enabled') || Object.hasOwn(source, 'backgroundTasks')) {
    if (!isPlotCompassEnabled(source)) return ''
  }
  if (source.mode && !['story', 'script'].includes(source.mode)) return ''
  const { compass, shortTerm, midTerm, longTerm } = activePlotCompassRoutes(compassRaw)
  const activeGoal = activePlotCompassGoal(compass)
  if (!shortTerm && !midTerm && !longTerm && !activeGoal) return ''
  const items = []
  if (activeGoal) {
    items.push(`目标导向〔${PLOT_COMPASS_GOAL_HORIZON_LABELS[activeGoal.horizon] || '短期'}〕：${activeGoal.text}`)
  }
  if (shortTerm) items.push(`近期锚定方向「${shortTerm.title}」：${shortTerm.summary}`)
  if (midTerm) items.push(`中期锚定篇章「${midTerm.title}」：${midTerm.summary}`)
  if (longTerm) items.push(`长期基调方向「${longTerm.title}」（${longTerm.tone || '远期伏脉'}）`)
  return '玩家当前在剧情罗盘中点亮了以下发展方向，压缩摘要时务必在 Foreshadowing and promises / Relationships 中完整保留与之相关的伏笔、约定与暗线线索（但只记录已发生的剧情事实，不要把未发生的规划当成既成事实写进摘要）：\n- ' + items.join('\n- ')
}

function buildGoalOrientationText(goal) {
  if (!goal?.enabled || !goal?.text) return ''
  const horizonLabel = PLOT_COMPASS_GOAL_HORIZON_LABELS[goal.horizon] || '短期'
  const horizonSpan = goal.horizon === 'shortTerm'
    ? 'shortTerm (短期目标 · 2–5 轮内达成)'
    : goal.horizon === 'midTerm'
      ? 'midTerm (中期目标 · 5–20 轮篇章结果)'
      : 'longTerm (长期目标 · 20+ 轮至终局结果)'

  const alignmentLines = goal.horizon === 'shortTerm'
    ? [
        '- `shortTerm` (Target Horizon — Direct Fulfillment): ALL 2–4 routes MUST resolve and fulfill this exact target outcome by their final beat (`beats[last]`) and `summary` within 2–5 turns, diverging ONLY in tactical approach, interpersonal angle, or risk/trade-off while respecting `<latest_scene_snapshot>`. (If `<recent_story>` shows the goal has already been achieved, focus `shortTerm` on consolidating and realizing its immediate payoff.)',
        '- `midTerm` (Downstream Continuation): ALL routes MUST treat the fulfillment of this short-term target outcome as their established causal starting point and build subsequent chapter arcs forward from it.',
        '- `longTerm` (Macro Continuation): ALL routes MUST project ultimate destinies forward on the premise that this short-term outcome succeeded.'
      ]
    : goal.horizon === 'midTerm'
      ? [
          '- `shortTerm` (Immediate Stepping Stones): ALL 2–4 routes MUST serve as 2–5 turn opening moves from `<latest_scene_snapshot>` (gathering leverage, breaking immediate blockers, or initiating the relationship/plot shift) that steer directly into achieving the mid-term target.',
          '- `midTerm` (Target Horizon — Chapter Culmination): ALL 2–4 routes MUST culminate in fulfilling this exact target outcome by their final milestone (`milestones[last]`) and `summary`, offering distinct chapter-scale paths/strategies to reach the SAME target result.',
          '- `longTerm` (Post-Goal Destiny): ALL routes MUST treat the fulfilled mid-term target outcome as an achieved `prerequisite` and extend macro-endings forward without undoing or contradicting it.'
        ]
      : [
          '- `shortTerm` (Opening Momentum): ALL 2–4 routes MUST initiate concrete causal momentum from `<latest_scene_snapshot>` toward the mid-term bridges needed for this long-term goal.',
          '- `midTerm` (Chapter Bridges): ALL 2–4 routes MUST act as chapter-scale stepping stones building the alliances, revelations, resources, or turning points required to reach this long-term target outcome.',
          '- `longTerm` (Target Horizon — Endgame Fulfillment): ALL 2–4 routes\' `vision` MUST achieve and realize this exact long-term target outcome (diverging ONLY in tone, cost, or specific realization form—NEVER offering endings that fail, invert, or abandon the goal).'
        ]

  return [
    `Active Goal-Oriented Mode: ENABLED`,
    `Target Horizon (${horizonLabel}): ${horizonSpan}`,
    `Locked Target Outcome (MUST STEER TOWARD & ACHIEVE): ${goal.text}`,
    'Mandatory Plot-Tree Convergence Rules:',
    ...alignmentLines,
    '- Strictly FORBID routes that abandon, oppose, fail, or drift away from the Locked Target Outcome. Differentiate routes via contrasting tactics/paths (`HOW`), NOT opposing destinations (`WHAT`).'
  ].join('\n')
}
function normalizeLedger(raw) {
  const src = object(raw) || {}
  const npcs = (Array.isArray(src.npcs) ? src.npcs : [])
    .filter(n => n && str(n.name).trim())
    .map(n => ({ name: str(n.name).trim(), relation: str(n.relation).trim(), condition: str(n.condition).trim() }))
  const items = (Array.isArray(src.items) ? src.items : [])
    .filter(i => i && str(i.name).trim())
    .map(i => ({ name: str(i.name).trim(), desc: str(i.desc).trim() }))
  return {
    location: str(src.location).trim(),
    npcs,
    items
  }
}

function extractVariablesSnapshot({ variables, chat } = {}) {
  const direct = object(variables)
  if (direct) {
    return object(direct.stat_data) || direct
  }
  const chatVars = object(chat?.variables)
  if (chatVars) {
    return object(chatVars.stat_data) || chatVars
  }
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== 'assistant') continue
    const list = Array.isArray(msg.variables) ? msg.variables : []
    const entry = object(list[Math.max(0, Number(msg.swipeId) || 0)]) || object(msg.variables)
    if (entry) return object(entry.stat_data) || entry
  }
  return null
}

const PASSIVE_CONSTRAINT_RE = /囚禁|关押|软禁|挟持|被擒|捆绑|束缚|锁链|铁链|镣铐|手铐|重伤|昏迷|晕倒|濒死|动弹不得|瘫痪|无力反抗|受制|押解|监禁|restrained|bound|imprisoned|captive|unconscious|paralyzed|incapacitated|cornered/i

/**
 * 提取最新回合末尾定格、现场地点、姿态与被动受限信号，避免长文截断导致地点或约束失真。
 */
export function extractSceneFreezeSnapshot(input) {
  const messages = Array.isArray(input?.messages) ? input.messages : []
  let latestAssistant = null
  let latestUser = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue
    const raw = str(msg.sourceText ?? msg.text).trim()
    if (!raw) continue
    if (!latestAssistant && msg.role === 'assistant') {
      latestAssistant = { turn: Number(msg.turn) || 0, text: raw }
    } else if (!latestUser && msg.role === 'user') {
      latestUser = { turn: Number(msg.turn) || 0, text: raw }
    }
    if (latestAssistant && latestUser) break
  }

  const posture = str(input?.posture).trim()
  const ledger = normalizeLedger(input?.ledger)
  const parts = []
  if (posture) parts.push(`当前现场姿态 / 处境（Posture）：\n${posture.slice(0, 600)}`)
  if (ledger.location) parts.push(`当前地点：${ledger.location}`)
  if (ledger.npcs.length > 0) {
    parts.push(`已知在场 / 关联人物：${ledger.npcs.slice(0, 8).map(n => `${n.name}${n.condition ? `（${n.condition}）` : ''}`).join('、')}`)
  }
  if (ledger.items.length > 0) {
    parts.push(`当前随身物品 / 关键线索：${ledger.items.slice(0, 8).map(i => i.name).join('、')}`)
  }
  if (latestUser) {
    const tailUser = latestUser.text.length > 220 ? '…' + latestUser.text.slice(-220) : latestUser.text
    parts.push(`玩家上一轮行动（第${latestUser.turn || '?'}轮）：${tailUser}`)
  }
  if (latestAssistant) {
    const tailAssistant = latestAssistant.text.length > 520 ? '…' + latestAssistant.text.slice(-520) : latestAssistant.text
    parts.push(`最新正文末尾定格（第${latestAssistant.turn || '?'}轮收尾状态）：\n${tailAssistant}`)
  }

  const probeSource = [
    posture,
    ledger.location,
    ledger.npcs.map(n => `${n.name} ${n.condition}`).join(' '),
    latestAssistant ? latestAssistant.text.slice(-600) : ''
  ].join('\n')
  const passiveConstraint = PASSIVE_CONSTRAINT_RE.test(probeSource)
  if (passiveConstraint) {
    parts.push('⚠ 处境约束提示：检测到主角当前处于受困 / 受制 / 重伤 / 昏迷或无法自由离场的被动局面，近期路线（shortTerm）必须围绕「被动承接 / 暗中观察拖延 / 外部变量破局」分化，禁止凭空生成自由离场路线！')
  }

  return {
    passiveConstraint,
    text: parts.join('\n\n')
  }
}

/**
 * 组装供剧情罗盘推演使用的紧凑高信噪比上下文素材。
 */
export function buildPlotCompassMaterial({
  chat,
  card,
  messages: explicitMessages,
  variables: explicitVariables,
  posture: explicitPosture,
  ledger: explicitLedger,
  guides: explicitGuides,
  compass: explicitCompass,
  worldbookEntries = [],
  constantWorldbookText = '',
  activatedWorldbookTitles = [],
  scriptWindow = null,
  scope = 'all',
  guidance = '',
  includeRequest = true,
  fresh = false
}) {
  const compass = readPlotCompass(explicitCompass ?? chat?.plotCompass)
  const messages = Array.isArray(explicitMessages) ? explicitMessages : (Array.isArray(chat?.messages) ? chat.messages : [])
  const posture = explicitPosture !== undefined ? str(explicitPosture) : str(chat?.posture)
  const ledgerRaw = explicitLedger !== undefined ? explicitLedger : chat?.ledger
  const guidesRaw = explicitGuides !== undefined ? explicitGuides : chat?.guides
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

  const dormantHooks = extractDormantWorldbookHooks(worldbookEntries, {
    ...(chat || {}),
    activatedWorldbookTitles
  }, { limit: 8 })
  if (dormantHooks.length > 0) {
    const hookLines = dormantHooks.map((hook, index) =>
      `${index + 1}. [${hook.title}]${hook.keys.length ? ` (triggers: ${hook.keys.join(', ')})` : ''}: ${hook.snippet}`
    ).join('\n')
    blocks.push(promptSection('dormant_worldbook_hooks',
      'Untriggered lore entries hidden in this card\'s worldbook (turn 1–2 of the most fitting ones into mysterious Teaser Hooks without spoiling secret twists outright):\n' + hookLines))
  }

  const activeGoal = activePlotCompassGoal(compass)

  if (scriptWindow && Array.isArray(scriptWindow.chunks) && scriptWindow.chunks.length > 0) {
    const scriptText = scriptWindow.chunks.map(chunk => `[${chunk.id}]\n${str(chunk.text).slice(0, 1200)}`).join('\n\n')
    const scriptRule = activeGoal
      ? 'Player Goal-Oriented Mode is active: align ALL routes toward `<player_goal>` (adapt or override canonical script beats whenever they conflict with the player\'s locked target outcome)'
      : 'Offer BOTH canonical script-aligned routes (sourceHook="原著主线") AND 1–2 creative What-If divergence routes (sourceHook="IF偏离")'
    blocks.push(promptSection('script_context',
      `Bound Script Mode (cursor ${Math.min((scriptWindow.cursor || 0) + 1, scriptWindow.total || 1)} / ${scriptWindow.total || 1}). ${scriptRule}:\n` + scriptText))
  }

  const freezeSnapshot = extractSceneFreezeSnapshot({ messages, posture, ledger: ledgerRaw })
  if (freezeSnapshot.text) {
    blocks.push(promptSection('latest_scene_snapshot', freezeSnapshot.text))
  }

  const stateParts = []
  if (posture) stateParts.push(`Current Posture / Scene State:\n${posture.slice(0, 1200)}`)
  const vars = extractVariablesSnapshot({ variables: explicitVariables, chat })
  if (vars && Object.keys(vars).length > 0) {
    stateParts.push(`Current MVU Variables (stat_data):\n${JSON.stringify(vars).slice(0, 3500)}`)
  }
  const ledger = normalizeLedger(ledgerRaw)
  if (ledger.location || ledger.npcs.length || ledger.items.length) {
    stateParts.push(`Story Ledger Snapshot:\n${JSON.stringify({
      location: ledger.location,
      npcs: ledger.npcs.slice(0, 8),
      items: ledger.items.slice(0, 10)
    })}`)
  }
  const guides = (Array.isArray(guidesRaw) ? guidesRaw : []).map(g => str(typeof g === 'string' ? g : g?.text).trim()).filter(Boolean)
  if (guides.length > 0) {
    stateParts.push('Player Active Guides:\n' + guides.map((g, i) => `${i + 1}. ${g}`).join('\n'))
  }
  if (stateParts.length > 0) blocks.push(promptSection('settled_state', stateParts.join('\n\n')))

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

  if (activeGoal) {
    blocks.push(promptSection('player_goal', buildGoalOrientationText(activeGoal)))
  }

  if (!fresh && (compass.shortTerm.length || compass.midTerm.length || compass.longTerm.length || compass.customArchetypes.length)) {
    blocks.push(promptSection('existing_plot_compass', JSON.stringify({
      refreshScope: scope,
      ...(activeGoal ? { activeGoal } : {}),
      playerCustomArchetypes: compass.customArchetypes,
      previousPlayArchetypes: compass.playArchetypes,
      pinned: compass.pinned,
      shortTerm: compass.shortTerm,
      midTerm: compass.midTerm,
      longTerm: compass.longTerm
    })))
  }

  if (includeRequest) {
    const goalHorizonLabel = activeGoal ? (PLOT_COMPASS_GOAL_HORIZON_LABELS[activeGoal.horizon] || '短期') : ''
    const maxRoutes = compass.maxRoutes || PLOT_COMPASS_DEFAULT_MAX_ROUTES
    const minRoutes = Math.min(2, maxRoutes)
    const routeLimitLine = maxRoutes === 1
      ? 'Per-horizon route count limit: generate exactly 1 focused route for each requested horizon (do NOT exceed 1).'
      : `Per-horizon route count limit: generate ${minRoutes}–${maxRoutes} distinct routes per requested horizon (at most ${maxRoutes} routes per horizon; aim for up to ${maxRoutes} genuinely distinct directions).`
    const requestLines = [
      fresh
        ? (activeGoal
          ? 'This is a FRESH REBUILD explicitly requested by the player while `<player_goal>` is active: discard earlier routes and derive brand-new tactical paths from current story facts, worldbook hooks, and variables—ensuring EVERY new route across the plot tree steers toward and fulfills `<player_goal>`!'
          : 'This is a FRESH REBUILD explicitly requested by the player: no previous compass board is provided on purpose. Do NOT reconstruct, rename or echo any earlier route, ticked beat or pinned direction mentioned in the story text; derive brand-new diverging directions only from current story facts, play archetypes, worldbook hooks and variables.')
        : '',
      `Target refresh scope: "${scope}" (${scope === 'all'
        ? 'generate or evolve all 3 horizons: shortTerm, midTerm, longTerm'
        : activeGoal
          ? `focus fresh tactical routes on "${scope}" that steer toward <player_goal> while keeping the other two horizons consistent`
          : `focus fresh divergent routes on "${scope}" while keeping the other two horizons consistent`}).`,
      routeLimitLine,
      activeGoal
        ? `MANDATORY GOAL ORIENTATION [${goalHorizonLabel} · ${activeGoal.horizon}]: The entire generated plot tree MUST steer toward and achieve the player's target outcome — "${activeGoal.text}". Branch across different tactics/approaches/costs, NEVER across opposing outcomes that fail or abandon this goal!`
        : '',
      compass.customArchetypes.length > 0
        ? `Player-specified Play Archetypes (MUST honor and build routes around these): ${compass.customArchetypes.join('、')}`
        : 'Infer 1–3 accurate Play Archetypes from the card, worldbook, variables, and story tone.',
      guidance.trim() ? `Extra player inspiration request / guidance:\n${guidance.trim().slice(0, 800)}` : '',
      'Call `plot_compass_submit` now with complete, concrete, inspiring multi-route plans.'
    ].filter(Boolean)
    blocks.push(promptSection('plot_compass_request', requestLines.join('\n\n')))
  }

  return blocks.join('\n\n')
}

export const PLOT_COMPASS_BRAINSTORM_SYSTEM = [
  'You are the Plot Compass Story Co-pilot (剧情罗盘策划搭档) for an interactive story game.',
  'Your role is to brainstorm plot directions, character motives, twists, and pacing ideas WITH the player—strictly respecting `<latest_scene_snapshot>`, `<card_profile>`, `<settled_state>`, `<dormant_worldbook_hooks>`, and `<player_goal>` (when present).',
  'Interaction Rules (Mode A - Safe Discussion First):',
  '1) DEFAULT TO DISCUSSION: By default, do NOT overwrite existing routes on the compass board. Reply directly in concise, vivid Simplified Chinese (or the story\'s language) with 2–3 concrete, causally plausible dramatic angles, key risks/hooks, and a short prompt inviting the player to refine or apply the idea.',
  '2) ONLY CALL `plot_compass_submit` WHEN EXPLICITLY REQUESTED: Call `plot_compass_submit` ONLY if the player clearly asks you in this turn to generate, rewrite, replace, or update compass routes (e.g. "按第2条生成今期路线" / "帮我重新生成中期方向" / "把这套思路落盘成新路线").',
  '3) SCOPED UPDATES & OPEN-INTENT BEATS: When calling `plot_compass_submit`, set `targetScope` accurately (`shortTerm`, `midTerm`, `longTerm`, or `all`) so unmentioned horizons stay untouched, and respect the configured per-horizon route count limit (default up to 4). Write `beats` / `milestones` as concise 10–22 char dramatic state shifts rather than rigid micro-actions so per-turn choices retain creative freedom. Never fabricate deus ex machina teleportation or break passive constraints.',
  '4) GOAL-ORIENTED CONVERGENCE: Whenever `<player_goal>` is active, both your brainstorming angles and any routes submitted via `plot_compass_submit` MUST steer toward and achieve the player\'s locked target outcome (differentiating by tactics and paths rather than opposing endings), unless the player explicitly asks to change the goal.',
  '5) AFTER TOOL CALL: After `plot_compass_submit` succeeds, still reply with a brief natural-language confirmation summarizing what changed so the player can review it right in the chat.'
].join('\n')

export function buildPlotCompassBrainstormPrompt(params) {
  const { compass: explicitCompass, chat, message = '' } = params
  const compass = readPlotCompass(explicitCompass ?? chat?.plotCompass)
  const base = buildPlotCompassMaterial({
    ...params,
    compass,
    scope: 'chat',
    includeRequest: false
  })
  const historyLines = compass.chatHistory.map(item =>
    `[${item.role === 'user' ? '玩家' : '罗盘助手'}${item.scopeApplied ? ` · 已更新${item.scopeApplied}` : ''}]\n${item.text}`
  )
  const blocks = [base]
  if (historyLines.length > 0) {
    blocks.push(promptSection('brainstorm_conversation', historyLines.join('\n\n')))
  }
  const latestText = decodeLiteralUnicodeEscapes(str(message)).trim().slice(0, 800)
  if (latestText) {
    const maxRoutes = compass.maxRoutes || PLOT_COMPASS_DEFAULT_MAX_ROUTES
    const limitHint = maxRoutes === 1
      ? 'If calling `plot_compass_submit`, provide 1 route per updated horizon.'
      : `If calling \`plot_compass_submit\`, provide ${Math.min(2, maxRoutes)}–${maxRoutes} distinct routes per updated horizon (at most ${maxRoutes}).`
    blocks.push(promptSection('latest_brainstorm_message', `Player says now:\n${latestText}\n\nRespond as the Story Co-pilot (discuss ideas by default; call \`plot_compass_submit\` only if the player explicitly asks to generate/update routes now. ${limitHint})`))
  }
  return blocks.filter(Boolean).join('\n\n')
}

export const PLOT_COMPASS_PROGRESS_SYSTEM = [
  'You are a strict story-beat progress & premise-validity verifier for an interactive story.',
  'Given the recent story text, pending plot beats / milestones, and active routes:',
  '1) Identify ONLY the beats/milestones that have ALREADY concretely happened or been achieved in the assistant story prose (`completed`), AND quote a verbatim 6–30 character excerpt from the assistant prose (`evidence`) proving each completed step.',
  '2) Identify ONLY routes whose core premise or causal foundation has been IRREVERSIBLY INVALIDATED / bypassed by the player\'s actual actions or settled events (`lapsed`), e.g. the player left the city or openly attacked the ally that an infiltration route depended on.',
  'Rules:',
  '- DRAMATIC EQUIVALENCE: Beats and milestones describe dramatic outcomes or state shifts rather than rigid choreography. If the characters achieved the SAME core narrative shift, revelation, or relationship turn through a different creative tactic or phrasing in the assistant prose, mark it `completed` and quote the verbatim prose `evidence` proving that outcome occurred.',
  '- Player intentions, thoughts, OOC planning, or unfulfilled promises that have NOT actually played out in the assistant story prose do NOT count as `completed`.',
  '- Every item in `completed` MUST have concrete verbatim `evidence` copied directly from `<recent_story_turns>` assistant prose (NOT from `<thinking>`, variable updates, or user wishes). If you cannot find verbatim prose evidence, do NOT mark it completed.',
  '- Do NOT mark a route as `lapsed` merely because it has not happened yet or progresses slowly; mark `lapsed` ONLY when its core premise is now contradictory or impossible.',
  '- Output ONLY a single valid JSON object with no extra commentary: {"completed":[{"key":"<key>","evidence":"<verbatim prose excerpt>"}],"lapsed":[{"horizon":"shortTerm"|"midTerm","routeId":"<id>","reason":"<brief reason>"}]} (use [] when empty).'
].join('\n')

const GROUNDING_STRIP_BLOCK_RE = /<(?:thinking|thought|konatan_planning|draft_notes|logic_check|UpdateVariable|JSONPatch|mvu_update|analysis)\b[^>]*>[\s\S]*?<\/(?:thinking|thought|konatan_planning|draft_notes|logic_check|UpdateVariable|JSONPatch|mvu_update|analysis)>|<!--[\s\S]*?-->/gi
const GROUNDING_NOISE_RE = /[\s\p{P}\p{S}]+/gu

export function extractStoryProseForGrounding(text) {
  return str(text)
    .replace(GROUNDING_STRIP_BLOCK_RE, ' ')
    .replace(/<[^>]{1,40}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function collectAssistantProseForGrounding(messagesOrChat, { maxMessages = 4 } = {}) {
  const messages = Array.isArray(messagesOrChat)
    ? messagesOrChat
    : (Array.isArray(messagesOrChat?.messages) ? messagesOrChat.messages : [])
  const chunks = []
  for (let i = messages.length - 1; i >= 0 && chunks.length < maxMessages; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== 'assistant') continue
    const cleaned = extractStoryProseForGrounding(msg.sourceText ?? msg.text)
    if (cleaned) chunks.unshift(cleaned)
  }
  return chunks.join('\n')
}

function normalizeGroundingStr(value) {
  return str(value).toLowerCase().replace(GROUNDING_NOISE_RE, '')
}

/**
 * 校验核验器给出的证据引句是否真实存在于剥离思维链与变量块后的助手正文中。
 */
export function verifyCompassEvidenceInText(proseText, evidence) {
  const normProse = normalizeGroundingStr(extractStoryProseForGrounding(proseText))
  const rawEvidence = str(evidence).trim()
  const normEvidence = normalizeGroundingStr(rawEvidence)
  if (!normProse || normEvidence.length < 4) return false
  if (normProse.includes(normEvidence)) return true
  const clauses = rawEvidence
    .split(/[\n\r，。！？；：、…—,.!?;:\-]+/)
    .map(part => normalizeGroundingStr(part))
    .filter(part => part.length >= 6)
  return clauses.length > 0 && clauses.some(clause => normProse.includes(clause))
}

export function collectPendingCompassSteps(compassRaw) {
  const compass = readPlotCompass(compassRaw)
  const pending = []
  for (const [horizon, stepField] of [['shortTerm', 'beats'], ['midTerm', 'milestones']]) {
    const pinnedId = compass.pinned[horizon]
    const ordered = [...compass[horizon]].sort((a, b) => Number(b.id === pinnedId) - Number(a.id === pinnedId))
    for (const route of ordered) {
      const steps = Array.isArray(route[stepField]) ? route[stepField] : []
      for (let idx = 0; idx < steps.length; idx++) {
        if (steps[idx]?.done) continue
        pending.push({
          key: `${horizon}:${route.id}:${idx}`,
          horizon,
          routeId: route.id,
          routeTitle: route.title,
          pinned: route.id === pinnedId,
          stepIndex: idx,
          text: steps[idx].text
        })
      }
    }
  }
  return pending
}

export function collectTrackableCompassRoutes(compassRaw) {
  const compass = readPlotCompass(compassRaw)
  const routes = []
  for (const horizon of ['shortTerm', 'midTerm']) {
    const pinnedId = compass.pinned[horizon]
    for (const route of compass[horizon]) {
      routes.push({
        horizon,
        routeId: route.id,
        title: route.title,
        summary: route.summary,
        causalBasis: route.causalBasis || '',
        pinned: route.id === pinnedId
      })
    }
  }
  return routes
}

export function buildPlotCompassProgressPrompt(messagesOrChat, pendingSteps, { fromTurn = 0, compass = null } = {}) {
  const messages = Array.isArray(messagesOrChat)
    ? messagesOrChat
    : (Array.isArray(messagesOrChat?.messages) ? messagesOrChat.messages : [])
  const turnBlocks = []
  for (let i = messages.length - 1; i >= 0 && turnBlocks.length < 6; i--) {
    const msg = messages[i]
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue
    const turn = Number(msg.turn) || 0
    if (fromTurn > 0 && turn > 0 && turn < fromTurn && turnBlocks.length >= 2) break
    const rawText = msg.role === 'assistant'
      ? extractStoryProseForGrounding(msg.sourceText ?? msg.text)
      : str(msg.sourceText ?? msg.text).trim()
    if (!rawText) continue
    const clipped = rawText.length > 2400 ? rawText.slice(0, 1200) + '\n…\n' + rawText.slice(-1200) : rawText
    turnBlocks.unshift(`[${msg.role === 'user' ? '玩家' : '正文'} · 第${turn || '?'}轮]\n${clipped}`)
  }
  const stepLines = pendingSteps.map(item =>
    `- key="${item.key}" (${item.horizon === 'shortTerm' ? '今期节拍' : '中期里程碑'} · 路线「${item.routeTitle}」${item.pinned ? ' [玩家当前点亮]' : ''}): ${item.text}`
  ).join('\n')

  const trackableRoutes = compass
    ? collectTrackableCompassRoutes(compass)
    : Array.from(new Map(pendingSteps.map(item => [`${item.horizon}:${item.routeId}`, {
        horizon: item.horizon,
        routeId: item.routeId,
        title: item.routeTitle,
        summary: '',
        causalBasis: '',
        pinned: item.pinned
      }])).values())
  const routeLines = trackableRoutes.map(r =>
    `- horizon="${r.horizon}" routeId="${r.routeId}"${r.pinned ? ' [玩家当前点亮]' : ''}: 「${r.title}」${r.causalBasis ? ` | 因果前提: ${r.causalBasis}` : (r.summary ? ` | 简述: ${r.summary}` : '')}`
  ).join('\n')

  const sections = [
    promptSection('recent_story_turns', turnBlocks.join('\n\n')),
    promptSection('pending_steps', stepLines)
  ]
  if (routeLines) sections.push(promptSection('active_routes', routeLines))
  sections.push('Return strictly JSON: {"completed":[{"key":"...","evidence":"verbatim prose excerpt"}],"lapsed":[{"horizon":"shortTerm","routeId":"...","reason":"..."}]}')
  return sections.join('\n\n')
}

export function parsePlotCompassProgressOutcome(rawText, validKeys, validRoutes = [], options = {}) {
  const parsed = parseJsonLenient(rawText)
  const list = Array.isArray(parsed.completed) ? parsed.completed : []
  const allowed = new Set(validKeys)
  const proseText = typeof options?.proseText === 'string' ? options.proseText : ''
  const hasProseToVerify = proseText.trim().length > 0
  const requireEvidence = options?.requireEvidence === true

  const completed = []
  const seenKeys = new Set()
  const rejectedCompleted = []

  for (const item of list) {
    const isObj = Boolean(item && typeof item === 'object' && !Array.isArray(item))
    const key = str(isObj ? (item.key ?? item.stepKey ?? item.id) : item).trim()
    if (!key || !allowed.has(key) || seenKeys.has(key)) continue
    const evidence = isObj ? str(item.evidence ?? item.quote ?? item.excerpt).trim() : ''

    if (hasProseToVerify && (isObj || requireEvidence)) {
      if (!evidence || !verifyCompassEvidenceInText(proseText, evidence)) {
        rejectedCompleted.push({ key, evidence, reason: evidence ? 'evidence_not_grounded_in_prose' : 'missing_evidence' })
        continue
      }
    }
    seenKeys.add(key)
    completed.push(key)
  }

  const routeMap = new Map()
  for (const r of validRoutes) {
    if (r?.horizon && r?.routeId) routeMap.set(`${r.horizon}:${r.routeId}`, r)
  }
  const lapsed = []
  const seenRoutes = new Set()
  const rawLapsed = Array.isArray(parsed.lapsed) ? parsed.lapsed : []
  for (const entry of rawLapsed) {
    const obj = object(entry)
    if (!obj) continue
    const horizon = obj.horizon === 'midTerm' ? 'midTerm' : (obj.horizon === 'shortTerm' ? 'shortTerm' : '')
    const routeId = str(obj.routeId || obj.id).trim()
    const key = `${horizon}:${routeId}`
    if (!horizon || !routeId || seenRoutes.has(key)) continue
    if (routeMap.size > 0 && !routeMap.has(key)) continue
    seenRoutes.add(key)
    lapsed.push({
      horizon,
      routeId,
      reason: cleanText(obj.reason || obj.note || '玩家行动已改写原定前提', { maxLength: 100 })
    })
  }
  return {
    completed,
    lapsed,
    ...(rejectedCompleted.length > 0 ? { rejectedCompleted } : {})
  }
}

export function parsePlotCompassProgressResponse(rawText, validKeys, options = {}) {
  return parsePlotCompassProgressOutcome(rawText, validKeys, [], options).completed
}

export function applyPlotCompassAutoProgress(previousRaw, completedOrOutcome, { turn = 0, now = Date.now() } = {}) {
  const next = readPlotCompass(previousRaw)
  const prevCheckedTurn = Math.max(next.basedOnTurn || 0, next.lastCheckedTurn || 0)
  const completedList = Array.isArray(completedOrOutcome)
    ? completedOrOutcome
    : (Array.isArray(completedOrOutcome?.completed) ? completedOrOutcome.completed : [])
  const lapsedInput = Array.isArray(completedOrOutcome)
    ? []
    : (Array.isArray(completedOrOutcome?.lapsed) ? completedOrOutcome.lapsed : [])
  const keySet = new Set(completedList)
  let newlyCompletedCount = 0
  let pinnedShortTouched = false

  for (const [horizon, stepField] of [['shortTerm', 'beats'], ['midTerm', 'milestones']]) {
    for (const route of next[horizon]) {
      const steps = Array.isArray(route[stepField]) ? route[stepField] : []
      for (let idx = 0; idx < steps.length; idx++) {
        const key = `${horizon}:${route.id}:${idx}`
        if (keySet.has(key) && !steps[idx].done) {
          steps[idx] = { ...steps[idx], done: true }
          newlyCompletedCount++
          if (horizon === 'shortTerm' && next.pinned.shortTerm === route.id) pinnedShortTouched = true
        }
      }
    }
  }

  const lapsedRoutes = []
  let pinnedShortLapsed = false
  let lapsedPinnedShortTitle = ''
  let lapsedPinnedShortReason = ''
  const resolvedTurn = Math.max(0, Number(turn) || 0)

  for (const entry of lapsedInput) {
    const horizon = entry?.horizon === 'midTerm' ? 'midTerm' : (entry?.horizon === 'shortTerm' ? 'shortTerm' : '')
    const routeId = str(entry?.routeId).trim()
    if (!horizon || !routeId) continue
    const idx = next[horizon].findIndex(r => r.id === routeId)
    if (idx < 0) continue
    const [removed] = next[horizon].splice(idx, 1)
    const reasonText = cleanText(entry?.reason || '玩家行动已改写原定前提', { maxLength: 100 })
    const wasPinned = next.pinned[horizon] === routeId
    if (wasPinned) next.pinned[horizon] = null
    if (horizon === 'shortTerm' && wasPinned) {
      pinnedShortLapsed = true
      lapsedPinnedShortTitle = removed.title
      lapsedPinnedShortReason = reasonText
    }
    next.archived = [...next.archived, {
      horizon,
      title: removed.title,
      reason: `前提失效：${reasonText}`,
      turn: resolvedTurn
    }].slice(-MAX_ARCHIVED)
    lapsedRoutes.push({ horizon, routeId, title: removed.title, reason: reasonText, wasPinned })
  }

  next.lastCheckedTurn = Math.max(next.lastCheckedTurn || 0, resolvedTurn)
  const pinnedShortRoute = next.pinned.shortTerm
    ? next.shortTerm.find(r => r.id === next.pinned.shortTerm) || null
    : null
  const pinnedShortHasPending = Boolean(
    pinnedShortRoute &&
    Array.isArray(pinnedShortRoute.beats) &&
    pinnedShortRoute.beats.some(step => !step.done)
  )
  const prevStalled = next.stalledTurns || 0
  if (!pinnedShortRoute || !pinnedShortHasPending || pinnedShortTouched || pinnedShortLapsed) {
    next.stalledTurns = 0
  } else if (resolvedTurn > prevCheckedTurn) {
    next.stalledTurns = Math.min(99, prevStalled + 1)
  }
  if (newlyCompletedCount > 0 || lapsedRoutes.length > 0 || next.stalledTurns !== prevStalled) {
    next.updatedAt = now
  }

  const pinnedShortCompleted = Boolean(
    pinnedShortTouched &&
    pinnedShortRoute &&
    Array.isArray(pinnedShortRoute.beats) &&
    pinnedShortRoute.beats.length > 0 &&
    pinnedShortRoute.beats.every(step => step.done === true)
  )

  return {
    compass: next,
    newlyCompletedCount,
    newlyLapsedCount: lapsedRoutes.length,
    lapsedRoutes,
    pinnedShortCompleted,
    completedPinnedShortTitle: pinnedShortCompleted ? pinnedShortRoute.title : '',
    pinnedShortLapsed,
    lapsedPinnedShortTitle,
    lapsedPinnedShortReason
  }
}
