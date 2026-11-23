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

function isNaturalExtremum(roll) {
  if (!roll || roll.autoSuccess) return null
  const dice = Array.isArray(roll.dice) ? roll.dice : []
  if (roll.rule === '2d6' && dice.length === 2) {
    if (dice[0] === 6 && dice[1] === 6) return 'critical'
    if (dice[0] === 1 && dice[1] === 1) return 'fumble'
  } else if ((roll.rule === 'd20' || roll.rule === 'd10') && dice.length === 1) {
    const sides = roll.rule === 'd20' ? 20 : 10
    if (dice[0] === sides) return 'critical'
    if (dice[0] === 1) return 'fumble'
  } else if (roll.rule === 'd100') {
    if (Number(roll.rawTotal) <= 5) return 'critical'
    if (Number(roll.rawTotal) >= 96) return 'fumble'
  }
  return null
}

/**
 * 构建注入主模型本轮上下文（turnSection）的客观真骰检定约束块。
 */
export function buildTurnInjection(payload) {
  if (!payload || typeof payload !== 'object') return ''
  const roll = payload.roll && typeof payload.roll === 'object'
    ? payload.roll
    : (payload.rule || payload.tier || payload.check ? payload : null)
  if (!roll) return ''

  const checkName = String(roll.skillName || roll.check || '行动').replace(/检定$/, '')
  const lines = ['【本轮客观检定已由系统真骰裁定（严禁模型重投、篡改结果或编造外挂翻转）】']

  if (roll.autoSuccess) {
    lines.push(
      `- 检定项目：${checkName}检定（实力碾压 · 免骰直通）`,
      `- 裁定结论：能力稳压当前难度「${roll.difficultyLabel || '容易'}」→ 【稳妥达成】`,
      '- 演绎要求：主角的既有实力与状态远超当前常规阻力，请顺畅、游刃有余地展现行动直接达成，无需强行制造意外失手。',
      '- 沉浸要求：严禁在故事正文中出现任何骰点数字、难度 DC/目标值、能力加值算式或规则字眼。'
    )
    if (roll.attempt) lines.push(`- 判定动作：${roll.attempt}`)
    return lines.join('\n')
  }

  const diceText = Array.isArray(roll.dice) ? roll.dice.join(' + ') : String(roll.total)
  const modText = roll.modifier
    ? (roll.modifier > 0 ? `+${roll.modifier}` : String(roll.modifier))
    : ''
  const skillBonus = Number(roll.skillBonus) || 0
  const skillText = skillBonus === 0 ? '' : (skillBonus > 0 ? `+${skillBonus}` : String(skillBonus))

  if (roll.checkType === 'contest' && roll.contest) {
    const c = roll.contest
    const rivalDiceText = Array.isArray(c.rivalDice) ? c.rivalDice.join(' + ') : String(c.rivalRawTotal ?? '')
    const signZ = c.margin > 0 ? `+${c.margin}` : String(c.margin)
    lines.push(
      `- 检定项目：${checkName} · 双边交锋对抗（vs ${c.rivalName || '对手'}）`,
      `- 我方掷骰：${roll.rule} [${diceText}]${modText ? ` ${modText}` : ''}${skillText ? ` 能力${skillText}` : ''} = ${roll.total}`,
      `- 对手掷骰：${roll.rule} [${rivalDiceText}]${c.rivalBonus ? (c.rivalBonus > 0 ? ` +${c.rivalBonus}` : ` ${c.rivalBonus}`) : ''} = ${c.rivalTotal}`,
      `- 交锋净差值 z = ${signZ} → 【${roll.tierLabel || '判定'}】`
    )
    if (c.counterAttack) {
      lines.push('- 对抗反制（强制兑现）：差值 z < 0，对手不仅成功化解或压制了本次试探，还必须在本轮立即抓准空隙发起反击、反制或抢占先手。')
    } else if (c.margin === 0) {
      lines.push('- 势均力敌（z = 0）：双方攻守相抵、寸步难让，本轮形成僵持或各退半步交换筹码，禁止一方轻松碾压。')
    }
  } else {
    const ruleLine = roll.rule === 'd100'
      ? `1d100 骰出 ${roll.total}（难度「${roll.difficultyLabel || '中等'}」目标 ≤ ${roll.target}）`
      : `${roll.rule} 骰出 [${diceText}]${modText ? ` ${modText}` : ''}${skillText ? ` 能力${skillText}` : ''} = ${roll.total}（难度「${roll.difficultyLabel || '中等'}」目标 ≥ ${roll.target}）`
    lines.push(
      `- 检定项目：${checkName}检定`,
      `- 掷骰结果：${ruleLine} → 【${roll.tierLabel || '成功'}】`
    )
  }

  lines.push(
    `- 演绎要求：${OUTCOME_GUIDANCE[roll.tier] || OUTCOME_GUIDANCE.success}`,
    '- 位阶与反讨好校验：严禁因讨好受控角色而将“失败/大失败”美化成暗中达成原目标（禁止假失败）；大成功仅代表当前能力上限内的超常发挥与绝妙借势，严禁违背世界观战力位阶神化角色。',
    '- 沉浸要求：严禁在故事正文中出现任何骰点数字、难度 DC/目标值、能力加值算式，或“检定成功 / 检定失败 / 大成功 / 大失败”等规则字眼；必须完全通过动作细节、对白反应与局势后果自然体现裁定结果。'
  )

  if (Array.isArray(roll.resistanceFactors) && roll.resistanceFactors.length) {
    lines.push(`- 客观阻力成因（可在景物/态势描写中自然体现）：${roll.resistanceFactors.map(f => `${f.label}(${f.delta})`).join('、')}`)
  }

  const extremum = isNaturalExtremum(roll)
  if (extremum === 'critical' && !roll.hidden) {
    lines.push('- 命运巧合（天然极值）：此瞬仿佛命运之弦精准拨动——请顺势写出一处精妙的自然巧合或环境助力（如风势、光线、对手一瞬的呼吸错拍），不写任何玄虚神谕字眼。')
  } else if (extremum === 'fumble' && !roll.hidden) {
    lines.push('- 厄运巧合（天然极值）：诸事恰在最坏的一瞬叠在一起——请写出一处令人措手不及的客观阴差阳错（如脚下打滑、弦断机卡或风向骤变），切实加剧当下处境。')
  }

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

/** 构建「局势 / 奇遇骰」上下文注入，用于探索、赶路或休整轮次制造客观命运变数。 */
export function buildEncounterInjection(roll) {
  if (!roll || typeof roll !== 'object') return ''
  const sides = Number(roll.sides) || 6
  const raw = Array.isArray(roll.dice) && roll.dice.length
    ? roll.dice.reduce((s, n) => s + Number(n || 0), 0)
    : Number(roll.total) || 0
  const ratio = sides > 0 && Array.isArray(roll.dice) && roll.dice.length
    ? raw / (sides * roll.dice.length)
    : 0.5
  let omen = '平稳推进：路途或当前局势按常规节奏展开，可铺陈一两处自然环境细节。'
  if (ratio >= 0.9) omen = '大吉奇遇：环境或局势出现明显利好（偶遇重要线索、有利天气、意外收获或难得善意），请自然融入本轮场景。'
  else if (ratio >= 0.65) omen = '顺风微利：氛围略偏向顺遂，可自然出现一件省力或令人安心的小细节。'
  else if (ratio <= 0.2) omen = '突生险兆：平静之下暗藏实质危机（埋伏、器物损毁、恶劣天气突变或不速之客），请制造明确转折与紧张感。'
  else if (ratio <= 0.4) omen = '小有波折：出现轻微阻碍、延误或令人不安的征兆，增加探索张力。'
  return [
    '【本轮局势 / 奇遇命运骰已落定（严禁在正文写出骰点或数字）】',
    `- 命运表征：${roll.expression || '2d6'} = ${roll.total}`,
    `- 局势指引：${omen}`
  ].join('\n')
}

/** 构建无小模型时使用的「宿命序列」6 组真骰带提示块。 */
export function buildFateTapeInjection(tape) {
  if (!tape || !Array.isArray(tape.slots) || !tape.slots.length) return ''
  const seq = tape.slots
    .map(s => `${s.symbol}(${s.dice.join(',')})=${s.rawTotal}`)
    .join(' | ')
  return [
    `【本轮宿命序列（${tape.rule} 真随机预掷 · 仅在存在不确定性时按 ①→⑥ 顺序取用）】`,
    `- 可用骰列：[ ${seq} ]`,
    '- 使用准则：日常无阻力行动无需取骰；若剧情出现真正不确定或风险对抗，请按顺序取用下一组未使用骰面，严禁挑骰或改点，并严禁在正文中直接写出数字或规则字眼。',
    '- 静默回传格式（仅当你本轮实际取用了序列时，在回复最末尾另起一行附加隐藏注释）：<!-- fate-dice-tape: ① check=行动名 diff=moderate mod=0 -->'
  ].join('\n')
}
