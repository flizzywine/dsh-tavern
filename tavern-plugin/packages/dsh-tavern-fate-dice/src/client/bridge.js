/* ------------------------------------------------------------------ *
 * bridge.js —— 宿主 RPC 安全桥、本地持久化、工作台视图模型归一化
 * 所有宿主调用均经 fdCall 包裹：宿主未实现该接口时返回 { ok:false }，绝不抛错。
 * ------------------------------------------------------------------ */

function fdNoop() {}

let fdCurrentGameId = ''
const fdGameIdListeners = new Set()

function fdDetectUrlGameId() {
  return fdSafe(() => {
    if (typeof window !== 'undefined' && window.location) {
      const search = String(window.location.search || '')
      const hash = String(window.location.hash || '')
      const combinedQuery = search + (hash.includes('?') ? '&' + hash.slice(hash.indexOf('?') + 1) : '')
      const qMatch = /[?&](?:sessionId|gameId)=([^&#]+)/.exec(combinedQuery)
      if (qMatch && qMatch[1]) return decodeURIComponent(qMatch[1])
      const routeText = String(window.location.pathname || '') + ' ' + hash
      const pMatch = /\/(?:sessions?|chats?|play|c)\/([a-zA-Z0-9_.:-]{6,})/.exec(routeText)
      if (pMatch && pMatch[1]) return decodeURIComponent(pMatch[1])
      const sMatch = /\b(session-[a-zA-Z0-9_.:-]{6,})\b/.exec(routeText)
      if (sMatch && sMatch[1]) return sMatch[1]
    }
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const els = document.querySelectorAll('[data-dsh-tavern-card-app-session], [data-session]')
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i]
        if (!el || typeof el.getAttribute !== 'function') continue
        const sid = (el.getAttribute('data-dsh-tavern-card-app-session') || el.getAttribute('data-session') || '').trim()
        if (sid) return sid
      }
    } else if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const el = document.querySelector('[data-dsh-tavern-card-app-session], [data-session]')
      if (el && typeof el.getAttribute === 'function') {
        const sid = el.getAttribute('data-dsh-tavern-card-app-session') || el.getAttribute('data-session') || ''
        if (sid) return sid.trim()
      }
    }
    return ''
  }, '')
}

function fdNoteActiveGameId(gameId) {
  const next = typeof gameId === 'string' ? gameId.trim() : ''
  if (!next || next === '__fate_dice_global__' || next === fdCurrentGameId) return
  fdCurrentGameId = next
  fdGameIdListeners.forEach(fn => {
    try { fn(next) } catch {}
  })
}

function fdGetActiveGameId() {
  const detected = fdDetectUrlGameId()
  if (detected && detected !== '__fate_dice_global__') {
    if (detected !== fdCurrentGameId) fdNoteActiveGameId(detected)
    return detected
  }
  return fdCurrentGameId || ''
}

function fdSubscribeActiveGameId(listener) {
  if (typeof listener !== 'function') return fdNoop
  fdGameIdListeners.add(listener)
  return () => { fdGameIdListeners.delete(listener) }
}

function fdSafe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/* 别名表：宿主侧若采用不同命名仍可命中；主名始终优先 */
const FD_RPC_ALIASES = {
  'fate-dice:workbench': ['fate-dice:read-workbench', 'fate-dice:workbench-state'],
  'fate-dice:save-global-settings': ['fate-dice:save-settings', 'fate-dice:global-settings'],
  'fate-dice:save-binding': ['fate-dice:bind-groups', 'fate-dice:save-bind']
}

function fdCall(ui, rpc, payload) {
  if (!ui || typeof ui.callHost !== 'function') return Promise.resolve({ ok: false, error: '宿主未提供 callHost' })
  const names = [rpc].concat(FD_RPC_ALIASES[rpc] || [])
  let lastError = '宿主调用失败'
  const attempt = index => {
    if (index >= names.length) return Promise.resolve({ ok: false, error: lastError })
    return Promise.resolve()
      .then(() => ui.callHost(names[index], payload))
      .then(data => ({ ok: true, data, rpc: names[index] }))
      .catch(error => {
        lastError = (error && error.message) || String(error || '宿主调用失败')
        return attempt(index + 1)
      })
  }
  return attempt(0)
}

function fdWatch(ui, gameId, name, handler) {
  if (!ui || typeof ui.watchState !== 'function') return fdNoop
  try {
    const off = ui.watchState(gameId, name, handler)
    return typeof off === 'function' ? off : fdNoop
  } catch {
    return fdNoop
  }
}

function fdStoreGet(key, fallback) {
  return fdSafe(() => {
    if (typeof window === 'undefined' || !window.localStorage) return fallback
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed === null || parsed === undefined ? fallback : parsed
  }, fallback)
}

function fdStoreSet(key, value) {
  return fdSafe(() => {
    if (typeof window === 'undefined' || !window.localStorage) return false
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  }, false)
}

function fdEnsureStyleInjected() {
  fdSafe(() => {
    if (typeof document === 'undefined' || !document.head) return
    const existing = document.getElementById(FD_STYLE_ID)
    if (existing) {
      /* 客户端热重载后旧 <style> 仍在 DOM 中：必须比对并覆写，否则新样式永远不生效 */
      if (existing.textContent !== CSS_TEXT) existing.textContent = CSS_TEXT
      return
    }
    const el = document.createElement('style')
    el.id = FD_STYLE_ID
    el.textContent = CSS_TEXT
    document.head.appendChild(el)
  })
}

function fdNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

/* 仅保留白名单内的检定参数（含发前暂停闸门）；其余历史字段一律丢弃 */
function fdNormalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const settings = { ...FD_DEFAULT_SETTINGS }
  if (typeof src.enabled === 'boolean') settings.enabled = src.enabled
  if (FD_SENSITIVITY_OPTIONS.some(o => o.value === src.sensitivity)) settings.sensitivity = src.sensitivity
  if (FD_TONE_OPTIONS.some(o => o.value === src.toneBias)) settings.toneBias = src.toneBias
  if (FD_ANIMATION_OPTIONS.some(o => o.value === src.animation)) settings.animation = src.animation
  if (typeof src.alwaysRoll === 'boolean') settings.alwaysRoll = src.alwaysRoll
  if (typeof src.autoHidden === 'boolean') settings.autoHidden = src.autoHidden
  else if (typeof src.allowHidden === 'boolean') settings.autoHidden = src.allowHidden
  if (typeof src.damperLinkage === 'boolean') settings.damperLinkage = src.damperLinkage
  if (typeof src.allowHeuristicFallback === 'boolean') settings.allowHeuristicFallback = src.allowHeuristicFallback
  else if (typeof src.heuristicFallback === 'boolean') settings.allowHeuristicFallback = src.heuristicFallback
  if (typeof src.preSendPause === 'boolean') settings.preSendPause = src.preSendPause
  if (FD_PRE_SEND_SCOPE_OPTIONS.some(o => o.value === src.preSendScope)) settings.preSendScope = src.preSendScope
  const waitSec = fdNumber(src.preSendWait, settings.preSendWait)
  if (FD_PRE_SEND_WAIT_OPTIONS.some(o => Number(o.value) === Math.round(waitSec))) settings.preSendWait = Math.round(waitSec)
  return settings
}

function fdNormalizeRecent(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(item => item && typeof item === 'object').map(item => ({
    turn: fdNumber(item.turn, 0),
    check: String(item.check || item.skill || '检定'),
    total: fdNumber(item.total, 0),
    tier: String(item.tier || 'success'),
    tierLabel: String(item.tierLabel || item.tier || '结果'),
    hidden: Boolean(item.hidden),
    damper: Boolean(item.damperSynced ?? item.damper ?? false),
    rolledAt: fdNumber(item.rolledAt, 0)
  }))
}

function fdNormalizeFate(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const max = Math.max(1, fdNumber(src.max, 3))
  const points = fdClamp(fdNumber(src.points, 2), 0, max)
  return {
    points,
    max,
    failCount: Math.max(0, fdNumber(src.failCount, 0))
  }
}

function fdBindStatusSummary(view, status) {
  if (!status || typeof status !== 'object') return view
  const next = { ...view }
  if (status.judgeStatus) next.judgeStatus = status.judgeStatus
  if (status.fate) next.fate = fdNormalizeFate(status.fate)
  const summary = status.summary
  if (summary && typeof summary === 'object') {
    const counts = summary.counts && typeof summary.counts === 'object' ? summary.counts : {}
    next.summary = summary
    next.stats = {
      total: fdNumber(summary.total, 0),
      good: fdNumber(counts.critical, 0) + fdNumber(counts.success, 0),
      bad: fdNumber(counts.costly, 0) + fdNumber(counts.failure, 0) + fdNumber(counts.fumble, 0)
    }
    if (Array.isArray(summary.recent) && summary.recent.length) next.recent = fdNormalizeRecent(summary.recent)
  }
  return next
}

function fdEmptyCharacterProfile() {
  return {
    characterName: '',
    archetype: '',
    traits: [],
    mvuHighlights: [],
    customNote: '',
    updatedTurn: 0,
    updatedAt: 0
  }
}

function fdEmptyContextSources() {
  return {
    playerName: '',
    hasCard: false,
    cardName: '',
    loreCount: 0,
    mvuKeyCount: 0,
    historyTurns: 0,
    backgroundModelReady: false
  }
}

const FD_PROFILE_SOURCES = ['角色卡', '世界书', 'MVU', '正文', '综合']

function fdNormalizeProfileTrait(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const label = String(src.label || src.name || src.trait || src.title || '').trim()
  if (!label) return null
  const source = FD_PROFILE_SOURCES.includes(src.source) ? src.source : '综合'
  const bonus = fdClamp(fdNumber(src.bonus ?? src.value ?? src.mod, 0), -50, 50)
  return {
    id: String(src.id || (source + ':' + label)),
    name: label,
    label,
    tier: fdClamp(fdNumber(src.tier, 0), -3, 3),
    bonus,
    tone: src.tone === 'good' || src.tone === 'bad' || src.tone === 'neutral'
      ? src.tone
      : (bonus > 0 ? 'good' : (bonus < 0 ? 'bad' : 'neutral')),
    source,
    hidden: Boolean(src.hidden ?? src.dark ?? false),
    reason: String(src.reason || src.note || src.basis || '')
  }
}

function fdNormalizeMvuHighlights(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map(item => {
      if (item && typeof item === 'object') {
        const key = String(item.key || item.name || item.path || '').trim()
        if (!key) return null
        return { key, value: String(item.value === undefined || item.value === null ? '' : item.value) }
      }
      const text = String(item || '').trim()
      if (!text) return null
      const idx = text.indexOf(':')
      if (idx < 0) return { key: text, value: '' }
      return { key: text.slice(0, idx).trim(), value: text.slice(idx + 1).trim() }
    }).filter(Boolean).slice(0, 24)
  }
  if (typeof raw === 'object') {
    return Object.keys(raw).slice(0, 24).map(key => ({ key, value: String(raw[key] === undefined || raw[key] === null ? '' : raw[key]) }))
  }
  return []
}

function fdNormalizeCharacterProfile(raw) {
  const base = fdEmptyCharacterProfile()
  if (!raw || typeof raw !== 'object') return base
  const traits = Array.isArray(raw.traits) ? raw.traits.map(fdNormalizeProfileTrait).filter(Boolean).slice(0, 24) : []
  return {
    characterName: String(raw.characterName || raw.name || raw.character || ''),
    archetype: String(raw.archetype || raw.tagline || raw.summary || ''),
    traits,
    mvuHighlights: fdNormalizeMvuHighlights(raw.mvuHighlights || raw.mvu || raw.variables),
    customNote: String(raw.customNote || raw.note || ''),
    updatedTurn: Math.max(0, fdNumber(raw.updatedTurn ?? raw.turn, 0)),
    updatedAt: Math.max(0, fdNumber(raw.updatedAt, 0))
  }
}

function fdNormalizeContextSources(raw) {
  const base = fdEmptyContextSources()
  if (!raw || typeof raw !== 'object') return base
  return {
    playerName: String(raw.playerName || raw.userName || ''),
    hasCard: Boolean(raw.hasCard ?? raw.cardReady ?? false),
    cardName: String(raw.cardName || raw.characterName || ''),
    loreCount: Math.max(0, fdNumber(raw.loreCount ?? raw.worldbookCount ?? raw.lore, 0)),
    mvuKeyCount: Math.max(0, fdNumber(raw.mvuKeyCount ?? raw.mvuCount ?? raw.variableCount, 0)),
    historyTurns: Math.max(0, fdNumber(raw.historyTurns ?? raw.turns ?? raw.history, 0)),
    backgroundModelReady: Boolean(raw.backgroundModelReady ?? raw.modelReady ?? false)
  }
}

function fdProfileCacheKey(gameId) {
  return String(gameId || '__global__')
}

function fdLoadProfileCache(gameId) {
  const cache = fdStoreGet(FD_STORAGE_KEYS.characterProfile, null)
  const src = cache && typeof cache === 'object' && !Array.isArray(cache) ? cache[fdProfileCacheKey(gameId)] : null
  return fdNormalizeCharacterProfile(src)
}

function fdSaveProfileCache(gameId, profile) {
  const cache = fdStoreGet(FD_STORAGE_KEYS.characterProfile, null)
  const map = cache && typeof cache === 'object' && !Array.isArray(cache) ? { ...cache } : {}
  map[fdProfileCacheKey(gameId)] = fdNormalizeCharacterProfile(profile)
  return fdStoreSet(FD_STORAGE_KEYS.characterProfile, map)
}

function fdEmptyWorkbench() {
  const cachedSettings = fdNormalizeSettings(fdStoreGet(FD_STORAGE_KEYS.settings, FD_DEFAULT_SETTINGS))
  return {
    settings: cachedSettings,
    rule: '2d6',
    autoCheck: true,
    binding: { autoCheck: true },
    damper: { available: false, linkage: cachedSettings.damperLinkage },
    judgeStatus: { available: false },
    fate: { points: 2, max: 3, failCount: 0 },
    lastTurn: 0,
    summary: { total: 0, counts: {}, recent: [] },
    stats: { total: 0, good: 0, bad: 0 },
    recent: [],
    characterProfile: fdLoadProfileCache(''),
    contextSources: fdEmptyContextSources(),
    source: 'local'
  }
}

function fdMergeWorkbench(base, raw) {
  if (!raw || typeof raw !== 'object') return base
  const view = { ...base }
  const payload = raw.workbench || raw.state || raw.data || raw

  const settingsSrc = payload.settings || payload.globalSettings || (payload.global && payload.global.settings) || null
  if (settingsSrc || payload.sensitivity || payload.animation) {
    view.settings = fdNormalizeSettings({ ...view.settings, ...(settingsSrc || {}), ...(settingsSrc ? {} : payload) })
  }
  if (payload.rule) view.rule = FD_RULES.some(r => r.id === payload.rule) ? payload.rule : view.rule
  const binding = payload.binding || payload.bind || null
  if (binding && typeof binding === 'object' && typeof binding.autoCheck === 'boolean') view.autoCheck = binding.autoCheck
  if (typeof payload.autoCheck === 'boolean') view.autoCheck = payload.autoCheck
  else if (typeof payload.autoSkillCheck === 'boolean') view.autoCheck = payload.autoSkillCheck
  view.binding = { ...view.binding, autoCheck: view.autoCheck }

  const damper = payload.damper || payload.damperBridge || {}
  view.damper = {
    available: Boolean(payload.damperBridgeAvailable ?? damper.available ?? view.damper.available),
    linkage: Boolean(payload.damperLinkage ?? damper.linkage ?? view.settings.damperLinkage)
  }
  if (payload.judgeStatus) view.judgeStatus = payload.judgeStatus
  if (payload.fate) view.fate = fdNormalizeFate(payload.fate)
  if (payload.lastTurn !== undefined) view.lastTurn = Math.max(0, fdNumber(payload.lastTurn, view.lastTurn || 0))
  else if (payload.turn !== undefined && fdNumber(payload.turn, 0) > 0) view.lastTurn = Math.max(view.lastTurn || 0, fdNumber(payload.turn, 0))
  if (payload.summary) {
    const summary = payload.summary
    const counts = summary.counts && typeof summary.counts === 'object' ? summary.counts : {}
    view.stats = {
      total: fdNumber(summary.total, 0),
      good: fdNumber(counts.critical, 0) + fdNumber(counts.success, 0),
      bad: fdNumber(counts.costly, 0) + fdNumber(counts.failure, 0) + fdNumber(counts.fumble, 0)
    }
    view.recent = Array.isArray(summary.recent) ? fdNormalizeRecent(summary.recent) : view.recent
  }
  if (Array.isArray(payload.recent)) view.recent = fdNormalizeRecent(payload.recent)
  if (payload.characterProfile || payload.profile) {
    view.characterProfile = fdNormalizeCharacterProfile(payload.characterProfile || payload.profile)
  }
  if (payload.contextSources || payload.context) {
    view.contextSources = fdNormalizeContextSources(payload.contextSources || payload.context)
  }
  view.source = payload.source === 'local' ? 'local' : 'host'
  return view
}

/* 初次装载：宿主提供工作台快照则用宿主，否则以本地缓存 + 状态接口拼装（保证无宿主接口也可用） */
function fdLoadWorkbench(ui, gameId) {
  const base = fdEmptyWorkbench()
  return fdCall(ui, FD_RPC.workbench, { gameId: gameId || null })
    .then(res => {
      let view = base
      if (res.ok && res.data) view = fdMergeWorkbench(base, res.data)
      return fdCall(ui, FD_RPC.status, { gameId: gameId || undefined }).then(status => {
        if (status.ok && status.data) {
          view = fdBindStatusSummary(view, status.data)
          if (!gameId) view.judgeStatus = status.data.judgeStatus || view.judgeStatus
        }
        const cachedProfile = fdLoadProfileCache(gameId)
        const hasHostProfile = Boolean(view.characterProfile && (view.characterProfile.traits || []).length)
        if (!hasHostProfile && (cachedProfile.traits.length || cachedProfile.customNote)) {
          view = { ...view, characterProfile: cachedProfile }
        }
        if (!gameId) view.source = 'local'
        return view
      })
    })
    .catch(() => base)
}

function fdPersistSettings(ui, settings) {
  const normalized = fdNormalizeSettings(settings)
  fdStoreSet(FD_STORAGE_KEYS.settings, normalized)
  return fdCall(ui, FD_RPC.saveSettings, { settings: normalized }).then(res => ({ ...res, local: true }))
}

/* 本局绑定仅同步「自动行动检定」开关与骰制 */
function fdPersistBinding(ui, gameId, binding) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后绑定' })
  const autoCheck = binding && typeof binding.autoCheck === 'boolean' ? binding.autoCheck : undefined
  return fdCall(ui, FD_RPC.saveBinding, { gameId, binding: { autoCheck } })
}

function fdFreeRoll(ui, gameId, expression) {
  return fdCall(ui, FD_RPC.freeRoll, { gameId: gameId || null, expression })
}

/* ---- AI 角色动态画像：刷新提取 / 备注保存 ---- */

function fdRefreshProfile(ui, gameId) {
  if (!gameId) {
    return Promise.resolve({ ok: false, error: '需要进入对话后才能提取角色能力画像' })
  }
  return fdCall(ui, FD_RPC.refreshProfile, { gameId }).then(res => {
    const data = (res && res.data) || null
    const profile = fdNormalizeCharacterProfile(
      (data && (data.characterProfile || data.profile)) || null
    )
    const contextSources = fdNormalizeContextSources(
      (data && (data.contextSources || data.context)) || null
    )
    const hasProfile = Boolean(profile.characterName || profile.archetype || profile.traits.length)
    if (hasProfile) fdSaveProfileCache(gameId, profile)
    return {
      ok: Boolean(res && res.ok && (!data || data.ok !== false)) && hasProfile,
      error: (data && data.error) || (res && res.error) || (hasProfile ? '' : '宿主尚未返回画像数据'),
      characterProfile: hasProfile ? profile : null,
      contextSources,
      raw: data
    }
  })
}

function fdSaveProfileNote(ui, gameId, payload) {
  const src = payload && typeof payload === 'object' ? payload : {}
  const customNote = String(src.customNote || '')
  const rule = src.rule ? String(src.rule) : ''
  const cached = fdLoadProfileCache(gameId)
  if (gameId) {
    fdSaveProfileCache(gameId, {
      ...cached,
      customNote,
      updatedAt: Date.now()
    })
  }
  const body = { gameId: gameId || null, customNote, rule }
  if (!rule) delete body.rule
  return fdCall(ui, FD_RPC.saveProfileNote, body).then(res => ({ ...res, customNote }))
}

function fdTierOf(tier) {
  const value = String(tier || 'success')
  return ['critical', 'success', 'costly', 'failure', 'fumble', 'hidden'].includes(value) ? value : 'success'
}

function fdTierColor(tier) {
  const map = {
    critical: '#c8941f',
    success: '#2f8f66',
    costly: '#b9772f',
    failure: '#bb5044',
    fumble: '#a8402f',
    hidden: '#8a8a95'
  }
  return map[fdTierOf(tier)] || map.success
}
