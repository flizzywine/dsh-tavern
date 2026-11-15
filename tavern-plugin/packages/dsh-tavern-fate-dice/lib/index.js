import { createHash } from 'node:crypto'
import { extractVariableModifier, normalizeDifficulty, normalizeRule, rollCheck, rollExpression } from './dice-engine.js'
import { judgeActionDifficulty } from './difficulty-judge.js'
import { buildTurnInjection, extractContextSnippet } from './prompt-builder.js'

export const name = 'dsh-tavern-fate-dice'
export const inject = ['tavern']

const TONE_BIAS_BONUS = Object.freeze({
  balanced: 0,
  heroic: 1,
  gritty: -1
})

function hashText(text) {
  return createHash('sha1').update(String(text || '').trim()).digest('hex').slice(0, 16)
}

function emptySummary() {
  return {
    total: 0,
    counts: { critical: 0, success: 0, costly: 0, failure: 0, fumble: 0 },
    recent: []
  }
}

function appendToSummary(prev, roll, turn) {
  const base = prev && typeof prev === 'object' ? prev : emptySummary()
  const counts = { ...emptySummary().counts, ...(base.counts || {}) }
  if (Object.hasOwn(counts, roll.tier)) counts[roll.tier] += 1
  const entry = {
    turn: Number(turn) || 0,
    rule: roll.rule,
    check: roll.check,
    difficulty: roll.difficulty,
    difficultyLabel: roll.difficultyLabel,
    total: roll.total,
    target: roll.target,
    tier: roll.tier,
    tierLabel: roll.tierLabel,
    hidden: Boolean(roll.hidden),
    rolledAt: roll.rolledAt || Date.now()
  }
  const recent = [entry, ...(Array.isArray(base.recent) ? base.recent : []).filter(item => item.turn !== entry.turn)].slice(0, 10)
  return {
    total: (Number(base.total) || 0) + 1,
    counts,
    recent
  }
}

export function apply(ctx) {
  const tavern = ctx.tavern
  const pendingByGame = new Map()
  const preRolledByGame = new Map()

  tavern.gameSettings({
    title: '命运之骰检定',
    fields: [
      {
        key: 'mode',
        type: 'select',
        label: '检定触发模式',
        description: '自动模式在发送前用决策模型毫秒定难并真骰注入；手动模式仅点击骰子栏或自由骰盘时投掷。',
        options: [
          { value: 'auto', label: '自动快判并投骰' },
          { value: 'manual', label: '仅发前手投 / 自由骰' },
          { value: 'off', label: '本局停用' }
        ],
        default: 'auto'
      },
      {
        key: 'rule',
        type: 'select',
        label: '检定规则',
        options: [
          { value: '2d6', label: '2d6 叙事渐进（推荐文字RP）' },
          { value: 'd20', label: '1d20 经典阶梯' },
          { value: 'd100', label: '1d100 百分阈值' }
        ],
        default: '2d6'
      },
      {
        key: 'sensitivity',
        type: 'select',
        label: '检定频率',
        options: [
          { value: 'normal', label: '适中（动作/冲突触发）' },
          { value: 'strict', label: '积极（多数主动尝试触发）' },
          { value: 'rare', label: '谨慎（仅高风险关键节点）' }
        ],
        default: 'normal'
      },
      {
        key: 'toneBias',
        type: 'select',
        label: '叙事基调修正',
        options: [
          { value: 'balanced', label: '平衡 (+0)' },
          { value: 'heroic', label: '英雄 (+1 宽容)' },
          { value: 'gritty', label: '严苛 (-1 险境)' }
        ],
        default: 'balanced'
      },
      {
        key: 'animation',
        type: 'select',
        label: '掷骰动画',
        options: [
          { value: 'bounce', label: '骰子弹跳揭示动画' },
          { value: 'compact', label: '极简数字闪现' },
          { value: 'none', label: '关闭动画' }
        ],
        default: 'bounce'
      },
      {
        key: 'allowHidden',
        type: 'boolean',
        label: '感知类动作自动暗骰',
        description: '观察、察觉、识破谎言等行动自动盖罩暗骰，点按可偷看。',
        default: true
      },
      {
        key: 'modifierFormula',
        type: 'text',
        label: '关联变量加值（可选）',
        description: '填变量字段名或路径（逗号分隔，如 敏捷,潜行 或 /主角/意志），自动提取整数修正。',
        maxLength: 200
      }
    ]
  })

  async function readLatestContextAndVars(gameId, currentTurn) {
    const prevTurnNum = Math.max(1, Number(currentTurn) - 1)
    let turnSnap = await tavern.getTurn({ gameId, turn: prevTurnNum }).catch(() => null)
    if (!turnSnap && prevTurnNum > 1) {
      turnSnap = await tavern.getTurn({ gameId, turn: 1 }).catch(() => null)
    }
    return {
      recentContext: extractContextSnippet(turnSnap),
      variables: turnSnap?.variables || null
    }
  }

  async function safeSettings(gameId) {
    try {
      return await tavern.getGameSettings({ gameId })
    } catch {
      return { mode: 'auto', rule: '2d6', sensitivity: 'normal', toneBias: 'balanced', animation: 'bounce', allowHidden: true, modifierFormula: '' }
    }
  }

  // 在正文发往主模型之前同步拦截：消费预投结果，或调用决策模型毫秒快判 + 本地真投骰
  tavern.turnSection({
    name: 'fate-dice',
    position: 'after',
    async text({ gameId, turn, input }) {
      const userInput = String(input || '').trim()
      if (!userInput) return ''

      const settings = await safeSettings(gameId)
      if (settings.mode === 'off') return ''

      // 优先检查是否有刚锁定的预投结果
      const locked = preRolledByGame.get(gameId)
      if (locked && Date.now() - locked.createdAt < 120_000 && (!locked.inputHash || locked.inputHash === hashText(userInput))) {
        preRolledByGame.delete(gameId)
        const roll = locked.roll
        pendingByGame.set(gameId, { turn, roll, inputHash: hashText(userInput) })
        await tavern.publishState({ gameId, name: 'pre-roll', data: null }).catch(() => {})
        await tavern.publishState({
          gameId,
          name: 'live-roll',
          data: { id: `${turn}-${roll.rolledAt}`, turn, kind: 'check', roll, animation: settings.animation || 'bounce' }
        }).catch(() => {})
        return buildTurnInjection(roll)
      }

      if (settings.mode !== 'auto') return ''

      const { recentContext, variables } = await readLatestContextAndVars(gameId, turn)
      const judged = await judgeActionDifficulty({
        tavern,
        gameId,
        input: userInput,
        recentContext,
        sensitivity: settings.sensitivity || 'normal',
        allowHidden: settings.allowHidden !== false,
        timeoutMs: 2500
      })

      if (!judged.shouldRoll) {
        await tavern.publishState({ gameId, name: 'live-roll', data: null }).catch(() => {})
        return ''
      }

      const varMod = extractVariableModifier(variables, settings.modifierFormula)
      const toneBonus = TONE_BIAS_BONUS[settings.toneBias] || 0
      const totalModifier = (Number(judged.edgeBonus) || 0) + varMod.modifier + toneBonus

      const roll = rollCheck({
        rule: normalizeRule(settings.rule),
        check: judged.check,
        difficulty: judged.difficulty,
        modifier: totalModifier,
        hidden: judged.hidden,
        attempt: userInput.slice(0, 120),
        reason: judged.reason,
        stakes: `成功推动预期进展；失败产生阻力与新变化`
      })
      roll.modifierBreakdown = {
        edgeBonus: Number(judged.edgeBonus) || 0,
        varModifier: varMod.modifier,
        matchedVars: varMod.matched,
        toneBonus
      }
      roll.judgeSource = judged.source
      roll.judgeTier = judged.judgeTier || null
      roll.retriedSafetyFallback = Boolean(judged.retriedSafetyFallback)

      pendingByGame.set(gameId, { turn, roll, inputHash: hashText(userInput) })

      // 立即把投骰结果推往浏览器端：主模型生成首字的空档同步播完动画，零额外耗时
      await tavern.publishState({
        gameId,
        name: 'live-roll',
        data: { id: `${turn}-${roll.rolledAt}`, turn, kind: 'check', roll, animation: settings.animation || 'bounce' }
      }).catch(() => {})

      return buildTurnInjection(roll)
    }
  })

  // 本轮正文落盘且拿到唯一 textVersion 后，绑定到该正文版本保存，支持回退/分叉版本一致
  tavern.onTurnSettled(async ({ gameId, turn, textVersion }) => {
    const pending = pendingByGame.get(gameId)
    if (!pending || pending.turn !== turn) return
    pendingByGame.delete(gameId)

    const roll = pending.roll
    await tavern.saveTurnData({
      gameId,
      turn,
      textVersion,
      data: { roll }
    }).catch(() => {})

    const prevSummary = await tavern.readGameData({ gameId }).catch(() => null)
    const nextSummary = appendToSummary(prevSummary, roll, turn)
    await tavern.saveGameData({ gameId, data: nextSummary }).catch(() => {})
    await tavern.publishState({ gameId, name: 'summary', data: nextSummary }).catch(() => {})
  })

  tavern.onGameRemoved(({ gameId }) => {
    pendingByGame.delete(gameId)
    preRolledByGame.delete(gameId)
  })

  // 浏览器侧交互 RPC
  tavern.handle('fate-dice:status', async ({ gameId } = {}) => {
    if (!gameId) return { judgeStatus: { available: false }, summary: emptySummary(), preRoll: null }
    const judgeStatus = typeof tavern.decisionJudgeStatus === 'function'
      ? await tavern.decisionJudgeStatus().catch(() => ({ available: false }))
      : { available: false }
    const summary = (await tavern.readGameData({ gameId }).catch(() => null)) || emptySummary()
    const locked = preRolledByGame.get(gameId)
    const preRoll = locked && Date.now() - locked.createdAt < 120_000 ? locked.roll : null
    return { judgeStatus, summary, preRoll }
  })

  tavern.handle('fate-dice:read-turn', async ({ gameId, turn } = {}) => {
    if (!gameId || !Number.isSafeInteger(turn) || turn < 1) return null
    const stored = await tavern.readTurnData({ gameId, turn }).catch(() => null)
    if (stored && stored.turn === turn && stored.data?.roll) {
      return { turn, textVersion: stored.textVersion, roll: stored.data.roll }
    }
    const pending = pendingByGame.get(gameId)
    if (pending && pending.turn === turn) {
      return { turn, textVersion: null, roll: pending.roll }
    }
    return null
  })

  tavern.handle('fate-dice:preview', async ({ gameId, input } = {}) => {
    const cleanInput = String(input || '').trim()
    if (!gameId || !cleanInput) {
      throw new Error('请先在输入框写下行动描述再进行发前预判')
    }
    const settings = await safeSettings(gameId)
    const state = await tavern.getTurnState({ gameId }).catch(() => ({ turn: 1 }))
    const { recentContext, variables } = await readLatestContextAndVars(gameId, (Number(state.turn) || 0) + 1)
    const judged = await judgeActionDifficulty({
      tavern,
      gameId,
      input: cleanInput,
      recentContext,
      sensitivity: settings.sensitivity || 'normal',
      allowHidden: settings.allowHidden !== false,
      timeoutMs: 3000
    })
    const varMod = extractVariableModifier(variables, settings.modifierFormula)
    const toneBonus = TONE_BIAS_BONUS[settings.toneBias] || 0
    return {
      ...judged,
      rule: normalizeRule(settings.rule),
      varModifier: varMod.modifier,
      matchedVars: varMod.matched,
      toneBonus,
      totalModifier: (Number(judged.edgeBonus) || 0) + varMod.modifier + toneBonus
    }
  })

  tavern.handle('fate-dice:roll-and-lock', async ({ gameId, input, rule, check, difficulty, modifier, hidden, reason } = {}) => {
    if (!gameId) throw new Error('缺少 gameId')
    const settings = await safeSettings(gameId)
    const cleanInput = String(input || '').trim()
    const roll = rollCheck({
      rule: normalizeRule(rule || settings.rule),
      check: check || '行动',
      difficulty: normalizeDifficulty(difficulty),
      modifier: Number(modifier) || 0,
      hidden: Boolean(hidden),
      attempt: cleanInput.slice(0, 120),
      reason: String(reason || '发前手动定难投掷'),
      stakes: '已锁定为本轮正式检定结果'
    })
    preRolledByGame.set(gameId, {
      roll,
      inputHash: cleanInput ? hashText(cleanInput) : '',
      createdAt: Date.now()
    })
    await tavern.publishState({ gameId, name: 'pre-roll', data: roll }).catch(() => {})
    await tavern.publishState({
      gameId,
      name: 'live-roll',
      data: { id: `pre-${roll.rolledAt}`, turn: 0, kind: 'pre-roll', roll, animation: settings.animation || 'bounce' }
    }).catch(() => {})
    return { roll }
  })

  tavern.handle('fate-dice:clear-pre-roll', async ({ gameId } = {}) => {
    if (!gameId) return { ok: true }
    preRolledByGame.delete(gameId)
    await tavern.publishState({ gameId, name: 'pre-roll', data: null }).catch(() => {})
    return { ok: true }
  })

  tavern.handle('fate-dice:free-roll', async ({ gameId, expression } = {}) => {
    if (!gameId) throw new Error('缺少 gameId')
    const settings = await safeSettings(gameId)
    const result = rollExpression(expression)
    await tavern.publishState({
      gameId,
      name: 'live-roll',
      data: { id: `free-${result.rolledAt}`, turn: 0, kind: 'free', result, animation: settings.animation || 'bounce' }
    }).catch(() => {})
    return { result }
  })
}
