import { randomInt } from 'node:crypto'

export const DICE_TARGETS = Object.freeze({ easy: 80, normal: 60, hard: 40, extreme: 20 })

export function diceTier(roll, target) {
  // Critical bands override thresholds, including any overlapping costly band.
  if (roll <= 5) return 'critical'
  if (roll >= 96) return 'fumble'
  if (roll <= target) return 'success'
  if (roll <= target + 10) return 'costly'
  return 'failure'
}

// check is shown to the player as 「<check>检定」, so it is the bare ability or skill word.
export function rollDice({ check, attempt, difficulty, hidden = false, reason, stakes }, draw = randomInt) {
  const target = DICE_TARGETS[difficulty]
  if (!Object.hasOwn(DICE_TARGETS, difficulty)) throw new Error('difficulty: easy, normal, hard or extreme')
  const name = typeof check === 'string' ? check.trim() : ''
  if (!name || [...name].length > 4 || name.endsWith('检定')) {
    throw new Error('check: the ability or skill tested, 2–4 characters without 检定 (shown as <check>检定), e.g. 魔力 / 观察 / 说服; got ' + JSON.stringify(check ?? null))
  }
  for (const [field, value] of Object.entries({ attempt, reason, stakes })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(field + ' must be non-empty text')
  }
  if (typeof hidden !== 'boolean') throw new Error('hidden must be boolean')
  const roll = draw(1, 101)
  return { check: name, attempt, difficulty, target, roll, tier: diceTier(roll, target), hidden, reason, stakes }
}