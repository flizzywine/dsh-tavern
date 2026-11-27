import { randomInt } from 'node:crypto'

// 五档判定语义，扩展支持 2d6 / d10 / d20 / d100 四种检定骰制
export const DICE_RULES = Object.freeze(['2d6', 'd10', 'd20', 'd100'])
export const DIFFICULTY_TIERS = Object.freeze(['trivial', 'easy', 'moderate', 'hard', 'extreme'])
export const OUTCOME_TIERS = Object.freeze(['critical', 'success', 'costly', 'failure', 'fumble'])

export const DIFFICULTY_LABELS = Object.freeze({
  trivial: '极易',
  easy: '容易',
  moderate: '中等',
  hard: '困难',
  extreme: '极难'
})

export const OUTCOME_LABELS = Object.freeze({
  critical: '大成功',
  success: '成功',
  costly: '代价成功',
  failure: '失败',
  fumble: '大失败'
})

export const RULE_LABELS = Object.freeze({
  '2d6': '2d6 叙事渐进',
  d10: '1d10 技能阶梯',
  d20: '1d20 经典阶梯',
  d100: '1d100 百分阈值'
})

/**
 * 各骰制在 5 档难度下的目标值。
 * - d100：成功上限（原始骰 <= target 为成功）
 * - d10 / d20：检定 DC（修正后总点数 >= target 为成功）
 * - 2d6：叙事渐进基准门槛（7 为中等，其余档位整体平移）
 */
export const RULE_TARGETS = Object.freeze({
  '2d6': Object.freeze({ trivial: 5, easy: 6, moderate: 7, hard: 8, extreme: 10 }),
  d10: Object.freeze({ trivial: 3, easy: 5, moderate: 7, hard: 9, extreme: 11 }),
  d20: Object.freeze({ trivial: 5, easy: 10, moderate: 15, hard: 20, extreme: 25 }),
  d100: Object.freeze({ trivial: 95, easy: 80, moderate: 60, hard: 40, extreme: 20 })
})

/**
 * 技能加值预算规格：min/max 为单项加值合法区间，defaultBonus 为单技能推荐加值，
 * perSkillBudget 为“每技能建议预算”，推荐总预算 = clamp(min, max, count * perSkillBudget)。
 */
export const SKILL_BUDGET_SPECS = Object.freeze({
  '2d6': Object.freeze({ min: -2, max: 4, defaultBonus: 1, perSkillBudget: 1 }),
  d10: Object.freeze({ min: -2, max: 10, defaultBonus: 2, perSkillBudget: 2 }),
  d20: Object.freeze({ min: -4, max: 20, defaultBonus: 3, perSkillBudget: 3 }),
  d100: Object.freeze({ min: -20, max: 100, defaultBonus: 15, perSkillBudget: 15 })
})

const SIDES_BY_RULE = Object.freeze({ '2d6': 6, d10: 10, d20: 20, d100: 100 })

function toFinite(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

export function clamp(value, min, max) {
  const num = toFinite(value, 0)
  return Math.max(min, Math.min(max, num))
}

/** 情景/变量修正限幅，避免单次外部加值碾压骰面。 */
export function clampModifier(value) {
  return Math.trunc(clamp(value, -8, 8))
}

/** 技能加值按当前骰制合法区间限幅。 */
export function clampSkillBonus(value, rule = '2d6') {
  const spec = SKILL_BUDGET_SPECS[normalizeRule(rule)]
  return Math.trunc(clamp(value, spec.min, spec.max))
}

export function normalizeRule(rule) {
  return DICE_RULES.includes(rule) ? rule : '2d6'
}

export function normalizeDifficulty(difficulty) {
  return DIFFICULTY_TIERS.includes(difficulty) ? difficulty : 'moderate'
}

/** 难度档位平移（+1 更难 / -1 更易），越界时贴边返回。 */
export function shiftDifficulty(difficulty, deltaSteps = 0) {
  const base = DIFFICULTY_TIERS.indexOf(normalizeDifficulty(difficulty))
  const steps = Math.trunc(toFinite(deltaSteps, 0))
  const next = Math.max(0, Math.min(DIFFICULTY_TIERS.length - 1, base + steps))
  return DIFFICULTY_TIERS[next]
}

export function ruleSides(rule) {
  return SIDES_BY_RULE[normalizeRule(rule)]
}

function resolveTarget({ rule, difficulty, customTarget }) {
  const base = RULE_TARGETS[rule][difficulty]
  const custom = Number(customTarget)
  if (customTarget === null || customTarget === undefined || !Number.isFinite(custom)) return base
  if (rule === 'd100') return clamp(custom, 5, 99)
  return Math.max(1, Math.trunc(custom))
}

/**
 * 纯函数裁定：不投骰，只把骰面 + 技能加值 + 情景修正 + 难度换算成五档结果。
 */
export function evaluateOutcome({
  rule,
  dice,
  skillBonus = 0,
  modifier = 0,
  difficulty = 'moderate',
  customTarget = null
} = {}) {
  const activeRule = normalizeRule(rule)
  const tierDifficulty = normalizeDifficulty(difficulty)
  const faces = Array.isArray(dice) ? dice.map(n => Math.trunc(toFinite(n, 1))) : []
  const rawTotal = faces.reduce((sum, n) => sum + n, 0)
  const skill = clampSkillBonus(skillBonus, activeRule)
  const mod = clampModifier(modifier)
  const target = resolveTarget({ rule: activeRule, difficulty: tierDifficulty, customTarget })

  const make = (tier, total) => ({
    rule: activeRule,
    difficulty: tierDifficulty,
    dice: faces,
    rawTotal,
    total,
    target,
    tier,
    skillBonus: skill,
    modifier: mod,
    modifierEffect: activeRule === 'd100' ? mod * 5 : mod
  })

  if (activeRule === 'd100') {
    const d100Target = clamp(target + skill + mod * 5, 5, 99)
    let tier = 'failure'
    if (rawTotal <= 5) tier = 'critical'
    else if (rawTotal >= 96) tier = 'fumble'
    else if (rawTotal <= d100Target) tier = 'success'
    else if (rawTotal <= Math.min(95, d100Target + 10)) tier = 'costly'
    const result = make(tier, rawTotal)
    result.target = d100Target
    return result
  }

  if (activeRule === 'd10' || activeRule === 'd20') {
    const sides = SIDES_BY_RULE[activeRule]
    const total = rawTotal + skill + mod
    const naturalMax = rawTotal === sides
    const naturalOne = rawTotal === 1
    let tier = 'failure'
    if (activeRule === 'd20' && naturalMax) {
      tier = 'critical'
    } else if (activeRule === 'd20' && naturalOne) {
      tier = 'fumble'
    } else if ((naturalMax && total >= target - 2) || total >= target + Math.ceil(sides * 0.25)) {
      tier = 'critical'
    } else if (activeRule === 'd10' && naturalOne && total < target) {
      tier = 'fumble'
    } else if (total >= target) {
      tier = 'success'
    } else if (total >= target - 2) {
      tier = 'costly'
    }
    return make(tier, total)
  }

  // 2d6：PbtA 叙事渐进区间，按难度档位整体平移
  const total = rawTotal + skill + mod
  const shift = target - 7
  const doubleSix = faces.length === 2 && faces[0] === 6 && faces[1] === 6
  const doubleOne = faces.length === 2 && faces[0] === 1 && faces[1] === 1
  let tier = 'failure'
  if (doubleSix || total >= 12 + Math.max(0, shift)) tier = 'critical'
  else if (doubleOne || total <= 3 + Math.min(0, shift)) tier = 'fumble'
  else if (total >= 10 + shift) tier = 'success'
  else if (total >= 7 + shift) tier = 'costly'
  return make(tier, total)
}

const RIVAL_BONUS_BY_RULE = Object.freeze({
  '2d6': Object.freeze({ trivial: -2, easy: -1, moderate: 0, hard: 2, extreme: 4 }),
  d10: Object.freeze({ trivial: -2, easy: -1, moderate: 0, hard: 2, extreme: 4 }),
  d20: Object.freeze({ trivial: -3, easy: -1, moderate: 0, hard: 3, extreme: 6 }),
  d100: Object.freeze({ trivial: -15, easy: -8, moderate: 0, hard: 12, extreme: 25 })
})

/**
 * 实力碾压免掷骰判断（Take-0）：当难度不高且角色净加值足以在最低骰面下稳跨目标值时直通成功。
 */
export function canAutoSucceed({
  rule = '2d6',
  skillBonus = 0,
  modifier = 0,
  difficulty = 'moderate',
  customTarget = null,
  checkType = 'normal',
  allowAutoSuccess = true
} = {}) {
  if (!allowAutoSuccess || checkType === 'contest') return false
  const tierDifficulty = normalizeDifficulty(difficulty)
  if (tierDifficulty !== 'trivial' && tierDifficulty !== 'easy') return false
  const activeRule = normalizeRule(rule)
  const skill = clampSkillBonus(skillBonus, activeRule)
  const mod = clampModifier(modifier)
  const target = resolveTarget({ rule: activeRule, difficulty: tierDifficulty, customTarget })
  if (activeRule === 'd100') {
    const effTarget = clamp(target + skill + mod * 5, 5, 99)
    return effTarget >= 96 && skill + mod * 5 >= 10
  }
  const minDieSum = activeRule === '2d6' ? 2 : 1
  return minDieSum + skill + mod >= target
}

function drawRuleDice(rule, draw = randomInt) {
  if (rule === '2d6') return [draw(1, 7), draw(1, 7)]
  if (rule === 'd10') return [draw(1, 11)]
  if (rule === 'd20') return [draw(1, 21)]
  return [draw(1, 101)]
}

/**
 * 纯函数交锋对抗裁定：我方与对手各掷一轮，按净差值 z 决定压制、拼平或反击。
 */
export function evaluateContestOutcome({
  rule,
  dice,
  rivalDice,
  skillBonus = 0,
  modifier = 0,
  difficulty = 'moderate',
  rivalBonus = null
} = {}) {
  const activeRule = normalizeRule(rule)
  const tierDifficulty = normalizeDifficulty(difficulty)
  const allyFaces = Array.isArray(dice) ? dice.map(n => Math.trunc(toFinite(n, 1))) : []
  const rivalFaces = Array.isArray(rivalDice) ? rivalDice.map(n => Math.trunc(toFinite(n, 1))) : []
  const allyRaw = allyFaces.reduce((s, n) => s + n, 0)
  const rivalRaw = rivalFaces.reduce((s, n) => s + n, 0)
  const skill = clampSkillBonus(skillBonus, activeRule)
  const mod = clampModifier(modifier)
  const hasExplicitRivalBonus = rivalBonus !== null && rivalBonus !== undefined && rivalBonus !== ''
  const rBonus = hasExplicitRivalBonus && Number.isFinite(Number(rivalBonus))
    ? Math.trunc(Number(rivalBonus))
    : (RIVAL_BONUS_BY_RULE[activeRule][tierDifficulty] ?? 0)

  let allyTotal
  let rivalTotal
  let margin
  if (activeRule === 'd100') {
    // 百分制下比较成功余量（目标线 - 骰出值），正值越高表现越佳
    const allyCap = clamp(50 + skill + mod * 5, 10, 95)
    const rivalCap = clamp(50 + rBonus, 10, 95)
    allyTotal = allyRaw
    rivalTotal = rivalRaw
    margin = (allyCap - allyRaw) - (rivalCap - rivalRaw)
  } else {
    allyTotal = allyRaw + skill + mod
    rivalTotal = rivalRaw + rBonus
    margin = allyTotal - rivalTotal
  }

  const sides = SIDES_BY_RULE[activeRule]
  const allyCrit = activeRule === '2d6'
    ? (allyFaces.length === 2 && allyFaces[0] === 6 && allyFaces[1] === 6)
    : (activeRule === 'd100' ? allyRaw <= 5 : allyRaw === sides)
  const allyFumble = activeRule === '2d6'
    ? (allyFaces.length === 2 && allyFaces[0] === 1 && allyFaces[1] === 1)
    : (activeRule === 'd100' ? allyRaw >= 96 : allyRaw === 1)
  const rivalCrit = activeRule === '2d6'
    ? (rivalFaces.length === 2 && rivalFaces[0] === 6 && rivalFaces[1] === 6)
    : (activeRule === 'd100' ? rivalRaw <= 5 : rivalRaw === sides)

  const bigLead = activeRule === 'd100' ? 25 : (activeRule === 'd20' ? 7 : 4)
  let tier = 'failure'
  if ((allyCrit && margin >= 0) || margin >= bigLead) tier = 'critical'
  else if (margin > 0) tier = 'success'
  else if (margin === 0) tier = 'costly'
  else if ((allyFumble && margin < 0) || (rivalCrit && margin < 0) || margin <= -bigLead) tier = 'fumble'

  return {
    rule: activeRule,
    difficulty: tierDifficulty,
    dice: allyFaces,
    rawTotal: allyRaw,
    total: allyTotal,
    target: rivalTotal,
    tier,
    skillBonus: skill,
    modifier: mod,
    modifierEffect: activeRule === 'd100' ? mod * 5 : mod,
    rivalDice: rivalFaces,
    rivalRawTotal: rivalRaw,
    rivalBonus: rBonus,
    rivalTotal,
    margin,
    counterAttack: margin < 0
  }
}

/**
 * 执行一次密码学级真随机检定掷骰（支持实力碾压免骰与交锋双边对抗）。
 */
export function rollCheck(options = {}, draw = randomInt) {
  const rule = normalizeRule(options.rule)
  const difficulty = normalizeDifficulty(options.difficulty)
  const skillName = typeof options.skillName === 'string' && options.skillName.trim()
    ? options.skillName.trim().replace(/检定$/, '').slice(0, 16) || '行动'
    : (typeof options.check === 'string' && options.check.trim()
      ? options.check.trim().replace(/检定$/, '').slice(0, 16) || '行动'
      : '行动')
  const skillId = typeof options.skillId === 'string' && options.skillId.trim() ? options.skillId.trim() : 'general'
  const skillBonus = clampSkillBonus(options.skillBonus, rule)
  const modifier = clampModifier(options.modifier)
  const customTarget = options.customTarget === null || options.customTarget === undefined
    ? null
    : Number(options.customTarget)
  const hidden = Boolean(options.hidden)
  const checkType = options.checkType === 'contest' && !hidden ? 'contest' : 'normal'
  const attempt = typeof options.attempt === 'string' ? options.attempt.trim().slice(0, 200) : ''
  const reason = typeof options.reason === 'string' ? options.reason.trim().slice(0, 200) : ''
  const stakes = typeof options.stakes === 'string' ? options.stakes.trim().slice(0, 200) : ''

  if (!options.forceRoll && canAutoSucceed({
    rule,
    skillBonus,
    modifier,
    difficulty,
    customTarget,
    checkType,
    allowAutoSuccess: options.allowAutoSuccess !== false
  })) {
    const target = resolveTarget({ rule, difficulty, customTarget })
    const minDie = rule === '2d6' ? 2 : (rule === 'd100' ? 1 : 1)
    const floorTotal = rule === 'd100' ? clamp(target + skillBonus + modifier * 5, 5, 99) : (minDie + skillBonus + modifier)
    return {
      rule,
      sides: ruleSides(rule),
      checkType: 'auto',
      autoSuccess: true,
      check: skillName,
      skillId,
      skillName,
      skillBonus,
      modifier,
      totalModifier: skillBonus + modifier,
      modifierEffect: rule === 'd100' ? modifier * 5 : modifier,
      dice: [],
      rawTotal: 0,
      total: floorTotal,
      target,
      tier: 'success',
      tierLabel: '稳妥达成',
      difficulty,
      difficultyLabel: DIFFICULTY_LABELS[difficulty],
      hidden: false,
      attempt,
      reason: reason ? `${reason}（能力稳压 · 免骰直通）` : '角色能力稳压当前阻力，直接达成无需掷骰',
      stakes,
      rolledAt: Date.now()
    }
  }

  if (checkType === 'contest') {
    const allyDice = drawRuleDice(rule, draw)
    const rivalDice = drawRuleDice(rule, draw)
    const ev = evaluateContestOutcome({
      rule,
      dice: allyDice,
      rivalDice,
      skillBonus,
      modifier,
      difficulty,
      rivalBonus: options.rivalBonus
    })
    const rivalName = typeof options.rivalName === 'string' && options.rivalName.trim()
      ? options.rivalName.trim().slice(0, 20)
      : '对手'
    return {
      rule,
      sides: ruleSides(rule),
      checkType: 'contest',
      check: skillName,
      skillId,
      skillName,
      skillBonus,
      modifier,
      totalModifier: skillBonus + modifier,
      modifierEffect: ev.modifierEffect,
      dice: allyDice,
      rawTotal: ev.rawTotal,
      total: ev.total,
      target: ev.rivalTotal,
      tier: ev.tier,
      tierLabel: OUTCOME_LABELS[ev.tier],
      difficulty,
      difficultyLabel: DIFFICULTY_LABELS[difficulty],
      hidden: false,
      contest: {
        rivalName,
        rivalDice,
        rivalRawTotal: ev.rivalRawTotal,
        rivalBonus: ev.rivalBonus,
        rivalTotal: ev.rivalTotal,
        margin: ev.margin,
        counterAttack: ev.counterAttack
      },
      attempt,
      reason,
      stakes,
      rolledAt: Date.now()
    }
  }

  const dice = drawRuleDice(rule, draw)
  const evaluated = evaluateOutcome({ rule, dice, skillBonus, modifier, difficulty, customTarget })
  return {
    rule,
    sides: ruleSides(rule),
    checkType: 'normal',
    check: skillName,
    skillId,
    skillName,
    skillBonus,
    modifier,
    totalModifier: skillBonus + modifier,
    modifierEffect: evaluated.modifierEffect,
    dice,
    rawTotal: evaluated.rawTotal,
    total: evaluated.total,
    target: evaluated.target,
    tier: evaluated.tier,
    tierLabel: OUTCOME_LABELS[evaluated.tier],
    difficulty,
    difficultyLabel: DIFFICULTY_LABELS[difficulty],
    hidden,
    attempt,
    reason,
    stakes,
    rolledAt: Date.now()
  }
}

const TAPE_SYMBOLS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧']

/** 生成一轮「宿命序列」预掷密码学真骰带（用于无决策模型时的轻量多检定）。 */
export function generateFateTape({ rule = '2d6', count = 6 } = {}, draw = randomInt) {
  const activeRule = normalizeRule(rule)
  const size = Math.max(1, Math.min(TAPE_SYMBOLS.length, Math.trunc(Number(count) || 6)))
  const slots = []
  for (let i = 0; i < size; i += 1) {
    const dice = drawRuleDice(activeRule, draw)
    const rawTotal = dice.reduce((s, n) => s + n, 0)
    slots.push({
      index: i + 1,
      symbol: TAPE_SYMBOLS[i],
      dice,
      rawTotal
    })
  }
  return {
    rule: activeRule,
    sides: ruleSides(activeRule),
    slots,
    createdAt: Date.now()
  }
}

/** 从模型输出正文中提取宿命序列使用标记，严格校验从 ① 开始顺位连续取用，并换算为标准 roll 结果供胶囊登记。 */
export function parseTapeUsageFromText(text, tape) {
  const raw = String(text || '')
  if (!raw || !tape || !Array.isArray(tape.slots) || !tape.slots.length) return null
  const matches = [...raw.matchAll(/<!--\s*fate-dice-tape:\s*([^>]+?)\s*-->/gi)]
  if (!matches.length) return null

  let expectedIndex = 1
  let lastValid = null
  for (const match of matches) {
    const body = String(match[1] || '')
    const slotMatch = /([①②③④⑤⑥⑦⑧]|\d+)/.exec(body)
    if (!slotMatch) break
    const token = slotMatch[1]
    const slot = tape.slots.find(s => s.symbol === token || String(s.index) === token)
    if (!slot || slot.index !== expectedIndex) break
    lastValid = { slot, body }
    expectedIndex += 1
  }
  if (!lastValid) return null

  const { slot, body: lastBody } = lastValid
  const checkMatch = /check=([^|;,\s]+)/i.exec(lastBody)
  const diffMatch = /diff=(trivial|easy|moderate|hard|extreme)/i.exec(lastBody)
  const modMatch = /mod=(-?\d+)/i.exec(lastBody)
  const difficulty = normalizeDifficulty(diffMatch ? diffMatch[1] : 'moderate')
  const skillBonus = clampSkillBonus(modMatch ? Number(modMatch[1]) : 0, tape.rule)
  const evaluated = evaluateOutcome({
    rule: tape.rule,
    dice: slot.dice,
    skillBonus,
    modifier: 0,
    difficulty
  })
  const checkName = (checkMatch ? checkMatch[1] : '宿命检定').replace(/检定$/, '').slice(0, 16) || '宿命'
  return {
    rule: tape.rule,
    sides: tape.sides,
    checkType: 'tape',
    tapeSlot: slot.symbol,
    check: checkName,
    skillId: 'tape',
    skillName: checkName,
    skillBonus,
    modifier: 0,
    totalModifier: skillBonus,
    modifierEffect: evaluated.modifierEffect,
    dice: slot.dice,
    rawTotal: evaluated.rawTotal,
    total: evaluated.total,
    target: evaluated.target,
    tier: evaluated.tier,
    tierLabel: OUTCOME_LABELS[evaluated.tier],
    difficulty,
    difficultyLabel: DIFFICULTY_LABELS[difficulty],
    hidden: false,
    attempt: '',
    reason: `宿命序列 ${slot.symbol} 顺位取骰（无小模型序列模式）`,
    stakes: '',
    rolledAt: tape.createdAt || Date.now()
  }
}

const EXPR_PATTERN = /^(\d{0,2})d(\d{1,4})(?:\s*([+-])\s*(\d{1,4}))?$/i

/**
 * 解析并投掷自由骰子表达式（如 "2d6+3"、"d20-1"、"1d100"）。
 */
export function rollExpression(expression, draw = randomInt) {
  const raw = String(expression || '').trim()
  const match = raw.match(EXPR_PATTERN)
  if (!match) {
    throw new Error('骰子表达式无效，请写成如 2d6+1、1d20、d100 的形式')
  }
  const count = Math.max(1, Math.min(20, match[1] ? Number(match[1]) : 1))
  const sides = Math.max(2, Math.min(1000, Number(match[2])))
  const sign = match[3] === '-' ? -1 : 1
  const bonus = match[4] ? sign * Number(match[4]) : 0
  const dice = []
  for (let i = 0; i < count; i++) dice.push(draw(1, sides + 1))
  const sum = dice.reduce((acc, n) => acc + n, 0)
  return {
    expression: `${count}d${sides}${bonus === 0 ? '' : (bonus > 0 ? '+' + bonus : String(bonus))}`,
    count,
    sides,
    dice,
    bonus,
    total: sum + bonus,
    rolledAt: Date.now()
  }
}

function readPath(obj, pathStr) {
  const parts = String(pathStr || '').split(/[./]+/).filter(Boolean)
  let current = obj
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

function flattenNumbers(node, out = [], prefix = '', depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return out
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue
    const nextPath = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.push({ key: k, path: nextPath, value: v })
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenNumbers(v, out, nextPath, depth + 1)
    }
  }
  return out
}

/**
 * 从人物卡 MVU 变量快照中提取玩家配置的修正加值（柔和缩放、限幅）。
 */
export function extractVariableModifier(variables, formulaText = '') {
  const root = variables?.stat_data || variables
  if (!root || typeof root !== 'object') return { modifier: 0, matched: [] }
  const spec = String(formulaText || '').trim()
  if (!spec) return { modifier: 0, matched: [] }

  const tokens = spec.split(/[,，;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 6)
  if (!tokens.length) return { modifier: 0, matched: [] }

  const flat = flattenNumbers(root)
  const matched = []
  let rawSum = 0

  for (const token of tokens) {
    let entry = null
    if (token.includes('/') || token.includes('.')) {
      const val = readPath(root, token)
      if (typeof val === 'number' && Number.isFinite(val)) {
        entry = { label: token.split(/[/.]+/).filter(Boolean).pop() || token, value: val }
      }
    } else {
      const hit = flat.find(item => item.key === token || item.key.includes(token))
      if (hit) entry = { label: hit.key, value: hit.value }
    }
    if (!entry) continue
    let bonus = 0
    if (entry.value >= 25) bonus = Math.round((entry.value - 50) / 15)
    else if (entry.value >= 9) bonus = Math.floor((entry.value - 10) / 2)
    else bonus = Math.trunc(entry.value)
    bonus = Math.max(-3, Math.min(4, bonus))
    rawSum += bonus
    matched.push({ label: entry.label, raw: entry.value, bonus })
  }

  return {
    modifier: clampModifier(Math.max(-5, Math.min(5, rawSum))),
    matched
  }
}

/** 读取 MVU 点/斜杠路径值（供场景切换检测与事件条件复用）。 */
export function readVariablePath(variables, pathStr) {
  const root = variables?.stat_data || variables
  if (!root || typeof root !== 'object') return undefined
  return readPath(root, pathStr)
}
