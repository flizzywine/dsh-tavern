import {
  DIFFICULTY_LABELS,
  normalizeDifficulty,
  shiftDifficulty
} from './dice-engine.js'
import {
  CONTEST_QUESTION_INSTRUCTIONS,
  heuristicAssessWithSkills,
  resolveContestCheckType
} from './difficulty-judge.js'
import {
  CAPABILITY_CRITERIA,
  DOMAIN_FALLBACKS,
  SKILL_CATEGORIES,
  capabilityScoreToTier,
  findMatchingSkill,
  probabilitiesToTier,
  resolveDomainChoice,
  resolveEffectiveCapability,
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

const ACTION_ATTEMPT_CUE = /尝试|试图|试着|打算|伸手|举起|抬起|抬手|挥舞|挥动|挥剑|挥刀|冲向|冲上|冲入|冲出|扑向|扑过去|奔向|奔跑|走向|走近|走出|跑向|跑开|逃跑|摸向|掏出|拔出|拔剑|拔刀|推开|推倒|拉开|拉住|踢开|踹开|喊出|高喊|大喊|低声|开口|靠近|转身|拔腿|按下|启动|施法|施展|发动|凝聚|瞄准|架住|格挡|挡住|抵挡|躲开|躲避|闪避|潜入|潜行|跟踪|观察|查看|翻找|翻越|攀爬|爬上|跃起|跳上|跳跃|撬开|开锁|破解|询问|追问|质问|打听|交谈|谈判|劝说|说服|威胁|安抚|亲吻|抱住|攻击|进攻|反击|刺向|砍向|劈向|射击|开枪|挣脱|按住|夺取|抢夺/g
const NEGATION_PREFIX_CUE = /(?:没|没有|并未|未曾|不曾|不用|无需|不必|无须|从未|根本没|绝不|不去|不再|懒得|不打算|不准备)(?:去|再|曾|要|会)?\s*$/

/** 判断越权输入中是否包含未被否定修饰的合法动作尝试。 */
export function hasLegitimateActionAttempt(text) {
  const raw = String(text || '')
  if (!raw) return false
  ACTION_ATTEMPT_CUE.lastIndex = 0
  let match
  while ((match = ACTION_ATTEMPT_CUE.exec(raw)) !== null) {
    const before = raw.slice(Math.max(0, match.index - 10), match.index)
    const clauseBefore = before.split(/[，,。！？!?；;\n]/).pop() || ''
    if (NEGATION_PREFIX_CUE.test(clauseBefore)) continue
    return true
  }
  return false
}

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
  if (traits.length >= 1) {
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

  const contestQuestion = {
    id: 'fd_contest',
    type: 'noul',
    instructions: CONTEST_QUESTION_INSTRUCTIONS
  }

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
      questions.push(contestQuestion)
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
    questions.push(contestQuestion)
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
    questions.push(contestQuestion)
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
  questions.push(contestQuestion)
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

function readNestedStateValue(data, key, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 3) return undefined
  if (data[key] !== undefined) {
    const num = Number(data[key])
    return Number.isFinite(num) ? num : undefined
  }
  for (const [childKey, value] of Object.entries(data)) {
    if (childKey.startsWith('$')) continue
    if (value && typeof value === 'object') {
      const found = readNestedStateValue(value, key, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function readStateValue(data, key, { targetText = '' } = {}) {
  if (!data || typeof data !== 'object') return undefined
  const root = data.stat_data && typeof data.stat_data === 'object' ? data.stat_data : data
  if (root[key] !== undefined) {
    const num = Number(root[key])
    return Number.isFinite(num) ? num : undefined
  }
  const candidates = []
  for (const [childKey, value] of Object.entries(root)) {
    if (childKey.startsWith('$') || !value || typeof value !== 'object') continue
    const found = readNestedStateValue(value, key, 1)
    if (found !== undefined) candidates.push({ name: childKey, value: found })
  }
  if (!candidates.length) return undefined
  if (candidates.length === 1) return candidates[0].value
  const text = String(targetText || '')
  if (!text) return undefined
  const matched = candidates
    .filter(item => item.name && text.includes(item.name))
    .sort((a, b) => b.name.length - a.name.length)
  if (!matched.length) return undefined
  if (matched.length === 1) return matched[0].value
  // 若匹配到多个不同子对象，仅当最长名称严格唯一（如包含关系）或数值一致时采纳，避免跨角色串读
  const topLen = matched[0].name.length
  const topMatches = matched.filter(item => item.name.length === topLen)
  if (topMatches.length === 1 && matched.every(item => matched[0].name.includes(item.name))) {
    return topMatches[0].value
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
    const hasAttempt = hasLegitimateActionAttempt(text)
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
  const fallback = heuristicAssessWithSkills(text, skillList, sensitivity, allowHidden, profile, rule)

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

  // 能力画像：AI 从 fd_domain 直接挑画像特征或通用能力域；无 fd_domain（如 noul 路径）时允许从本地特征匹配补齐
  const domainKey = answerChoice(answers, 'fd_domain') || answerChoice(answers, 'fd_skill') || answerChoice(answers, 'check_skill') || ''
  let profileDomain = resolveDomainChoice(hasUsableProfile(profile) ? profile : null, domainKey)
  if (!profileDomain && !domainKey && fallback.profileDomain?.kind === 'trait' && hasUsableProfile(profile)) {
    profileDomain = resolveDomainChoice(profile, fallback.profileDomain.name)
  }
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
  const effectiveCap = resolveEffectiveCapability({
    profileDomain,
    capability,
    fallbackSkillBonus: Number(matchedSkill?.bonus) || 0,
    rule
  })
  const skillBonus = effectiveCap.bonus

  const damperSync = {}
  let edgeBonus = 0

  if (damperLinkage !== false) {
    const leverageScore = Number(ruling.leverageScore ?? ruling.leverage_score ?? context.leverageScore ?? 0)
    edgeBonus = leverageToEdgeBonus(leverageScore)
    const snapshot = context.stateSnapshot?.data || context.stateSnapshot?.stat_data || context.stateSnapshot || null
    const guard = readStateValue(snapshot, 'psychological_guard', { targetText: text })
    const trust = readStateValue(snapshot, 'intimacy_trust', { targetText: text })
    const tension = readStateValue(snapshot, 'arousal_or_tension', { targetText: text })
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
      capabilityTier: effectiveCap.tier,
      capabilitySource: effectiveCap.source,
      capabilityBonus: skillBonus,
      baseTraitTier: effectiveCap.baseTraitTier,
      baseTraitBonus: effectiveCap.baseTraitBonus,
      tempStateBonus: effectiveCap.tempStateBonus,
      domain: profileDomain
        ? { kind: profileDomain.kind, key: String(domainKey || profileDomain.name), name: profileDomain.name, tier: profileDomain.tier }
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
  const contestProb = firstFinite(
    answerProbability(answers, 'fd_contest'),
    answerProbability(answers, 'is_contest')
  )
  const checkType = resolveContestCheckType({ input: text, category, hidden, contestProb })

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
    capabilityTier: effectiveCap.tier,
    capabilityScore: capability && Number.isFinite(capability.score) ? capability.score : null,
    capabilitySource: effectiveCap.source,
    capabilityBreakdown: {
      baseTraitTier: effectiveCap.baseTraitTier,
      baseTraitBonus: effectiveCap.baseTraitBonus,
      tempStateBonus: effectiveCap.tempStateBonus
    },
    profileDomain: profileDomain
      ? { kind: profileDomain.kind, key: String(domainKey || profileDomain.name), name: profileDomain.name, tier: profileDomain.tier }
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
