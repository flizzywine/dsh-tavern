/**
 * multi-check.js —— 单回合多判定核心模块
 *
 * 支持三种可切换方式：
 * 1. decompose   —— 发前条件拆解（小模型门控 + 仅多动作时拆解 2~3 项子检定，发前一次掷完）
 * 2. agent-tool  —— Agent 实时真骰工具（主检定发前落定 + 对话中按需调用 fate_dice_roll 现掷）
 * 3. hybrid-tape —— 主骰 + 备用宿命序列真骰带（零额外延迟，额外风险按 ②→③ 顺位取用）
 */

import {
  DIFFICULTY_LABELS,
  normalizeDifficulty,
  normalizeRule
} from './dice-engine.js'
import {
  DOMAIN_FALLBACKS,
  parseProfileJson,
  resolveDomainChoice,
  resolveEffectiveCapability
} from './auto-profiler.js'
import {
  detectContestIntent,
  heuristicAssessWithSkills
} from './difficulty-judge.js'

export const MULTI_CHECK_MODES = Object.freeze(['decompose', 'agent-tool', 'hybrid-tape'])
export const MULTI_CHECK_MAX_DEFAULT = 3
export const MULTI_CHECK_MAX_MIN = 2
export const MULTI_CHECK_MAX_LIMIT = 3

export const MULTI_CHECK_QUESTION_INSTRUCTIONS =
  '玩家本轮输入是否明确包含 2 个及以上相互独立、需要分别裁定成败的高风险行动（例如“先用假话稳住对方、趁机偷拿账本、顺便听门外动静”），而不是单一核心动作的细节描写？'

export function normalizeMultiCheckSettings(settings = {}) {
  const src = settings && typeof settings === 'object' ? settings : {}
  const mode = MULTI_CHECK_MODES.includes(src.multiCheckMode) ? src.multiCheckMode : 'decompose'
  const rawMax = Number(src.multiCheckMax)
  const maxChecks = Number.isFinite(rawMax)
    ? Math.max(MULTI_CHECK_MAX_MIN, Math.min(MULTI_CHECK_MAX_LIMIT, Math.trunc(rawMax)))
    : MULTI_CHECK_MAX_DEFAULT
  return {
    enabled: Boolean(src.multiCheckEnabled),
    mode,
    maxChecks
  }
}

/** 将单条 roll 或 rolls[] 统一归一化为数组（完全兼容旧版单骰结构）。 */
export function normalizeRollList(source) {
  if (!source) return []
  if (Array.isArray(source)) return source.filter(item => item && typeof item === 'object')
  if (typeof source === 'object') {
    if (Array.isArray(source.rolls) && source.rolls.length) {
      return source.rolls.filter(item => item && typeof item === 'object')
    }
    if (source.roll && typeof source.roll === 'object') return [source.roll]
    if (source.rule || source.tier || source.check) return [source]
  }
  return []
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
    return message.map(part => (typeof part === 'string' ? part : (part?.text || ''))).join('')
  }
  return ''
}

const CLAUSE_SPLIT_RE = /(?:[；;。\n]|(?:，|,)\s*(?=同时|顺便|一边|然后|接着|随后|并且|并|再|又|趁机|顺手|另外|暗中))+/g
const SEQUENCE_CUE_RE = /^(?:然后|接着|随后|再|趁机|之后)/

/** 本地启发式多子句拆分兜底：仅当确实识别出 >=2 个独立风险动作时返回。 */
export function heuristicSplitMultiChecks({
  input = '',
  maxChecks = MULTI_CHECK_MAX_DEFAULT,
  profile = null,
  rule = '2d6',
  sensitivity = 'normal',
  allowHidden = true
} = {}) {
  const text = String(input || '').trim()
  if (!text || text.length < 10) return []
  const limit = Math.max(MULTI_CHECK_MAX_MIN, Math.min(MULTI_CHECK_MAX_LIMIT, Math.trunc(Number(maxChecks) || 3)))
  const rawParts = text
    .split(CLAUSE_SPLIT_RE)
    .map(part => part.trim())
    .filter(part => part.length >= 4)

  if (rawParts.length < 2) return []

  const items = []
  const seenKeys = new Set()
  for (let i = 0; i < rawParts.length && items.length < limit; i++) {
    const clause = rawParts[i]
    const assessed = heuristicAssessWithSkills(clause, [], sensitivity, allowHidden, profile, rule)
    if (!assessed || !assessed.shouldRoll) continue
    const dedupKey = `${assessed.category}:${clause.slice(0, 8)}`
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)
    const dependsOn = items.length > 0 && SEQUENCE_CUE_RE.test(clause) ? items.length : null
    items.push({
      attempt: clause.slice(0, 120),
      check: assessed.check,
      skillId: assessed.skillId,
      skillName: assessed.skillName || assessed.check,
      skillBonus: Number(assessed.skillBonus) || 0,
      category: assessed.category || 'physical',
      difficulty: normalizeDifficulty(assessed.difficulty),
      difficultyLabel: DIFFICULTY_LABELS[normalizeDifficulty(assessed.difficulty)],
      hidden: Boolean(allowHidden && assessed.hidden),
      checkType: !assessed.hidden && assessed.checkType === 'contest' ? 'contest' : 'normal',
      dependsOn,
      reason: `多动作拆解 #${items.length + 1}：${assessed.reason || '独立风险动作'}`,
      source: 'multi-heuristic'
    })
  }
  return items.length >= 2 ? items : []
}

function buildDecomposeSystemPrompt(profile, maxChecks) {
  const traits = (Array.isArray(profile?.traits) ? profile.traits : []).filter(t => t && t.name).slice(0, 10)
  const domainKeys = [
    ...traits.map(t => `${t.id || t.name}(${t.name}, tier ${Number(t.tier) >= 0 ? '+' : ''}${Number(t.tier) || 0}${t.hidden ? ', 暗骰' : ''})`),
    ...Object.entries(DOMAIN_FALLBACKS).map(([k, v]) => `${k}(${v.label}${v.hidden ? ', 暗骰' : ''})`)
  ].join('、')

  return [
    '你是跑团主持人的多动作检定拆解器。将玩家本轮输入拆解为 2 到 ' + maxChecks + ' 项相互独立、确实需要分别掷骰裁定成败的风险行动。',
    '要求：',
    '1. 只输出纯 JSON，不要任何解释、前后缀或代码块标记；',
    '2. JSON 格式：{"checks":[{"attempt":"不超过40字的具体行动","domain":"能力域key或名称","difficulty":"trivial|easy|moderate|hard|extreme","hidden":false,"checkType":"normal|contest","dependsOn":null}]}；',
    `3. 可选能力域（domain）：${domainKeys}；`,
    '4. 如果玩家其实只做了一件核心行动（其余只是动作修饰或情绪描写），请只返回 1 项或空数组；',
    `5. 最多返回 ${maxChecks} 项；若后一项严格依赖前一项先成功（如先撬锁再潜入），dependsOn 填前一项的 1-based 序号（如 1），否则填 null；`,
    '6. 感知/侦查/识破类行动将 hidden 设为 true；正面交锋对抗将 checkType 设为 "contest"（暗骰不可为 contest）。'
  ].join('\n')
}

function normalizeDecomposedItems(rawChecks, {
  profile = null,
  rule = '2d6',
  allowHidden = true,
  maxChecks = MULTI_CHECK_MAX_DEFAULT,
  primaryJudged = null
} = {}) {
  const list = Array.isArray(rawChecks) ? rawChecks : []
  const limit = Math.max(MULTI_CHECK_MAX_MIN, Math.min(MULTI_CHECK_MAX_LIMIT, Math.trunc(Number(maxChecks) || 3)))
  const out = []
  for (let i = 0; i < list.length && out.length < limit; i++) {
    const item = list[i]
    if (!item || typeof item !== 'object') continue
    const attempt = String(item.attempt || item.action || '').trim().slice(0, 120)
    if (!attempt) continue
    const domainKey = String(item.domain || item.skill || item.category || '').trim()
    const resolved = resolveDomainChoice(profile, domainKey)
    const fallbackCap = out.length === 0 && primaryJudged && Number.isFinite(Number(primaryJudged.skillBonus))
      ? Number(primaryJudged.skillBonus)
      : 0
    const effectiveCap = resolveEffectiveCapability({
      profileDomain: resolved,
      capability: null,
      fallbackSkillBonus: fallbackCap,
      rule
    })
    const difficulty = normalizeDifficulty(item.difficulty)
    const category = resolved?.category || 'physical'
    const check = (resolved?.kind === 'domain' ? resolved.name : '')
      || resolved?.name
      || (String(item.check || item.skillName || '').trim().slice(0, 16))
      || '行动'
    const skillId = resolved?.kind === 'trait'
      ? String(resolved.trait.id)
      : (resolved?.kind === 'domain' ? String(domainKey) : 'general')
    const hidden = Boolean(allowHidden && (item.hidden === true || resolved?.hidden || category === 'insight'))
    const checkType = !hidden && (item.checkType === 'contest' || detectContestIntent(attempt, category))
      ? 'contest'
      : 'normal'
    const rawDep = Number(item.dependsOn)
    const dependsOn = Number.isInteger(rawDep) && rawDep >= 1 && rawDep <= out.length ? rawDep : null
    out.push({
      attempt,
      check,
      skillId,
      skillName: check,
      skillBonus: effectiveCap.bonus,
      capabilityTier: effectiveCap.tier,
      capabilitySource: effectiveCap.source,
      capabilityBreakdown: {
        baseTraitTier: effectiveCap.baseTraitTier,
        baseTraitBonus: effectiveCap.baseTraitBonus,
        tempStateBonus: effectiveCap.tempStateBonus
      },
      category,
      difficulty,
      difficultyLabel: DIFFICULTY_LABELS[difficulty],
      hidden,
      checkType,
      dependsOn,
      reason: `多判定拆解 #${out.length + 1}（${DIFFICULTY_LABELS[difficulty]}）`,
      source: 'multi-decompose'
    })
  }
  return out
}

/**
 * 方案 1：发前条件拆解。仅在门控判断存在多动作时调用。
 * 优先使用后台模型输出结构化 JSON，不可用或失败时降级本地多子句拆分。
 */
export async function decomposeMultiChecks({
  llm = null,
  tavern = null,
  gameId = '',
  input = '',
  recentContext = '',
  characterMaterial = '',
  profile = null,
  rule = '2d6',
  sensitivity = 'normal',
  allowHidden = true,
  maxChecks = MULTI_CHECK_MAX_DEFAULT,
  primaryJudged = null
} = {}) {
  const activeRule = normalizeRule(rule)
  const limit = Math.max(MULTI_CHECK_MAX_MIN, Math.min(MULTI_CHECK_MAX_LIMIT, Math.trunc(Number(maxChecks) || 3)))
  const fallback = () => heuristicSplitMultiChecks({
    input,
    maxChecks: limit,
    profile,
    rule: activeRule,
    sensitivity,
    allowHidden
  })

  if (!llm || typeof llm.stream !== 'function' || typeof tavern?.backgroundModel !== 'function') {
    return fallback()
  }

  let selected = null
  try {
    selected = await tavern.backgroundModel({ gameId })
  } catch {
    selected = null
  }
  if (!selected?.provider || !selected?.model) return fallback()

  const userText = [
    characterMaterial ? `【角色能力背景】\n${String(characterMaterial).slice(0, 900)}` : '',
    recentContext ? `【前情摘录】\n${String(recentContext).slice(0, 500)}` : '',
    `【本轮玩家输入】\n${String(input || '').slice(0, 1400)}`
  ].filter(Boolean).join('\n\n')

  try {
    const streamed = await llm.stream({
      provider: selected.provider,
      model: selected.model,
      ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
      system: buildDecomposeSystemPrompt(profile, limit),
      temperature: 0.2,
      maxTokens: 900,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }]
    })
    const rawText = await readStreamText(streamed)
    const parsed = parseProfileJson(rawText)
    const normalized = normalizeDecomposedItems(parsed?.checks || parsed?.items, {
      profile,
      rule: activeRule,
      allowHidden,
      maxChecks: limit,
      primaryJudged
    })
    if (normalized.length >= 2) return normalized
    return []
  } catch {
    return fallback()
  }
}
