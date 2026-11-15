import { randomInt } from 'node:crypto'

// 抽离自 mods/dice/dice.js 的五档判定语义，并扩展支持 2d6 / d20 / d100 多规则
export const DICE_RULES = Object.freeze(['2d6', 'd20', 'd100'])
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

// 各规则体系在 5 档难度下的目标值（d100 为成功上限<=target，2d6/d20 为检定 DC >= target）
export const RULE_TARGETS = Object.freeze({
  d100: Object.freeze({ trivial: 95, easy: 80, moderate: 60, hard: 40, extreme: 20 }),
  d20: Object.freeze({ trivial: 5, easy: 9, moderate: 13, hard: 16, extreme: 19 }),
  '2d6': Object.freeze({ trivial: 5, easy: 6, moderate: 7, hard: 8, extreme: 10 })
})

export function clampModifier(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(-8, Math.min(8, Math.trunc(num)))
}

export function normalizeRule(rule) {
  return DICE_RULES.includes(rule) ? rule : '2d6'
}

export function normalizeDifficulty(difficulty) {
  return DIFFICULTY_TIERS.includes(difficulty) ? difficulty : 'moderate'
}

export function evaluateOutcome({ rule, dice, modifier = 0, difficulty = 'moderate' }) {
  const activeRule = normalizeRule(rule)
  const tierDifficulty = normalizeDifficulty(difficulty)
  const mod = clampModifier(modifier)
  const rawTotal = dice.reduce((sum, n) => sum + n, 0)

  if (activeRule === 'd100') {
    const baseTarget = RULE_TARGETS.d100[tierDifficulty]
    // d100 中正修正提高成功率上限（每 1 点加值约等价 +5 阈值）
    const target = Math.max(5, Math.min(99, baseTarget + mod * 5))
    let tier = 'failure'
    if (rawTotal <= 5) tier = 'critical'
    else if (rawTotal >= 96) tier = 'fumble'
    else if (rawTotal <= target) tier = 'success'
    else if (rawTotal <= Math.min(95, target + 10)) tier = 'costly'
    return { total: rawTotal, target, tier, modifierEffect: mod * 5 }
  }

  if (activeRule === 'd20') {
    const target = RULE_TARGETS.d20[tierDifficulty]
    const total = rawTotal + mod
    let tier = 'failure'
    if (rawTotal === 20) tier = 'critical'
    else if (rawTotal === 1) tier = 'fumble'
    else if (total >= target) tier = total >= target + 5 ? 'critical' : 'success'
    else if (total >= target - 2) tier = 'costly'
    return { total, target, tier, modifierEffect: mod }
  }

  // 默认 2d6 叙事渐进版：标准 PbtA 区间按难度动态偏移门槛
  const target = RULE_TARGETS['2d6'][tierDifficulty]
  const total = rawTotal + mod
  const shift = target - 7
  let tier = 'failure'
  if ((dice[0] === 6 && dice[1] === 6) || total >= 12 + Math.max(0, shift)) tier = 'critical'
  else if ((dice[0] === 1 && dice[1] === 1) || total <= 3 + Math.min(0, shift)) tier = 'fumble'
  else if (total >= 10 + shift) tier = 'success'
  else if (total >= 7 + shift) tier = 'costly'
  return { total, target, tier, modifierEffect: mod }
}

/**
 * 执行一次密码学级真随机检定掷骰。
 */
export function rollCheck(options = {}, draw = randomInt) {
  const rule = normalizeRule(options.rule)
  const difficulty = normalizeDifficulty(options.difficulty)
  const check = typeof options.check === 'string' && options.check.trim()
    ? options.check.trim().replace(/检定$/, '').slice(0, 8)
    : '行动'
  const modifier = clampModifier(options.modifier)
  const hidden = Boolean(options.hidden)
  const attempt = typeof options.attempt === 'string' ? options.attempt.trim().slice(0, 200) : ''
  const reason = typeof options.reason === 'string' ? options.reason.trim().slice(0, 200) : ''
  const stakes = typeof options.stakes === 'string' ? options.stakes.trim().slice(0, 200) : ''

  let dice
  let sides
  if (rule === 'd100') {
    sides = 100
    dice = [draw(1, 101)]
  } else if (rule === 'd20') {
    sides = 20
    dice = [draw(1, 21)]
  } else {
    sides = 6
    dice = [draw(1, 7), draw(1, 7)]
  }

  const evaluated = evaluateOutcome({ rule, dice, modifier, difficulty })
  return {
    rule,
    sides,
    check,
    difficulty,
    difficultyLabel: DIFFICULTY_LABELS[difficulty],
    dice,
    modifier,
    modifierEffect: evaluated.modifierEffect,
    total: evaluated.total,
    target: evaluated.target,
    tier: evaluated.tier,
    tierLabel: OUTCOME_LABELS[evaluated.tier],
    hidden,
    attempt,
    reason,
    stakes,
    rolledAt: Date.now()
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
  for (let i = 0; i < count; i++) {
    dice.push(draw(1, sides + 1))
  }
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
 * 从人物卡 MVU 变量快照中提取玩家配置的修正加值（并柔和缩放、限幅，避免大数值卡碾压骰点）。
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
    // 将常见的 0-100 百分比或 1-20 DND 属性值平滑折算到 -3..+4 检定加值
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
