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
 * 构建注入主模型本轮上下文（turnSection）的客观真骰检定约束块。
 */
export function buildTurnInjection(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const roll = payload.roll && typeof payload.roll === 'object'
    ? payload.roll
    : (payload.rule || payload.tier || payload.check ? payload : null)
  if (!roll) return ''

  const diceText = Array.isArray(roll.dice) ? roll.dice.join(' + ') : String(roll.total)
  const modText = roll.modifier
    ? (roll.modifier > 0 ? `+${roll.modifier}` : String(roll.modifier))
    : ''
  const skillBonus = Number(roll.skillBonus) || 0
  const skillText = skillBonus === 0 ? '' : (skillBonus > 0 ? `+${skillBonus}` : String(skillBonus))
  const ruleLine = roll.rule === 'd100'
    ? `1d100 骰出 ${roll.total}（难度「${roll.difficultyLabel || '中等'}」目标 ≤ ${roll.target}）`
    : `${roll.rule} 骰出 [${diceText}]${modText ? ` ${modText}` : ''}${skillText ? ` 能力${skillText}` : ''} = ${roll.total}（难度「${roll.difficultyLabel || '中等'}」目标 ≥ ${roll.target}）`

  const checkName = String(roll.skillName || roll.check || '行动').replace(/检定$/, '')
  const lines = [
    '【本轮客观检定已由系统真骰裁定（严禁模型重投或篡改结果）】',
    `- 检定项目：${checkName}检定`,
    `- 掷骰结果：${ruleLine} → 【${roll.tierLabel || '成功'}】`,
    `- 演绎要求：${OUTCOME_GUIDANCE[roll.tier] || OUTCOME_GUIDANCE.success}`,
    '- 沉浸要求：严禁在故事正文中出现任何骰点数字、难度 DC/目标值、能力加值算式，或“检定成功 / 检定失败 / 大成功 / 大失败”等规则字眼；必须完全通过动作细节、对白反应与局势后果自然体现裁定结果。'
  ]
  if (roll.tier === 'failure' || roll.tier === 'costly' || roll.tier === 'fumble') {
    lines.push('- 渐进失败（Fail Forward）：即使裁定未如愿，也必须让剧情向前推进（暴露新线索、产生新危机或迫使角色做出新抉择），禁止原地停滞。')
  }
  if (roll.rerollMeta?.mode === 'push') {
    if (roll.tier === 'fumble') {
      lines.push('- 孤注一掷反噬（强制兑现）：本次系角色不顾后果强行搏命重投却彻底失手，正文必须体现比常规失败更沉重的反噬、伤势恶化、破绽暴露或局势崩坏。')
    } else if (roll.pushedCostRequired || roll.tier === 'success' || roll.tier === 'costly') {
      lines.push('- 孤注一掷代价（强制兑现）：本次系角色透支潜力或行险搏命才逆转败局；正文在达成行动企图的同时，必须写出真实损耗（挂彩负伤、体力/精力透支、动静过大引来警觉或折损关键筹码），严禁无伤完胜。')
    }
  }
  if (roll.hidden) {
    lines.push('- 暗骰约束：本次为暗骰。受控角色自身并不知晓具体骰点与成败裁定，正文只能描写角色主观能感知到的表象或误判，不得提前揭露尚未被发现的真相。')
  }
  if (roll.attempt) lines.push(`- 判定动作：${roll.attempt}`)
  return lines.join('\n')
}
