import { createHash } from 'node:crypto'
import {
  DICE_RULES,
  DIFFICULTY_LABELS,
  DIFFICULTY_TIERS,
  OUTCOME_LABELS,
  OUTCOME_TIERS,
  RULE_LABELS,
  RULE_TARGETS,
  SKILL_BUDGET_SPECS,
  normalizeDifficulty,
  normalizeRule,
  rollCheck,
  rollExpression
} from './dice-engine.js'
import {
  SKILL_CATEGORIES,
  buildProfileDigest,
  collectCharacterMaterial,
  normalizeCharacterProfile,
  refreshProfileWithBackgroundLlm,
  summarizeMvuVariables
} from './auto-profiler.js'
import { buildDamperJudgeQuestions, resolveCheckFromDamperContext } from './damper-bridge.js'
import { judgeActionDifficulty } from './difficulty-judge.js'
import { buildTurnInjection, extractContextSnippet } from './prompt-builder.js'
import {
  PRE_SEND_GATE_HOST_BUDGET_MS,
  PRE_SEND_GATE_IDLE_MS,
  PRE_SEND_GATE_REROLL_RESERVE_MS,
  PRE_SEND_GATE_WAIT_DEFAULT_SEC,
  createPreSendGateBroker,
  normalizePreSendGateSettings,
  planPreSendGate,
  resolvePreSendGateAction
} from './pre-send-gate.js'

export const name = 'dsh-tavern-fate-dice'
export const inject = ['tavern']
export const PLUGIN_VERSION = '1.4.2'

const TONE_BIAS_BONUS = Object.freeze({ balanced: 0, heroic: 1, gritty: -1 })
const SENSITIVITY_VALUES = Object.freeze(['strict', 'normal', 'rare'])
const ANIMATION_VALUES = Object.freeze([
  'bounce',
  'prism',
  'inferno',
  'cyber',
  'jianxin',
  'singularity',
  'compact',
  'none'
])
const TONE_VALUES = Object.freeze(Object.keys(TONE_BIAS_BONUS))
const GLOBAL_GAME_ID = '__fate_dice_global__'
const MAX_CACHE_ENTRIES = 60
const MAX_SETTLED_LOCKS = 60
const DEFAULT_FATE_POINTS = 2
const MAX_FATE_POINTS = 3
const FAILS_PER_FATE_RECHARGE = 2

export const DEFAULT_GLOBAL_SETTINGS = Object.freeze({
  enabled: false,
  autoCheck: true,
  alwaysRoll: false,
  damperLinkage: true,
  allowHeuristicFallback: false,
  rule: '2d6',
  sensitivity: 'normal',
  toneBias: 'balanced',
  allowHidden: true,
  animation: 'bounce',
  /* 失败 / 大失败时暂停正文发送，等玩家选择是否用命运点逆命重投或孤注一掷 */
  preSendPause: false,
  preSendScope: 'both',
  preSendWait: PRE_SEND_GATE_WAIT_DEFAULT_SEC
})

function hashText(text) {
  return createHash('sha1').update(String(text || '').trim()).digest('hex').slice(0, 16)
}

function extractActionInput(raw) {
  return String(raw || '')
    .replace(/\n*<current_body>[\s\S]*$/i, '')
    .replace(/\n*<rewrite_request>[\s\S]*$/i, '')
    .replace(/\n*<turn_extra_request>[\s\S]*$/i, '')
    .trim()
}

function settingsCacheSignature(settings) {
  if (!settings || typeof settings !== 'object') return ''
  return [
    settings.rule || '2d6',
    settings.sensitivity || 'normal',
    settings.toneBias || 'balanced',
    settings.alwaysRoll ? 1 : 0,
    settings.allowHidden ? 1 : 0,
    settings.damperLinkage ? 1 : 0,
    settings.allowHeuristicFallback ? 1 : 0
  ].join(':')
}

function toInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

function emptySummary() {
  return {
    total: 0,
    counts: { critical: 0, success: 0, costly: 0, failure: 0, fumble: 0 },
    recent: []
  }
}

function appendToSummary(prev, roll, turn, damperSynced = false, options = {}) {
  const base = prev && typeof prev === 'object' ? prev : emptySummary()
  if (!roll || typeof roll !== 'object') return base
  const turnNum = Number(turn) || 0
  const rawRecent = Array.isArray(base.recent) ? base.recent : []
  const reusedSettled = Boolean(options?.reusedSettled)
  const prevRecent = (!reusedSettled && !options?.replaceExistingTurn && turnNum > 0)
    ? rawRecent.filter(item => (Number(item?.turn) || 0) <= turnNum)
    : rawRecent
  const existingForTurn = turnNum > 0 ? prevRecent.find(item => Number(item?.turn) === turnNum) : null
  const replaceExistingTurn = Boolean(options?.replaceExistingTurn || existingForTurn)

  const counts = { ...emptySummary().counts, ...(base.counts || {}) }
  let total = Number(base.total) || 0

  if (reusedSettled && existingForTurn) {
    // 重新生成复用本轮首次已结算真骰：不重复累加统计次数
  } else if (replaceExistingTurn && existingForTurn) {
    if (existingForTurn.tier && Object.hasOwn(counts, existingForTurn.tier)) {
      counts[existingForTurn.tier] = Math.max(0, (Number(counts[existingForTurn.tier]) || 0) - 1)
    }
    if (Object.hasOwn(counts, roll.tier)) counts[roll.tier] += 1
  } else {
    if (Object.hasOwn(counts, roll.tier)) counts[roll.tier] += 1
    total += 1
  }

  const entry = {
    turn: turnNum,
    rule: roll.rule,
    check: roll.check,
    skillId: roll.skillId || 'general',
    skillBonus: Number(roll.skillBonus) || 0,
    difficulty: roll.difficulty,
    difficultyLabel: roll.difficultyLabel,
    total: roll.total,
    target: roll.target,
    tier: roll.tier,
    tierLabel: roll.tierLabel,
    hidden: Boolean(roll.hidden),
    damperSynced: Boolean(damperSynced || roll.damper?.applied),
    damper: Boolean(damperSynced || roll.damper?.applied),
    rolledAt: roll.rolledAt || Date.now()
  }
  const recent = [entry, ...prevRecent.filter(item => item.turn !== entry.turn)].slice(0, 10)
  return {
    total,
    counts,
    recent
  }
}

function sanitizeSettings(input = {}, fallback = DEFAULT_GLOBAL_SETTINGS) {
  const base = { ...DEFAULT_GLOBAL_SETTINGS, ...(fallback || {}) }
  const next = { ...base }
  const source = input && typeof input === 'object' ? input : {}
  for (const key of ['enabled', 'autoCheck', 'alwaysRoll', 'damperLinkage', 'allowHidden', 'allowHeuristicFallback', 'preSendPause']) {
    if (source[key] !== undefined) next[key] = Boolean(source[key])
  }
  if (source.autoHidden !== undefined && source.allowHidden === undefined) next.allowHidden = Boolean(source.autoHidden)
  if (source.heuristicFallback !== undefined && source.allowHeuristicFallback === undefined) {
    next.allowHeuristicFallback = Boolean(source.heuristicFallback)
  }
  if (source.rule !== undefined) next.rule = normalizeRule(source.rule)
  if (source.sensitivity !== undefined && SENSITIVITY_VALUES.includes(source.sensitivity)) next.sensitivity = source.sensitivity
  if (source.animation !== undefined && ANIMATION_VALUES.includes(source.animation)) next.animation = source.animation
  if (source.toneBias !== undefined && TONE_VALUES.includes(source.toneBias)) next.toneBias = source.toneBias
  if (source.preSendScope !== undefined) next.preSendScope = source.preSendScope
  if (source.preSendWait !== undefined) next.preSendWait = source.preSendWait
  const gateDefaults = normalizePreSendGateSettings(next)
  next.preSendScope = gateDefaults.scope
  next.preSendWait = gateDefaults.waitSec
  return next
}

function normalizeGlobalStore(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  return {
    version: 3,
    settings: sanitizeSettings(data.settings, DEFAULT_GLOBAL_SETTINGS),
    updatedAt: toInt(data.updatedAt, Date.now())
  }
}

function normalizeFateState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const max = MAX_FATE_POINTS
  const rawPoints = src.points === undefined ? DEFAULT_FATE_POINTS : toInt(src.points, DEFAULT_FATE_POINTS)
  return {
    points: Math.max(0, Math.min(max, rawPoints)),
    max,
    failCount: Math.max(0, toInt(src.failCount, 0)),
    lastAwardTurn: Math.max(0, toInt(src.lastAwardTurn, 0))
  }
}

function applyPushRollConsequences(roll) {
  if (!roll || typeof roll !== 'object') return roll
  if (roll.tier === 'failure') {
    roll.tier = 'fumble'
    roll.tierLabel = OUTCOME_LABELS.fumble
    roll.pushedFumble = true
  } else if (roll.tier === 'critical') {
    roll.tier = 'success'
    roll.tierLabel = OUTCOME_LABELS.success
    roll.pushedCapped = true
  }
  if (roll.tier === 'success' || roll.tier === 'costly') {
    roll.pushedCostRequired = true
  }
  roll.rerollMeta = {
    count: 1,
    mode: 'push',
    label: '孤注一掷'
  }
  return roll
}

function evaluateRerollEligibility({
  turn,
  game,
  roll,
  pending = null,
  settledLock = null,
  liveLatestTurn = 0,
  inFlightPreSend = false
} = {}) {
  const fate = normalizeFateState(game?.fate)
  const base = {
    allowed: false,
    canFate: false,
    canPush: false,
    recommendedMode: null,
    fatePoints: fate.points,
    fateMax: fate.max,
    failCount: fate.failCount,
    rerollCount: 0,
    code: 'NO_ROLL',
    reason: '本轮无检定记录'
  }
  const turnNum = toInt(turn, 0)
  if (!roll || typeof roll !== 'object' || turnNum <= 0) return base

  const rerollCount = Math.max(
    toInt(roll.rerollMeta?.count, 0),
    toInt(settledLock?.rerollCount, 0),
    toInt(pending?.rerollCount, 0)
  )
  base.rerollCount = rerollCount
  if (rerollCount >= 1) {
    return { ...base, code: 'ALREADY_REROLLED', reason: '本轮已重投锁定（每轮限 1 次）' }
  }
  const isActivePending = Boolean(inFlightPreSend || (pending && toInt(pending.turn, 0) === turnNum))
  const liveTurn = toInt(liveLatestTurn, 0)
  const storedLastTurn = toInt(game?.lastTurn, 0)
  /* 回退/删楼或宿主原生轮号跳变后，game.lastTurn 可能残留大于当前最新楼层的旧轮号；
     以宿主实时最新楼层或当前已存锁表核对，绝不把当前最新轮误判为历史楼层 */
  const effectiveStoredLastTurn = (
    liveTurn > 0
    && storedLastTurn > liveTurn
    && !game?.settledRolls?.[String(storedLastTurn)]
  )
    ? liveTurn
    : storedLastTurn
  const latestTurn = Math.max(effectiveStoredLastTurn, toInt(pending?.turn, 0))
  const isCurrentLiveFloor = liveTurn > 0 && turnNum >= liveTurn && !game?.settledRolls?.[String(latestTurn)]
  if (!isActivePending && !(liveTurn > 0 && turnNum === liveTurn) && !isCurrentLiveFloor && latestTurn > 0 && turnNum < latestTurn) {
    return { ...base, code: 'HISTORY_LOCKED', reason: '仅最新楼层可重投，历史因果已锁定' }
  }
  if (roll.hidden) {
    return { ...base, code: 'HIDDEN_LOCKED', reason: '感知/洞察类暗骰不可重投' }
  }
  if (roll.tier === 'critical' || roll.tier === 'success') {
    return { ...base, code: 'ALREADY_SUCCEEDED', reason: '检定已达成成功，无需重投' }
  }
  const canFate = fate.points > 0
  return {
    ...base,
    allowed: true,
    canFate,
    canPush: true,
    recommendedMode: canFate ? 'fate' : 'push',
    code: 'OK',
    reason: ''
  }
}

function advanceFateOnSettle(prevFate, { turnNum, roll, reusedSettled, forceReroll, hadPriorLock } = {}) {
  const fate = normalizeFateState(prevFate)
  if (!roll || reusedSettled || forceReroll || hadPriorLock) return fate
  if ((Number(roll.rerollMeta?.count) || 0) > 0) return fate
  if (turnNum <= 0 || turnNum <= fate.lastAwardTurn) return fate
  if (roll.tier === 'fumble') {
    return {
      ...fate,
      points: Math.min(fate.max, fate.points + 1),
      failCount: 0,
      lastAwardTurn: turnNum
    }
  }
  if (roll.tier === 'failure') {
    const nextFail = fate.failCount + 1
    if (nextFail >= FAILS_PER_FATE_RECHARGE) {
      return {
        ...fate,
        points: Math.min(fate.max, fate.points + 1),
        failCount: 0,
        lastAwardTurn: turnNum
      }
    }
    return {
      ...fate,
      failCount: nextFail,
      lastAwardTurn: turnNum
    }
  }
  return fate
}

function normalizeSettledRolls(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const entries = []
  for (const [key, item] of Object.entries(raw)) {
    if (!item || typeof item !== 'object') continue
    const turn = toInt(item.turn ?? key, 0)
    const inputHash = typeof item.inputHash === 'string' ? item.inputHash.trim() : ''
    if (turn <= 0 || !inputHash || !item.roll || typeof item.roll !== 'object') continue
    entries.push([
      String(turn),
      {
        turn,
        input: typeof item.input === 'string' ? item.input : '',
        inputHash,
        roll: item.roll,
        judged: item.judged && typeof item.judged === 'object' ? item.judged : null,
        damperUsed: Boolean(item.damperUsed),
        rerollCount: Math.max(0, toInt(item.rerollCount, item.roll?.rerollMeta?.count || 0)),
        preSendHandled: Boolean(item.preSendHandled),
        lockedAt: toInt(item.lockedAt, Date.now())
      }
    ])
  }
  entries.sort((a, b) => a[1].turn - b[1].turn)
  return Object.fromEntries(entries.slice(-MAX_SETTLED_LOCKS))
}

function normalizeGameState(raw, fallbackRule = '2d6') {
  const data = raw && typeof raw === 'object' ? raw : {}
  const config = data.config && typeof data.config === 'object' ? { ...data.config } : {}
  const rule = normalizeRule(config.rule || fallbackRule)
  return {
    version: 3,
    config,
    characterProfile: data.characterProfile && typeof data.characterProfile === 'object'
      ? normalizeCharacterProfile(data.characterProfile, rule)
      : normalizeCharacterProfile({}, rule),
    fate: normalizeFateState(data.fate),
    settledRolls: normalizeSettledRolls(data.settledRolls),
    summary: data.summary && typeof data.summary === 'object' ? data.summary : emptySummary(),
    lastRoll: data.lastRoll && typeof data.lastRoll === 'object' ? data.lastRoll : null,
    lastTurn: toInt(data.lastTurn, 0),
    updatedAt: toInt(data.updatedAt, Date.now())
  }
}

export function apply(ctx) {
  const tavern = ctx?.tavern
  if (!tavern || typeof tavern !== 'object') return

  let runtimeLlm = null
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['llm'], scoped => {
        runtimeLlm = scoped?.llm || null
        return () => { runtimeLlm = null }
      })
    } catch {}
  }

  const turnCacheByGame = new Map()
  const pendingByGame = new Map()
  const pendingProfileByGame = new Map()
  const attachedCapsuleKeys = new Set()
  /* 发前重投闸门：一次「暂停发送」= 一个 broker 等待，由浏览器 RPC 或超时收口 */
  const preSendGateBroker = createPreSendGateBroker()
  const activeGatePayloadByGame = new Map()
  let globalCache = null
  let lastActiveGameId = ''

  async function readLiveLatestTurn(gameId) {
    if (!gameId || typeof tavern.getTurnState !== 'function') return 0
    try {
      const st = await tavern.getTurnState({ gameId })
      if (st && st.greeting !== true) return Math.max(0, toInt(st.turn, 0))
    } catch {}
    return 0
  }

  async function readGlobal() {
    if (globalCache) return globalCache
    let raw = null
    let readable = false
    try {
      if (typeof tavern.readPluginData === 'function') {
        raw = await tavern.readPluginData()
        readable = true
      } else if (typeof tavern.readGameData === 'function') {
        raw = await tavern.readGameData({ gameId: GLOBAL_GAME_ID })
        readable = true
      }
    } catch {
      raw = null
      readable = false
    }
    const data = raw && typeof raw === 'object' && raw.data !== undefined ? raw.data : raw
    if (!data || typeof data !== 'object' || !data.settings) {
      /* 读不到（宿主接口缺失或异常）时只用内存默认值，绝不拿默认值覆盖已存设置：
         否则任何一次读取失败都会把用户的开关冲回默认，表现为「打开了又自动关闭」 */
      if (!readable) return normalizeGlobalStore({ settings: DEFAULT_GLOBAL_SETTINGS })
      const fresh = normalizeGlobalStore({ settings: DEFAULT_GLOBAL_SETTINGS })
      await saveGlobal(fresh)
      return fresh
    }
    globalCache = normalizeGlobalStore(data)
    return globalCache
  }

  async function saveGlobal(store) {
    const payload = normalizeGlobalStore({ ...store, updatedAt: Date.now() })
    globalCache = payload
    try {
      if (typeof tavern.savePluginData === 'function') await tavern.savePluginData({ data: payload })
      else if (typeof tavern.saveGameData === 'function') await tavern.saveGameData({ gameId: GLOBAL_GAME_ID, data: payload })
    } catch {}
    return payload
  }

  async function readGame(gameId, fallbackRule = '2d6') {
    if (!gameId) return normalizeGameState(null, fallbackRule)
    let raw = null
    try {
      if (typeof tavern.readGameData === 'function') raw = await tavern.readGameData({ gameId })
    } catch {
      raw = null
    }
    return normalizeGameState(raw && raw.data !== undefined ? raw.data : raw, fallbackRule)
  }

  async function writeGame(gameId, data) {
    if (!gameId) return data
    const next = { ...data, updatedAt: Date.now() }
    try {
      if (typeof tavern.saveGameData === 'function') await tavern.saveGameData({ gameId, data: next })
    } catch {}
    return next
  }

  /* 本局 config 只允许覆盖「自动检定开关 / 启用 / 骰制」三项；
     其余全局检定设置（alwaysRoll 等）不再被本局历史残留值覆盖，否则全局开关会被锁死在旧值 */
  const GAME_CONFIG_OVERRIDE_KEYS = Object.freeze(['autoCheck', 'enabled', 'rule'])

  function effectiveSettings(globalStore, game) {
    const config = game && game.config && typeof game.config === 'object' ? game.config : {}
    const override = {}
    for (const key of GAME_CONFIG_OVERRIDE_KEYS) {
      if (config[key] !== undefined) override[key] = config[key]
    }
    return sanitizeSettings(
      { ...(globalStore?.settings || {}), ...override },
      globalStore?.settings || DEFAULT_GLOBAL_SETTINGS
    )
  }

  function profileOf(game, rule) {
    return normalizeCharacterProfile(game?.characterProfile || {}, normalizeRule(rule))
  }

  function buildContextSources(profile, material = null) {
    const src = material?.contextSources || {}
    return {
      playerName: String(src.playerName || profile?.characterName || ''),
      hasCard: Boolean(src.hasCard),
      cardName: String(src.cardName || ''),
      loreCount: toInt(src.loreCount, 0),
      mvuKeyCount: toInt(src.mvuKeyCount, Array.isArray(profile?.mvuHighlights) ? profile.mvuHighlights.length : 0),
      historyTurns: toInt(src.historyTurns, 0),
      backgroundModelReady: Boolean(runtimeLlm && typeof tavern.backgroundModel === 'function')
    }
  }

  async function readLatestContextAndVars(gameId, currentTurn) {
    const prevTurnNum = Math.max(1, Number(currentTurn) - 1)
    let turnSnap = null
    try {
      turnSnap = await tavern.getTurn?.({ gameId, turn: prevTurnNum })
    } catch {
      turnSnap = null
    }
    if (!turnSnap && prevTurnNum > 1) {
      try {
        turnSnap = await tavern.getTurn?.({ gameId, turn: 1 })
      } catch {
        turnSnap = null
      }
    }
    return {
      recentContext: extractContextSnippet(turnSnap),
      variables: turnSnap?.variables || null
    }
  }

  async function readDamperContext(gameId, turn) {
    if (typeof tavern.getDamperTurnContext !== 'function') return null
    let raw = null
    try {
      raw = await tavern.getDamperTurnContext({ gameId, turn })
    } catch {
      raw = null
    }
    if (!raw || typeof raw !== 'object') return null
    const context = raw.answers || raw.ruling || raw.explicitSceneShift !== undefined
      ? raw
      : (raw.data && typeof raw.data === 'object' ? raw.data : (raw.context && typeof raw.context === 'object' ? raw.context : raw))
    if (!context || typeof context !== 'object') return null
    if (!context.answers && !context.ruling && context.explicitSceneShift === undefined && !context.stateSnapshot) return null
    return context
  }

  function trimCache(gameId) {
    const keys = [...turnCacheByGame.keys()]
    if (keys.length <= MAX_CACHE_ENTRIES) return
    let removed = 0
    for (const key of keys) {
      if (removed >= keys.length - MAX_CACHE_ENTRIES) break
      if (key.startsWith(`${gameId}:`)) {
        turnCacheByGame.delete(key)
        removed += 1
      }
    }
  }

  function settingsForClient(settings) {
    return {
      enabled: Boolean(settings.enabled),
      sensitivity: settings.sensitivity,
      toneBias: settings.toneBias,
      autoHidden: settings.allowHidden,
      allowHidden: settings.allowHidden,
      alwaysRoll: Boolean(settings.alwaysRoll),
      damperLinkage: settings.damperLinkage,
      allowHeuristicFallback: Boolean(settings.allowHeuristicFallback),
      animation: settings.animation,
      preSendPause: Boolean(settings.preSendPause),
      preSendScope: normalizePreSendGateSettings(settings).scope,
      preSendWait: normalizePreSendGateSettings(settings).waitSec
    }
  }

  async function resolveStoryTurn(gameId, rawTurn, explicitStoryTurn = 0, rawInput = '') {
    if (toInt(explicitStoryTurn, 0) > 0) return toInt(explicitStoryTurn, 0)
    const raw = toInt(rawTurn, 0)
    if (gameId && typeof tavern.getTurnState === 'function') {
      try {
        const st = await tavern.getTurnState({ gameId })
        const latestStoryTurn = toInt(st?.turn, 0)
        if (latestStoryTurn > 0 && st?.greeting !== true) {
          if (st?.settled === false) return latestStoryTurn
          if (st?.generating === false) return latestStoryTurn
          if (/<(?:current_body|rewrite_request|turn_extra_request)>/i.test(String(rawInput || ''))) {
            return latestStoryTurn
          }
        }
      } catch {}
    }
    return raw
  }

  async function findLockedSettledRoll(game, gameId, storyTurn, inputHash) {
    const turnNum = toInt(storyTurn, 0)
    if (turnNum <= 0 || !inputHash) return null
    const fromGame = game?.settledRolls?.[String(turnNum)]
    if (fromGame && fromGame.inputHash === inputHash && fromGame.roll) {
      return fromGame
    }
    if (typeof tavern.readTurnData === 'function') {
      try {
        const stored = await tavern.readTurnData({ gameId, turn: turnNum })
        const data = stored?.data
        if (data && data.inputHash === inputHash && data.roll && typeof data.roll === 'object') {
          return {
            turn: turnNum,
            input: typeof data.input === 'string' ? data.input : '',
            inputHash,
            roll: data.roll,
            judged: data.judged && typeof data.judged === 'object' ? data.judged : null,
            damperUsed: Boolean(data.damperUsed ?? data.roll?.damper),
            rerollCount: Math.max(0, toInt(data.rerollCount, data.roll?.rerollMeta?.count || 0)),
            preSendHandled: Boolean(data.preSendHandled)
          }
        }
      } catch {}
    }
    return null
  }

  async function syncDamperQuotaWithRoll({ gameId, turn, roll, judged, damperUsed, settings }) {
    let damperShiftResult = null
    if (damperUsed && roll && settings.damperLinkage && typeof tavern.applyDamperDiceShift === 'function') {
      try {
        damperShiftResult = await tavern.applyDamperDiceShift({
          gameId,
          turn,
          tier: roll.tier,
          check: roll.check,
          summary: `${roll.rule}:${roll.total}/${roll.target} (${roll.tierLabel})`
        })
      } catch {
        damperShiftResult = null
      }
    }
    if (roll && (damperUsed || roll.damperSync || roll.damper)) {
      const syncedRuling = damperShiftResult?.ruling || null
      const prevDamper = roll.damper && typeof roll.damper === 'object' ? roll.damper : null
      const fallbackModifier = prevDamper?.modifier ?? (Number(judged?.edgeBonus) || 0)
      roll.damper = {
        applied: Boolean(damperShiftResult?.applied ?? prevDamper?.applied ?? true),
        blockedByViolation: Boolean(damperShiftResult?.blockedByViolation ?? prevDamper?.blockedByViolation),
        modifier: Number(judged?.edgeBonus ?? fallbackModifier) || 0,
        quota: syncedRuling ? `${syncedRuling.rulingTier} / ${syncedRuling.deltaBudget}` : (prevDamper?.quota || null),
        quotaLabel: syncedRuling
          ? `配额:${syncedRuling.deltaBudget}`
          : (damperShiftResult?.blockedByViolation ? '越权锁定' : (prevDamper?.quotaLabel || '阻尼联动')),
        reason: Array.isArray(roll.damperSync?.notes) && roll.damperSync.notes.length
          ? roll.damperSync.notes.join('；')
          : (judged?.reason || prevDamper?.reason || '')
      }
    }
    return damperShiftResult
  }

  /**
   * 核心回合检定闭环：合并阻尼器单趟裁定 / 四源独立判定 → 真骰 → 配额反向同步 → 注入文本。
   * 同一楼层 turn 且玩家输入 inputHash 未变时，重新生成正文强制复用首次已结算的真骰结果并重新同步阻尼器配额。
   */
  async function computeTurn({ gameId, turn, storyTurn: explicitStoryTurn = 0, input, overrideSettings = null, force = false, rerollMode = null } = {}) {
    const cleanInput = extractActionInput(input)
    if (gameId) lastActiveGameId = gameId
    if (!gameId || !cleanInput) return { skipped: 'empty', injection: '' }

    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = sanitizeSettings(
      { ...effectiveSettings(globalStore, game), ...(overrideSettings || {}) },
      globalStore.settings
    )
    if (!settings.enabled || !settings.autoCheck) {
      await tavern.publishState?.({ gameId, name: 'live-roll', data: null }).catch(() => {})
      return { skipped: 'disabled', injection: '' }
    }

    const damperTurn = toInt(turn, 0)
    const storyTurn = await resolveStoryTurn(gameId, turn, explicitStoryTurn, input)
    const inputHash = hashText(cleanInput)
    const cacheKey = `${gameId}:${storyTurn}:${settingsCacheSignature(settings)}:${inputHash}`
    if (!force) {
      const cached = turnCacheByGame.get(cacheKey)
      if (cached) return cached
    }

    const activeRule = normalizeRule(settings.rule)
    const characterProfile = profileOf(game, activeRule)

    if (!force) {
      const lockedSettled = (await findLockedSettledRoll(game, gameId, storyTurn, inputHash))
        || (damperTurn > 0 && damperTurn !== storyTurn ? await findLockedSettledRoll(game, gameId, damperTurn, inputHash) : null)
      if (lockedSettled?.roll) {
        const reusedRoll = structuredClone(lockedSettled.roll)
        reusedRoll.reusedOnRegenerate = true
        const reusedJudged = lockedSettled.judged ? structuredClone(lockedSettled.judged) : null
        let reusedDamperUsed = false
        if (settings.damperLinkage) {
          const damperContext = (await readDamperContext(gameId, damperTurn))
            || (damperTurn !== storyTurn ? await readDamperContext(gameId, storyTurn) : null)
          if (damperContext) {
            const bypassedCode = damperContext.outcome?.status === 'bypassed' ? String(damperContext.outcome.code || '') : ''
            const unconfiguredDamper = bypassedCode === 'DAMPER_NO_KEY' || bypassedCode === 'DAMPER_INVALID_CONFIG' || bypassedCode === 'DAMPER_AUTH_ERROR'
            if (!unconfiguredDamper || settings.allowHeuristicFallback) {
              reusedDamperUsed = true
            }
          } else if (lockedSettled.damperUsed || reusedRoll.damper) {
            reusedDamperUsed = true
          }
        }
        const damperShiftResult = await syncDamperQuotaWithRoll({
          gameId,
          turn: damperTurn || storyTurn,
          roll: reusedRoll,
          judged: reusedJudged,
          damperUsed: reusedDamperUsed,
          settings
        })
        const injection = buildTurnInjection(reusedRoll)
        const reusedRecord = {
          gameId,
          turn: storyTurn,
          rawTurn: damperTurn,
          input: cleanInput,
          inputHash,
          injection,
          roll: reusedRoll,
          judged: reusedJudged,
          damperUsed: reusedDamperUsed,
          damperShiftResult,
          reusedSettled: true,
          rerollCount: Math.max(toInt(lockedSettled.rerollCount, 0), toInt(reusedRoll.rerollMeta?.count, 0)),
          preSendHandled: Boolean(lockedSettled.preSendHandled),
          settings,
          characterProfile,
          animation: settings.animation,
          createdAt: Date.now()
        }
        turnCacheByGame.set(cacheKey, reusedRecord)
        trimCache(gameId)
        pendingByGame.set(gameId, reusedRecord)
        await tavern.publishState?.({
          gameId,
          name: 'live-roll',
          data: {
            id: `${storyTurn}-${reusedRoll.rolledAt}-reused-${reusedRecord.createdAt}`,
            turn: storyTurn,
            kind: 'check',
            roll: reusedRoll,
            reused: true,
            animation: settings.animation,
            emittedAt: Date.now()
          }
        }).catch(() => {})
        await tavern.publishState?.({
          gameId,
          name: 'turn-check',
          data: { turn: storyTurn, at: Date.now(), hasRoll: true, reused: true, streaming: true }
        }).catch(() => {})
        return reusedRecord
      }
    }

    const { recentContext, variables } = await readLatestContextAndVars(gameId, storyTurn)
    const mvuNow = summarizeMvuVariables(variables)
    if (mvuNow.highlights?.length && !characterProfile.mvuHighlights?.length) {
      characterProfile.mvuHighlights = mvuNow.highlights.slice(0, 12)
    }

    let judged = null
    let damperUsed = false
    let setupRequiredReason = ''

    if (settings.damperLinkage) {
      const damperContext = (await readDamperContext(gameId, damperTurn))
        || (damperTurn !== storyTurn ? await readDamperContext(gameId, storyTurn) : null)
      if (damperContext) {
        const bypassedCode = damperContext.outcome?.status === 'bypassed' ? String(damperContext.outcome.code || '') : ''
        const unconfiguredDamper = bypassedCode === 'DAMPER_NO_KEY' || bypassedCode === 'DAMPER_INVALID_CONFIG' || bypassedCode === 'DAMPER_AUTH_ERROR'
        if (unconfiguredDamper && !settings.allowHeuristicFallback) {
          setupRequiredReason = bypassedCode
        } else {
          damperUsed = true
          judged = resolveCheckFromDamperContext({
            damperContext,
            input: cleanInput,
            profile: characterProfile,
            rule: activeRule,
            sensitivity: settings.sensitivity,
            allowHidden: settings.allowHidden,
            damperLinkage: settings.damperLinkage
          })
        }
      }
    }

    if (!damperUsed && !setupRequiredReason) {
      let judgeReady = false
      let judgeReason = 'NOT_CONFIGURED'
      if (tavern?.capabilities?.decisionJudge && typeof tavern.decisionJudgeStatus === 'function') {
        try {
          const st = await tavern.decisionJudgeStatus()
          judgeReady = Boolean(st?.available)
          if (!judgeReady && st?.reason) judgeReason = String(st.reason)
        } catch {
          judgeReady = false
        }
      }
      if (!judgeReady && !settings.allowHeuristicFallback) {
        setupRequiredReason = judgeReason
      } else {
        const material = await collectCharacterMaterial({ tavern, gameId, turn: storyTurn }).catch(() => null)
        const characterMaterial = buildProfileDigest(
          characterProfile,
          [
            material?.promptDigest || '',
            mvuNow.summary ? `【MVU 实时状态】${mvuNow.summary}` : ''
          ].filter(Boolean).join('\n')
        )
        judged = await judgeActionDifficulty({
          tavern,
          gameId,
          input: cleanInput,
          recentContext,
          characterMaterial,
          profile: characterProfile,
          rule: activeRule,
          sensitivity: settings.sensitivity,
          allowHidden: settings.allowHidden,
          timeoutMs: 2500
        })
      }
    }

    // 「每轮必检定」：AI 判为低不确定性时也强制投骰（场景切换/越权拦截仍然跳过）
    if ((settings.alwaysRoll || rerollMode) && judged && judged.shouldRoll !== true) {
      const hardSkip = !rerollMode && (judged.damperSync?.skipped === 'scene-shift' || judged.damperSync?.blockedByViolation === true)
      if (!hardSkip) {
        judged = {
          ...judged,
          shouldRoll: true,
          reason: rerollMode
            ? `${judged.reason || ''}`.trim()
            : `${judged.reason || ''}（每轮必检定：已强制投骰）`.trim()
        }
      }
    }

    let roll = null
    if (judged?.shouldRoll) {
      const toneBonus = TONE_BIAS_BONUS[settings.toneBias] || 0
      const edgeBonus = Number(judged.edgeBonus) || 0
      const skillBonus = Number(judged.skillBonus) || 0
      roll = rollCheck({
        rule: activeRule,
        skillId: judged.skillId,
        skillName: judged.skillName || judged.check,
        check: judged.check,
        skillBonus,
        difficulty: normalizeDifficulty(judged.difficulty),
        modifier: edgeBonus + toneBonus,
        hidden: Boolean(judged.hidden),
        attempt: cleanInput.slice(0, 120),
        reason: judged.reason,
        stakes: '成功推动预期进展；失败产生真实阻力与新变化'
      })
      roll.modifierBreakdown = {
        skillBonus,
        edgeBonus,
        varModifier: 0,
        matchedVars: mvuNow.highlights?.slice(0, 4).map(h => ({ label: h.key, value: h.value })) || [],
        toneBonus
      }
      roll.judgeSource = judged.source || 'heuristic'
      roll.judgeTier = judged.judgeTier || null
      roll.retriedSafetyFallback = Boolean(judged.retriedSafetyFallback)
      roll.damperSync = judged.damperSync || null
      if (rerollMode === 'push') {
        applyPushRollConsequences(roll)
      } else if (rerollMode === 'fate') {
        const fateLeft = Math.max(0, normalizeFateState(game.fate).points - 1)
        roll.rerollMeta = {
          count: 1,
          mode: 'fate',
          label: '逆命重投',
          fateRemaining: fateLeft
        }
      }
    }

    const damperShiftResult = await syncDamperQuotaWithRoll({
      gameId,
      turn: damperTurn || storyTurn,
      roll,
      judged,
      damperUsed,
      settings
    })

    const injection = buildTurnInjection(roll)
    const record = {
      gameId,
      turn: storyTurn,
      rawTurn: damperTurn,
      input: cleanInput,
      inputHash,
      injection,
      roll,
      judged,
      damperUsed,
      damperShiftResult,
      rerollCount: rerollMode ? 1 : 0,
      forceReroll: Boolean(rerollMode),
      setupRequiredReason: setupRequiredReason || '',
      settings,
      characterProfile,
      animation: settings.animation,
      createdAt: Date.now()
    }

    turnCacheByGame.set(cacheKey, record)
    trimCache(gameId)
    pendingByGame.set(gameId, record)

    if (roll) {
      await tavern.publishState?.({
        gameId,
        name: 'live-roll',
        data: {
          id: `${storyTurn}-${roll.rolledAt}`,
          turn: storyTurn,
          kind: 'check',
          roll,
          animation: settings.animation,
          emittedAt: Date.now()
        }
      }).catch(() => {})
    } else if (setupRequiredReason) {
      await tavern.publishState?.({
        gameId,
        name: 'live-roll',
        data: {
          id: `setup-${storyTurn}-${Date.now()}`,
          turn: storyTurn,
          kind: 'setup-required',
          reason: setupRequiredReason,
          message: '请先前往酒馆「设置 › 叙事阻尼器」配置决策模型与 API Key，配好后即可启用 AI 自动检定',
          animation: settings.animation === 'none' ? 'compact' : settings.animation
        }
      }).catch(() => {})
    } else if (judged && judged.shouldRoll === false) {
      const prob = Number(judged.needProbability)
      const gate = Number(judged.threshold)
      const probText = Number.isFinite(prob) ? `触发概率 ${Math.round(prob * 100)}%` : '模型判定无不确定性'
      const gateText = Number.isFinite(gate) ? ` < 阈值 ${Math.round(gate * 100)}%` : ''
      await tavern.publishState?.({
        gameId,
        name: 'live-roll',
        data: {
          id: `skip-${storyTurn}-${inputHash}`,
          turn: storyTurn,
          kind: 'skipped',
          check: judged.check || '',
          needProbability: Number.isFinite(prob) ? prob : null,
          threshold: Number.isFinite(gate) ? gate : null,
          sensitivity: settings.sensitivity,
          reason: judged.reason || '',
          message: judged.damperSync?.skipped === 'scene-shift'
            ? '场景切换过渡：本轮免检定'
            : `本轮无需检定（${probText}${gateText}）`,
          animation: 'compact'
        }
      }).catch(() => {})
    } else {
      await tavern.publishState?.({ gameId, name: 'live-roll', data: null }).catch(() => {})
    }
    await tavern.publishState?.({
      gameId,
      name: 'turn-check',
      data: {
        turn: storyTurn,
        at: Date.now(),
        hasRoll: Boolean(roll),
        skipped: Boolean(!roll && judged && judged.shouldRoll === false),
        setupRequired: Boolean(setupRequiredReason),
        streaming: true
      }
    }).catch(() => {})

    return record
  }

  // ── 发前暂停闸门：失败 / 大失败时先别发正文，等玩家决定要不要逆命 ────────
  async function publishPreSendGate(gameId, data) {
    if (!gameId) return
    if (data && data.gateId) activeGatePayloadByGame.set(gameId, structuredClone(data))
    else activeGatePayloadByGame.delete(gameId)
    await tavern.publishState?.({ gameId, name: 'pre-send-gate', data: data || null }).catch(() => {})
  }

  function buildGatePayload({ gameId, record, plan, fate, waitMs, deadlineAt, round, error }) {
    const roll = record.roll || {}
    return {
      gateId: '',
      gameId,
      turn: record.turn,
      rawTurn: record.rawTurn,
      round,
      rule: roll.rule || '',
      check: roll.check || '',
      skillName: roll.skillName || '',
      tier: roll.tier || '',
      tierLabel: roll.tierLabel || '',
      total: roll.total,
      target: roll.target,
      dice: Array.isArray(roll.dice) ? roll.dice.slice(0, 6) : [],
      modifier: Number(roll.totalModifier ?? ((Number(roll.skillBonus) || 0) + (Number(roll.modifier) || 0))) || 0,
      difficultyLabel: roll.difficultyLabel || roll.difficulty || '',
      reason: roll.reason || '',
      rolledAt: roll.rolledAt || 0,
      animation: record.animation || (record.settings && record.settings.animation) || '',
      fate: { points: fate.points, max: fate.max, failCount: fate.failCount },
      modes: plan.modes,
      scope: plan.scope,
      waitMs,
      deadlineAt,
      error: error || '',
      at: Date.now()
    }
  }

  /**
   * 真骰已在发送前落下：若命中「失败 / 大失败」且设置允许，就把正文请求按在这里，
   * 广播 pre-send-gate 让浏览器弹窗，等玩家选「命运点重投 / 孤注一掷 / 接受」后再返回注入文本。
   */
  async function awaitPreSendReroll({ gameId, record, startedAt = Date.now() } = {}) {
    const baseInjection = record?.injection || ''
    if (!record || !record.roll) {
      await publishPreSendGate(gameId, null)
      return baseInjection
    }
    const settings = record.settings || {}
    let game = null
    try {
      game = await readGame(gameId, normalizeRule(settings.rule))
    } catch {
      game = null
    }
    if (!game) {
      await publishPreSendGate(gameId, null)
      return baseInjection
    }
    let fate = normalizeFateState(game.fate)
    const liveLatestTurn = await readLiveLatestTurn(gameId)
    const rerollState = evaluateRerollEligibility({
      turn: record.turn,
      game,
      roll: record.roll,
      pending: record,
      liveLatestTurn,
      inFlightPreSend: true
    })
    const plan = planPreSendGate({
      settings,
      roll: record.roll,
      turn: record.turn,
      fatePoints: fate.points,
      rerollState,
      reused: Boolean(record.reusedSettled && record.preSendHandled),
      rerolled: Boolean(record.forceReroll) || toInt(record.rerollCount, 0) > 0
    })
    if (!plan.pause) {
      await publishPreSendGate(gameId, null)
      return baseInjection
    }
    /* 宿主 turnSection 30 秒上限：扣掉已经花掉的时间，并给重投结算预留 4 秒 */
    const budget = PRE_SEND_GATE_HOST_BUDGET_MS - (Date.now() - startedAt) - PRE_SEND_GATE_REROLL_RESERVE_MS
    if (budget < PRE_SEND_GATE_IDLE_MS) {
      /* 判难本身就吃掉了大半预算：宁可不拦，也不要让宿主 30 秒超时把整段注入丢掉 */
      await publishPreSendGate(gameId, null)
      return baseInjection
    }
    const waitMs = Math.max(PRE_SEND_GATE_IDLE_MS, Math.min(plan.waitMs, budget))

    let injection = baseInjection
    let round = 0
    let gateError = ''
    try {
      while (round < 2) {
        /* 每一轮都按剩余预算重新收口：宿主 30 秒一到就会跳过本段，宁可自动接受也不丢注入 */
        const remaining = PRE_SEND_GATE_HOST_BUDGET_MS - (Date.now() - startedAt) - PRE_SEND_GATE_REROLL_RESERVE_MS
        if (remaining < PRE_SEND_GATE_IDLE_MS) break
        const roundWaitMs = Math.max(PRE_SEND_GATE_IDLE_MS, Math.min(waitMs, remaining))
        round += 1
        const gateId = `${gameId}#${record.turn}#${record.roll.rolledAt || 0}#${round}#${Date.now().toString(36)}`
        const deadlineAt = Date.now() + roundWaitMs
        const opened = preSendGateBroker.open({
          id: gateId,
          waitMs: roundWaitMs,
          meta: { gameId, turn: record.turn, modes: plan.modes.slice(), fatePoints: fate.points }
        })
        const payload = buildGatePayload({ gameId, record, plan, fate, waitMs: roundWaitMs, deadlineAt, round, error: gateError })
        payload.gateId = gateId
        await publishPreSendGate(gameId, payload)

        let decision = null
        try {
          decision = await opened.promise
        } catch {
          decision = { action: 'accept', code: 'WAIT_FAILED' }
        }
        if (!decision || decision.action === 'accept') break

        const freshGame = await readGame(gameId, normalizeRule(settings.rule)).catch(() => game)
        fate = normalizeFateState(freshGame?.fate ?? fate)
        const resolved = resolvePreSendGateAction(decision.action, { fatePoints: fate.points, modes: plan.modes })
        if (!resolved.ok) {
          gateError = resolved.code === 'NO_FATE_POINTS'
            ? '命运点已耗尽，只能孤注一掷或接受命运'
            : '该重投方式本轮不可用'
          continue
        }
        const reroll = await handleRerollTurn({
          gameId,
          turn: record.turn,
          input: record.input,
          mode: resolved.mode
        })
        if (reroll && reroll.ok) {
          injection = reroll.injection || record.injection || baseInjection
          gateError = ''
          break
        }
        gateError = (reroll && (reroll.error || reroll.code)) || '重投失败'
      }
      record.preSendHandled = true
      const latestPending = pendingByGame.get(gameId)
      if (latestPending && Number(latestPending.turn) === Number(record.turn)) {
        latestPending.preSendHandled = true
      }
    } finally {
      await publishPreSendGate(gameId, null)
    }
    return injection
  }

  // ── 发前无感检定注入 ────────────────────────────────────────────
  if (typeof tavern.turnSection === 'function') {
    tavern.turnSection({
      name: 'fate-dice',
      position: 'after',
      async text({ gameId, turn, input } = {}) {
        if (!gameId) return ''
        const startedAt = Date.now()
        const record = await computeTurn({ gameId, turn, input })
        if (!record?.injection) {
          await publishPreSendGate(gameId, null)
          return record?.injection || ''
        }
        return await awaitPreSendReroll({ gameId, record, startedAt })
      }
    })
  }

  // ── 叙事阻尼器单趟合并提问 ──────────────────────────────────────
  if (tavern.capabilities?.narrativeDamper && typeof tavern.damperTurnQuestions === 'function') {
    try {
      tavern.damperTurnQuestions({
        name: 'fate-dice-judge',
        async questions({ gameId, protocol: dynamicProtocol, capabilities: dynCaps } = {}) {
          const globalStore = await readGlobal()
          const game = await readGame(gameId, globalStore.settings.rule)
          const settings = effectiveSettings(globalStore, game)
          if (!settings.enabled || !settings.autoCheck || !settings.damperLinkage) return []
          const activeRule = normalizeRule(settings.rule)
          const resolvedProto = dynamicProtocol || (dynCaps?.choice && dynCaps?.score ? 'gemini' : 'noul')
          return buildDamperJudgeQuestions({
            profile: profileOf(game, activeRule),
            rule: activeRule,
            protocol: resolvedProto,
            allowHidden: settings.allowHidden,
            autoProfile: true
          })
        }
      })
    } catch {}
  }

  // ── 后台结算：自动建立与演进主角能力画像 ─────────────────────────
  function buildProfileSyncSection(game, settings) {
    const profile = game.characterProfile
    const traits = Array.isArray(profile?.traits) ? profile.traits.filter(item => item && item.name) : []
    const rule = normalizeRule(settings?.rule)
    if (!traits.length) {
      return [
        '【命运之骰·主角能力画像（自动建档）】',
        '本局尚未建立主角能力画像。请调用工具 fate_dice_profile_sync，依据【角色卡 / 用户人设 / 启用世界书 / 当前 MVU 变量 / 本轮正文】推演主角的能力画像：',
        '- characterName：受控主角名；archetype：一句话实力与当前状态定位；',
        '- traits：4~8 条，覆盖特长、短板与当前伤病/装备/境界状态；每条给 name（≤8字）、tier（-2..3 整数）、hidden（感知洞察类为 true）、source（角色卡|世界书|MVU|正文）、reason（简短依据）。',
        `- 当前骰制 ${rule}：tier 会自动换算为检定加值，无需玩家手动设置。`
      ].join('\n')
    }
    return [
      '【命运之骰·主角能力画像（动态演进）】',
      `当前画像已建立（${traits.length} 条）：${traits.map(item => `${item.name}[tier ${Number(item.tier) >= 0 ? '+' : ''}${Number(item.tier) || 0}]`).join('、')}`,
      '仅在正文或 MVU 发生实质的能力变化、伤病、境界突破/跌落或关键道具得失时，才调用 fate_dice_profile_sync 更新画像；无实质变化不要调用。'
    ].join('\n')
  }

  if (typeof tavern.settlementSection === 'function') {
    tavern.settlementSection({
      name: 'fate-dice-profile',
      async text({ gameId } = {}) {
        if (!gameId) return ''
        lastActiveGameId = gameId
        const globalStore = await readGlobal()
        const game = await readGame(gameId, globalStore.settings.rule)
        const settings = effectiveSettings(globalStore, game)
        if (!settings.enabled || !settings.autoCheck) return ''
        return buildProfileSyncSection(game, settings)
      }
    })
  }

  const profileSyncTool = async (rawCall = {}, toolCtx = {}) => {
    const envelope = rawCall && typeof rawCall === 'object' ? rawCall : {}
    const payload = envelope.arguments && typeof envelope.arguments === 'object' ? envelope.arguments : envelope
    const gameId = payload.gameId || envelope.gameId || toolCtx?.gameId || lastActiveGameId || ''
    const rawTraits = Array.isArray(payload.traits) ? payload.traits : (Array.isArray(payload.report?.traits) ? payload.report.traits : [])
    const report = {
      characterName: String(payload.characterName || envelope.characterName || ''),
      archetype: String(payload.archetype || envelope.archetype || ''),
      traits: rawTraits
    }
    if (gameId && (report.traits.length || report.characterName || report.archetype)) {
      pendingProfileByGame.set(gameId, report)
    }
    return { ok: true, gameId: gameId || null, accepted: report.traits.length }
  }

  if (typeof tavern.settlementTool === 'function') {
    tavern.settlementTool({
      name: 'fate_dice_profile_sync',
      description: '提交/更新主角能力画像（能力、短板与当前伤病/装备/境界状态）。首次建档必调，之后仅在实质变化时调用。',
      parameters: {
        type: 'object',
        properties: {
          gameId: { type: 'string', description: '当前对局 id（宿主上下文已提供时可省略）' },
          characterName: { type: 'string', description: '受控主角名' },
          archetype: { type: 'string', description: '一句话实力与当前状态定位' },
          traits: {
            type: 'array',
            description: '4~8 条能力特征',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '不超过 8 字的能力/状态名' },
                tier: { type: 'integer', description: '-2 到 3 的能力阶梯：-2 短板受创，0 普通，2 职业专精，3 高阶位格压制' },
                hidden: { type: 'boolean', description: '感知洞察类为 true（暗骰）' },
                source: { type: 'string', enum: ['角色卡', '世界书', 'MVU', '正文', '综合'] },
                reason: { type: 'string', description: '简短依据' }
              }
            }
          }
        }
      },
      handler: profileSyncTool,
      execute: profileSyncTool
    })
  }

  // ── 正式落盘结算 ────────────────────────────────────────────────
  if (typeof tavern.onTurnSettled === 'function') {
    tavern.onTurnSettled(async ({ gameId, turn, textVersion } = {}) => {
      if (!gameId) return
      lastActiveGameId = gameId
      const pending = pendingByGame.get(gameId)
      const syncedProfile = pendingProfileByGame.get(gameId)
      const matchesPending = Boolean(
        pending && (
          Number(pending.turn) === Number(turn)
          || (Number(pending.rawTurn) > 0 && Number(pending.rawTurn) === Number(turn))
        )
      )
      if (!matchesPending && !syncedProfile) return
      const activePending = matchesPending ? pending : null

      try {
        const globalStore = await readGlobal()
        const game = await readGame(gameId, globalStore.settings.rule)
        const settings = pending?.settings || effectiveSettings(globalStore, game)
        const activeRule = normalizeRule(settings.rule)

        const latestVars = (await readLatestContextAndVars(gameId, Number(turn) + 1)).variables
        const mvuNow = summarizeMvuVariables(latestVars)
        let characterProfile = profileOf(game, activeRule)
        if (syncedProfile) {
          characterProfile = normalizeCharacterProfile({
            ...characterProfile,
            characterName: syncedProfile.characterName || characterProfile.characterName,
            archetype: syncedProfile.archetype || characterProfile.archetype,
            traits: syncedProfile.traits?.length ? syncedProfile.traits : characterProfile.traits,
            mvuHighlights: mvuNow.highlights?.length ? mvuNow.highlights : characterProfile.mvuHighlights,
            customNote: characterProfile.customNote,
            updatedTurn: Number(turn) || game.lastTurn,
            updatedAt: Date.now()
          }, activeRule)
        } else if (mvuNow.highlights?.length) {
          characterProfile = { ...characterProfile, mvuHighlights: mvuNow.highlights.slice(0, 12) }
        }

        const turnNum = toInt(turn, 0)
        const nextSettledRolls = { ...(game.settledRolls || {}) }
        const hadPriorLock = Boolean(turnNum > 0 && nextSettledRolls[String(turnNum)])
        if (turnNum > 0 && activePending) {
          for (const key of Object.keys(nextSettledRolls)) {
            if (toInt(key, 0) > turnNum) delete nextSettledRolls[key]
          }
          const turnKey = String(turnNum)
          const existingLock = nextSettledRolls[turnKey]
          if (activePending.roll) {
            const shouldUpdateLock = !existingLock
              || existingLock.inputHash !== activePending.inputHash
              || Boolean(activePending.forceReroll)
            if (shouldUpdateLock) {
              const cleanLockedRoll = structuredClone(activePending.roll)
              delete cleanLockedRoll.reusedOnRegenerate
              const rerollCount = Math.max(
                toInt(activePending.rerollCount, 0),
                toInt(cleanLockedRoll.rerollMeta?.count, 0)
              )
              nextSettledRolls[turnKey] = {
                turn: turnNum,
                input: activePending.input || '',
                inputHash: activePending.inputHash || hashText(activePending.input || ''),
                roll: cleanLockedRoll,
                judged: activePending.judged ? structuredClone(activePending.judged) : null,
                damperUsed: Boolean(activePending.damperUsed),
                rerollCount,
                preSendHandled: Boolean(
                  activePending.preSendHandled
                  || (existingLock && existingLock.inputHash === activePending.inputHash && existingLock.preSendHandled)
                ),
                lockedAt: Date.now()
              }
            } else if (existingLock && activePending.preSendHandled && !existingLock.preSendHandled) {
              nextSettledRolls[turnKey] = { ...existingLock, preSendHandled: true }
            }
          } else if (existingLock && (existingLock.inputHash !== activePending.inputHash || activePending.forceReroll)) {
            delete nextSettledRolls[turnKey]
          }
        }

        const baseFate = normalizeFateState(game.fate)
        if (turnNum > 0 && activePending && baseFate.lastAwardTurn > turnNum) {
          baseFate.lastAwardTurn = hadPriorLock ? turnNum : Math.max(0, turnNum - 1)
        }
        const nextFate = advanceFateOnSettle(baseFate, {
          turnNum,
          roll: activePending?.roll || null,
          reusedSettled: Boolean(activePending?.reusedSettled),
          forceReroll: Boolean(activePending?.forceReroll),
          hadPriorLock
        })
        const preservedLock = turnNum > 0 ? nextSettledRolls[String(turnNum)] : null
        let priorTurnStored = null
        if (!activePending && !preservedLock && turnNum > 0 && typeof tavern.readTurnData === 'function') {
          try {
            priorTurnStored = await tavern.readTurnData({ gameId, turn: turnNum })
          } catch {
            priorTurnStored = null
          }
        }
        const effectiveRoll = activePending
          ? (activePending.roll || null)
          : (preservedLock?.roll || priorTurnStored?.data?.roll || null)
        const effectiveJudged = activePending
          ? (activePending.judged || null)
          : (preservedLock?.judged || priorTurnStored?.data?.judged || null)
        const effectiveInput = activePending
          ? (activePending.input || '')
          : (preservedLock?.input || priorTurnStored?.data?.input || '')
        const effectiveInputHash = activePending
          ? (activePending.inputHash || null)
          : (preservedLock?.inputHash || priorTurnStored?.data?.inputHash || null)
        const effectiveDamperUsed = activePending
          ? Boolean(activePending.damperUsed)
          : Boolean(preservedLock?.damperUsed ?? priorTurnStored?.data?.damperUsed)
        const effectiveRerollCount = activePending
          ? Math.max(toInt(activePending.rerollCount, 0), toInt(activePending.roll?.rerollMeta?.count, 0))
          : Math.max(toInt(preservedLock?.rerollCount, 0), toInt(priorTurnStored?.data?.rerollCount, 0), toInt(effectiveRoll?.rerollMeta?.count, 0))
        const effectivePreSendHandled = Boolean(
          activePending?.preSendHandled
          || preservedLock?.preSendHandled
          || priorTurnStored?.data?.preSendHandled
        )

        const nextSummary = activePending?.roll
          ? appendToSummary(game.summary, activePending.roll, turn, activePending.damperUsed, {
            reusedSettled: Boolean(activePending.reusedSettled)
          })
          : game.summary
        const nextGame = {
          ...game,
          characterProfile,
          fate: nextFate,
          settledRolls: normalizeSettledRolls(nextSettledRolls),
          summary: nextSummary,
          lastRoll: activePending?.roll || game.lastRoll,
          /* 以当前已结算轮次为准，避免回退/删楼后残留更大的旧轮号锁死后续最新轮重投与发前暂停 */
          lastTurn: turnNum > 0 ? turnNum : toInt(game.lastTurn, 0),
          updatedAt: Date.now()
        }
        await writeGame(gameId, nextGame)

        try {
          await tavern.saveTurnData?.({
            gameId,
            turn,
            textVersion,
            data: {
              input: effectiveInput,
              inputHash: effectiveInputHash,
              damperUsed: effectiveDamperUsed,
              rerollCount: effectiveRerollCount,
              preSendHandled: effectivePreSendHandled,
              roll: effectiveRoll,
              judged: effectiveJudged,
              characterProfile
            }
          })
        } catch {}

        // 必须在 writeGame 与 saveTurnData 都完成后再移除内存 pending，杜绝结算异步窗口期前端 read-turn 读空导致胶囊闪烁消失
        if (activePending && pendingByGame.get(gameId) === activePending) {
          pendingByGame.delete(gameId)
        }
        if (syncedProfile && pendingProfileByGame.get(gameId) === syncedProfile) {
          pendingProfileByGame.delete(gameId)
        }

        if (effectiveRoll && turnNum > 0 && typeof textVersion === 'string' && textVersion && typeof tavern.attach === 'function') {
          const attachKey = `${gameId}:${turnNum}:${textVersion}`
          if (!attachedCapsuleKeys.has(attachKey)) {
            attachedCapsuleKeys.add(attachKey)
            if (attachedCapsuleKeys.size > 300) {
              const oldest = attachedCapsuleKeys.values().next().value
              if (oldest) attachedCapsuleKeys.delete(oldest)
            }
            try {
              await tavern.attach({
                gameId,
                turn: turnNum,
                textVersion,
                item: {
                  kind: 'dsh-tavern-fate-dice/roll-capsule',
                  status: 'ready',
                  data: { turn: turnNum }
                }
              })
            } catch {}
          }
        }

        await tavern.publishState?.({ gameId, name: 'summary', data: nextSummary }).catch(() => {})
        await tavern.publishState?.({
          gameId,
          name: 'turn-check',
          data: { turn: toInt(turn, 0), at: Date.now() }
        }).catch(() => {})
        await tavern.publishState?.({
          gameId,
          name: 'workbench-sync',
          data: {
            turn,
            lastTurn: nextGame.lastTurn,
            fate: nextFate,
            summary: nextSummary,
            characterProfile,
            lastRoll: nextGame.lastRoll
          }
        }).catch(() => {})

        for (const key of [...turnCacheByGame.keys()]) {
          if (
            key.startsWith(`${gameId}:${turn}:`)
            || (activePending?.turn && key.startsWith(`${gameId}:${activePending.turn}:`))
            || (activePending?.rawTurn && key.startsWith(`${gameId}:${activePending.rawTurn}:`))
          ) {
            turnCacheByGame.delete(key)
          }
        }
      } finally {
        if (activePending && pendingByGame.get(gameId) === activePending) {
          pendingByGame.delete(gameId)
        }
        if (syncedProfile && pendingProfileByGame.get(gameId) === syncedProfile) {
          pendingProfileByGame.delete(gameId)
        }
      }
    })
  }

  if (typeof tavern.onTimelineChanged === 'function') {
    tavern.onTimelineChanged(({ gameId, kind } = {}) => {
      if (!gameId) return
      // 宿主在 regenBody 返回后立即发 timelineChanged('regenerate')，此时后台结算（onTurnSettled）往往仍在运行；
      // 仅清内存帧缓存，保留待落盘的 pendingByGame / pendingProfileByGame 供随后到达的 onTurnSettled 消费。
      if (kind !== 'regenerate' && kind !== 'edit') {
        pendingByGame.delete(gameId)
        pendingProfileByGame.delete(gameId)
      }
      for (const key of [...turnCacheByGame.keys()]) {
        if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
      }
    })
  }

  if (typeof tavern.onGameRemoved === 'function') {
    tavern.onGameRemoved(({ gameId } = {}) => {
      if (!gameId) return
      pendingByGame.delete(gameId)
      pendingProfileByGame.delete(gameId)
      for (const key of [...turnCacheByGame.keys()]) {
        if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
      }
    })
  }

  // ── 浏览器侧极简 RPC ────────────────────────────────────────────
  function handle(rpcName, fn) {
    if (typeof tavern.handle === 'function') tavern.handle(rpcName, fn)
  }

  async function buildWorkbenchView(params = {}) {
    const gameId = params.gameId || ''
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = effectiveSettings(globalStore, game)
    const activeRule = normalizeRule(settings.rule)
    const characterProfile = profileOf(game, activeRule)

    let judgeStatus = { available: false }
    if (typeof tavern.decisionJudgeStatus === 'function') {
      try {
        judgeStatus = await tavern.decisionJudgeStatus()
      } catch {
        judgeStatus = { available: false }
      }
    }

    let profileMaterial = null
    if (gameId) {
      profileMaterial = await collectCharacterMaterial({
        tavern,
        gameId,
        turn: Math.max(2, toInt(game.lastTurn, 1) + 1)
      }).catch(() => null)
      if (profileMaterial?.mvuHighlights?.length && !characterProfile.mvuHighlights?.length) {
        characterProfile.mvuHighlights = profileMaterial.mvuHighlights.slice(0, 12)
      }
    }

    return {
      ok: true,
      name,
      version: PLUGIN_VERSION,
      gameId: gameId || null,
      activeGameId: gameId || lastActiveGameId || null,
      rules: DICE_RULES.map(rule => ({ value: rule, label: RULE_LABELS[rule], targets: RULE_TARGETS[rule], budget: SKILL_BUDGET_SPECS[rule] })),
      difficulties: DIFFICULTY_TIERS.map(value => ({ value, label: DIFFICULTY_LABELS[value] })),
      outcomes: OUTCOME_TIERS.map(value => ({ value, label: OUTCOME_LABELS[value] })),
      categories: SKILL_CATEGORIES,
      settings: settingsForClient(settings),
      globalSettings: globalStore.settings,
      rule: activeRule,
      autoCheck: settings.autoCheck,
      characterProfile,
      contextSources: buildContextSources(characterProfile, profileMaterial),
      binding: { autoCheck: settings.autoCheck, rule: activeRule },
      damper: { available: Boolean(tavern.capabilities?.narrativeDamper), linkage: settings.damperLinkage },
      damperBridgeAvailable: Boolean(tavern.capabilities?.narrativeDamper),
      damperLinkage: settings.damperLinkage,
      judgeStatus,
      fate: game.fate,
      summary: game.summary || emptySummary(),
      lastRoll: game.lastRoll,
      lastTurn: game.lastTurn,
      source: 'host'
    }
  }

  handle('fate-dice:workbench', buildWorkbenchView)
  handle('fate-dice:bootstrap', buildWorkbenchView)
  handle('fate-dice:status', buildWorkbenchView)

  async function handleSaveGlobalSettings(params = {}) {
    const globalStore = await readGlobal()
    const incoming = params.settings || params.data || params.config || params
    const settings = sanitizeSettings(incoming, globalStore.settings)
    const saved = await saveGlobal({ ...globalStore, settings })
    turnCacheByGame.clear()
    const clientSettings = settingsForClient(saved.settings)
    if (lastActiveGameId) {
      await tavern.publishState?.({
        gameId: lastActiveGameId,
        name: 'workbench-sync',
        data: { settings: clientSettings }
      }).catch(() => {})
    }
    return { ok: true, settings: clientSettings }
  }
  handle('fate-dice:save-global-settings', handleSaveGlobalSettings)
  handle('fate-dice:save-settings', handleSaveGlobalSettings)

  async function handleSaveBinding(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const incoming = params.binding || params.config || params.settings || params
    const config = { ...game.config }
    if (typeof incoming.autoCheck === 'boolean') config.autoCheck = incoming.autoCheck
    if (typeof incoming.enabled === 'boolean') config.enabled = incoming.enabled
    if (typeof incoming.rule === 'string' && incoming.rule) config.rule = normalizeRule(incoming.rule)
    const activeRule = normalizeRule(config.rule || globalStore.settings.rule)
    const characterProfile = profileOf(game, activeRule)
    await writeGame(gameId, { ...game, config, characterProfile })
    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
    }
    return { ok: true, config, rule: activeRule, autoCheck: config.autoCheck ?? globalStore.settings.autoCheck }
  }
  handle('fate-dice:save-binding', handleSaveBinding)
  handle('fate-dice:save-game-config', handleSaveBinding)

  async function handleRefreshProfile(params = {}) {
    const gameId = params.gameId || lastActiveGameId || ''
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = effectiveSettings(globalStore, game)
    const turn = Math.max(2, toInt(Number(params.turn) || toInt(game.lastTurn, 1) + 1, 2))
    const result = await refreshProfileWithBackgroundLlm({
      llm: runtimeLlm,
      tavern,
      gameId,
      turn,
      rule: settings.rule,
      existingProfile: game.characterProfile || null
    })
    const characterProfile = normalizeCharacterProfile(result.characterProfile, settings.rule)
    const contextSources = buildContextSources(characterProfile, { contextSources: result.contextSources })
    if (!result.ok || !characterProfile.traits.length) {
      return {
        ok: false,
        error: result.error || '未推演出有效的角色能力画像',
        characterProfile,
        contextSources
      }
    }
    const saved = { ...characterProfile, updatedTurn: turn, updatedAt: Date.now() }
    await writeGame(gameId, { ...game, characterProfile: saved })
    await tavern.publishState?.({
      gameId,
      name: 'workbench-sync',
      data: { characterProfile: saved, contextSources, refreshedAt: Date.now(), turn }
    }).catch(() => {})
    return { ok: true, turn, characterProfile: saved, contextSources }
  }
  handle('fate-dice:refresh-profile', handleRefreshProfile)

  async function handleSaveProfileNote(params = {}) {
    const gameId = params.gameId || ''
    const globalStore = await readGlobal()
    if (!gameId) {
      if (params.rule !== undefined && params.rule !== '') {
        const nextRule = normalizeRule(params.rule)
        const saved = await saveGlobal({ ...globalStore, settings: { ...globalStore.settings, rule: nextRule } })
        turnCacheByGame.clear()
        return { ok: true, rule: saved.settings.rule, characterProfile: null, contextSources: null }
      }
      return { ok: false, error: '缺少 gameId' }
    }
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = effectiveSettings(globalStore, game)
    const nextRule = params.rule !== undefined && params.rule !== ''
      ? normalizeRule(params.rule)
      : normalizeRule(settings.rule)
    const config = { ...game.config }
    if (params.rule !== undefined && params.rule !== '') config.rule = nextRule
    const characterProfile = normalizeCharacterProfile(game.characterProfile || {}, nextRule)
    if (params.customNote !== undefined) characterProfile.customNote = String(params.customNote || '').slice(0, 200)
    characterProfile.updatedAt = Date.now()
    await writeGame(gameId, { ...game, config, characterProfile })
    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
    }
    const contextSources = buildContextSources(characterProfile)
    await tavern.publishState?.({
      gameId,
      name: 'workbench-sync',
      data: { characterProfile, contextSources, rule: nextRule }
    }).catch(() => {})
    return { ok: true, rule: nextRule, characterProfile, contextSources }
  }
  handle('fate-dice:save-profile-note', handleSaveProfileNote)

  async function handleReadTurn(params = {}) {
    const gameId = params.gameId || lastActiveGameId || ''
    const wantLatest = Boolean(params.latest)
    let turn = toInt(params.turn, 0)
    if (!gameId || (turn <= 0 && !params.streaming && !wantLatest)) return null
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = effectiveSettings(globalStore, game)
    const pending = pendingByGame.get(gameId)
    const liveLatestTurn = await readLiveLatestTurn(gameId)
    if (turn <= 0 && wantLatest) {
      const settledTurns = Object.keys(game.settledRolls || {}).map(k => toInt(k, 0)).filter(n => n > 0)
      const recentTurn = Array.isArray(game.summary?.recent) && game.summary.recent[0] ? toInt(game.summary.recent[0].turn, 0) : 0
      const storedLatest = (liveLatestTurn > 0 && toInt(game.lastTurn, 0) > liveLatestTurn && !game.settledRolls?.[String(game.lastTurn)])
        ? liveLatestTurn
        : toInt(game.lastTurn, 0)
      turn = Math.max(
        0,
        toInt(pending?.turn, 0),
        storedLatest,
        recentTurn,
        settledTurns.length ? Math.max(...settledTurns) : 0
      )
    }
    const baseMeta = {
      rule: normalizeRule(settings.rule),
      autoCheck: Boolean(settings.autoCheck),
      animation: settings.animation || 'bounce'
    }
    // 重新生成流式期间，DOM 楼层带目标 storyTurn 且 streaming=true，兼容 storyTurn / rawTurn / streaming 读取
    if (pending && (
      Number(pending.turn) === turn
      || (Number(pending.rawTurn) > 0 && Number(pending.rawTurn) === turn)
      || Boolean(params.streaming)
    )) {
      const pTurn = turn > 0 ? turn : toInt(pending.turn, turn)
      const pLock = game.settledRolls?.[String(pTurn)] || null
      return {
        ...baseMeta,
        gameId,
        turn: pTurn,
        streaming: true,
        textVersion: null,
        roll: pending.roll,
        judged: pending.judged,
        setupRequiredReason: pending.setupRequiredReason || null,
        characterProfile: pending.characterProfile || null,
        fate: game.fate,
        rerollState: evaluateRerollEligibility({ turn: pTurn, game, roll: pending.roll, pending, settledLock: pLock })
      }
    }
    const settledLock = turn > 0 ? (game.settledRolls?.[String(turn)] || null) : null
    let stored = null
    try {
      if (turn > 0) stored = await tavern.readTurnData?.({ gameId, turn })
    } catch {
      stored = null
    }
    if (settledLock?.roll) {
      const storedRolledAt = Number(stored?.data?.roll?.rolledAt) || 0
      const lockRolledAt = Number(settledLock.roll?.rolledAt) || 0
      if (!stored?.data?.roll || lockRolledAt >= storedRolledAt) {
        return {
          ...baseMeta,
          gameId,
          turn,
          streaming: false,
          textVersion: stored?.textVersion ?? null,
          roll: settledLock.roll,
          judged: settledLock.judged || stored?.data?.judged || null,
          characterProfile: stored?.data?.characterProfile || game.characterProfile || null,
          fate: game.fate,
          rerollState: evaluateRerollEligibility({ turn, game, roll: settledLock.roll, settledLock, liveLatestTurn })
        }
      }
    }
    const legacyLastRoll = (!settledLock?.roll && !stored?.data?.roll && !stored?.data?.judged && turn === toInt(game.lastTurn, 0) && game.lastRoll)
      ? game.lastRoll
      : null
    if (legacyLastRoll) {
      return {
        ...baseMeta,
        gameId,
        turn,
        streaming: false,
        textVersion: stored?.textVersion ?? null,
        roll: legacyLastRoll,
        judged: null,
        characterProfile: stored?.data?.characterProfile || game.characterProfile || null,
        fate: game.fate,
        rerollState: evaluateRerollEligibility({ turn, game, roll: legacyLastRoll, settledLock, liveLatestTurn })
      }
    }
    if (stored && stored.turn === turn && stored.data) {
      const storedRoll = stored.data.roll || null
      return {
        ...baseMeta,
        gameId,
        turn,
        streaming: false,
        textVersion: stored.textVersion ?? null,
        roll: storedRoll,
        judged: stored.data.judged || null,
        characterProfile: stored.data.characterProfile || null,
        fate: game.fate,
        rerollState: evaluateRerollEligibility({
          turn,
          game,
          roll: storedRoll,
          settledLock: stored.data.rerollCount ? { rerollCount: stored.data.rerollCount } : settledLock,
          liveLatestTurn
        })
      }
    }
    if (wantLatest) {
      return {
        ...baseMeta,
        gameId,
        turn,
        streaming: false,
        textVersion: null,
        roll: null,
        judged: null,
        setupRequiredReason: null,
        characterProfile: game.characterProfile || null,
        fate: game.fate,
        rerollState: null
      }
    }
    return null
  }
  handle('fate-dice:read-turn', handleReadTurn)

  async function handleRerollTurn(params = {}) {
    const gameId = params.gameId || lastActiveGameId || ''
    if (!gameId) return { ok: false, code: 'MISSING_GAME', error: '缺少 gameId' }
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const pendingRecord = pendingByGame.get(gameId)
    const turn = toInt(params.turn, pendingRecord?.turn || game.lastTurn || 0)
    if (turn <= 0) return { ok: false, code: 'INVALID_TURN', error: '缺少有效楼层 turn', turn: 0 }

    const turnKey = String(turn)
    const settledLock = game.settledRolls?.[turnKey] || null
    let storedTurn = null
    try {
      storedTurn = await tavern.readTurnData?.({ gameId, turn })
    } catch {
      storedTurn = null
    }

    const activePending = pendingRecord && Number(pendingRecord.turn) === turn ? pendingRecord : null
    const liveLatestTurn = await readLiveLatestTurn(gameId)
    const legacyRoll = (!activePending && !settledLock?.roll && !storedTurn?.data?.roll && turn === toInt(game.lastTurn, 0) && game.lastRoll)
      ? game.lastRoll
      : null
    const currentRoll = activePending?.roll || settledLock?.roll || storedTurn?.data?.roll || legacyRoll || null
    const effectiveLock = settledLock || (storedTurn?.data?.rerollCount ? { rerollCount: storedTurn.data.rerollCount } : null)
    const check = evaluateRerollEligibility({
      turn,
      game,
      roll: currentRoll,
      pending: activePending,
      settledLock: effectiveLock,
      liveLatestTurn
    })
    if (!check.allowed) {
      return {
        ok: false,
        turn,
        code: check.code,
        error: check.reason,
        fate: game.fate,
        rerollState: check
      }
    }

    const requestedMode = params.mode === 'fate' || params.mode === 'push' ? params.mode : 'auto'
    if (requestedMode === 'fate' && !check.canFate) {
      return {
        ok: false,
        turn,
        code: 'NO_FATE_POINTS',
        error: '命运点已耗尽，仅可选择孤注一掷',
        fate: game.fate,
        rerollState: check
      }
    }
    const chosenMode = requestedMode === 'auto' ? check.recommendedMode : requestedMode

    const sourceInput = String(
      params.input
      || activePending?.input
      || settledLock?.input
      || storedTurn?.data?.input
      || currentRoll?.attempt
      || ''
    ).trim()
    if (!sourceInput) {
      return { ok: false, code: 'MISSING_INPUT', error: '缺少原始输入，无法重投该轮', turn, fate: game.fate, rerollState: check }
    }

    const wasSettled = Boolean((settledLock || storedTurn?.data?.roll || legacyRoll) && !activePending)
    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:${turn}:`)) turnCacheByGame.delete(key)
    }

    const record = await computeTurn({ gameId, turn, storyTurn: turn, input: sourceInput, force: true, rerollMode: chosenMode })
    record.forceReroll = true
    record.rerollCount = 1

    const baseFate = normalizeFateState(game.fate)
    const nextFate = chosenMode === 'fate'
      ? { ...baseFate, points: Math.max(0, baseFate.points - 1), failCount: 0 }
      : { ...baseFate, failCount: 0 }

    if (wasSettled) {
      const nextSettledRolls = { ...(game.settledRolls || {}) }
      if (record.roll) {
        const cleanRoll = structuredClone(record.roll)
        delete cleanRoll.reusedOnRegenerate
        nextSettledRolls[turnKey] = {
          turn,
          input: record.input,
          inputHash: record.inputHash,
          roll: cleanRoll,
          judged: record.judged ? structuredClone(record.judged) : null,
          damperUsed: Boolean(record.damperUsed),
          rerollCount: 1,
          lockedAt: Date.now()
        }
      } else {
        delete nextSettledRolls[turnKey]
      }
      const nextSummary = record.roll
        ? appendToSummary(game.summary, record.roll, turn, record.damperUsed, { replaceExistingTurn: true })
        : game.summary
      const nextGame = {
        ...game,
        fate: nextFate,
        settledRolls: normalizeSettledRolls(nextSettledRolls),
        summary: nextSummary,
        lastRoll: record.roll || game.lastRoll,
        updatedAt: Date.now()
      }
      await writeGame(gameId, nextGame)
      try {
        await tavern.saveTurnData?.({
          gameId,
          turn,
          textVersion: storedTurn?.textVersion ?? undefined,
          data: {
            input: record.input,
            inputHash: record.inputHash,
            damperUsed: Boolean(record.damperUsed),
            rerollCount: 1,
            roll: record.roll || null,
            judged: record.judged || null,
            characterProfile: record.characterProfile || game.characterProfile
          }
        })
      } catch {}
      await tavern.publishState?.({ gameId, name: 'summary', data: nextSummary }).catch(() => {})
      await tavern.publishState?.({
        gameId,
        name: 'turn-check',
        data: { turn: toInt(turn, 0), at: Date.now() }
      }).catch(() => {})
      await tavern.publishState?.({
        gameId,
        name: 'workbench-sync',
        data: {
          turn,
          fate: nextFate,
          summary: nextSummary,
          characterProfile: game.characterProfile,
          lastRoll: nextGame.lastRoll
        }
      }).catch(() => {})
      for (const key of [...turnCacheByGame.keys()]) {
        if (key.startsWith(`${gameId}:${turn}:`)) turnCacheByGame.delete(key)
      }
      pendingByGame.delete(gameId)
    } else {
      await writeGame(gameId, { ...game, fate: nextFate })
      await tavern.publishState?.({
        gameId,
        name: 'workbench-sync',
        data: {
          turn,
          fate: nextFate,
          summary: game.summary,
          characterProfile: game.characterProfile,
          lastRoll: record.roll || game.lastRoll
        }
      }).catch(() => {})
    }

    const afterState = evaluateRerollEligibility({
      turn,
      game: { ...game, fate: nextFate },
      roll: record.roll,
      pending: wasSettled ? null : record,
      settledLock: wasSettled ? { rerollCount: 1 } : null
    })

    return {
      ok: true,
      turn,
      mode: chosenMode,
      fate: nextFate,
      rerollState: afterState,
      roll: record.roll || null,
      injection: record.injection || ''
    }
  }
  handle('fate-dice:reroll-turn', handleRerollTurn)

  /* 浏览器弹窗的选择：解决正在等待的发前闸门（命运点重投 / 孤注一掷 / 接受命运） */
  async function handleGateResolve(params = {}) {
    const gateId = String(params.gateId || '')
    if (!gateId) return { ok: false, code: 'MISSING_GATE', error: '缺少 gateId' }
    const openGate = preSendGateBroker.peek(gateId)
    if (!openGate) return { ok: false, code: 'NO_PENDING_GATE', error: '当前没有等待中的发前重投' }
    const gateGameId = String(openGate.meta?.gameId || '')
    const requestedGameId = String(params.gameId || '')
    if (gateGameId && requestedGameId && gateGameId !== requestedGameId) {
      return { ok: false, code: 'GATE_MISMATCH', error: '该发前重投不属于当前对话' }
    }
    let fatePoints = toInt(openGate.meta?.fatePoints, 0)
    if (gateGameId) {
      try {
        const globalStore = await readGlobal()
        const game = await readGame(gateGameId, globalStore.settings.rule)
        fatePoints = normalizeFateState(game?.fate).points
      } catch {}
    }
    const resolved = resolvePreSendGateAction(params.action, { fatePoints, modes: openGate.meta?.modes })
    if (!resolved.ok) {
      return {
        ok: false,
        code: resolved.code,
        error: resolved.code === 'NO_FATE_POINTS' ? '命运点已耗尽，仅可选择孤注一掷或接受命运' : '该选择本轮不可用',
        fatePoints
      }
    }
    const settled = preSendGateBroker.resolve(gateId, resolved.action, resolved.code)
    if (!settled.ok) return { ok: false, code: settled.code, error: '该发前重投已结束' }
    return { ok: true, gateId, action: resolved.action, mode: resolved.mode, code: resolved.code, fatePoints }
  }
  handle('fate-dice:gate-resolve', handleGateResolve)

  async function handleGatePeek(params = {}) {
    const requestedGameId = String(params.gameId || '').trim()
    const targetGameId = requestedGameId || lastActiveGameId || ''
    let payload = targetGameId ? (activeGatePayloadByGame.get(targetGameId) || null) : null
    if (!payload && !requestedGameId && activeGatePayloadByGame.size === 1) {
      payload = activeGatePayloadByGame.values().next().value || null
    } else if (!payload && requestedGameId && activeGatePayloadByGame.size === 1) {
      /* 浏览器侧尚未从 SPA 同步到最新会话 ID 时，若全局唯一一个活跃闸门正在等待，直接返回以修正绑定 */
      const sole = activeGatePayloadByGame.values().next().value || null
      if (sole && sole.gameId && sole.gameId === lastActiveGameId) payload = sole
    }
    if (payload && payload.gateId && !preSendGateBroker.peek(payload.gateId)) {
      if (payload.gameId) activeGatePayloadByGame.delete(payload.gameId)
      payload = null
    }
    return {
      ok: true,
      gameId: (payload && payload.gameId) || targetGameId || null,
      gate: payload ? structuredClone(payload) : null
    }
  }
  handle('fate-dice:gate-peek', handleGatePeek)

  async function handleFreeRoll(params = {}) {
    const gameId = params.gameId || ''
    const globalStore = await readGlobal()
    const game = gameId ? await readGame(gameId, globalStore.settings.rule) : null
    const settings = effectiveSettings(globalStore, game)
    const result = rollExpression(params.expression || '2d6')
    if (gameId) {
      await tavern.publishState?.({
        gameId,
        name: 'live-roll',
        data: { id: `free-${result.rolledAt}`, turn: 0, kind: 'free', result, animation: settings.animation }
      }).catch(() => {})
    }
    return { ok: true, result }
  }
  handle('fate-dice:free-roll', handleFreeRoll)
}

export default { name, inject, apply }
