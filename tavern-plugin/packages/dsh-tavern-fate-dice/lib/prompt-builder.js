/**
 * 清理正文中的 HTML 块与长面板标签，保留精简叙事摘要喂给决策模型。
 */
export function extractContextSnippet(turnSnapshot, maxLength = 700) {
  if (!turnSnapshot) return ''
  const raw = String(turnSnapshot.text || turnSnapshot.rawText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return ''
  return raw.length > maxLength ? raw.slice(-maxLength) : raw
}

const OUTCOME_GUIDANCE = Object.freeze({
  critical: '大成功：超额达成企图，收获意料之外的有利局面或关键优势。',
  success: '成功：稳妥达成预期行动目标，剧情顺畅推进。',
  costly: '代价成功（部分成功）：行动勉强达成，但必须伴随真实代价（耗时、声响、暴露、资源损耗、关系擦伤或留下隐患）。',
  failure: '失败：行动未能如愿；切勿让剧情僵死原地，请用失败推动出新的危机、阻碍或反转局面。',
  fumble: '大失败：弄巧成拙或暴露严重破绽，引发局势恶化或即时反制。'
})

/**
 * 构建注入主模型本轮上下文（turnSection）的精简判定块。
 */
export function buildTurnInjection(roll) {
  if (!roll || typeof roll !== 'object') return ''
  const diceText = Array.isArray(roll.dice) ? roll.dice.join(' + ') : String(roll.total)
  const modText = roll.modifier
    ? (roll.modifier > 0 ? `+${roll.modifier}` : String(roll.modifier))
    : ''
  const ruleLine = roll.rule === 'd100'
    ? `1d100 骰出 ${roll.total}（难度「${roll.difficultyLabel}」目标 ≤ ${roll.target}）`
    : `${roll.rule} 骰出 [${diceText}]${modText ? ` ${modText}` : ''} = ${roll.total}（难度「${roll.difficultyLabel}」目标 ≥ ${roll.target}）`

  const lines = [
    '【本轮客观检定已由系统掷骰裁定（严禁模型重投或篡改结果）】',
    `- 检定项目：${roll.check}检定`,
    `- 掷骰结果：${ruleLine} → 【${roll.tierLabel}】`,
    `- 演绎要求：${OUTCOME_GUIDANCE[roll.tier] || OUTCOME_GUIDANCE.success}`
  ]
  if (roll.hidden) {
    lines.push('- 暗骰约束：本次为暗骰。受控角色自身并不知晓具体骰点与成败裁定，正文只能描写角色主观能感知到的表象或误判，不要泄露骰数。')
  }
  if (roll.attempt) {
    lines.push(`- 判定动作：${roll.attempt}`)
  }
  return lines.join('\n')
}
