import {
  DIFFICULTY_LABELS,
  normalizeDifficulty,
  shiftDifficulty
} from './dice-engine.js'
import { detectContestIntent, heuristicAssessWithSkills } from './difficulty-judge.js'
import {
  CAPABILITY_CRITERIA,
  DOMAIN_FALLBACKS,
  SKILL_CATEGORIES,
  capabilityScoreToTier,
  findMatchingSkill,
  probabilitiesToTier,
  resolveDomainChoice,
  tierToRuleBonus
} from './auto-profiler.js'

export const DAMPER_QUESTION_PREFIX = 'fd_'

const SENSITIVITY_THRESHOLDS = Object.freeze({
  strict: 0.35,
  normal: 0.55,
  rare: 0.78
})

const DIFFICULTY_CRITERIA = Object.freeze({
  trivial: '极易：几乎没有阻碍，仅微小意外才可能出错',
  easy: '容易：有常规成功把握，稍加注意即可达成',
  moderate: '中等：成败参半，需要真正拼搏或运气',
  hard: '困难：逆境、强防备、高技巧或不利处境下的强行尝试',
  extreme: '极难：以弱胜强、几乎违背常理或严密防线下的冒险一搏'
})

const ACTION_ATTEMPT_CUE = /尝试|试图|伸手|举起|抬|挥|冲|扑|奔|走|跑|摸|掏|拔|推|拉|踢|喊|低声|开口|靠近|转身|拔腿|按下|启动|施法|凝聚|瞄准|架|挡|躲|潜入|跟踪|观察|翻|撬|问|谈|劝|威胁|安抚|亲吻|抱住/
const RESULT_DECLARATION_CUE = /已经|已然|成功|直接|立刻|瞬间|当场|所有人|全都|注定|必然|获得了|得到了|杀死了|击倒|说服了|逃出|通关|拿下/

/** 阻尼器协议识别：低阶提供方只支持 is/is-not 并发题。 */
export function resolveJudgeProtocol(status = {}) {
  const caps = status?.capabilities || {}
  if (caps.choice && caps.score) return status?.provider === 'gemini' ? 'gemini' : 'structured'
  return 'noul'
}

function signedTier(tier) {
  const num = Number(tier) || 0
  return `${num >= 0 ? '+' : ''}${num}`
}

function hasUsableProfile(profile) {
  if (!profile || typeof profile !== 'object') return false
  const traits = Array.isArray(profile.traits) ? profile.traits : []
  return traits.length > 0 || Boolean(profile.characterName) || Boolean(profile.archetype)
}

function buildDomainCriteria(profile, allowHidden) {
  const criteria = {}
  const traits = (Array.isArray(profile?.traits) ? profile.traits : []).filter(item => item && item.name).slice(0, 10)
  if (traits.length >= 2) {
    for (const trait of traits) {
      const suffix = [
        `[${signedTier(trait.tier)}]`,
        trait.source ? `来源:${trait.source}` : '',
        trait.hidden && allowHidden ? '暗骰' : ''
      ].filter(Boolean).join('·')
      criteria[String(trait.id || trait.name)] = `${trait.name}（画像特征${suffix}）`
    }
  }
  for (const [key, meta] of Object.entries(DOMAIN_FALLBACKS)) {
    criteria[key] = `${meta.label}（通用能力域${meta.hidden && allowHidden ? '·暗骰' : ''}）`
  }
  return criteria
}

/**
 * 构造与叙事阻尼器单趟合并的检定附加题。
 *
 * 新版契约（能力画像模式）：4 道题 —— 是否需检定 / 客观难度 / 受控角色能力档位 / 最贴合的能力域。
 * 旧版兼容（无画像但传入了技能表）：保留 fd_skill 三题形态，供历史调用与旧测试使用。
 */
export function buildDamperJudgeQuestions({
  profile = null,
  skills = [],
  rule = '2d6',
  protocol = 'gemini',
  allowHidden = true,
  autoProfile = false
} = {}) {
  const skillList = (Array.isArray(skills) ? skills : []).filter(item => item && item.name)
  const profileMode = Boolean(autoProfile) || hasUsableProfile(profile)
  const questions = [
    {
      id: 'fd_needs_check',
      type: 'noul',
      instructions: '本轮玩家行动是否真的存在结果不确定性、阻力对抗或需要侦查才能发现的信息（而非纯日常寒暄、内省或必定成功的轻松动作）？'
    }
  ]

  if (protocol === 'gemini') {
    questions.push({
      id: 'fd_difficulty',
      type: 'choice',
      instructions: '结合当前场景的外部阻力，评估这次行动客观难度档位：',
      criteria: { ...DIFFICULTY_CRITERIA }
    })
    if (profileMode) {
      questions.push({
        id: 'fd_capability',
        type: 'score',
        instructions: '根据角色人设、世界书设定、当前 MVU 状态与近期正文，评估受控角色在本次行动上的自身能力与状态档位：',
        criteria: [...CAPABILITY_CRITERIA]
      })
      questions.push({
        id: 'fd_domain',
        type: 'choice',
        instructions: '这次行动最贴合该角色的哪项画像能力或通用能力域？',
        criteria: buildDomainCriteria(profile, allowHidden)
      })
      return questions
    }
    if (skillList.length >= 2) {
      const criteria = {}
      for (const item of skillList.slice(0, 24)) {
        criteria[item.id] = `${item.name}（${SKILL_CATEGORIES[item.category]?.label || '综合'}${item.hidden && allowHidden ? '·暗骰' : ''}）`
      }
      questions.push({
        id: 'fd_skill',
        type: 'choice',
        instructions: '这项行动最贴合该角色的哪项技能？',
        criteria
      })
    }
    return questions
  }

  if (profileMode) {
    questions.push({
      id: 'fd_hard',
      type: 'noul',
      instructions: '不受角色能力影响，这项尝试本身客观上是否属于困难或高风险行动？'
    })
    questions.push({
      id: 'fd_skilled',
      type: 'noul',
      instructions: '依据受控角色的人设、世界书位格与当前 MVU 状态，这件事是否正是其擅长领域？'
    })
    questions.push({
      id: 'fd_impaired',
      type: 'noul',
      instructions: '受控角色当前是否处于短板、伤病、虚弱、被束缚或明显不利状态，从而难以正常发挥？'
    })
    return questions
  }

  questions.push({
    id: 'fd_hard',
    type: 'noul',
    instructions: '以普通角色能力衡量，这项尝试本身是否属于困难或高风险行动？'
  })
  questions.push({
    id: 'fd_hidden',
    type: 'noul',
    instructions: allowHidden
      ? '这项行动的核心是否在于察觉秘密、识破伪装或探测不该立刻知晓的真相（适合暗骰）？'
      : '这项行动是否需要暗中进行、避免被他人察觉？'
  })
  return questions
}

function isViolationTier(ruling) {
  const tier = String(ruling?.rulingTier || ruling?.ruling_tier || ruling?.tier || '')
  return tier === 'strip_delusion' || tier === 'block_delusion' || tier === 'violation'
}

function leverageToEdgeBonus(score) {
  const num = Number(score)
  if (!Number.isFinite(num)) return 0
  if (num >= 2.4) return 2
  if (num >= 1.6) return 1
  if (num < 0.7) return -1
  return 0
}

function readStateValue(data, key, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 3) return undefined
  const root = depth === 0 ? (data.stat_data || data) : data
  if (root?.[key] !== undefined) {
    const num = Number(root[key])
    return Number.isFinite(num) ? num : undefined
  }
  for (const value of Object.values(root)) {
    if (value && typeof value === 'object') {
      const found = readStateValue(value, key, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function normalizeAnswers(raw) {
  if (!raw) return null
  if (Array.isArray(raw)) {
    const map = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const id = String(item.id || item.questionId || item.name || '')
      if (!id) continue
      map[id] = item
    }
    return map
  }
  if (typeof raw === 'object') return raw
  return null
}

function answerProbability(answers, key) {
  const entry = answers?.[key]
  if (entry === undefined || entry === null) return NaN
  if (typeof entry === 'number') return entry
  const prob = Number(entry.probability ?? entry.score ?? entry.value)
  return Number.isFinite(prob) ? prob : NaN
}

function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value
  }
  return NaN
}

function answerChoice(answers, key) {
  const entry = answers?.[key]
  if (entry === undefined || entry === null) return ''
  if (typeof entry === 'string') return entry
  return String(entry.choice ?? entry.value ?? entry.label ?? '')
}

function extractSkillFromAnswers(answers, skillList) {
  const key = answerChoice(answers, 'fd_domain') || answerChoice(answers, 'fd_skill') || answerChoice(answers, 'check_skill') || answerChoice(answers, 'skill')
  if (key) {
    const matched = findMatchingSkill(skillList, key)
    if (matched.id !== 'general') return matched
  }
  return null
}

function answerScore(answers, key) {
  const entry = answers?.[key]
  if (entry === undefined || entry === null) return NaN
  if (typeof entry === 'number') return entry
  const num = Number(entry.score ?? entry.value ?? entry.probability)
  return Number.isFinite(num) ? num : NaN
}

/**
 * 从合并答案中读取「受控角色能力档位」：
 * 优先 score 0..4（fd_capability），其次 fd_skilled/fd_impaired 的概率折算。
 */
function readCapabilitySignal(answers, rule) {
  const score = firstFinite(
    answerScore(answers, 'fd_capability'),
    answerScore(answers, 'character_capability'),
    answerScore(answers, 'fd_cap')
  )
  if (Number.isFinite(score)) {
    const tier = capabilityScoreToTier(score)
    return { tier, score, source: 'score', bonus: tierToRuleBonus(tier, rule) }
  }
  const skilled = firstFinite(answerProbability(answers, 'fd_skilled'), answerProbability(answers, 'character_skilled'))
  const impaired = firstFinite(answerProbability(answers, 'fd_impaired'), answerProbability(answers, 'character_impaired'))
  if (Number.isFinite(skilled) || Number.isFinite(impaired)) {
    const tier = probabilitiesToTier({
      skilled: Number.isFinite(skilled) ? skilled : 0,
      impaired: Number.isFinite(impaired) ? impaired : 0
    })
    return { tier, score: NaN, source: 'noul', bonus: tierToRuleBonus(tier, rule) }
  }
  return null
}

/**
 * 合并裁定：从叙事阻尼器本轮上下文解析是否需要掷骰、技能、难度与双向联动修正。
 */
export function resolveCheckFromDamperContext({
  damperContext = null,
  input = '',
  skills = [],
  profile = null,
  rule = '2d6',
  sensitivity = 'normal',
  allowHidden = true,
  damperLinkage = true
} = {}) {
  const context = damperContext && typeof damperContext === 'object' ? damperContext : {}
  const skillList = (Array.isArray(skills) ? skills : []).filter(item => item && item.name)
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.normal
  const text = String(input || '')

  if (context.explicitSceneShift) {
    return {
      shouldRoll: false,
      reason: '场景切换过渡免检定',
      source: 'damper',
      damperSync: { skipped: 'scene-shift' }
    }
  }

  const ruling = context.ruling || {}
  if (isViolationTier(context.ruling) || isViolationTier(context)) {
    const hasAttempt = ACTION_ATTEMPT_CUE.test(text)
    if (!hasAttempt) {
      return {
        shouldRoll: false,
        reason: '叙事阻尼器已拦截越权设定宣告',
        source: 'damper',
        damperSync: { blockedByViolation: true, rulingTier: ruling.rulingTier || ruling.tier || 'strip_delusion' }
      }
    }
  }

  const answers = normalizeAnswers(context.answers)
  const needProb = firstFinite(
    answerProbability(answers, 'fd_needs_check'),
    answerProbability(answers, 'needs_check'),
    answerProbability(answers, 'fd_check')
  )
  const hasAnswers = Number.isFinite(needProb)
  const fallback = heuristicAssessWithSkills(text, skillList, sensitivity, allowHidden)

  let shouldRoll
  let needProbability
  let difficulty
  let matchedSkill
  let hidden
  let baseCheck
  let category
  let reason

  if (!hasAnswers) {
    shouldRoll = fallback.shouldRoll
    needProbability = fallback.needProbability
    difficulty = normalizeDifficulty(fallback.difficulty)
    matchedSkill = fallback.skillId && fallback.skillId !== 'general'
      ? findMatchingSkill(skillList, fallback.skillId)
      : null
    hidden = Boolean(allowHidden && fallback.hidden)
    baseCheck = fallback.check
    category = fallback.category
    reason = `无阻尼器附加题答案，回退本地启发式：${fallback.reason}`
  } else {
    shouldRoll = needProb >= threshold
    needProbability = Math.round(needProb * 100) / 100
    const choice = answerChoice(answers, 'fd_difficulty') || answerChoice(answers, 'difficulty_tier')
    if (choice) {
      difficulty = normalizeDifficulty(choice)
    } else {
      const hardProb = firstFinite(answerProbability(answers, 'fd_hard'), 0.5)
      if (hardProb >= 0.82) difficulty = 'extreme'
      else if (hardProb >= 0.62) difficulty = 'hard'
      else if (hardProb <= 0.2) difficulty = 'trivial'
      else if (hardProb <= 0.36) difficulty = 'easy'
      else difficulty = 'moderate'
    }
    matchedSkill = extractSkillFromAnswers(answers, skillList)
    const hiddenProb = firstFinite(answerProbability(answers, 'fd_hidden'), 0)
    hidden = Boolean(allowHidden && (matchedSkill?.hidden || hiddenProb >= 0.65))
    baseCheck = matchedSkill?.name || fallback.check
    category = matchedSkill?.category || fallback.category || 'physical'
    reason = `叙事阻尼器合并裁定：触发概率 ${Math.round(needProb * 100)}%`
  }

  // 能力画像：AI 从 fd_domain 直接挑画像特征或通用能力域
  const domainKey = answerChoice(answers, 'fd_domain') || answerChoice(answers, 'fd_skill') || answerChoice(answers, 'check_skill') || ''
  const profileDomain = resolveDomainChoice(hasUsableProfile(profile) ? profile : null, domainKey)
  if (profileDomain?.kind === 'trait') {
    matchedSkill = {
      id: profileDomain.trait.id,
      name: profileDomain.name,
      category: profileDomain.category,
      hidden: profileDomain.hidden,
      bonus: Number(profileDomain.trait.bonus) || 0
    }
  } else if (!matchedSkill) {
    const guessed = findMatchingSkill(skillList, baseCheck)
    if (guessed.id !== 'general') matchedSkill = guessed
  }

  const capability = readCapabilitySignal(answers, rule)
  const check = (profileDomain?.kind === 'domain' ? profileDomain.name : '') || matchedSkill?.name || baseCheck || '行动'
  const skillId = profileDomain?.kind === 'trait'
    ? String(profileDomain.trait.id)
    : (profileDomain?.kind === 'domain' ? String(domainKey) : (matchedSkill?.id || 'general'))
  if (profileDomain) {
    category = profileDomain.category
    if (allowHidden && profileDomain.hidden) hidden = true
  }
  // 能力加值 100% 来自 AI 判定的能力档位；无 AI 信号时才回退旧技能加值
  const skillBonus = capability ? capability.bonus : (Number(matchedSkill?.bonus) || 0)

  const damperSync = {}
  let edgeBonus = 0

  if (damperLinkage !== false) {
    const leverageScore = Number(ruling.leverageScore ?? ruling.leverage_score ?? context.leverageScore ?? 0)
    edgeBonus = leverageToEdgeBonus(leverageScore)
    const snapshot = context.stateSnapshot?.data || context.stateSnapshot?.stat_data || context.stateSnapshot || null
    const guard = readStateValue(snapshot, 'psychological_guard')
    const trust = readStateValue(snapshot, 'intimacy_trust')
    const tension = readStateValue(snapshot, 'arousal_or_tension')
    const shifts = []
    const socialOrInsight = category === 'social' || category === 'insight'
    let next = normalizeDifficulty(difficulty)
    if (socialOrInsight && guard !== undefined && guard >= 75) {
      next = shiftDifficulty(next, 1)
      shifts.push({ source: 'psychological_guard', value: guard, delta: 1, message: '心理防线高企：社交/洞察难度 +1 档' })
    }
    if (socialOrInsight && trust !== undefined && trust >= 70) {
      next = shiftDifficulty(next, -1)
      shifts.push({ source: 'intimacy_trust', value: trust, delta: -1, message: '亲密信任充足：社交/洞察难度 -1 档' })
    }
    if ((category === 'physical' || category === 'social') && tension !== undefined && tension >= 75) {
      next = shiftDifficulty(next, 1)
      shifts.push({ source: 'arousal_or_tension', value: tension, delta: 1, message: '张力/情欲高压：对抗类难度 +1 档' })
    }
    difficulty = next
    damperSync.leverageScore = Number.isFinite(leverageScore) ? leverageScore : 0
    damperSync.edgeBonus = edgeBonus
    damperSync.difficultyShifts = shifts
    damperSync.state = {
      psychological_guard: guard ?? null,
      intimacy_trust: trust ?? null,
      arousal_or_tension: tension ?? null
    }
  } else {
    damperSync.skipped = 'damper-linkage-disabled'
  }

  if (isViolationTier(context.ruling) || isViolationTier(context)) {
    const escalated = Math.max(
      ['trivial', 'easy', 'moderate', 'hard', 'extreme'].indexOf(difficulty),
      ['trivial', 'easy', 'moderate', 'hard', 'extreme'].indexOf('hard')
    )
    difficulty = ['trivial', 'easy', 'moderate', 'hard', 'extreme'][escalated]
    damperSync.blockedByViolation = false
    damperSync.violationEscalation = true
    shouldRoll = true
    reason = '叙事阻尼器判定为越权结果宣告且存在动作尝试，难度已上调'
  }

  if (hasUsableProfile(profile)) {
    damperSync.profile = {
      characterName: String(profile.characterName || ''),
      archetype: String(profile.archetype || '').slice(0, 140),
      capabilityTier: capability ? capability.tier : null,
      capabilitySource: capability ? capability.source : 'skill-fallback',
      capabilityBonus: skillBonus,
      domain: profileDomain
        ? { kind: profileDomain.kind, key: String(domainKey), name: profileDomain.name, tier: profileDomain.tier }
        : null
    }
  }

  const resistanceFactors = []
  if (edgeBonus > 0) resistanceFactors.push({ label: '铺陈契机', delta: `+${edgeBonus}`, source: 'leverage' })
  else if (edgeBonus < 0) resistanceFactors.push({ label: '铺陈不足', delta: `${edgeBonus}`, source: 'leverage' })
  if (Array.isArray(damperSync.difficultyShifts)) {
    for (const shift of damperSync.difficultyShifts) {
      if (!shift) continue
      const label = shift.source === 'psychological_guard'
        ? '心理防线高企'
        : (shift.source === 'intimacy_trust' ? '亲密信任减阻' : '张力高压')
      resistanceFactors.push({
        label,
        delta: `${shift.delta > 0 ? '+' : ''}${shift.delta}档`,
        source: shift.source
      })
    }
  }
  if (damperSync.violationEscalation) {
    resistanceFactors.push({ label: '越权宣言升难', delta: '≥困难', source: 'violation' })
  }
  const checkType = !hidden && detectContestIntent(text, category) ? 'contest' : 'normal'

  return {
    shouldRoll,
    needProbability,
    threshold,
    check,
    checkType,
    resistanceFactors,
    skillId,
    skillName: check,
    skillBonus,
    capabilityTier: capability ? capability.tier : null,
    capabilityScore: capability && Number.isFinite(capability.score) ? capability.score : null,
    capabilitySource: capability ? capability.source : 'skill-fallback',
    profileDomain: profileDomain
      ? { kind: profileDomain.kind, key: String(domainKey), name: profileDomain.name, tier: profileDomain.tier }
      : null,
    category,
    rule,
    difficulty,
    difficultyLabel: DIFFICULTY_LABELS[difficulty],
    edgeBonus,
    hidden,
    reason,
    source: 'damper',
    damperSync
  }
}
