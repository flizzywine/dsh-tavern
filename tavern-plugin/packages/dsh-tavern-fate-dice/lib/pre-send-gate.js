/* ------------------------------------------------------------------ *
 * pre-send-gate.js —— 「失败 / 大失败时暂停发送」发前重投闸门
 *
 * 机制：正文请求组装阶段（宿主 turnSection）真骰一旦落定为「失败 / 大失败」，
 * 本模块负责判定是否值得暂停，并把等待玩家选择做成可测试的纯逻辑 + 等待器：
 *   planPreSendGate()             —— 该不该停、能选哪几种重投
 *   resolvePreSendGateAction()    —— 玩家点的那一下是否合法
 *   createPreSendGateBroker()     —— 一次等待（含超时自动接受），可被 RPC 提前解决
 *
 * 宿主 turnSection 的回调有 30 秒硬上限，所以等待时间必须留出重投结算的余量。
 * ------------------------------------------------------------------ */

export const PRE_SEND_GATE_SCOPES = ['both', 'fumble']
export const PRE_SEND_GATE_ACTIONS = ['fate', 'push', 'accept']
export const PRE_SEND_GATE_WAIT_DEFAULT_SEC = 18
export const PRE_SEND_GATE_WAIT_MIN_SEC = 5
export const PRE_SEND_GATE_WAIT_MAX_SEC = 24
/* 宿主 turnSection 的 30 秒界：留 4 秒给「重投后重新判难 + 阻尼器同步」 */
export const PRE_SEND_GATE_HOST_BUDGET_MS = 30000
export const PRE_SEND_GATE_REROLL_RESERVE_MS = 4000
export const PRE_SEND_GATE_IDLE_MS = 3000

const clampInt = (value, min, max, fallback) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, Math.round(num)))
}

export function normalizePreSendGateSettings(settings = {}) {
  const src = settings && typeof settings === 'object' ? settings : {}
  const scope = PRE_SEND_GATE_SCOPES.includes(src.preSendScope) ? src.preSendScope : 'both'
  const waitSec = clampInt(src.preSendWait, PRE_SEND_GATE_WAIT_MIN_SEC, PRE_SEND_GATE_WAIT_MAX_SEC, PRE_SEND_GATE_WAIT_DEFAULT_SEC)
  return {
    enabled: Boolean(src.preSendPause),
    scope,
    waitSec,
    waitMs: waitSec * 1000
  }
}

/**
 * 判定本轮是否需要「暂停发送、等玩家决定」。
 * 只做策略判断，不碰骰子本身：骰点与五档结论由调用方传入。
 */
export function planPreSendGate({
  settings = {},
  roll = null,
  turn = 0,
  fatePoints = 0,
  rerollState = null,
  reused = false,
  rerolled = false
} = {}) {
  const cfg = normalizePreSendGateSettings(settings)
  const turnNum = Number.isFinite(Number(turn)) ? Math.trunc(Number(turn)) : 0
  const points = Math.max(0, Math.trunc(Number(fatePoints) || 0))
  const base = {
    pause: false,
    code: 'DISABLED',
    scope: cfg.scope,
    tier: roll && typeof roll === 'object' ? String(roll.tier || '') : '',
    tierLabel: roll && typeof roll === 'object' ? String(roll.tierLabel || '') : '',
    turn: turnNum,
    fatePoints: points,
    waitSec: cfg.waitSec,
    waitMs: cfg.waitMs,
    modes: []
  }
  if (!cfg.enabled) return base
  if (!roll || typeof roll !== 'object') return { ...base, code: 'NO_ROLL' }
  if (turnNum <= 0) return { ...base, code: 'NO_TURN' }
  if (reused) return { ...base, code: 'REGEN_REUSED' }
  if (rerolled) return { ...base, code: 'ALREADY_REROLLED' }
  if (roll.hidden) return { ...base, code: 'HIDDEN_LOCKED' }
  if (roll.tier !== 'failure' && roll.tier !== 'fumble') return { ...base, code: 'TIER_OUT_OF_SCOPE' }
  if (cfg.scope === 'fumble' && roll.tier !== 'fumble') return { ...base, code: 'TIER_OUT_OF_SCOPE' }

  const modes = []
  if (points > 0) modes.push('fate')
  modes.push('push')
  if (rerollState && typeof rerollState === 'object' && rerollState.allowed === false) {
    return { ...base, code: String(rerollState.code || 'NOT_ELIGIBLE'), modes }
  }
  return { ...base, pause: true, code: 'OK', modes }
}

/** 把浏览器送来的选择转成可执行的重投模式；'accept' 表示认栽照常发送。 */
export function resolvePreSendGateAction(action, { fatePoints = 0, modes = null } = {}) {
  const raw = String(action === undefined || action === null ? '' : action).trim().toLowerCase()
  const points = Math.max(0, Math.trunc(Number(fatePoints) || 0))
  const allowed = Array.isArray(modes) && modes.length ? modes : ['fate', 'push']
  if (raw === 'accept' || raw === 'keep' || raw === 'decline' || raw === 'timeout' || raw === 'pass') {
    return { ok: true, action: 'accept', mode: null, code: 'ACCEPTED' }
  }
  if (raw === 'push' || raw === 'gamble' || raw === 'desperate') {
    if (!allowed.includes('push')) return { ok: false, action: 'push', mode: null, code: 'MODE_NOT_ALLOWED' }
    return { ok: true, action: 'push', mode: 'push', code: 'REROLL_PUSH' }
  }
  if (raw === 'fate' || raw === 'reverse' || raw === 'reroll') {
    if (points <= 0) return { ok: false, action: 'fate', mode: null, code: 'NO_FATE_POINTS' }
    if (!allowed.includes('fate')) return { ok: false, action: 'fate', mode: null, code: 'MODE_NOT_ALLOWED' }
    return { ok: true, action: 'fate', mode: 'fate', code: 'REROLL_FATE' }
  }
  return { ok: false, action: '', mode: null, code: 'INVALID_ACTION' }
}

/**
 * 一次「暂停发送」的等待器。
 * - open() 返回 { gateId, promise }：promise 只有两种归宿——玩家选择，或超时自动接受。
 * - resolve() 由宿主 RPC 调用，先到先得，重复解决无效。
 */
export function createPreSendGateBroker({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const gates = new Map()

  function open({ id = '', waitMs = PRE_SEND_GATE_WAIT_DEFAULT_SEC * 1000, meta = null } = {}) {
    const gateId = String(id || '')
    if (!gateId) {
      return { gateId: '', promise: Promise.resolve({ gateId: '', action: 'accept', code: 'INVALID_GATE', timedOut: false, waitedMs: 0 }) }
    }
    const startedAt = now()
    const total = Math.max(0, Number(waitMs) || 0)
    let resolveFn = null
    const promise = new Promise(resolve => { resolveFn = resolve })
    const entry = { gateId, meta, startedAt, deadlineAt: startedAt + total, timer: null, closed: false }

    const finish = (action, code, timedOut) => {
      if (entry.closed) return false
      entry.closed = true
      if (entry.timer) {
        clearTimer(entry.timer)
        entry.timer = null
      }
      gates.delete(gateId)
      resolveFn({ gateId, action, code, timedOut: Boolean(timedOut), waitedMs: Math.max(0, now() - startedAt) })
      return true
    }

    entry.timer = setTimer(() => finish('accept', 'TIMEOUT', true), total)
    if (entry.timer && typeof entry.timer === 'object' && typeof entry.timer.unref === 'function') entry.timer.unref()
    gates.set(gateId, { entry, finish })
    return { gateId, promise, deadlineAt: entry.deadlineAt }
  }

  function resolve(id, action, code = 'RESOLVED') {
    const gateId = String(id || '')
    const record = gates.get(gateId)
    if (!record) return { ok: false, code: 'NO_PENDING_GATE' }
    const done = record.finish(String(action || 'accept'), code, false)
    return done ? { ok: true, gateId } : { ok: false, code: 'GATE_CLOSED' }
  }

  function peek(id) {
    const record = gates.get(String(id || ''))
    return record ? { ...record.entry } : null
  }

  function cancel(id, code = 'CANCELLED') {
    const record = gates.get(String(id || ''))
    if (!record) return false
    return record.finish('accept', code, false)
  }

  return { open, resolve, peek, cancel, get size() { return gates.size }, _gates: gates }
}

export default { planPreSendGate, resolvePreSendGateAction, normalizePreSendGateSettings, createPreSendGateBroker }
