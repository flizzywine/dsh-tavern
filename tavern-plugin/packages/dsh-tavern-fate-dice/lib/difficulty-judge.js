import {
  DIFFICULTY_LABELS,
  normalizeDifficulty
} from './dice-engine.js'
import {
  CAPABILITY_CRITERIA,
  DOMAIN_FALLBACKS,
  SKILL_CATEGORIES,
  capabilityScoreToTier,
  findMatchingSkill,
  probabilitiesToTier,
  profileTraitsToSkills,
  resolveDomainChoice,
  resolveEffectiveCapability,
  tierToRuleBonus
} from './auto-profiler.js'

const SENSITIVITY_THRESHOLDS = Object.freeze({
  strict: 0.35,
  normal: 0.55,
  rare: 0.78
})

const CATEGORY_META = Object.freeze({
  physical: { label: '体魄', hidden: false },
  stealth: { label: '潜行', hidden: false },
  social: { label: '说服', hidden: false },
  insight: { label: '察觉', hidden: true },
  arcana: { label: '技艺', hidden: false },
  will: { label: '意志', hidden: false }
})

const HEURISTIC_RULES = [
  { key: 'insight', pattern: /观察|查看|察觉|侦查|窃听|偷听|搜索|调查|识破|判断.*撒谎|暗中确认|寻找线索|陷阱/ },
  { key: 'stealth', pattern: /潜行|偷窃|撬锁|开锁|躲避|藏匿|摸近|跟踪|溜进|逃跑|摆脱/ },
  { key: 'social', pattern: /说服|劝说|诱骗|欺骗|撒谎|威逼|威胁|谈判|讨价还价|安抚|套话|诱导|审问|辩论|舌战|对质|质证|诈唬|竞标|商战/ },
  { key: 'arcana', pattern: /施法|魔力|破解|黑客|骇入|手术|炼金|操控|拆弹|修理|驾驶|黑进|斗法|斗丹|斗阵|御剑|对弈|下棋|飙车|竞速|赛车|赌局|对赌|梭哈|出千|攻防/ },
  { key: 'physical', pattern: /攻击|闪避|格挡|冲撞|攀爬|跳跃|踢开|砸开|按住|挣脱|反抗|追逐|搏斗|打斗|对抗|战斗|交锋|交战|缠斗|扭打|激战|对决|厮杀|拼杀|比武|切磋|对掌|擂台|枪战|火拼|射击|比赛|单挑|拳击|角力|推倒|强行/ },
  { key: 'will', pattern: /抵抗|强忍|抵御|克制|直面|承受|稳住|克服恐惧|神识|威压|内力比拼|拼内力|赌命/ }
]

const HIGH_STAKES_CUE = /强行|拼死|当面|守卫|防备|严密|不可能|徒手|几乎|违抗|高空|重伤|绝境|暗杀/
const EASY_CUE = /顺手|悄悄检查|尝试|打听|轻微|试探|简单/

const CONTEST_CUE_GROUPS = [
  // 通用肉搏 / 战斗 / 冷兵器
  '挥剑|拔剑|砍向|劈向|刺向|斩向|挥刀|拔刀|横扫|格挡|招架|拆招|迎战|应战|交手|决斗|搏斗|拼刀|反击|追逐|追击|擒拿|压制|硬刚|对峙|打斗|对抗|战斗|交锋|交战|缠斗|扭打|肉搏|激战|对决|过招|比试|较量|开打|打起来|厮杀|拼杀|对攻|交火|抢夺|争夺|扑向|冲上去打|制伏|制服|角力|掰手腕|摔跤|互殴|群殴|单挑|约架|突袭|偷袭|伏击|反杀|死斗|血战',
  // 武侠 / 功夫 / 江湖
  '切磋|比武|论剑|对掌|拼内力|内力比拼|比拼内力|真气对抗|拆解招式|剑气|刀气|掌风|拳风|点穴|暗器|飞刀|轻功追逐|打擂|擂台|守擂|攻擂|踢馆|破阵|过两招|领教高招|分个高下|一决高下|一较高下|生死斗|比剑|斗拳',
  // 仙侠 / 玄幻 / 奇幻法术
  '斗法|斗剑|斗丹|斗阵|斗灵|御剑|祭出法宝|灵力对轰|法术对轰|对波|神识交锋|神识对抗|神念交锋|威压对抗|抵挡威压|镇压|灵压|剑意交锋|领域对抗|法相|斩妖|除魔|斗兽|魔法对决|施法对轰|魔力对抗|咒语对决|元素碰撞|契约争夺',
  // 现代 / 枪战 / 竞速 / 职场商战 / 攻防
  '开枪|射击|枪战|火拼|对射|狙击|点射|扫射|飙车|竞速|赛车|超车|别车|逼停|追车|飙速|黑客攻防|网络攻防|攻防战|反入侵|竞标|抢标|商战|收购战|舆论战|法庭辩论|庭审交锋|质证|对质|辩论|舌战|嘴炮|心理博弈|博弈|智斗|斗智|拉锯战',
  // 比赛 / 竞技 / 体育 / 电竞
  '比赛|竞赛|竞技|决赛|淘汰赛|晋级赛|加时赛|点球|抢七|PK|pk|单挑赛|排位赛|对局|对弈|下棋|弈棋|斗牛|拳击|格斗赛|散打|柔道|击剑|射箭比赛|拔河|赛跑|百米冲刺|抢答|夺冠|争冠|卫冕|挑战赛|擂台赛',
  // 赌博 / 牌桌 / 博弈
  '赌博|赌局|对赌|豪赌|押注|下注|梭哈|全压|all\\s*in|ALL\\s*IN|跟注|加注|诈唬|抓诈|比大小|摇骰子|掷色子|赌骰|猜大小|牌局|德州扑克|二十一点|轮盘|出千|抓千|反千|赌命|打赌|对押'
]
const CONTEST_CUE = new RegExp(CONTEST_CUE_GROUPS.join('|'))

export const CONTEST_QUESTION_INSTRUCTIONS =
  '这项行动是否是与明确对手/敌人之间的双边交锋或胜负较量（包括打斗搏杀、武侠比武切磋、仙侠斗法神识交锋、现代枪战竞速攻防、体育/棋牌比赛、赌局对赌诈唬、辩论对质等，而非单人克服静态环境障碍）？'

export function detectContestIntent(input, category = 'physical') {
  const text = String(input || '')
  if (!text) return false
  if (category === 'insight' || category === 'stealth') return false
  return CONTEST_CUE.test(text)
}

export function resolveContestCheckType({ input, category = 'physical', hidden = false, contestProb = NaN } = {}) {
  if (hidden) return 'normal'
  if (Number.isFinite(contestProb)) {
    if (contestProb >= 0.6) return 'contest'
    if (contestProb <= 0.25) return 'normal'
  }
  return detectContestIntent(input, category) ? 'contest' : 'normal'
}

function scoreToEdgeBonus(scoreValue) {
  const num = Number(scoreValue)
  if (!Number.isFinite(num)) return 0
  if (num >= 2.5) return 2
  if (num >= 1.5) return 1
  if (num <= 0.6) return -1
  return 0
}

function buildJudgeMaterial({ input, recentContext = '', characterMaterial = '' }) {
  const cleanInput = String(input || '').trim().slice(0, 1800)
  const cleanCtx = String(recentContext || '').trim().slice(0, 900)
  const cleanCharacter = String(characterMaterial || '').trim().slice(0, 1800)
  return [
    cleanCharacter ? `【受控角色人设与当前状态】\n${cleanCharacter}` : '',
    cleanCtx ? `【当前场景前情摘录】\n${cleanCtx}` : '',
    `【本轮受控角色行动输入】\n${cleanInput}`
  ].filter(Boolean).join('\n\n')
}

function profileTraitList(profile) {
  return (Array.isArray(profile?.traits) ? profile.traits : []).filter(item => item && item.name).slice(0, 10)
}

function buildDomainQuestion(profile, skills) {
  const traits = profileTraitList(profile)
  const skillList = (Array.isArray(skills) ? skills : []).filter(item => item && item.name).slice(0, 24)
  if (traits.length >= 1) {
    const criteria = {}
    for (const trait of traits) {
      const sign = Number(trait.tier) >= 0 ? '+' : ''
      criteria[String(trait.id || trait.name)] = `${trait.name}（画像特征[${sign}${Number(trait.tier) || 0}]${trait.source ? `·${trait.source}` : ''}${trait.hidden ? '·暗骰' : ''}）`
    }
    for (const [key, meta] of Object.entries(DOMAIN_FALLBACKS)) {
      criteria[key] = `${meta.label}（通用能力域${meta.hidden ? '·暗骰' : ''}）`
    }
    return {
      id: 'character_domain',
      type: 'choice',
      instructions: '这项行动最贴合受控角色的哪项画像能力或通用能力域？',
      criteria
    }
  }
  if (skillList.length >= 2) return buildSkillChoiceQuestion(skillList)
  return {
    id: 'check_category',
    type: 'choice',
    instructions: '判断这项行动最贴合的检定能力类别：',
    criteria: {
      physical: '体魄：搏斗、攀爬、闪避、挣脱、力量碰撞',
      stealth: '潜行：隐蔽行动、开锁、偷窃、跟踪、悄无声息接近',
      social: '说服：谈判、威逼、诱导、撒谎欺瞒、社交交锋',
      insight: '察觉：暗中侦查、识破谎言、感知危机、搜寻隐藏线索',
      arcana: '技艺：专业技巧、医疗、破解、魔法或器械操作',
      will: '意志：精神抵抗、强忍疼痛/诱惑、抗压与定力'
    }
  }
}

function buildCapabilityQuestion() {
  return {
    id: 'character_capability',
    type: 'score',
    instructions: '根据角色人设、世界书设定、当前 MVU 状态与近期正文，评估受控角色在本次行动上的自身能力与状态档位：',
    criteria: [...CAPABILITY_CRITERIA]
  }
}

function pickSkillForInput(input, skills, profile = null, rule = '2d6') {
  const text = String(input || '')
  const traitSkills = profileTraitsToSkills(profile, rule)
  const extraSkills = Array.isArray(skills) ? skills.filter(item => item && item.name) : []
  const list = [...traitSkills, ...extraSkills]
  if (!list.length) return null
  const named = list
    .filter(item => text.includes(String(item.name)))
    .sort((a, b) => (String(b.name).length - String(a.name).length) || (Number(Boolean(b.fromProfile)) - Number(Boolean(a.fromProfile))))
  if (named.length) return named[0]
  const hit = HEURISTIC_RULES.find(item => item.pattern.test(text))
  if (hit) {
    const sameCategory = list.filter(item => item.category === hit.key)
    if (sameCategory.length) {
      const profileHit = sameCategory.find(item => item.fromProfile)
      return profileHit || sameCategory.find(item => !item.hidden) || sameCategory[0]
    }
  }
  return null
}

function assess(input, sensitivity, allowHidden, skills, profile = null, rule = '2d6') {
  const text = String(input || '').trim()
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.normal
  const matchedSkill = pickSkillForInput(text, skills, profile, rule)
  const matchedProfileDomain = matchedSkill?.fromProfile
    ? {
        kind: 'trait',
        trait: matchedSkill.trait,
        name: matchedSkill.name,
        tier: matchedSkill.tier,
        category: matchedSkill.category,
        hidden: Boolean(matchedSkill.hidden)
      }
    : null
  const effectiveCap = resolveEffectiveCapability({
    profileDomain: matchedProfileDomain,
    capability: null,
    fallbackSkillBonus: Number(matchedSkill?.bonus) || 0,
    rule
  })
  if (!text || text.length < 3) {
    return {
      shouldRoll: false,
      check: matchedSkill?.name || '行动',
      skillId: matchedSkill?.id || 'general',
      skillName: matchedSkill?.name || '行动',
      skillBonus: effectiveCap.bonus,
      capabilityTier: effectiveCap.tier,
      capabilitySource: effectiveCap.source,
      capabilityBreakdown: {
        baseTraitTier: effectiveCap.baseTraitTier,
        baseTraitBonus: effectiveCap.baseTraitBonus,
        tempStateBonus: effectiveCap.tempStateBonus
      },
      profileDomain: matchedProfileDomain
        ? { kind: 'trait', name: matchedProfileDomain.name, tier: matchedProfileDomain.tier, category: matchedProfileDomain.category }
        : null,
      category: matchedSkill?.category || 'physical',
      difficulty: 'moderate',
      difficultyLabel: DIFFICULTY_LABELS.moderate,
      edgeBonus: 0,
      hidden: false,
      needProbability: 0,
      threshold,
      reason: '纯简短交互无需检定',
      source: 'heuristic'
    }
  }
  const hit = HEURISTIC_RULES.find(item => item.pattern.test(text))
  const hasActionVerb = Boolean(hit) || Boolean(matchedSkill?.fromProfile && text.includes(matchedSkill.name)) || /[！!]|尝试|试着|打算|偷偷|硬生生|强行/.test(text)
  const category = matchedSkill?.category || hit?.key || 'physical'
  const meta = CATEGORY_META[category] || CATEGORY_META.physical
  const check = matchedSkill?.name || meta.label
  const base = {
    check,
    skillId: matchedSkill?.id || 'general',
    skillName: check,
    skillBonus: effectiveCap.bonus,
    capabilityTier: effectiveCap.tier,
    capabilitySource: effectiveCap.source,
    capabilityBreakdown: {
      baseTraitTier: effectiveCap.baseTraitTier,
      baseTraitBonus: effectiveCap.baseTraitBonus,
      tempStateBonus: effectiveCap.tempStateBonus
    },
    profileDomain: matchedProfileDomain
      ? { kind: 'trait', name: matchedProfileDomain.name, tier: matchedProfileDomain.tier, category: matchedProfileDomain.category }
      : null,
    category,
    difficultyLabel: DIFFICULTY_LABELS.moderate,
    edgeBonus: 0,
    source: 'heuristic'
  }
  if (!hasActionVerb && sensitivity !== 'strict') {
    return {
      ...base,
      shouldRoll: false,
      difficulty: 'moderate',
      difficultyLabel: DIFFICULTY_LABELS.moderate,
      hidden: false,
      needProbability: 0,
      threshold,
      reason: '常规对话与描写，直接推进剧情'
    }
  }
  let difficulty = 'moderate'
  const resistanceFactors = []
  if (HIGH_STAKES_CUE.test(text)) {
    difficulty = 'hard'
    resistanceFactors.push({ label: '高压险境', delta: '困难', source: 'scene' })
  } else if (EASY_CUE.test(text)) {
    difficulty = 'easy'
    resistanceFactors.push({ label: '轻试探', delta: '容易', source: 'scene' })
  }
  const hidden = Boolean(allowHidden && (matchedSkill?.hidden || meta.hidden))
  const checkType = !hidden && detectContestIntent(text, category) ? 'contest' : 'normal'
  return {
    ...base,
    checkType,
    resistanceFactors,
    shouldRoll: Boolean(hit) || sensitivity === 'strict' || text.length >= 12,
    needProbability: Math.min(1, Math.max(threshold, Boolean(hit) ? 0.7 : 0.3)),
    threshold,
    difficulty,
    difficultyLabel: DIFFICULTY_LABELS[difficulty],
    hidden,
    reason: hit ? `识别到「${check}」相关不确定行动` : '主动尝试需要判定结果'
  }
}

/** 无技能表时的启发式评估（保留旧签名）。 */
export function heuristicAssess({ input, sensitivity = 'normal', allowHidden = true } = {}) {
  return assess(input, sensitivity, allowHidden, [])
}

/** 带当前局技能表/能力画像的启发式评估：支持对象参数或位置参数调用。 */
export function heuristicAssessWithSkills(inputOrOpts, skills = [], sensitivity = 'normal', allowHidden = true, profile = null, rule = '2d6') {
  if (inputOrOpts && typeof inputOrOpts === 'object' && !Array.isArray(inputOrOpts)) {
    return assess(
      inputOrOpts.input,
      inputOrOpts.sensitivity ?? 'normal',
      inputOrOpts.allowHidden !== false,
      inputOrOpts.skills ?? [],
      inputOrOpts.profile ?? null,
      inputOrOpts.rule ?? '2d6'
    )
  }
  return assess(inputOrOpts, sensitivity, allowHidden, skills, profile, rule)
}

function buildSkillChoiceQuestion(skills) {
  const list = (Array.isArray(skills) ? skills : []).filter(item => item && item.name).slice(0, 24)
  const criteria = {}
  for (const item of list) {
    criteria[item.id] = `${item.name}（${SKILL_CATEGORIES[item.category]?.label || '综合'}${item.hidden ? '·暗骰' : ''}）`
  }
  return {
    id: 'check_skill',
    type: 'choice',
    instructions: '判断这项行动最贴合当前角色的哪项技能：',
    criteria
  }
}

/**
 * 复用宿主 decisionJudge 判定本轮行动：是否需要检定、难度、技能与暗骰倾向。
 * 支持动态传入当前局技能表（choice 挑技能），失败时静默回退本地启发式。
 */
export async function judgeActionDifficulty({
  tavern,
  gameId,
  input,
  recentContext = '',
  characterMaterial = '',
  profile = null,
  skills = [],
  rule = '2d6',
  sensitivity = 'normal',
  allowHidden = true,
  timeoutMs = 2500,
  signal
} = {}) {
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.normal
  const material = buildJudgeMaterial({ input, recentContext, characterMaterial })
  const fallback = () => heuristicAssessWithSkills(input, skills, sensitivity, allowHidden, profile, rule)
  const skillList = Array.isArray(skills) ? skills.filter(item => item && item.name) : []

  if (!tavern?.capabilities?.decisionJudge || typeof tavern.decisionJudgeStatus !== 'function' || typeof tavern.judgeDecision !== 'function') {
    return fallback()
  }

  let status
  try {
    status = await tavern.decisionJudgeStatus()
  } catch {
    return fallback()
  }
  if (!status?.available) return fallback()

  const supportsStructured = Boolean(status.capabilities?.choice && status.capabilities?.score)

  try {
    if (supportsStructured) {
      const questions = [
        {
          id: 'needs_check',
          type: 'noul',
          instructions: '玩家本轮行动是否包含真正的结果不确定性、物理/心理阻力、欺瞒对抗或需要侦查发现的隐情（而非纯日常对话、内省或必定成功的轻松行为）？'
        },
        {
          id: 'difficulty_tier',
          type: 'choice',
          instructions: '结合前情与当前阻力，评估该行动的客观难度档位：',
          criteria: {
            trivial: '极易：几乎没有阻碍，仅微小意外才可能出错',
            easy: '容易：有常规成功把握，稍加注意即可达成',
            moderate: '中等：成败参半，需要真正拼搏或运气',
            hard: '困难：逆境、强防备、高技巧或不利处境下的强行尝试',
            extreme: '极难：以弱胜强、几乎违背常理或严密防线下的冒险一搏'
          }
        },
        buildCapabilityQuestion(),
        buildDomainQuestion(profile, skillList),
        {
          id: 'situation_edge',
          type: 'score',
          instructions: '评估角色当前是否提前做了充分铺垫、占据有利地利或恰好处于明显劣势？',
          criteria: [
            '0: 明显处于被动、仓促或暴露劣势之中',
            '1: 常规临场尝试，无额外明显优势或劣势',
            '2: 有一定铺垫、契机或利用了现成环境条件',
            '3: 准备极充分、精准拿捏关键条件或掌握压倒性筹码'
          ]
        },
        {
          id: 'is_contest',
          type: 'noul',
          instructions: CONTEST_QUESTION_INSTRUCTIONS
        }
      ]

      const response = await tavern.judgeDecision({
        ...(gameId ? { gameId } : {}),
        input: material,
        desensitize: true,
        timeoutMs,
        ...(signal ? { signal } : {}),
        questions
      })

      const ans = response.answers || {}
      const prob = Number(ans.needs_check?.probability ?? 0)
      const difficulty = normalizeDifficulty(ans.difficulty_tier?.choice)
      let matched = null
      if (skillList.length >= 2) {
        matched = findMatchingSkill(skillList, ans.check_skill?.choice)
        if (matched.id === 'general') matched = null
      }
      const rawCapabilityScore = ans.character_capability?.score ?? ans.character_capability?.value
      const capabilityScore = Number(rawCapabilityScore)
      const hasCapability = Number.isFinite(capabilityScore)
      const capabilityTier = hasCapability ? capabilityScoreToTier(capabilityScore) : 0
      const capabilityBonus = hasCapability ? tierToRuleBonus(capabilityTier, rule) : NaN
      const domain = resolveDomainChoice(
        profileTraitList(profile).length ? profile : null,
        ans.character_domain?.choice || ans.check_skill?.choice || ans.check_category?.choice
      )
      const effectiveCap = resolveEffectiveCapability({
        profileDomain: domain,
        capability: hasCapability ? { tier: capabilityTier, bonus: capabilityBonus, source: 'score' } : null,
        fallbackSkillBonus: Number(matched?.bonus) || 0,
        rule
      })
      const catKey = Object.hasOwn(CATEGORY_META, ans.check_category?.choice) ? ans.check_category.choice : 'physical'
      const meta = CATEGORY_META[catKey]
      const edgeBonus = scoreToEdgeBonus(ans.situation_edge?.score)
      const check = (domain?.kind === 'domain' ? domain.name : '') || domain?.name || matched?.name || meta.label
      const category = domain ? domain.category : (matched?.category || catKey)
      const hiddenMeta = CATEGORY_META[category] || meta
      const hidden = Boolean(allowHidden && (domain?.hidden || matched?.hidden || hiddenMeta.hidden))
      const contestProb = ans.is_contest?.probability !== undefined ? Number(ans.is_contest.probability) : NaN
      const checkType = resolveContestCheckType({ input, category, hidden, contestProb })
      const resistanceFactors = []
      if (edgeBonus > 0) resistanceFactors.push({ label: '铺垫/地利', delta: `+${edgeBonus}`, source: 'edge' })
      else if (edgeBonus < 0) resistanceFactors.push({ label: '仓促/被动', delta: `${edgeBonus}`, source: 'edge' })

      return {
        shouldRoll: prob >= threshold,
        needProbability: Math.round(prob * 100) / 100,
        threshold,
        check,
        checkType,
        resistanceFactors,
        skillId: domain?.kind === 'trait'
          ? String(domain.trait.id)
          : (domain?.kind === 'domain' ? String(domain.name) : (matched?.id || 'general')),
        skillName: check,
        skillBonus: effectiveCap.bonus,
        capabilityTier: effectiveCap.tier,
        capabilityScore: hasCapability ? capabilityScore : null,
        capabilitySource: effectiveCap.source,
        capabilityBreakdown: {
          baseTraitTier: effectiveCap.baseTraitTier,
          baseTraitBonus: effectiveCap.baseTraitBonus,
          tempStateBonus: effectiveCap.tempStateBonus
        },
        profileDomain: domain
          ? { kind: domain.kind, name: domain.name, tier: domain.tier, category: domain.category }
          : null,
        category,
        difficulty,
        difficultyLabel: DIFFICULTY_LABELS[difficulty],
        edgeBonus,
        hidden,
        rule,
        reason: `决策模型(${response.judgeTier || 'full'}): 触发概率 ${Math.round(prob * 100)}%`,
        source: 'decision-judge',
        provider: response.provider,
        judgeTier: response.judgeTier,
        retriedSafetyFallback: Boolean(response.retriedSafetyFallback)
      }
    }

    // 仅支持 noul 的提供方（jev / openai）用并发是/否题折算
    const response = await tavern.judgeDecision({
      ...(gameId ? { gameId } : {}),
      input: material,
      desensitize: true,
      timeoutMs,
      ...(signal ? { signal } : {}),
      questions: [
        {
          id: 'needs_check',
          type: 'noul',
          instructions: '玩家本轮行动是否包含明显的结果不确定性、阻力冲突或需要发现隐情，而不是必定成功的日常互动？'
        },
        {
          id: 'high_difficulty',
          type: 'noul',
          instructions: '以普通角色能力衡量，这项尝试本身是否属于困难或高风险行动？'
        },
        {
          id: 'favorable_edge',
          type: 'noul',
          instructions: '角色当前是否具备充分的前期铺垫、情报或有利处境来提高成功率？'
        },
        {
          id: 'hidden_perception',
          type: 'noul',
          instructions: '这项行动的核心是否在于察觉秘密、识破伪装或探测角色不应立即得知真相的事？'
        },
        {
          id: 'character_skilled',
          type: 'noul',
          instructions: '依据受控角色的人设、世界书位格与当前 MVU 状态，这件事是否正是其擅长领域？'
        },
        {
          id: 'character_impaired',
          type: 'noul',
          instructions: '受控角色当前是否处于短板、伤病、虚弱或被束缚的状态，从而难以正常发挥？'
        },
        {
          id: 'is_contest',
          type: 'noul',
          instructions: CONTEST_QUESTION_INSTRUCTIONS
        }
      ]
    })

    const ans = response.answers || {}
    const prob = Number(ans.needs_check?.probability ?? 0)
    const hardProb = Number(ans.high_difficulty?.probability ?? 0.5)
    const edgeProb = Number(ans.favorable_edge?.probability ?? 0.5)
    const hiddenProb = Number(ans.hidden_perception?.probability ?? 0)
    const skilledProb = Number(ans.character_skilled?.probability ?? 0)
    const impairedProb = Number(ans.character_impaired?.probability ?? 0)
    const capabilityTier = probabilitiesToTier({ skilled: skilledProb, impaired: impairedProb })
    const capabilityBonus = tierToRuleBonus(capabilityTier, rule)

    let difficulty = 'moderate'
    if (hardProb >= 0.82) difficulty = 'extreme'
    else if (hardProb >= 0.62) difficulty = 'hard'
    else if (hardProb <= 0.2) difficulty = 'trivial'
    else if (hardProb <= 0.36) difficulty = 'easy'

    const edgeBonus = edgeProb >= 0.72 ? 1 : (edgeProb <= 0.28 ? -1 : 0)
    const isHidden = Boolean(allowHidden && hiddenProb >= 0.65)
    const guessed = pickSkillForInput(String(input || ''), skillList, profile, rule)
    const guessedDomain = guessed?.fromProfile
      ? { kind: 'trait', trait: guessed.trait, name: guessed.name, tier: guessed.tier, category: guessed.category, hidden: Boolean(guessed.hidden) }
      : null
    const effectiveCap = resolveEffectiveCapability({
      profileDomain: guessedDomain,
      capability: { tier: capabilityTier, bonus: capabilityBonus, source: 'noul' },
      fallbackSkillBonus: Number(guessed?.bonus) || 0,
      rule
    })
    const check = guessed?.name || (isHidden ? '察觉' : '行动')
    const category = guessed?.category || (isHidden ? 'insight' : 'physical')
    const finalHidden = Boolean(isHidden || (allowHidden && guessed?.hidden))
    const contestProb = ans.is_contest?.probability !== undefined ? Number(ans.is_contest.probability) : NaN
    const checkType = resolveContestCheckType({ input, category, hidden: finalHidden, contestProb })
    const resistanceFactors = []
    if (edgeBonus > 0) resistanceFactors.push({ label: '有利处境', delta: '+1', source: 'edge' })
    else if (edgeBonus < 0) resistanceFactors.push({ label: '不利处境', delta: '-1', source: 'edge' })

    return {
      shouldRoll: prob >= threshold,
      needProbability: Math.round(prob * 100) / 100,
      threshold,
      check,
      checkType,
      resistanceFactors,
      skillId: guessed?.id || 'general',
      skillName: check,
      skillBonus: effectiveCap.bonus,
      capabilityTier: effectiveCap.tier,
      capabilityScore: null,
      capabilitySource: effectiveCap.source,
      capabilityBreakdown: {
        baseTraitTier: effectiveCap.baseTraitTier,
        baseTraitBonus: effectiveCap.baseTraitBonus,
        tempStateBonus: effectiveCap.tempStateBonus
      },
      profileDomain: guessedDomain
        ? { kind: 'trait', name: guessedDomain.name, tier: guessedDomain.tier, category: guessedDomain.category }
        : null,
      category,
      difficulty,
      difficultyLabel: DIFFICULTY_LABELS[difficulty],
      edgeBonus,
      hidden: finalHidden,
      rule,
      reason: `决策模型(${response.judgeTier || 'full'}): 触发概率 ${Math.round(prob * 100)}%`,
      source: 'decision-judge',
      provider: response.provider,
      judgeTier: response.judgeTier,
      retriedSafetyFallback: Boolean(response.retriedSafetyFallback)
    }
  } catch {
    return fallback()
  }
}
