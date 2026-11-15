import { DIFFICULTY_TIERS, normalizeDifficulty } from './dice-engine.js'

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
  { key: 'social', pattern: /说服|劝说|诱骗|欺骗|撒谎|威逼|威胁|谈判|讨价还价|安抚|套话|诱导|审问/ },
  { key: 'arcana', pattern: /施法|魔力|破解|黑客|骇入|手术|炼金|操控|拆弹|修理|驾驶|黑进/ },
  { key: 'physical', pattern: /攻击|闪避|格挡|冲撞|攀爬|跳跃|踢开|砸开|按住|挣脱|反抗|追逐|搏斗|推倒|强行/ },
  { key: 'will', pattern: /抵抗|强忍|抵御|克制|直面|承受|稳住|克服恐惧/ }
]

const HIGH_STAKES_CUE = /强行|拼死|当面|守卫|防备|严密|不可能|徒手|几乎|违抗|高空|重伤|绝境|暗杀/
const EASY_CUE = /顺手|悄悄检查|尝试|打听|轻微|试探|简单/

function scoreToEdgeBonus(scoreValue) {
  const num = Number(scoreValue)
  if (!Number.isFinite(num)) return 0
  if (num >= 2.5) return 2
  if (num >= 1.5) return 1
  if (num <= 0.6) return -1
  return 0
}

function buildJudgeMaterial({ input, recentContext = '' }) {
  const cleanInput = String(input || '').trim().slice(0, 1800)
  const cleanCtx = String(recentContext || '').trim().slice(0, 900)
  return [
    cleanCtx ? `【当前场景前情摘录】\n${cleanCtx}` : '',
    `【本轮受控角色行动输入】\n${cleanInput}`
  ].filter(Boolean).join('\n\n')
}

export function heuristicAssess({ input, sensitivity = 'normal', allowHidden = true }) {
  const text = String(input || '').trim()
  if (!text || text.length < 3) {
    return { shouldRoll: false, check: '行动', difficulty: 'moderate', edgeBonus: 0, hidden: false, reason: '纯简短交互无需检定', source: 'heuristic' }
  }
  const hit = HEURISTIC_RULES.find(item => item.pattern.test(text))
  const hasActionVerb = Boolean(hit) || /[！!]|尝试|试着|打算|偷偷|硬生生|强行/.test(text)
  if (!hasActionVerb && sensitivity !== 'strict') {
    return { shouldRoll: false, check: '行动', difficulty: 'moderate', edgeBonus: 0, hidden: false, reason: '常规对话与描写，直接推进剧情', source: 'heuristic' }
  }
  const meta = CATEGORY_META[hit?.key || 'physical']
  let difficulty = 'moderate'
  if (HIGH_STAKES_CUE.test(text)) difficulty = 'hard'
  else if (EASY_CUE.test(text)) difficulty = 'easy'

  return {
    shouldRoll: Boolean(hit) || sensitivity === 'strict',
    check: meta.label,
    difficulty,
    edgeBonus: 0,
    hidden: Boolean(allowHidden && meta.hidden),
    reason: hit ? `识别到「${meta.label}」相关不确定行动` : '主动尝试需要判定结果',
    source: 'heuristic'
  }
}

/**
 * 复用宿主 decisionJudge 判定本次行动是否需要检定、难度档位、情景加减值与暗骰倾向。
 * 内置 R18 送审脱敏参数（由宿主逐级执行 full -> skeleton -> digest 安全降级）。
 */
export async function judgeActionDifficulty({
  tavern,
  gameId,
  input,
  recentContext = '',
  sensitivity = 'normal',
  allowHidden = true,
  timeoutMs = 2500,
  signal
} = {}) {
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.normal
  const material = buildJudgeMaterial({ input, recentContext })

  if (!tavern?.capabilities?.decisionJudge || typeof tavern.decisionJudgeStatus !== 'function' || typeof tavern.judgeDecision !== 'function') {
    return heuristicAssess({ input, sensitivity, allowHidden })
  }

  let status
  try {
    status = await tavern.decisionJudgeStatus()
  } catch {
    return heuristicAssess({ input, sensitivity, allowHidden })
  }

  if (!status?.available) {
    return heuristicAssess({ input, sensitivity, allowHidden })
  }

  const supportsStructured = Boolean(status.capabilities?.choice && status.capabilities?.score)

  try {
    if (supportsStructured) {
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
          {
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
          },
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
          }
        ]
      })

      const ans = response.answers || {}
      const prob = Number(ans.needs_check?.probability ?? 0)
      const shouldRoll = prob >= threshold
      const difficulty = normalizeDifficulty(ans.difficulty_tier?.choice)
      const catKey = Object.hasOwn(CATEGORY_META, ans.check_category?.choice) ? ans.check_category.choice : 'physical'
      const meta = CATEGORY_META[catKey]
      const edgeBonus = scoreToEdgeBonus(ans.situation_edge?.score)

      return {
        shouldRoll,
        needProbability: Math.round(prob * 100) / 100,
        check: meta.label,
        difficulty,
        edgeBonus,
        hidden: Boolean(allowHidden && meta.hidden),
        reason: `决策模型(${response.judgeTier || 'full'}): 触发概率 ${Math.round(prob * 100)}%`,
        source: 'decision-judge',
        provider: response.provider,
        judgeTier: response.judgeTier,
        retriedSafetyFallback: Boolean(response.retriedSafetyFallback)
      }
    }

    // 仅支持 noul 的提供方（jev / openai）使用并发是非概率题折算
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
        }
      ]
    })

    const ans = response.answers || {}
    const prob = Number(ans.needs_check?.probability ?? 0)
    const hardProb = Number(ans.high_difficulty?.probability ?? 0.5)
    const edgeProb = Number(ans.favorable_edge?.probability ?? 0.5)
    const hiddenProb = Number(ans.hidden_perception?.probability ?? 0)

    let difficulty = 'moderate'
    if (hardProb >= 0.82) difficulty = 'extreme'
    else if (hardProb >= 0.62) difficulty = 'hard'
    else if (hardProb <= 0.2) difficulty = 'trivial'
    else if (hardProb <= 0.36) difficulty = 'easy'

    const edgeBonus = edgeProb >= 0.72 ? 1 : (edgeProb <= 0.28 ? -1 : 0)
    const isHidden = Boolean(allowHidden && hiddenProb >= 0.65)
    const check = isHidden ? '察觉' : '行动'

    return {
      shouldRoll: prob >= threshold,
      needProbability: Math.round(prob * 100) / 100,
      check,
      difficulty,
      edgeBonus,
      hidden: isHidden,
      reason: `决策模型(${response.judgeTier || 'full'}): 触发概率 ${Math.round(prob * 100)}%`,
      source: 'decision-judge',
      provider: response.provider,
      judgeTier: response.judgeTier,
      retriedSafetyFallback: Boolean(response.retriedSafetyFallback)
    }
  } catch {
    // 决策请求异常（限流、超时、服务不可用等）时静默回退到本地启发式，保障玩家体验连续
    return heuristicAssess({ input, sensitivity, allowHidden })
  }
}
