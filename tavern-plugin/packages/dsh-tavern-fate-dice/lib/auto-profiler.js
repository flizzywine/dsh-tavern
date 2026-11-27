/**
 * auto-profiler —— 角色能力自动推演器
 *
 * 设计目标：玩家不再需要手动维护 18 项技能数值与加值预算。
 * 主角的能力修正完全由 LLM 依据【正文 + 角色卡/人设 + 世界书 + MVU 变量】自动推演，
 * 并随后台结算（settlementTool / onTurnSettled）动态演进。
 *
 * 核心概念：标准能力阶梯 tier ∈ [-3, +3]，按当前骰制等比换算为检定加值 bonus。
 */

export const TIER_MIN = -3
export const TIER_MAX = 3
export const MAX_DIGEST_CHARS = 2200
export const MAX_MVU_ITEMS = 24
/** 能力档位评测标准（供阻尼器合并题与独立判定共用）。 */
export const CAPABILITY_CRITERIA = Object.freeze([
  '0: 严重受限或明显短板（外行、设定不擅长、重伤虚弱或境界被碾压）',
  '1: 生疏勉强或状态欠佳（非擅长领域、疲惫或轻微受制）',
  '2: 常规普通水准（设定无特殊偏向、状态正常）',
  '3: 训练有素或状态充沛（贴合角色职业特长、持有合适装备或属性占优）',
  '4: 核心看家本领或显著压制（角色标志性专精、世界书高阶位格或状态巅峰）'
])

export const PROFILE_TRAIT_SOURCES = Object.freeze(['角色卡', '世界书', 'MVU', '正文', '综合'])

export const SKILL_CATEGORIES = Object.freeze({
  physical: Object.freeze({ label: '体魄', hidden: false }),
  stealth: Object.freeze({ label: '潜行', hidden: false }),
  social: Object.freeze({ label: '说服', hidden: false }),
  insight: Object.freeze({ label: '察觉', hidden: true }),
  arcana: Object.freeze({ label: '技艺', hidden: false }),
  will: Object.freeze({ label: '意志', hidden: false })
})

export function findMatchingSkill(skills, keyOrName) {
  const key = String(keyOrName || '').trim()
  const list = Array.isArray(skills) ? skills : []
  const fallback = { id: 'general', name: key || '行动', bonus: 0, category: 'physical', hidden: false }
  if (!key || !list.length) return fallback
  const lower = key.toLowerCase()
  const hit = list.find(s => String(s?.id || '').toLowerCase() === lower)
    || list.find(s => String(s?.name || '') === key)
    || list.find(s => {
      const n = String(s?.name || '').toLowerCase()
      const id = String(s?.id || '').toLowerCase()
      return (n && (n.includes(lower) || lower.includes(n))) || (id && (id.includes(lower) || lower.includes(id)))
    })
  return hit ? { ...hit } : fallback
}

const MVU_MAX_ITEMS = MAX_MVU_ITEMS
const LORE_ITEM_CHARS = 220
const HISTORY_ITEM_CHARS = 260
const CARD_CHARS = 420

function toInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

/** 与规范书写顺序一致：clamp(min, max, value)。 */
function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value))
}

function clip(text, limit) {
  const str = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim()
  return str.length > limit ? `${str.slice(0, limit)}…` : str
}

/** 标准能力阶梯 → 当前骰制下的检定加值。 */
export function tierToRuleBonus(tier, rule = '2d6') {
  const t = clamp(TIER_MIN, TIER_MAX, toInt(tier, 0))
  switch (String(rule || '2d6')) {
    case 'd10':
      return clamp(-3, 6, Math.round(t * 1.5))
    case 'd20':
      return clamp(-6, 9, t * 2)
    case 'd100':
      return clamp(-30, 45, t * 10)
    case '2d6':
    default:
      return clamp(-3, 3, t)
  }
}

const MVU_PRIORITY_HIGH = /力量|敏捷|感知|知识|魅力|魔力|信仰|智力|体质|意志|幸运|耐力|武艺|生命|血量|体力|精力|护甲|防御|理智|架势|伤势|受伤|重伤|中毒|疲劳|虚弱|境界|等级|阶级|实力|位格|level|rank|hp|mp|sp|san|str|dex|con|int|wis|cha|armor|wound|fatigue|injury/i
const MVU_PRIORITY_MID = /武器|防具|装备|饰品|技能|专长|天气|气候|时段|地形|地点|所在地|环境|警戒|警觉|关系|信任|好感|防线|张力|压力|buff|debuff|status|weather|location|stance|guard|trust/i
const MVU_NOISE_KEY = /(?:^|[._])(id|uuid|hash|timestamp|createdAt|updatedAt|avatar|icon|url|version)$/i

function scoreMvuEntry(pathStr, keyStr) {
  const combined = `${pathStr} ${keyStr}`
  if (MVU_NOISE_KEY.test(keyStr)) return 0
  if (MVU_PRIORITY_HIGH.test(combined)) return 100
  if (MVU_PRIORITY_MID.test(combined)) return 60
  return 10
}

/** 递归扫描 MVU 变量，按跑团关键度提权采样，抽取属性/伤势/环境键值对与紧凑摘要。 */
export function summarizeMvuVariables(variables) {
  const source = variables && typeof variables === 'object'
    ? (variables.stat_data && typeof variables.stat_data === 'object' ? variables.stat_data : variables)
    : null
  const collected = []
  if (!source) return { entries: [], highlights: [], summary: '', keyCount: 0, environmentCues: [] }

  const walk = (node, prefix, depth) => {
    if (!node || typeof node !== 'object' || depth > 4 || collected.length >= 120) return
    for (const [rawKey, value] of Object.entries(node)) {
      if (collected.length >= 120) return
      const key = String(rawKey)
      if (!key || key.startsWith('$')) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object') {
        walk(value, path, depth + 1)
        continue
      }
      if (value === null || value === undefined) continue
      const score = scoreMvuEntry(path, key)
      if (typeof value === 'boolean') {
        collected.push({ key: key.slice(0, 40), path: path.slice(0, 80), value, score, depth })
        continue
      }
      if (typeof value === 'number') {
        collected.push({ key: key.slice(0, 40), path: path.slice(0, 80), value, score, depth })
        continue
      }
      const str = String(value).trim()
      if (!str) continue
      if (/^-?\d+(\.\d+)?$/.test(str) && str.length <= 24) {
        collected.push({ key: key.slice(0, 40), path: path.slice(0, 80), value: Number(str), score, depth })
        continue
      }
      if (str.length > 80) continue
      collected.push({ key: key.slice(0, 40), path: path.slice(0, 80), value: clip(str, 60), score, depth })
    }
  }
  walk(source, '', 0)

  const ranked = collected
    .map((item, idx) => ({ ...item, idx }))
    .sort((a, b) => (b.score - a.score) || (a.depth - b.depth) || (a.idx - b.idx))
    .slice(0, MVU_MAX_ITEMS)
    .map(({ key, path, value }) => ({ key, path, value }))

  const environmentCues = []
  for (const item of ranked) {
    const label = `${item.path}=${item.value}`
    if (/天气|暴雨|大雨|暴雪|浓雾|大雾|风暴|雷雨|沙尘|酷热|极寒/.test(label)) {
      environmentCues.push({ source: 'mvu-weather', label: `天气·${String(item.value).slice(0, 18)}` })
    } else if (/重伤|受伤|中毒|虚弱|疲惫|疲劳|眩晕|束缚|破势|debuff/i.test(label) && item.value !== false && item.value !== 0 && item.value !== '无') {
      environmentCues.push({ source: 'mvu-status', label: `状态·${item.key}` })
    }
    if (environmentCues.length >= 3) break
  }

  const summary = ranked
    .map(item => `${item.path}=${typeof item.value === 'boolean' ? (item.value ? '是' : '否') : item.value}`)
    .join('；')
    .slice(0, 760)
  return { entries: ranked, highlights: ranked, summary, keyCount: ranked.length, environmentCues }
}

async function safeCall(fn, payload) {
  if (typeof fn !== 'function') return null
  try {
    const result = await fn(payload)
    return result === undefined ? null : result
  } catch {
    return null
  }
}

/** 宿主 tavern 服务的方法靠 this 定位调用者 fiber（plugin-api 的 guardScope），
 * 只能以 `tavern.方法名(...)` 形式调用；摘下来裸调会让守卫抛错，被吞成"没有素材"。 */
async function callHost(tv, name, payload) {
  if (!tv || typeof tv[name] !== 'function') return null
  return await safeCall(() => tv[name](payload))
}

function readDesigns(designs) {
  const list = Array.isArray(designs)
    ? designs
    : (designs && typeof designs === 'object'
      ? (Array.isArray(designs.characters)
        ? designs.characters
        : (Array.isArray(designs.designs) ? designs.designs : (Array.isArray(designs.items) ? designs.items : [])))
      : [])
  const parts = []
  for (const item of list.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue
    const sections = Array.isArray(item.sections) ? item.sections : []
    const sectionText = key => sections.find(s => s && s.key === key)?.text || ''
    const name = clip(item.name || item.characterName || item.title || '', 24)
    const role = clip(item.narrativeRole || item.role || '', 40)
    const identity = clip(item.identity || sectionText('identity') || '', 90)
    const personality = clip(item.personality || sectionText('personality') || '', 90)
    const line = [name && `【${name}】`, role && `定位:${role}`, identity && `身份:${identity}`, personality && `性格:${personality}`]
      .filter(Boolean)
      .join(' ')
    if (line) parts.push(line)
  }
  return clip(parts.join(' / '), 900)
}

function readCard(card, playerName) {
  const data = card && typeof card === 'object' ? (card.data && typeof card.data === 'object' ? card.data : card) : {}
  const name = clip(data.name || data.charName || data.characterName || '', 40)
  const description = clip(data.description || data.persona || '', CARD_CHARS)
  const personality = clip(data.personality || '', 220)
  const scenario = clip(data.scenario || '', 260)
  const lines = []
  if (name || playerName) lines.push(`主角：${playerName || '你'}${name ? `（角色卡 ${name}）` : ''}`)
  if (description) lines.push(`设定：${description}`)
  if (personality) lines.push(`性格：${personality}`)
  if (scenario) lines.push(`处境：${scenario}`)
  return { name, text: clip(lines.join('\n'), 1000) }
}

function readLore(cardContext) {
  const ctx = cardContext && typeof cardContext === 'object' ? cardContext : {}
  const raw = Array.isArray(ctx.lore)
    ? ctx.lore
    : (Array.isArray(ctx.worldbook) ? ctx.worldbook : (Array.isArray(ctx.entries) ? ctx.entries : []))
  const items = []
  for (const entry of raw.slice(0, 10)) {
    if (!entry || typeof entry !== 'object') continue
    const title = clip(entry.title || entry.name || entry.comment || '', 40)
    const content = clip(entry.content || entry.text || entry.value || '', LORE_ITEM_CHARS)
    if (!title && !content) continue
    items.push(title ? `·${title}：${content}` : `·${content}`)
  }
  return { count: items.length, text: clip(items.join('\n'), 900) }
}

function readHistory(history) {
  const list = Array.isArray(history)
    ? history
    : (history && typeof history === 'object'
      ? (Array.isArray(history.turns) ? history.turns : (Array.isArray(history.items) ? history.items : []))
      : [])
  const lines = []
  for (const item of list.slice(-3)) {
    if (!item || typeof item !== 'object') continue
    const turn = item.turn ?? item.index ?? ''
    const text = clip(item.text || item.content || item.output || item.reply || '', HISTORY_ITEM_CHARS)
    if (!text) continue
    lines.push(`[第${turn || '?'}轮] ${text}`)
  }
  return { turns: lines.length, text: clip(lines.join('\n'), 820) }
}

/** 采集本局可用的一切判难素材：人设 / 角色卡 / 世界书 / MVU / 近期正文。 */
export async function collectCharacterMaterial({ tavern, gameId, turn } = {}) {
  const tv = tavern && typeof tavern === 'object' ? tavern : {}
  const gid = gameId || ''
  const turnNum = Math.max(1, toInt(turn, 2) || 2)
  const prevTurn = Math.max(1, turnNum - 1)
  const fromTurn = Math.max(1, turnNum - 3)

  const [playerNameRaw, designsRaw, cardRaw, cardContextRaw, prevTurnRaw, historyRaw] = await Promise.all([
    callHost(tv, 'getPlayerName', { gameId: gid }),
    callHost(tv, 'getCharacterDesigns', { gameId: gid }),
    callHost(tv, 'getCard', { gameId: gid }),
    callHost(tv, 'getCardContext', { gameId: gid, turn: prevTurn }),
    callHost(tv, 'getTurn', { gameId: gid, turn: prevTurn }),
    callHost(tv, 'getHistory', { gameId: gid, from: fromTurn, to: prevTurn })
  ])

  const playerName = clip(
    typeof playerNameRaw === 'string'
      ? playerNameRaw
      : (playerNameRaw?.name || playerNameRaw?.playerName || ''),
    40
  ) || '你'

  const designsText = readDesigns(designsRaw)
  const card = readCard(cardRaw, playerName)
  const lore = readLore(cardContextRaw)

  const prevTurnObj = prevTurnRaw && typeof prevTurnRaw === 'object' ? prevTurnRaw : {}
  const variables = prevTurnObj.variables || prevTurnObj.statData || prevTurnObj.stat_data || null
  const mvu = summarizeMvuVariables(variables)
  const prevText = clip(prevTurnObj.text || prevTurnObj.content || prevTurnObj.output || '', 600)
  const history = readHistory(historyRaw)
  const latestText = history.text || (prevText ? `[第${prevTurn}轮] ${prevText}` : '')

  const blocks = [
    `【受控角色】${playerName}${card.name ? `（角色卡：${card.name}）` : ''}`,
    designsText ? `【人设设计】${designsText}` : '',
    card.text ? `【角色卡设定】${card.text}` : '',
    lore.text ? `【启用世界书】\n${lore.text}` : '',
    mvu.summary ? `【当前 MVU 状态】${mvu.summary}` : '',
    latestText ? `【近期正文处境】\n${latestText}` : '',
    '【任务】以这些素材判断该角色在此行动上的能力与状态档位，不要臆造设定外的能力。'
  ].filter(Boolean)

  return {
    playerName,
    cardName: card.name,
    promptDigest: blocks.join('\n').slice(0, MAX_DIGEST_CHARS),
    mvuHighlights: mvu.entries.slice(0, 12),
    contextSources: {
      playerName,
      hasCard: Boolean(card.name || card.text),
      cardName: card.name,
      loreCount: lore.count,
      mvuKeyCount: mvu.keyCount,
      historyTurns: history.turns
    }
  }
}

/** LLM 输出契约：严格 JSON。 */
export const PROFILE_SYSTEM_PROMPT = [
  '你是跑团主持人的能力推演器。依据给定素材，为受控主角建立一套能力画像。',
  '要求：',
  '1. 只输出纯 JSON，不要任何解释、前后缀或代码块标记；',
  '2. JSON 结构：{"characterName":"...","archetype":"一句话实力与当前状态定位","traits":[{"name":"不超过8字的能力/状态名","tier":-2到3的整数,"hidden":布尔(感知洞察类为true),"source":"角色卡|世界书|MVU|正文","reason":"简短依据"}]}；',
  '3. traits 提取 4~8 条：既要贴合设定的特长，也要有短板，以及当前的伤病、装备或境界状态；若 MVU 中已写明具体属性数值或品阶/阶级，请将其对应为稳定的 tier；',
  '4. tier 含义：-2 明显短板/受创，-1 稍弱，0 普通，1 训练有素，2 职业专精，3 世界书级别的压制性位格；',
  '5. 不得臆造素材中不存在的能力。'
].join('\n')

/** 对比两份角色画像的实质演进差异，供楼层胶囊轻量提示。 */
export function diffCharacterProfiles(prevProfile, nextProfile) {
  const prevTraits = Array.isArray(prevProfile?.traits) ? prevProfile.traits : []
  const nextTraits = Array.isArray(nextProfile?.traits) ? nextProfile.traits : []
  if (!nextTraits.length) return []
  if (!prevTraits.length) {
    return [{ kind: 'init', name: '初始能力建档', count: nextTraits.length }]
  }
  const prevMap = new Map()
  for (const item of prevTraits) {
    if (item && item.name) prevMap.set(String(item.name).trim(), Number(item.tier) || 0)
  }
  const nextMap = new Map()
  const changes = []
  for (const item of nextTraits) {
    if (!item || !item.name) continue
    const name = String(item.name).trim()
    const tier = Number(item.tier) || 0
    nextMap.set(name, tier)
    if (!prevMap.has(name)) {
      changes.push({ kind: 'added', name, tier, delta: tier })
    } else {
      const oldTier = prevMap.get(name)
      if (oldTier !== tier) {
        changes.push({ kind: 'changed', name, prevTier: oldTier, tier, delta: tier - oldTier })
      }
    }
  }
  for (const [name, oldTier] of prevMap.entries()) {
    if (!nextMap.has(name)) {
      changes.push({ kind: 'removed', name, prevTier: oldTier, delta: -oldTier })
    }
  }
  return changes.slice(0, 4)
}

export function normalizeCharacterProfile(raw, rule = '2d6') {
  const source = raw && typeof raw === 'object' ? raw : {}
  const traitsRaw = Array.isArray(source.traits) ? source.traits : []
  const traits = traitsRaw.slice(0, 10).map((t, i) => {
    const tier = Math.max(-3, Math.min(3, Math.trunc(Number(t?.tier) || 0)))
    return {
      id: String(t?.id || `tr_${i + 1}`),
      name: String(t?.name || '能力特征').slice(0, 20),
      tier,
      bonus: tierToRuleBonus(tier, rule),
      hidden: Boolean(t?.hidden),
      source: PROFILE_TRAIT_SOURCES.includes(t?.source) ? t.source : String(t?.source || '综合').slice(0, 12),
      reason: String(t?.reason || '').slice(0, 120)
    }
  })
  return {
    characterName: String(source.characterName || ''),
    archetype: String(source.archetype || source.summary || ''),
    traits,
    mvuHighlights: Array.isArray(source.mvuHighlights) ? source.mvuHighlights.slice(0, 12) : [],
    customNote: String(source.customNote || '').slice(0, 200),
    updatedTurn: Math.max(0, Math.trunc(Number(source.updatedTurn) || 0)),
    updatedAt: Number(source.updatedAt) || 0
  }
}

/** 把画像压成送审用的一段文本（不触发宿主 IO，可在每回合热路径使用）。 */
export function buildProfileDigest(profile, extraDigest = '') {
  const p = profile && typeof profile === 'object' ? profile : {}
  const traits = (Array.isArray(p.traits) ? p.traits : []).filter(item => item && item.name)
  const lines = []
  if (p.characterName) lines.push(`【受控角色】${p.characterName}`)
  if (p.archetype) lines.push(`【实力定位】${clip(p.archetype, 160)}`)
  if (traits.length) {
    lines.push(`【能力画像】${traits
      .map(item => `${item.name}[tier ${item.tier >= 0 ? '+' : ''}${item.tier}${item.hidden ? '·暗' : ''}${item.reason ? `：${clip(item.reason, 40)}` : ''}]`)
      .join('；')}`)
  }
  if (Array.isArray(p.mvuHighlights) && p.mvuHighlights.length) {
    lines.push(`【MVU 状态】${p.mvuHighlights
      .slice(0, 8)
      .map(item => `${item?.path || item?.key || ''}=${item?.value ?? ''}`)
      .join('；')
      .slice(0, 480)}`)
  }
  if (p.customNote) lines.push(`【玩家补充】${clip(p.customNote, 160)}`)
  if (extraDigest) lines.push(clip(extraDigest, 900))
  return clip(lines.join('\n'), MAX_DIGEST_CHARS)
}

async function readStreamText(result) {
  if (!result) return ''
  if (typeof result === 'string') return result
  if (typeof result.text === 'string' && !result[Symbol.asyncIterator]) return result.text
  if (typeof result[Symbol.asyncIterator] === 'function') {
    let out = ''
    for await (const chunk of result) {
      if (!chunk) continue
      if (typeof chunk === 'string') { out += chunk; continue }
      const piece = chunk.text ?? chunk.delta ?? chunk.content ?? chunk.output
      if (typeof piece === 'string') out += piece
      else if (piece && typeof piece === 'object' && typeof piece.text === 'string') out += piece.text
    }
    return out
  }
  const message = result.message?.content ?? result.content
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    return message
      .map(part => (typeof part === 'string' ? part : (part?.text || '')))
      .join('')
  }
  return ''
}

/** 解析模型输出为 JSON（兼容 ```json 代码块包裹与前后噪声）。 */
export function parseProfileJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const candidate = body.slice(start, end + 1)
  try {
    const parsed = JSON.parse(candidate)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function coerceTraits(rawTraits, limit = 8) {
  const list = Array.isArray(rawTraits) ? rawTraits : []
  return list
    .filter(item => item && (item.name || item.title))
    .slice(0, limit)
    .map(item => ({
      name: String(item.name || item.title || '能力特征').slice(0, 20),
      tier: Math.max(TIER_MIN, Math.min(TIER_MAX, Math.trunc(Number(item.tier) || 0))),
      hidden: Boolean(item.hidden),
      source: PROFILE_TRAIT_SOURCES.includes(item.source) ? item.source : '综合',
      reason: String(item.reason || item.note || '').slice(0, 120)
    }))
}

function fallbackProfile(material, existingProfile, note) {
  const base = normalizeCharacterProfile(existingProfile || {}, '2d6')
  const traits = base.traits.length ? base.traits : []
  return normalizeCharacterProfile({
    characterName: base.characterName || material?.playerName || '',
    archetype: base.archetype || (material?.cardName
      ? `${material.cardName} 的既有设定倾向（待模型细化）`
      : '暂未推定实力定位（后台模型未就绪）'),
    traits,
    mvuHighlights: material?.mvuHighlights || base.mvuHighlights,
    customNote: base.customNote,
    updatedTurn: base.updatedTurn,
    updatedAt: base.updatedAt
  })
}

/** 通用能力域兜底（AI 未选中任何画像特征时使用）。 */
export const DOMAIN_FALLBACKS = Object.freeze({
  general_physical: { label: '通用·体魄', category: 'physical', hidden: false },
  general_stealth: { label: '通用·潜行', category: 'stealth', hidden: false },
  general_social: { label: '通用·社交', category: 'social', hidden: false },
  general_insight: { label: '通用·洞察', category: 'insight', hidden: true },
  general_arcana: { label: '通用·技艺', category: 'arcana', hidden: false },
  general_will: { label: '通用·意志', category: 'will', hidden: false }
})

const CATEGORY_HINTS = Object.freeze([
  { category: 'insight', pattern: /察觉|洞察|感知|识破|侦查|眼力|直觉|灵感|神识|听风|追踪|暗察|察言/ },
  { category: 'stealth', pattern: /潜行|隐匿|轻功|身法|敏捷|开锁|偷窃|暗步|无声/ },
  { category: 'social', pattern: /说服|游说|交涉|劝说|诱骗|威吓|社交|交际|魅力|话术|威严|声望|人脉|统御|谈判|蛊惑|仪态|辩才|辩论|辞令|言辞/ },
  { category: 'arcana', pattern: /法术|术法|技艺|锻造|炼金|医|剑|枪|弓|驾驶|机械|科技|符|阵|诅咒|毒|炼器|丹/ },
  { category: 'will', pattern: /意志|定力|心性|抗压|忍耐|精神|道心|信念/ },
  { category: 'physical', pattern: /体魄|力量|耐力|武功|搏斗|战斗|筋骨|气血|蛮力|冲锋/ }
])

/** 由特征名推断检定类别。 */
export function categoryFromTraitName(name) {
  const text = String(name || '')
  const hit = CATEGORY_HINTS.find(item => item.pattern.test(text))
  return hit ? hit.category : 'physical'
}

/** 从画像中按 id / name 找到特征。 */
export function matchProfileTrait(profile, keyOrName) {
  const key = String(keyOrName || '').trim().toLowerCase()
  const traits = (profile?.traits || []).filter(item => item && item.name)
  if (!key || !traits.length) return null
  return traits.find(item => String(item.id || '').toLowerCase() === key) ||
    traits.find(item => String(item.name || '').toLowerCase() === key) ||
    traits.find(item => {
      const name = String(item.name || '').toLowerCase()
      return name && (name.includes(key) || key.includes(name))
    }) ||
    null
}

/**
 * 把 AI 选中的能力域（画像特征 或 general_*）解析为检定用的名称/类别/暗骰倾向。
 */
export function resolveDomainChoice(profile, keyOrName) {
  const key = String(keyOrName || '').trim()
  const fallback = DOMAIN_FALLBACKS[key]
  if (fallback) {
    return { kind: 'domain', trait: null, name: fallback.label, category: fallback.category, hidden: fallback.hidden, tier: 0 }
  }
  const trait = matchProfileTrait(profile, key)
  if (trait) {
    return {
      kind: 'trait',
      trait,
      name: trait.name,
      category: categoryFromTraitName(trait.name),
      hidden: Boolean(trait.hidden),
      tier: toInt(trait.tier, 0)
    }
  }
  return null
}

/** capability score(0..4) → 标准能力阶梯 tier。 */
export function capabilityScoreToTier(score) {
  const num = Number(score)
  if (!Number.isFinite(num)) return 0
  const table = [-2, -1, 0, 1, 2]
  return table[clamp(0, 4, Math.round(num))]
}

/** 技能熟练/受限概率 → 标准能力阶梯 tier。 */
export function probabilitiesToTier({ skilled = 0, impaired = 0 } = {}) {
  const s = Number(skilled) || 0
  const i = Number(impaired) || 0
  if (i >= 0.65) return i >= 0.86 ? -2 : -1
  if (s >= 0.68) return s >= 0.86 ? 2 : 1
  return 0
}

/** 将画像特征转为可供本地兜底与 noul 路径检索的标准技能项。 */
export function profileTraitsToSkills(profile, rule = '2d6') {
  const traits = (Array.isArray(profile?.traits) ? profile.traits : []).filter(item => item && item.name)
  return traits.map((trait, idx) => {
    const tier = clamp(TIER_MIN, TIER_MAX, toInt(trait.tier, 0))
    return {
      id: String(trait.id || `tr_${idx + 1}`),
      name: String(trait.name),
      category: categoryFromTraitName(trait.name),
      hidden: Boolean(trait.hidden),
      tier,
      bonus: tierToRuleBonus(tier, rule),
      fromProfile: true,
      trait
    }
  })
}

/**
 * 融合「命中画像特征的基础档位」与「当轮临时能力评分」：
 * - 命中画像特征时以 trait.tier（保留 -3..+3 完整范围）作为锚点基础；
 * - 当轮评分仅作临时状态修正：正常(0)保持特征基准、受限(<0)下调、充沛(>0)同向取高不双倍叠加；
 * - 未命中具体画像特征时，沿用当轮能力评分或回退技能加值。
 */
export function resolveEffectiveCapability({
  profileDomain = null,
  capability = null,
  fallbackSkillBonus = 0,
  rule = '2d6'
} = {}) {
  if (profileDomain?.kind === 'trait') {
    const baseTier = clamp(TIER_MIN, TIER_MAX, toInt(profileDomain.tier, 0))
    const baseBonus = tierToRuleBonus(baseTier, rule)
    let effectiveTier = baseTier
    let source = 'profile-trait'
    if (capability && Number.isFinite(Number(capability.tier))) {
      const capTier = clamp(-2, 2, toInt(capability.tier, 0))
      if (capTier < 0) {
        effectiveTier = baseTier < 0
          ? Math.min(baseTier, capTier)
          : clamp(TIER_MIN, TIER_MAX, baseTier + capTier)
      } else if (capTier > 0) {
        effectiveTier = Math.max(baseTier, capTier)
      }
      source = capability.source ? `trait+${capability.source}` : 'profile-trait'
    }
    const bonus = tierToRuleBonus(effectiveTier, rule)
    return {
      tier: effectiveTier,
      bonus,
      baseTraitTier: baseTier,
      baseTraitBonus: baseBonus,
      tempStateBonus: bonus - baseBonus,
      source
    }
  }
  if (capability && Number.isFinite(Number(capability.bonus))) {
    return {
      tier: Number.isFinite(Number(capability.tier)) ? toInt(capability.tier, 0) : null,
      bonus: Number(capability.bonus),
      baseTraitTier: null,
      baseTraitBonus: 0,
      tempStateBonus: Number(capability.bonus),
      source: capability.source || 'score'
    }
  }
  const fallback = Number(fallbackSkillBonus) || 0
  return {
    tier: null,
    bonus: fallback,
    baseTraitTier: null,
    baseTraitBonus: 0,
    tempStateBonus: 0,
    source: 'skill-fallback'
  }
}

/**
 * 调用本局后台结算模型，自动推演并刷新角色能力画像。
 * @returns {Promise<{ok:boolean, characterProfile:object, contextSources:object, error?:string, raw?:string}>}
 */
export async function refreshProfileWithBackgroundLlm({
  llm = null,
  tavern = null,
  gameId = '',
  turn = 1,
  rule = '2d6',
  existingProfile = null
} = {}) {
  const tv = tavern && typeof tavern === 'object' ? tavern : {}
  const material = await collectCharacterMaterial({ tavern: tv, gameId, turn })
  const existing = existingProfile && typeof existingProfile === 'object' ? existingProfile : null
  const sources = { ...material.contextSources }

  const noLlm = !llm || typeof llm.stream !== 'function'
  const noBackgroundModel = typeof tv.backgroundModel !== 'function'
  if (noLlm || noBackgroundModel) {
    return {
      ok: false,
      error: noBackgroundModel ? '本局后台结算模型尚未配置' : '宿主未提供 llm 服务',
      characterProfile: normalizeCharacterProfile(
        fallbackProfile(material, existing, 'model-unavailable'),
        rule
      ),
      contextSources: { ...sources, backgroundModelReady: false }
    }
  }

  let selected = null
  try {
    selected = await tv.backgroundModel({ gameId })
  } catch {
    selected = null
  }
  if (!selected?.provider || !selected?.model) {
    return {
      ok: false,
      error: '本局后台结算模型尚未选择 provider/model',
      characterProfile: normalizeCharacterProfile(
        fallbackProfile(material, existing, 'model-unconfigured'),
        rule
      ),
      contextSources: { ...sources, backgroundModelReady: false }
    }
  }

  let rawText = ''
  try {
    const streamed = await llm.stream({
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
      system: PROFILE_SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 2500,
      messages: [{ role: 'user', content: [{ type: 'text', text: material.promptDigest }] }]
    })
    rawText = await readStreamText(streamed)
  } catch (error) {
    return {
      ok: false,
      error: `后台模型调用失败：${String(error?.message || error)}`.slice(0, 160),
      characterProfile: normalizeCharacterProfile(fallbackProfile(material, existing, 'model-failed'), rule),
      contextSources: { ...sources, backgroundModelReady: true }
    }
  }

  const parsed = parseProfileJson(rawText)
  if (!parsed) {
    return {
      ok: false,
      error: '后台模型未返回可解析的 JSON 画像',
      raw: rawText.slice(0, 400),
      characterProfile: normalizeCharacterProfile(fallbackProfile(material, existing, 'parse-failed'), rule),
      contextSources: { ...sources, backgroundModelReady: true }
    }
  }

  const traits = coerceTraits(parsed.traits, 8)
  const profile = normalizeCharacterProfile({
    characterName: parsed.characterName || material.playerName || '',
    archetype: parsed.archetype || parsed.summary || '',
    traits,
    mvuHighlights: material.mvuHighlights,
    customNote: existing?.customNote || '',
    updatedTurn: Math.max(1, toInt(turn, 1)),
    updatedAt: Date.now()
  }, rule)

  return {
    ok: true,
    characterProfile: profile,
    contextSources: { ...sources, backgroundModelReady: true },
    raw: rawText.slice(0, 400)
  }
}
