/* ------------------------------------------------------------------ *
 * pre-send-gate.js —— 「失败 / 大失败时暂停发送」的发前逆命弹窗
 *
 * 宿主在正文请求组装阶段（turnSection）把真骰压住不发送，并广播 pre-send-gate；
 * 这里用纯 DOM 覆层（不依赖 React 树、不受流式布局影响）把选择权交给玩家：
 *   ✦ 逆命重投（消耗 1 点命运点） / 🔥 孤注一掷（0 点，败则恶化大失败） / 接受命运
 * 选择经 fate-dice:gate-resolve 回传，宿主完成重投后清空状态，正文才真正发送。
 * ------------------------------------------------------------------ */

const FD_GATE_STATE = 'pre-send-gate'
const FD_GATE_ACTION_LABEL = {
  fate: '✦ 正在逆命重投…',
  push: '🔥 正在孤注一掷…',
  accept: '已记录：照常按原骰点发送正文…'
}

const fdPreSendGate = {
  ui: null,
  root: null,
  ticker: 0,
  payload: null,
  gameId: '',
  busy: false,
  resolvingMode: '',
  pendingPower: 0,
  closeTimer: 0,
  probeTimers: [],
  cardRo: null,
  onWinResize: null,
  offWatch: fdNoop,
  offGame: fdNoop,
  offEvents: fdNoop,
  disposed: false
}

function fdGateClearChildren(node) {
  if (!node) return
  node.textContent = ''
  if (Array.isArray(node.children) && !('firstChild' in node)) {
    node.children.length = 0
  }
}

function fdIsPreSendGateHoldingOverlay() {
  return Boolean(!fdPreSendGate.disposed && fdPreSendGate.payload && fdPreSendGate.payload.gateId)
}

function fdConsumePreSendGatePower() {
  const p = Math.max(0, Number(fdPreSendGate.pendingPower) || 0)
  fdPreSendGate.pendingPower = 0
  return p
}

function fdNotifyPreSendGateRerollLaunched() {
  if (!fdPreSendGate.payload || !fdPreSendGate.resolvingMode) return
  fdClearPreSendGate({ keepStageCharge: true })
}

function fdRollFromGatePayload(payload) {
  if (!payload || !payload.tier) return null
  return {
    rule: payload.rule || '2d6',
    check: payload.check || payload.skillName || '行动',
    skillName: payload.skillName || '',
    tier: payload.tier || 'failure',
    tierLabel: payload.tierLabel || (payload.tier === 'fumble' ? '大失败' : '失败'),
    total: payload.total,
    target: payload.target,
    dice: Array.isArray(payload.dice) ? payload.dice.slice() : [],
    totalModifier: fdNumber(payload.modifier, 0),
    modifier: fdNumber(payload.modifier, 0),
    difficultyLabel: payload.difficultyLabel || '',
    hidden: false,
    rolledAt: fdNumber(payload.rolledAt, 0)
  }
}

function fdMeasurePreSendGateCardHeight() {
  const root = fdPreSendGate.root
  if (!root || root.hidden) return 0
  const card = typeof root.querySelector === 'function' ? root.querySelector('.fd-presend-card') : null
  if (!card) return 204
  const h = Number(card.offsetHeight)
    || (typeof card.getBoundingClientRect === 'function' ? Number(card.getBoundingClientRect().height) : 0)
  return h > 40 ? Math.round(h) : 204
}

function fdApplyPreSendGateDockGeometry(geo) {
  const root = fdPreSendGate.root
  if (!root || !geo) return
  const docked = Boolean(geo.docked)
  if (typeof fdToggleNodeClass === 'function') fdToggleNodeClass(root, 'is-docked', docked)
  if (typeof fdSetNodeCssVar === 'function') {
    fdSetNodeCssVar(root, '--fd-presend-left', typeof geo.left === 'number' ? `${Math.round(geo.left)}px` : '0px')
    fdSetNodeCssVar(root, '--fd-presend-width', typeof geo.width === 'number' ? `${Math.round(geo.width)}px` : '100vw')
    fdSetNodeCssVar(root, '--fd-presend-top', docked && typeof geo.top === 'number' ? `${Math.round(geo.top)}px` : '')
  }
}

function fdSyncPreSendGateLayout() {
  const root = fdPreSendGate.root
  if (!root || root.hidden || !fdPreSendGate.payload) return
  const ov = typeof fdGetPrimaryFloorRollOverlay === 'function' ? fdGetPrimaryFloorRollOverlay() : null
  if (ov && ov.wrap && (ov.wrap.isConnected || ov.wrap.parentNode) && typeof ov.syncGeometry === 'function') {
    ov.syncGeometry()
    return
  }
  let left = 0
  let width = null
  if (typeof document !== 'undefined' && typeof fdResolveConversationPane === 'function') {
    const pane = fdResolveConversationPane(document, null)
    if (pane && typeof pane.getBoundingClientRect === 'function') {
      const r = pane.getBoundingClientRect()
      if (r.width > 120 && r.height > 96) {
        left = r.left
        width = r.width
      }
    }
  }
  fdApplyPreSendGateDockGeometry({ docked: false, left, width })
}

function fdDetachGateLayoutWatchers() {
  if (fdPreSendGate.cardRo) {
    try { fdPreSendGate.cardRo.disconnect() } catch {}
    fdPreSendGate.cardRo = null
  }
  if (fdPreSendGate.onWinResize && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    try { window.removeEventListener('resize', fdPreSendGate.onWinResize) } catch {}
    fdPreSendGate.onWinResize = null
  }
}

function fdGateEl(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined && text !== null) node.textContent = String(text)
  return node
}

function fdGateSecondsLeft(payload) {
  const waitMs = Math.max(1000, fdNumber(payload && payload.waitMs, 18000))
  const deadlineAt = fdNumber(payload && payload.deadlineAt, 0)
  if (!deadlineAt) return Math.ceil(waitMs / 1000)
  const left = Math.max(0, Math.min(waitMs, deadlineAt - Date.now()))
  return Math.max(0, Math.ceil(left / 1000))
}

function fdGateDiceText(payload) {
  if (!payload) return ''
  const rule = String(payload.rule || '').trim()
  const dice = Array.isArray(payload.dice) && payload.dice.length ? `[${payload.dice.join('+')}]` : ''
  const modifier = fdNumber(payload.modifier, 0)
  const modText = modifier ? (modifier > 0 ? ` +${modifier}` : ` ${modifier}`) : ''
  const total = payload.total === undefined || payload.total === null ? '' : ` = ${payload.total}`
  const target = payload.target === undefined || payload.target === null ? '' : ` vs 目标 ${payload.target}`
  return [rule, dice + modText + total + target].filter(Boolean).join(' · ')
}

function fdGateBodyText(payload) {
  if (!payload) return ''
  const check = [payload.skillName, payload.check].filter(Boolean)[0] || '行动检定'
  const difficulty = String(payload.difficultyLabel || '').trim()
  return difficulty ? `${check} · ${difficulty}` : check
}

function fdEnsureGateRoot() {
  if (typeof document === 'undefined' || !document.body) return null
  const existing = fdPreSendGate.root
  if (existing && existing.isConnected) return existing
  const root = document.createElement('div')
  root.className = 'fd-presend-overlay'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-live', 'polite')
  root.setAttribute('aria-label', '检定失败：是否逆命重投')
  root.hidden = true
  document.body.appendChild(root)
  fdPreSendGate.root = root
  return root
}

function fdStopGateTicker() {
  if (!fdPreSendGate.ticker) return
  clearInterval(fdPreSendGate.ticker)
  fdPreSendGate.ticker = 0
}

function fdStartGateTicker() {
  fdStopGateTicker()
  fdPreSendGate.ticker = setInterval(() => fdTickGateCountdown(), 250)
}

function fdGateCountNode() {
  const root = fdPreSendGate.root
  if (!root) return null
  return root.querySelector('.fd-presend-count')
}

function fdTickGateCountdown() {
  const payload = fdPreSendGate.payload
  if (!payload) {
    fdStopGateTicker()
    return
  }
  const node = fdGateCountNode()
  if (!node) return
  const left = fdGateSecondsLeft(payload)
  node.textContent = left > 0 ? `${left}s 后自动接受` : '超时：正在按原骰点发送…'
  if (left > 0) return
  fdStopGateTicker()
  /* 兜底：宿主已收口或请求被中断时状态可能不再更新，超时后自行收掉覆层，绝不把界面钉死 */
  if (!fdPreSendGate.closeTimer) {
    fdPreSendGate.closeTimer = setTimeout(() => {
      fdPreSendGate.closeTimer = 0
      if (fdPreSendGate.payload && fdGateSecondsLeft(fdPreSendGate.payload) <= 0) fdClearPreSendGate()
    }, 2500)
  }
}

function fdSetGateBusy(busy, action) {
  const root = fdPreSendGate.root
  if (!root) return
  root.querySelectorAll('.fd-presend-btn').forEach(btn => {
    btn.disabled = Boolean(busy)
  })
  const hint = root.querySelector('.fd-presend-hint')
  if (hint && busy) hint.textContent = FD_GATE_ACTION_LABEL[action] || '正在提交选择…'
}

function fdSetGateNotice(text) {
  const root = fdPreSendGate.root
  if (!root) return
  const notice = root.querySelector('.fd-presend-notice')
  if (!notice) return
  notice.textContent = String(text || '')
  notice.hidden = !text
  fdSyncPreSendGateLayout()
}

async function fdResolvePreSendGate(action, power) {
  const payload = fdPreSendGate.payload
  const ui = fdPreSendGate.ui
  if (!payload || !payload.gateId || fdPreSendGate.busy) return
  const isReroll = action === 'fate' || action === 'push'
  const launchPower = isReroll ? Math.max(0, Number(power) || 0) : 0
  fdPreSendGate.busy = true
  fdPreSendGate.resolvingMode = isReroll ? action : ''
  fdPreSendGate.pendingPower = launchPower
  fdSetGateBusy(true, action)
  fdSetGateNotice('')

  const activeStage = isReroll && typeof fdGetActiveFloorRollStage === 'function'
    ? fdGetActiveFloorRollStage()
    : null
  if (launchPower > 0.1 && activeStage && !activeStage.charging && typeof activeStage.startButtonCharge === 'function') {
    try { activeStage.startButtonCharge(action) } catch {}
  }

  const res = await fdCall(ui, FD_RPC.gateResolve, {
    gameId: payload.gameId || fdPreSendGate.gameId,
    gateId: payload.gateId,
    action
  })
  const data = res && res.ok ? res.data : null
  if (!data || data.ok !== true) {
    fdPreSendGate.busy = false
    fdPreSendGate.resolvingMode = ''
    fdPreSendGate.pendingPower = 0
    if (activeStage && activeStage.charging && typeof activeStage.cancelButtonCharge === 'function') {
      try { activeStage.cancelButtonCharge() } catch {}
    }
    fdSetGateBusy(false, '')
    fdSetGateNotice((data && data.error) || (res && res.error) || '宿主未响应这次选择，请再点一次')
    return
  }
  /* 接受命运后宿主立即放行：不等 SSE 回推即可收起覆层并让剧场谢幕；重投则在 live-roll 到达时无缝抛新骰 */
  if (data.action === 'accept' || action === 'accept') {
    setTimeout(() => {
      if (fdPreSendGate.payload && fdPreSendGate.payload.gateId === payload.gateId) fdClearPreSendGate()
    }, 80)
  } else {
    setTimeout(() => fdProbePreSendGate(payload.gameId || fdPreSendGate.gameId), 420)
    setTimeout(() => fdProbePreSendGate(payload.gameId || fdPreSendGate.gameId), 1250)
  }
}

function fdClearPreSendGate(options) {
  fdStopGateTicker()
  fdDetachGateLayoutWatchers()
  if (fdPreSendGate.closeTimer) {
    clearTimeout(fdPreSendGate.closeTimer)
    fdPreSendGate.closeTimer = 0
  }
  const wasRerolling = Boolean(fdPreSendGate.resolvingMode)
  fdPreSendGate.payload = null
  fdPreSendGate.busy = false
  fdPreSendGate.resolvingMode = ''
  const root = fdPreSendGate.root
  if (root) {
    root.hidden = true
    if (typeof fdToggleNodeClass === 'function') fdToggleNodeClass(root, 'is-docked', false)
    fdGateClearChildren(root)
  }
  if (typeof fdReleaseFloorRollOverlayFromGate === 'function') {
    const keepCharge = Boolean(options && options.keepStageCharge)
    fdReleaseFloorRollOverlayFromGate({
      keepStageCharge: keepCharge,
      exitDelayMs: wasRerolling && !keepCharge ? 1800 : 260
    })
  }
}

function fdRenderPreSendGate(payload) {
  const root = fdEnsureGateRoot()
  if (!root) return
  if (!payload || !payload.gateId) {
    fdClearPreSendGate()
    return
  }
  fdDetachGateLayoutWatchers()
  fdPreSendGate.payload = payload
  fdPreSendGate.busy = false
  fdPreSendGate.resolvingMode = ''
  root.hidden = false
  fdGateClearChildren(root)

  const isFumble = payload.tier === 'fumble'
  const tone = isFumble ? 'is-fumble' : 'is-failure'
  const card = fdGateEl('div', 'fd-presend-card ' + tone)
  card.setAttribute('data-tier', isFumble ? 'fumble' : 'failure')

  card.appendChild(fdGateEl('div', 'fd-presend-rail'))

  const top = fdGateEl('div', 'fd-presend-top')
  top.appendChild(fdGateEl('span', 'fd-presend-seal ' + tone, isFumble ? '💀 大失败' : '⚠️ 失败'))
  top.appendChild(fdGateEl('span', 'fd-presend-title', '骰已落定 · 正文还没发送'))
  const count = fdGateEl('span', 'fd-presend-count', '')
  top.appendChild(count)
  card.appendChild(top)

  const summary = fdGateEl('div', 'fd-presend-summary')
  summary.appendChild(fdGateEl('span', 'fd-presend-check', fdGateBodyText(payload)))
  const diceText = fdGateDiceText(payload)
  if (diceText) summary.appendChild(fdGateEl('span', 'fd-presend-dice', diceText))
  card.appendChild(summary)

  const fate = payload.fate && typeof payload.fate === 'object' ? payload.fate : {}
  const points = Math.max(0, fdNumber(fate.points, 0))
  const maxPoints = Math.max(1, fdNumber(fate.max, 3))
  card.appendChild(fdGateEl(
    'div',
    'fd-presend-fate',
    `✦ 命运点 ${points}/${maxPoints} · 本轮限重投 1 次 · 拒绝重投将按失败推进正文`
  ))

  const notice = fdGateEl('div', 'fd-presend-notice', payload.error || '')
  if (!payload.error) notice.hidden = true
  card.appendChild(notice)

  const modes = Array.isArray(payload.modes) && payload.modes.length ? payload.modes : ['push']
  const showFateSlot = modes.includes('fate') || points <= 0
  const showPushSlot = modes.includes('push')
  const actions = fdGateEl(
    'div',
    'fd-presend-actions' + (showFateSlot && showPushSlot ? ' has-pair' : '')
  )
  if (modes.includes('fate')) {
    const fateLabel = '✦ 逆命重投 · -1 命运点'
    const fateBtn = fdGateEl('button', 'fd-presend-btn is-fate fd-hold-btn')
    fateBtn.type = 'button'
    fateBtn.title = `消耗 1 点命运点稳妥重掷（当前 ${points}/${maxPoints}）；长按可聚能蓄力`
    fateBtn.appendChild(fdGateEl('span', 'fd-reroll-btn-title', fateLabel))
    if (typeof fdAttachHoldChargeToDomBtn === 'function') {
      fdAttachHoldChargeToDomBtn(fateBtn, {
        mode: 'fate',
        baseLabel: fateLabel,
        getStage: () => (typeof fdGetActiveFloorRollStage === 'function' ? fdGetActiveFloorRollStage() : null),
        onTrigger: (_m, pwr) => fdResolvePreSendGate('fate', pwr)
      })
    } else {
      fateBtn.addEventListener('click', () => fdResolvePreSendGate('fate', 0))
    }
    actions.appendChild(fateBtn)
  } else if (points <= 0) {
    const fateBtn = fdGateEl('button', 'fd-presend-btn is-fate', '✦ 命运点已耗尽')
    fateBtn.type = 'button'
    fateBtn.disabled = true
    actions.appendChild(fateBtn)
  }
  if (showPushSlot) {
    const pushLabel = '🔥 孤注一掷 · 0 点'
    const pushBtn = fdGateEl('button', 'fd-presend-btn is-push fd-hold-btn')
    pushBtn.type = 'button'
    pushBtn.title = '不耗命运点强行一搏：失败会恶化为大失败，成功也要背负挂彩/透支代价；长按可熔炉蓄力'
    pushBtn.appendChild(fdGateEl('span', 'fd-reroll-btn-title', pushLabel))
    if (typeof fdAttachHoldChargeToDomBtn === 'function') {
      fdAttachHoldChargeToDomBtn(pushBtn, {
        mode: 'push',
        baseLabel: pushLabel,
        getStage: () => (typeof fdGetActiveFloorRollStage === 'function' ? fdGetActiveFloorRollStage() : null),
        onTrigger: (_m, pwr) => fdResolvePreSendGate('push', pwr)
      })
    } else {
      pushBtn.addEventListener('click', () => fdResolvePreSendGate('push', 0))
    }
    actions.appendChild(pushBtn)
  }
  const acceptBtn = fdGateEl('button', 'fd-presend-btn is-accept', '接受命运 · 直接生成')
  acceptBtn.type = 'button'
  acceptBtn.title = '按本次失败结果照常推进正文，之后仍可在楼层胶囊里重投'
  acceptBtn.addEventListener('click', () => fdResolvePreSendGate('accept', 0))
  actions.appendChild(acceptBtn)
  card.appendChild(actions)

  card.appendChild(fdGateEl('div', 'fd-presend-hint', '正文请求被按住，你选完才发送 · 长按重投可聚能蓄力'))
  root.appendChild(card)

  if (typeof fdEnsureFloorRollForGate === 'function') {
    fdEnsureFloorRollForGate(payload)
  }
  fdSyncPreSendGateLayout()
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => fdSyncPreSendGateLayout())
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onResize = () => fdSyncPreSendGateLayout()
    fdPreSendGate.onWinResize = onResize
    window.addEventListener('resize', onResize)
  }
  if (typeof ResizeObserver === 'function') {
    try {
      fdPreSendGate.cardRo = new ResizeObserver(() => fdSyncPreSendGateLayout())
      fdPreSendGate.cardRo.observe(card)
    } catch {}
  }

  fdStartGateTicker()
  fdTickGateCountdown()
  const primary = actions.querySelector('.fd-presend-btn.is-fate') || actions.querySelector('.fd-presend-btn.is-push')
  if (primary && typeof primary.focus === 'function') {
    try { primary.focus({ preventScroll: true }) } catch {}
  }
}

function fdApplyPreSendGatePayload(data, gameId) {
  if (fdPreSendGate.disposed) return
  if (!data || !data.gateId) {
    if (fdPreSendGate.payload && (!gameId || !fdPreSendGate.payload.gameId || fdPreSendGate.payload.gameId === gameId)) {
      fdClearPreSendGate()
    }
    return
  }
  if (fdPreSendGate.payload && fdPreSendGate.payload.gateId === data.gateId) {
    /* 同一道闸门的重复广播（宿主重投过程中的补充信息）：只刷新计数与剧场锚点 */
    fdPreSendGate.payload = { ...fdPreSendGate.payload, ...data }
    if (typeof fdEnsureFloorRollForGate === 'function') fdEnsureFloorRollForGate(fdPreSendGate.payload)
    fdSyncPreSendGateLayout()
    if (!fdPreSendGate.busy) fdTickGateCountdown()
    return
  }
  const activeStage = typeof fdGetActiveFloorRollStage === 'function' ? fdGetActiveFloorRollStage() : null
  if (activeStage && activeStage.charging && typeof activeStage.cancelButtonCharge === 'function') {
    try { activeStage.cancelButtonCharge() } catch {}
  }
  fdRenderPreSendGate(data)
}

function fdClearGateProbeTimers() {
  while (fdPreSendGate.probeTimers.length) {
    const t = fdPreSendGate.probeTimers.pop()
    if (t) clearTimeout(t)
  }
}

function fdProbePreSendGate(hintGameId) {
  const ui = fdPreSendGate.ui
  if (!ui || fdPreSendGate.disposed) return Promise.resolve(null)
  const gameId = String(hintGameId || fdGetActiveGameId() || fdPreSendGate.gameId || '').trim()
  return fdCall(ui, FD_RPC.gatePeek, gameId ? { gameId } : {}).then(res => {
    if (fdPreSendGate.disposed || !res || !res.ok || !res.data) return null
    const nextGameId = String((res.data.gate && res.data.gate.gameId) || res.data.gameId || '').trim()
    if (nextGameId) fdNoteActiveGameId(nextGameId)
    if (res.data.gate && res.data.gate.gateId) {
      fdApplyPreSendGatePayload(res.data.gate, nextGameId || gameId)
      return res.data.gate
    }
    if (fdPreSendGate.payload && (!nextGameId || !fdPreSendGate.payload.gameId || fdPreSendGate.payload.gameId === nextGameId)) {
      fdClearPreSendGate()
    }
    return null
  }).catch(() => null)
}

function fdSchedulePreSendGateProbes(hintGameId) {
  if (!fdPreSendGate.ui || fdPreSendGate.disposed) return
  const targetId = String(hintGameId || fdGetActiveGameId() || fdPreSendGate.gameId || '').trim()
  if (typeof fdMayNeedPreSendGate === 'function' && !fdMayNeedPreSendGate(targetId)) return
  fdClearGateProbeTimers()
  const delays = [260, 1100]
  for (let i = 0; i < delays.length; i++) {
    const timer = setTimeout(() => {
      if (!fdPreSendGate.disposed && !fdPreSendGate.payload) {
        if (typeof fdMayNeedPreSendGate === 'function' && !fdMayNeedPreSendGate(targetId)) return
        fdProbePreSendGate(hintGameId)
      }
    }, delays[i])
    fdPreSendGate.probeTimers.push(timer)
  }
}

function fdMountPreSendGate(ui) {
  if (typeof document === 'undefined' || !document.body) return fdNoop
  if (fdPreSendGate.ui && fdPreSendGate.ui !== ui) {
    /* 重新挂载：清掉上一份监听与覆层 */
    try { fdPreSendGate.offWatch() } catch {}
    try { fdPreSendGate.offGame() } catch {}
    try { fdPreSendGate.offEvents() } catch {}
    fdClearGateProbeTimers()
    fdClearPreSendGate()
  }
  const root = fdEnsureGateRoot()
  if (!root) return fdNoop
  fdPreSendGate.disposed = false
  fdPreSendGate.ui = ui

  const bindGame = nextId => {
    const id = String(nextId || '').trim()
    if (!id || id === fdPreSendGate.gameId || fdPreSendGate.disposed) return
    try { fdPreSendGate.offWatch() } catch {}
    fdPreSendGate.gameId = id
    fdPreSendGate.offWatch = fdWatch(ui, id, FD_GATE_STATE, data => fdApplyPreSendGatePayload(data, id))
    if (typeof fdMayNeedPreSendGate !== 'function' || fdMayNeedPreSendGate(id)) {
      fdProbePreSendGate(id)
    }
  }

  fdPreSendGate.offGame = fdSubscribeActiveGameId(bindGame)

  const onSessionEvent = ev => {
    const sid = ev && ev.detail && ev.detail.sessionId
    if (sid) fdNoteActiveGameId(String(sid))
    else {
      const detected = fdGetActiveGameId()
      if (detected) bindGame(detected)
    }
  }
  const onComposerKeyDown = ev => {
    if (!ev || ev.key !== 'Enter' || ev.shiftKey || ev.altKey || ev.isComposing) return
    const target = ev.target
    const tag = target && target.tagName ? String(target.tagName).toUpperCase() : ''
    if (tag === 'TEXTAREA' || (target && target.isContentEditable)) {
      fdSchedulePreSendGateProbes('')
    }
  }
  const onActionClick = ev => {
    const target = ev && ev.target && typeof ev.target.closest === 'function'
      ? ev.target.closest('button, [role="button"]')
      : null
    if (!target || (fdPreSendGate.root && fdPreSendGate.root.contains(target))) return
    const label = String(
      (typeof target.getAttribute === 'function' && (target.getAttribute('aria-label') || target.getAttribute('title')))
      || target.textContent
      || ''
    )
    if (/发送|重新生成|重试|继续|send|regenerate|retry/i.test(label) || target.type === 'submit') {
      fdSchedulePreSendGateProbes('')
    }
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('dsh-tavern-session-changed', onSessionEvent)
    window.addEventListener('popstate', onSessionEvent)
    window.addEventListener('hashchange', onSessionEvent)
  }
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onComposerKeyDown, true)
    document.addEventListener('click', onActionClick, true)
  }
  fdPreSendGate.offEvents = () => {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('dsh-tavern-session-changed', onSessionEvent)
      window.removeEventListener('popstate', onSessionEvent)
      window.removeEventListener('hashchange', onSessionEvent)
    }
    if (typeof document.removeEventListener === 'function') {
      document.removeEventListener('keydown', onComposerKeyDown, true)
      document.removeEventListener('click', onActionClick, true)
    }
  }

  const active = fdGetActiveGameId()
  if (active) bindGame(active)
  else if (typeof fdBootstrapActiveGame === 'function') fdBootstrapActiveGame(ui)
  else fdCall(ui, FD_RPC.status, {}).then(res => {
    const nextActive = res && res.ok && res.data && (res.data.activeGameId || res.data.gameId)
    if (nextActive) fdNoteActiveGameId(String(nextActive))
  }).catch(() => {})

  return () => {
    fdPreSendGate.disposed = true
    fdClearGateProbeTimers()
    try { fdPreSendGate.offWatch() } catch {}
    try { fdPreSendGate.offGame() } catch {}
    try { fdPreSendGate.offEvents() } catch {}
    fdPreSendGate.offWatch = fdNoop
    fdPreSendGate.offGame = fdNoop
    fdPreSendGate.offEvents = fdNoop
    fdPreSendGate.gameId = ''
    fdClearPreSendGate()
    const node = fdPreSendGate.root
    fdPreSendGate.root = null
    if (node && node.parentNode) node.parentNode.removeChild(node)
  }
}
