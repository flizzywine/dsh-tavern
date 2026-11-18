/* ------------------------------------------------------------------ *
 * widgets.js —— 聊天流挂件：输入栏揭晓动效条 / 楼层折叠检定胶囊 / 状态卡
 * 三处挂载点在无数据时均返回 null 或原 children（零占位、零样式污染）
 * ------------------------------------------------------------------ */

const FD_STREAM_POLL_DELAYS = [1200, 2800, 5500]
const FD_POST_SETTLE_DELAYS = [600, 1600]

function DieGlyph(props) {
  const { sides, label, rolling, tier, hidden } = props || {}
  const faceCount = fdNumber(sides, 6)
  const tierValue = hidden ? 'hidden' : fdTierOf(tier)
  const cls = 'fd-die-svg' + (rolling ? ' is-rolling' : ' is-settled')
  const stroke = hidden ? 'currentColor' : fdTierColor(tier)
  const fill = hidden ? 'rgba(128,128,142,0.14)' : fdTierColor(tier) + '22'
  let points = null
  if (faceCount >= 20) points = '20,3 35,11 35,29 20,37 5,29 5,11'
  else if (faceCount >= 10) points = '20,3 36,20 20,37 4,20'
  else if (faceCount === 8) points = '20,3 34,13 34,27 20,37 6,27 6,13'
  else if (faceCount === 4) points = '20,4 36,34 4,34'

  const shape = points
    ? h('polygon', { points, fill, stroke, strokeWidth: 2, strokeLinejoin: 'round', opacity: hidden ? 0.7 : 1 })
    : h('rect', { x: 4, y: 4, width: 32, height: 32, rx: 7, fill, stroke, strokeWidth: 2, opacity: hidden ? 0.7 : 1 })

  const text = hidden ? '?' : String(label === undefined || label === null ? '?' : label)
  return h('svg', {
    className: cls,
    'data-tier': tierValue,
    viewBox: '0 0 40 40',
    'aria-hidden': 'true',
    focusable: 'false'
  },
  shape,
  h('text', {
    x: 20,
    y: 21,
    textAnchor: 'middle',
    dominantBaseline: 'central',
    fill: stroke,
    fontSize: text.length >= 3 ? 10 : 14,
    fontWeight: 700
  }, text))
}

function formatRollSummary(roll, revealed) {
  if (!roll) return ''
  if (roll.hidden && !revealed) return `${roll.check}暗骰 · 等待揭晓`
  const mod = roll.modifier ? (roll.modifier > 0 ? `+${roll.modifier}` : String(roll.modifier)) : ''
  const dicePart = Array.isArray(roll.dice) && roll.dice.length > 1
    ? `[${roll.dice.join('+')}]${mod}=${roll.total}`
    : `${roll.total}${mod ? `(${mod})` : ''}`
  return `${roll.check}检定 · ${dicePart} · ${roll.tierLabel}`
}

function fdDamperChip(roll) {
  if (!roll) return null
  const damper = roll.damper || roll.damperLink || roll.linkage
  if (!damper) return null
  const applied = damper.applied !== false
  const text = damper.quotaLabel || damper.label || (applied ? '阻尼联动' : '阻尼未联动')
  return h('span', {
    className: 'fd-event-pill',
    title: damper.reason || '叙事阻尼器联动标记'
  }, `${applied ? '⛓' : '⛓̶'} ${text}`)
}

function fdRerollChip(roll) {
  const meta = roll && roll.rerollMeta
  if (!meta || !meta.mode) return null
  if (meta.mode === 'push') {
    return h('span', {
      className: 'fd-event-pill',
      title: roll.pushedFumble
        ? '孤注一掷失手：普通失败已强制恶化为大失败'
        : '孤注一掷：强行逆转亦须承受挂彩/透支等叙事代价'
    }, '🔥 孤注一掷')
  }
  return h('span', {
    className: 'fd-event-pill',
    title: '消耗 1 点命运点发动的逆命重投'
  }, '✦ 逆命重投')
}

function LiveRollBanner(props) {
  const { event, onDismiss } = props || {}
  const [rolling, setRolling] = useState(true)
  const [tickFace, setTickFace] = useState('?')
  const [revealed, setRevealed] = useState(false)

  const animation = event && event.animation ? event.animation : 'atelier'
  const isSetup = Boolean(event && event.kind === 'setup-required')
  const isSkipped = Boolean(event && event.kind === 'skipped')
  const isFree = Boolean(event && event.kind === 'free')
  const roll = isFree ? null : (event && event.roll) || null
  const isReused = Boolean((event && event.reused) || (roll && roll.reusedOnRegenerate))
  const freeResult = isFree ? (event && event.result) || null : null
  const hidden = Boolean(roll && roll.hidden && !revealed)
  const eventId = event ? event.id : null

  useEffect(() => {
    setRevealed(false)
    if (!eventId) return undefined
    /* 未配置决策模型：不投骰、不抖动，5 秒后自动收起，轻触亦可关闭 */
    if (isSetup) {
      const closer = setTimeout(() => {
        if (typeof onDismiss === 'function') onDismiss()
      }, 5000)
      return () => clearTimeout(closer)
    }
    /* 本轮无需检定：只留一行浅提示，6 秒后自动收起，不播骰子动画 */
    if (isSkipped) {
      setRolling(false)
      const closer = setTimeout(() => {
        if (typeof onDismiss === 'function') onDismiss()
      }, 6000)
      return () => clearTimeout(closer)
    }
    /* 重新生成复用本轮已锁定的首次真骰结果：直接展示原骰面，不再假播滚动随机点数 */
    if (isReused) {
      setRolling(false)
      const hider = setTimeout(() => {
        if (typeof onDismiss === 'function') onDismiss()
      }, 3600)
      return () => clearTimeout(hider)
    }
    const reduced = fdSafe(() => typeof window !== 'undefined' && Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches), false)
    if (animation === 'none' || reduced) {
      setRolling(false)
      return undefined
    }
    const use3D = Boolean(FD3D.canUseWebGL2() && FD3D.resolveTheme(animation, 'normal', hidden))
    setRolling(true)
    const sides = fdNumber(roll && roll.sides, fdNumber(freeResult && freeResult.sides, 6))
    const ticker = use3D ? 0 : setInterval(() => {
      setTickFace(String(1 + Math.floor(Math.random() * Math.max(2, sides))))
    }, 70)
    const stopper = setTimeout(() => {
      if (ticker) clearInterval(ticker)
      setRolling(false)
    }, animation === 'compact' ? 320 : (use3D ? 1120 : 760))
    const hider = setTimeout(() => {
      if (typeof onDismiss === 'function') onDismiss()
    }, use3D ? 5200 : 4200)
    return () => {
      if (ticker) clearInterval(ticker)
      clearTimeout(stopper)
      clearTimeout(hider)
    }
  }, [eventId])

  if (!event) return null

  if (isSetup) {
    return h('div', {
      className: 'fd-root',
      style: { padding: '2px 0' }
    },
    h('div', {
      className: 'fd-guide-banner is-lite',
      role: 'status',
      'aria-live': 'polite',
      onClick: () => {
        if (typeof onDismiss === 'function') onDismiss()
      }
    },
    h('div', { className: 'fd-guide-banner-head' },
      h('span', { className: 'fd-guide-banner-icon', 'aria-hidden': 'true' }, '⚠️'),
      h('span', { className: 'fd-guide-banner-title' }, '命运之骰尚未配置决策模型')),
    h('div', { className: 'fd-guide-banner-step' },
      '请前往酒馆「设置 › 叙事阻尼器」填写决策模型与 API Key（轻触收起）')))
  }

  if (isSkipped) {
    return h('div', { className: 'fd-root', style: { padding: '2px 0' } },
      h('div', {
        className: 'fd-skip-note',
        role: 'status',
        'aria-live': 'polite',
        title: event.reason ? String(event.reason) : '本轮未被判定为需要检定',
        onClick: () => {
          if (typeof onDismiss === 'function') onDismiss()
        }
      },
      h('span', { className: 'fd-skip-icon', 'aria-hidden': 'true' }, '🎲'),
      h('span', { className: 'fd-skip-text' }, event.message || '本轮无需检定'),
      event.check ? h('span', { className: 'fd-skip-check' }, `· ${event.check}`) : null))
  }

  if (!roll && !freeResult) return null

  const tier = hidden ? 'hidden' : fdTierOf(isFree ? 'success' : (roll ? roll.tier : 'success'))
  const faces = isFree
    ? ((freeResult && Array.isArray(freeResult.dice) && freeResult.dice.length) ? freeResult.dice : [freeResult && freeResult.total])
    : (hidden ? ['?'] : ((roll && Array.isArray(roll.dice) && roll.dice.length) ? roll.dice : [roll ? roll.total : '?']))
  const sides = fdNumber(roll && roll.sides, fdNumber(freeResult && freeResult.sides, 6))

  const titleText = isFree
    ? `自由骰 ${freeResult.expression || ''}`
    : `${roll.check}检定（${roll.difficultyLabel || '判定'}）`

  const subText = rolling
    ? '正在投掷命运真骰…'
    : isFree
      ? `骰面 [${(freeResult.dice || []).join(', ')}]${freeResult.bonus ? (freeResult.bonus > 0 ? ' +' : ' ') + freeResult.bonus : ''} · 轻触收起`
      : hidden
        ? (isReused ? '已复用本轮首次暗骰结果（轻触偷看）' : '结果已暗中注入本轮裁定（轻触偷看）')
        : (isReused ? `已锁定复用首次真骰 · ${formatRollSummary(roll, true)}` : `${formatRollSummary(roll, true)} · 轻触收起`)

  const use3DBanner = Boolean(FD3D.canUseWebGL2() && FD3D.resolveTheme(animation, FD3D.resolveThemeMode(roll, hidden), hidden))

  return h('div', {
    className: 'fd-root',
    style: { padding: '2px 0' }
  },
  h('div', {
    className: 'fd-live-card',
    'data-tier': tier,
    role: 'status',
    'aria-live': 'polite',
    onClick: () => {
      if (hidden && !rolling) setRevealed(true)
      else if (typeof onDismiss === 'function') onDismiss()
    }
  },
  use3DBanner
    ? h(Fd3DDiceStage, {
      roll: isFree ? freeResult : roll,
      isFree,
      revealed,
      animation,
      banner: true,
      animateOnMount: !isReused
    })
    : h('div', { className: 'fd-die-stage' },
      (faces.length ? faces : ['?']).slice(0, 3).map((face, idx) => h(DieGlyph, {
        key: idx,
        sides,
        label: rolling && !hidden ? tickFace : face,
        rolling,
        tier,
        hidden
      }))),
  h('div', { className: 'fd-live-body' },
    h('div', { className: 'fd-live-title' },
      h('span', { className: 'fd-turn-summary', style: { minWidth: 0 } }, titleText),
      !rolling
        ? h('span', { className: 'fd-tier-pill', 'data-tier': tier },
          isFree
            ? `总计 ${freeResult.total}`
            : hidden
              ? '暗骰 · 点按揭晓'
              : `${roll.tierLabel || ''} · ${roll.total}`)
        : null,
      !rolling && isReused
        ? h('span', { className: 'fd-event-pill', title: '同一楼层输入未变，重新生成已强制复用首次已结算的真骰结果' }, '🔒 锁骰复用')
        : null,
      !rolling ? fdRerollChip(roll) : null,
      !rolling ? fdDamperChip(roll) : null),
    h('div', { className: 'fd-live-sub' }, subText))))
}

function fdLatestDomFloorInfo() {
  return fdSafe(() => {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
      return { turn: 0, streaming: false }
    }
    const articles = document.querySelectorAll('article.dsh-tavern-story-floor')
    for (let i = articles.length - 1; i >= 0; i -= 1) {
      const article = articles[i]
      if (!article || (typeof article.hasAttribute === 'function' && (article.hasAttribute('data-greeting') || article.hasAttribute('data-story-held')))) {
        continue
      }
      const turn = fdExtractFloorTurn(article)
      const streaming = Boolean(article.classList && typeof article.classList.contains === 'function' && article.classList.contains('dsh-tavern-story-streaming'))
      if (turn > 0 || streaming) return { turn, streaming }
    }
    return { turn: 0, streaming: false }
  }, { turn: 0, streaming: false })
}

function fdComputePopoverStyle(rect) {
  const vw = (typeof window !== 'undefined' && Number(window.innerWidth) > 0) ? Number(window.innerWidth) : 1024
  const vh = (typeof window !== 'undefined' && Number(window.innerHeight) > 0) ? Number(window.innerHeight) : 768
  const pad = 12
  const maxWidth = Math.min(760, Math.max(240, vw - pad * 2))
  if (!rect) {
    return {
      position: 'fixed',
      left: pad + 'px',
      bottom: '96px',
      width: maxWidth + 'px',
      maxHeight: Math.max(180, vh - pad * 2) + 'px'
    }
  }
  const left = Math.max(pad, Math.min(Number(rect.left) || pad, vw - maxWidth - pad))
  const spaceAbove = (Number(rect.top) || 0) - pad - 8
  const spaceBelow = vh - (Number(rect.bottom) || 0) - pad - 8
  if (spaceAbove >= 200 || spaceAbove >= spaceBelow) {
    return {
      position: 'fixed',
      left: Math.round(left) + 'px',
      bottom: Math.round(Math.max(pad, vh - (Number(rect.top) || 0) + 8)) + 'px',
      width: Math.round(maxWidth) + 'px',
      maxHeight: Math.round(Math.max(160, spaceAbove)) + 'px'
    }
  }
  return {
    position: 'fixed',
    left: Math.round(left) + 'px',
    top: Math.round(Math.max(pad, (Number(rect.bottom) || 0) + 8)) + 'px',
    width: Math.round(maxWidth) + 'px',
    maxHeight: Math.round(Math.max(160, spaceBelow)) + 'px'
  }
}

function fdResolveFloorToneAndLabel(record, peeked, awaitingLiveRoll) {
  if (awaitingLiveRoll) {
    return {
      tone: 'skipped',
      pillText: '🎲 真骰定难中…',
      tooltip: '命运之骰正在读取本轮情境并投掷真骰…',
      covered: false
    }
  }
  const roll = record && record.roll ? record.roll : null
  const judged = record && record.judged ? record.judged : null
  const setupReason = (record && record.setupRequiredReason) || ''
  const fate = fdNormalizeFate(record && record.fate)
  const covered = Boolean(roll && roll.hidden && !peeked)

  if (roll) {
    const tone = covered ? 'hidden' : fdTierOf(roll.tier)
    if (covered) {
      return {
        tone,
        covered: true,
        pillText: `暗骰 · ${roll.check || '感知'} · 点按偷看`,
        tooltip: '感知/洞察暗骰（点击揭晓并展开详情）'
      }
    }
    const suffix = roll.rerollMeta && roll.rerollMeta.mode === 'push'
      ? ' · 🔥孤注'
      : (roll.rerollMeta && roll.rerollMeta.mode === 'fate'
        ? ' · ✦逆命'
        : (roll.reusedOnRegenerate ? ' · 🔒锁骰' : ''))
    return {
      tone,
      covered: false,
      pillText: `🎲 ${roll.check || '检定'} ${fdFormatCompactDice(roll)} · ${roll.tierLabel || ''}${suffix}`,
      tooltip: `${roll.rule || '2d6'} ${roll.check || '检定'}（难度：${roll.difficultyLabel || '普通'}）· ✦ 命运点 ${fate.points}/${fate.max}（点击打开裁定小窗）`
    }
  }
  if (setupReason) {
    return {
      tone: 'skipped',
      covered: false,
      pillText: '🎲 待配决策模型',
      tooltip: '尚未配置决策模型 API Key（点击查看指引）'
    }
  }
  if (judged && judged.shouldRoll === false) {
    const prob = Number(judged.needProbability)
    const probPart = judged.damperSync && judged.damperSync.skipped === 'scene-shift'
      ? '场景放行'
      : (Number.isFinite(prob) ? `免检定 ${Math.round(prob * 100)}%` : '免检定')
    return {
      tone: 'skipped',
      covered: false,
      pillText: `🎲 ${probPart}`,
      tooltip: `${judged.reason || '本轮行动无显著不确定性，免于投骰'}（点击展开详情）`
    }
  }
  return {
    tone: 'idle',
    covered: false,
    pillText: '🎲 命运之骰',
    tooltip: `打开命运之骰裁定小窗（✦ 命运点 ${fate.points}/${fate.max}）`
  }
}

function ComposerDicePopover(props) {
  const { record, peeked, rerolling, rerollHint, isStreaming, popoverStyle, popoverRef, onReroll, onClose } = props || {}
  const stageRef = useRef(null)
  const roll = record && record.roll ? record.roll : null
  const judged = record && record.judged ? record.judged : null
  const setupReason = (record && record.setupRequiredReason) || ''
  const fate = fdNormalizeFate(record && record.fate)
  const covered = Boolean(roll && roll.hidden && !peeked)
  const tone = roll
    ? (covered ? 'hidden' : fdTierOf(roll.tier))
    : ((setupReason || (judged && judged.shouldRoll === false)) ? 'skipped' : 'idle')

  const rerollState = record && record.rerollState && typeof record.rerollState === 'object'
    ? record.rerollState
    : { allowed: false, reason: '本轮骰点已锁定' }

  const breakdown = (roll && roll.modifierBreakdown) || {}
  const skillBonus = roll ? fdNumber(breakdown.skillBonus ?? roll.skillBonus, 0) : 0
  const damper = roll ? (roll.damper || roll.damperSync || null) : null
  const quota = damper ? (damper.quota || damper.quotaSync || '') : ''

  const titleText = roll
    ? `命运之骰裁定 · ${roll.check || '行动'}检定（${covered ? '暗骰已揭晓' : (roll.tierLabel || '判定')}）`
    : (setupReason
      ? '命运之骰 · 待配置决策模型'
      : (judged && judged.shouldRoll === false
        ? '命运之骰 · 本轮免检定'
        : '命运之骰 · 本局尚未检定'))

  return h('section', {
    ref: popoverRef,
    className: 'fd-root fd-floor-panel fd-composer-popover',
    'data-tone': tone,
    role: 'dialog',
    'aria-label': '命运之骰本轮裁定详情',
    style: popoverStyle || undefined
  },
  h('div', { className: 'fd-floor-panel-head' },
    h('strong', { className: 'fd-floor-panel-title' }, titleText),
    h('div', { className: 'fd-floor-panel-tags' },
      roll ? h('span', { className: 'fd-floor-tag' }, String(roll.rule || '2d6')) : null,
      !roll && record && record.rule ? h('span', { className: 'fd-floor-tag' }, String(record.rule)) : null,
      roll && roll.difficultyLabel ? h('span', { className: 'fd-floor-tag' }, `难度：${roll.difficultyLabel}`) : null,
      roll && roll.damper ? h('span', { className: 'fd-floor-tag' }, `⛓ ${roll.damper.quotaLabel || '阻尼联动'}`) : null,
      h('span', { className: 'fd-floor-tag' }, `✦ 命运点 ${fate.points}/${fate.max}`),
      h('button', {
        type: 'button',
        className: 'fd-popover-close',
        'aria-label': '关闭裁定窗口',
        title: '关闭',
        onClick: e => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
          if (typeof onClose === 'function') onClose()
        }
      }, '×'))),
  roll
    ? h(Fragment, null,
      h(Fd3DDiceStage, {
        roll,
        revealed: !covered,
        animation: record && record.animation,
        compact: true,
        animateOnMount: false,
        stageRef
      }),
      h('dl', { className: 'fd-turn-details' },
        h('dt', { className: 'fd-turn-dt' }, '骰面算式'),
        h('dd', { className: 'fd-turn-dd' },
          `${roll.rule || '2d6'} 原骰 [${(roll.dice || []).join(', ')}] = ${roll.total}（目标${roll.rule === 'd100' ? ' ≤ ' : ' ≥ '}${roll.target === undefined ? '—' : roll.target}）`),
        h('dt', { className: 'fd-turn-dt' }, '能力修正'),
        h('dd', { className: 'fd-turn-dd' },
          `${roll.check || '检定'} ${skillBonus >= 0 ? '+' : ''}${skillBonus}${roll.modifier ? `（环境/基调修正 ${roll.modifier > 0 ? '+' : ''}${roll.modifier}）` : ''}`),
        damper
          ? h(Fragment, null,
            h('dt', { className: 'fd-turn-dt' }, '叙事阻尼器'),
            h('dd', { className: 'fd-turn-dd' },
              `${damper.applied === false ? '未联动' : '双向联动'}${quota ? ` · 配额 ${quota}` : ''}${damper.reason ? ` · ${damper.reason}` : ''}`))
          : null,
        h('dt', { className: 'fd-turn-dt' }, '难度理由'),
        h('dd', { className: 'fd-turn-dd' }, `${roll.difficultyLabel || '判定'} · ${roll.reason || 'AI 综合评定'}`)),
      h(FdRerollActionBox, {
        rerollState,
        fate,
        rerolling,
        rerollHint,
        isStreaming,
        compact: true,
        stageRef,
        onReroll
      }))
    : h('div', { className: 'fd-hint' },
      setupReason
        ? '请前往酒馆「设置 › 叙事阻尼器」填写决策模型与 API Key，配好后即可自动定难并投掷真骰。'
        : (judged && judged.shouldRoll === false
          ? (judged.reason || '本轮行动无显著不确定性，免于投骰。')
          : '发送一条行动消息触发检定后，可在此直接查看骰面详情并执行逆命重投或孤注一掷。'))
  )
}

/* 输入栏上方停靠：揭晓动效条 + 左下角骰子悬浮胶囊（点开弹出与楼层一致的裁定小窗） */
function ComposerLiveDock(props) {
  const { ui, sessionId, gameId } = props || {}
  const [liveEvent, setLiveEvent] = useState(null)
  const [record, setRecord] = useState(null)
  const [open, setOpen] = useState(false)
  const [peeked, setPeeked] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [rerollHint, setRerollHint] = useState('')
  const [popoverStyle, setPopoverStyle] = useState(null)
  const lastIdRef = useRef('')
  const pillRef = useRef(null)
  const popoverRef = useRef(null)
  const reqSeqRef = useRef(0)
  const retryTimerRef = useRef(0)
  const retryCountRef = useRef(0)
  const replyStreamingRef = useRef(false)
  const lastRecordTurnRef = useRef(0)
  const stateKey = sessionId || gameId || null
  const keys = stateKey && gameId && gameId !== stateKey ? [stateKey, gameId] : (stateKey ? [stateKey] : [])
  const keysKey = keys.join('|')

  useEffect(() => {
    if (stateKey) fdNoteActiveGameId(String(stateKey))
  }, [stateKey])

  useEffect(() => {
    if (!keys.length) {
      setLiveEvent(null)
      setRecord(null)
      setOpen(false)
      lastRecordTurnRef.current = 0
      return undefined
    }
    let alive = true
    setLiveEvent(null)
    setRecord(null)
    setOpen(false)
    setPeeked(false)
    setRerollHint('')
    lastRecordTurnRef.current = 0
    retryCountRef.current = 0

    const syncTurnReset = nextTurn => {
      const n = fdNumber(nextTurn, 0)
      if (n > 0 && n !== lastRecordTurnRef.current) {
        lastRecordTurnRef.current = n
        setPeeked(false)
        setRerollHint('')
      }
    }

    const loadLatest = opts => {
      if (!alive) return
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = 0
      }
      const seq = reqSeqRef.current + 1
      reqSeqRef.current = seq
      const dom = fdLatestDomFloorInfo()
      const streamingHint = Boolean(dom.streaming || replyStreamingRef.current)
      if (streamingHint && fdIsEnabledForGame(stateKey) === false) {
        return
      }
      fdReadTurnBatched(ui, {
        gameId: stateKey,
        turn: dom.turn,
        latest: true,
        streaming: streamingHint,
        force: Boolean(opts && opts.force)
      }).then(res => {
        if (!alive || reqSeqRef.current !== seq) return
        const data = res && res.ok && res.data && typeof res.data === 'object' ? res.data : null
        if (data) {
          fdNoteRuntimeFlags(stateKey, data)
          syncTurnReset(data.turn)
          setRecord(data)
        }
        const pluginActive = fdIsEnabledForGame(stateKey) !== false
          && !(data && (data.enabled === false || data.autoCheck === false))
        const hasPayload = Boolean(data && (data.roll || data.setupRequiredReason || (data.judged && data.judged.shouldRoll === false)))
        const stillStreaming = Boolean(streamingHint || (data && data.streaming))
        if (pluginActive && stillStreaming && !hasPayload && retryCountRef.current < FD_STREAM_POLL_DELAYS.length) {
          const delay = FD_STREAM_POLL_DELAYS[retryCountRef.current]
          retryCountRef.current += 1
          retryTimerRef.current = setTimeout(() => loadLatest({ force: true }), delay)
        }
      })
    }

    const acceptLive = data => {
      if (!alive) return
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = 0
      }
      if (!data) {
        setLiveEvent(null)
        return
      }
      syncTurnReset(data.turn)
      setRecord(prev => fdRecordFromLiveEvent(stateKey, data.turn, data, prev) || prev)
      retryCountRef.current = FD_STREAM_POLL_DELAYS.length
      /* 关闭动画时不再展示骰面卡，但未配置决策模型的引导提示仍需露面 */
      if (data.animation === 'none' && data.kind !== 'setup-required' && data.kind !== 'skipped') {
        setLiveEvent(null)
        return
      }
      const id = data.id || `${data.kind || 'live'}-${data.turn || 0}-${Date.now()}`
      if (id === lastIdRef.current) return
      lastIdRef.current = id
      setLiveEvent({ ...data, id })
    }

    const refresh = () => {
      retryCountRef.current = 0
      loadLatest({ force: true })
    }

    loadLatest()
    const offs = []
    let lastTurnObserved = 0
    let lastSettledObserved = true
    keys.forEach(key => {
      offs.push(fdWatch(ui, key, 'live-roll', acceptLive))
      offs.push(fdWatch(ui, key, 'turn-check', data => {
        fdInvalidateTurnCache(key, data && data.turn)
        refresh()
      }))
      offs.push(fdWatch(ui, key, 'workbench-sync', payload => {
        fdNoteRuntimeFlags(key, payload)
        if (payload && (payload.settings || payload.rule || payload.binding)) {
          refresh()
        } else if (payload && payload.fate) {
          setRecord(prev => (prev && typeof prev === 'object' ? { ...prev, fate: fdNormalizeFate(payload.fate) } : prev))
        }
      }))
      if (ui && typeof ui.watchTurnState === 'function') {
        try {
          const offTurn = ui.watchTurnState(key, st => {
            if (fdIsEnabledForGame(key) === false) return
            const nextTurn = fdNumber(st && st.turn, 0)
            const nextSettled = Boolean(st && st.settled)
            const settledChanged = nextSettled && (!lastSettledObserved || nextTurn !== lastTurnObserved)
            lastTurnObserved = nextTurn
            lastSettledObserved = nextSettled
            if (settledChanged) refresh()
          })
          if (typeof offTurn === 'function') offs.push(offTurn)
        } catch {}
      }
      if (ui && typeof ui.watchReply === 'function') {
        try {
          const offReply = ui.watchReply(key, reply => {
            const nextStreaming = Boolean(reply && (reply.streaming || reply.busy))
            const changed = nextStreaming !== replyStreamingRef.current
            replyStreamingRef.current = nextStreaming
            if (fdIsEnabledForGame(key) === false) return
            if (changed) refresh()
          })
          if (typeof offReply === 'function') offs.push(offReply)
        } catch {}
      }
    })

    const onWindowStoryEvent = ev => {
      const sid = ev && ev.detail && ev.detail.sessionId
      if (sid && String(sid).trim() !== String(stateKey)) return
      if (ev && ev.type !== 'dsh-tavern-session-changed' && fdIsEnabledForGame(stateKey) === false) return
      if (ev && ev.type === 'dsh-tavern-session-changed') refresh()
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('dsh-tavern-session-changed', onWindowStoryEvent)
      window.addEventListener('dsh-tavern-story-mutated', onWindowStoryEvent)
      window.addEventListener('dsh-tavern-message-rendered', onWindowStoryEvent)
    }

    return () => {
      alive = false
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = 0
      }
      offs.forEach(off => off())
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('dsh-tavern-session-changed', onWindowStoryEvent)
        window.removeEventListener('dsh-tavern-story-mutated', onWindowStoryEvent)
        window.removeEventListener('dsh-tavern-message-rendered', onWindowStoryEvent)
      }
    }
  }, [keysKey])

  useEffect(() => {
    if (!open) return undefined
    const updatePosition = () => {
      const rect = pillRef.current && typeof pillRef.current.getBoundingClientRect === 'function'
        ? pillRef.current.getBoundingClientRect()
        : null
      setPopoverStyle(fdComputePopoverStyle(rect))
    }
    updatePosition()

    const onKeyDown = e => {
      if (e && e.key === 'Escape') setOpen(false)
    }
    const onPointerDown = e => {
      const target = e && e.target
      if (!target) return
      if (pillRef.current && typeof pillRef.current.contains === 'function' && pillRef.current.contains(target)) return
      if (popoverRef.current && typeof popoverRef.current.contains === 'function' && popoverRef.current.contains(target)) return
      setOpen(false)
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', updatePosition)
      window.addEventListener('scroll', updatePosition, true)
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('pointerdown', onPointerDown)
    }
    return () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('resize', updatePosition)
        window.removeEventListener('scroll', updatePosition, true)
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('pointerdown', onPointerDown)
      }
    }
  }, [open])

  if (!stateKey) return null

  const dom = fdLatestDomFloorInfo()
  const hasPayload = Boolean(record && (record.roll || record.setupRequiredReason || (record.judged && record.judged.shouldRoll === false)))
  const isStreaming = Boolean((record && record.streaming) || dom.streaming || replyStreamingRef.current)
  const awaitingLiveRoll = Boolean(isStreaming && !hasPayload && (record && record.streaming))
  const effectiveTurn = fdNumber((record && record.turn) || dom.turn, 0)
  const pillMeta = fdResolveFloorToneAndLabel(record, peeked, awaitingLiveRoll)

  const handleReroll = (mode, power) => {
    if (rerolling || !effectiveTurn) return
    setRerolling(true)
    setRerollHint('')
    fdCall(ui, FD_RPC.rerollTurn, { gameId: stateKey, turn: effectiveTurn, mode: mode || 'auto' })
      .then(res => {
        const data = res && res.ok ? res.data : null
        const nextRoll = data && data.ok !== false && data.roll ? data.roll : null
        if (nextRoll) {
          fdInvalidateTurnCache(stateKey, effectiveTurn)
          setRecord(prev => ({
            ...(prev || {}),
            turn: effectiveTurn,
            roll: nextRoll,
            fate: data.fate || (prev && prev.fate),
            rerollState: data.rerollState || { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' }
          }))
          fdPlayFloorRollAnim(null, null, nextRoll, record && record.animation, { power })
          setRerollHint(data.mode === 'push'
            ? '🔥 已孤注一掷并同步配额！现在点下方「重新生成正文」即可按新结果与代价改写剧情'
            : '✦ 已消耗 1 点命运点逆命重投！现在点下方「重新生成正文」即可按新点数改写剧情')
        } else {
          if (data && data.rerollState) {
            setRecord(prev => ({ ...(prev || {}), fate: data.fate || (prev && prev.fate), rerollState: data.rerollState }))
          }
          setRerollHint((data && data.error) || (res && res.error) || '当前条件不允许重投')
        }
      })
      .catch(() => setRerollHint('手动重投失败'))
      .finally(() => setRerolling(false))
  }

  const togglePopup = e => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
    if (pillMeta.covered && !peeked) {
      setPeeked(true)
      setOpen(true)
      return
    }
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen) {
      const latestDom = fdLatestDomFloorInfo()
      fdReadTurnBatched(ui, {
        gameId: stateKey,
        turn: latestDom.turn,
        latest: true,
        streaming: Boolean(latestDom.streaming || replyStreamingRef.current),
        force: true
      }).then(res => {
        const data = res && res.ok && res.data && typeof res.data === 'object' ? res.data : null
        if (data) setRecord(data)
      })
    }
  }

  const popoverNode = open
    ? h(ComposerDicePopover, {
      record,
      peeked,
      rerolling,
      rerollHint,
      isStreaming,
      popoverStyle,
      popoverRef,
      onReroll: handleReroll,
      onClose: () => setOpen(false)
    })
    : null

  const portaledPopover = popoverNode && ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body
    ? ReactDOM.createPortal(popoverNode, document.body)
    : popoverNode

  return h(Fragment, null,
    liveEvent
      ? h('div', { className: 'fd-root', style: { padding: '0 2px 4px' } },
        h(LiveRollBanner, { event: liveEvent, onDismiss: () => setLiveEvent(null) }))
      : null,
    h('div', { className: 'fd-composer-dock-wrap' },
      h('button', {
        ref: pillRef,
        type: 'button',
        className: 'fd-floor-pill fd-composer-pill',
        'data-tone': pillMeta.tone,
        'data-expanded': open ? 'true' : undefined,
        'aria-expanded': open ? 'true' : 'false',
        'aria-haspopup': 'dialog',
        title: pillMeta.tooltip,
        'aria-label': pillMeta.pillText,
        onClick: togglePopup
      },
      h('span', { className: 'fd-floor-dot', 'aria-hidden': 'true' }),
      h('span', { className: 'fd-floor-pill-icon', 'aria-hidden': 'true' }),
      h('span', { className: 'fd-floor-pill-text' }, pillMeta.pillText))),
    portaledPopover
  )
}

function fdBuildTurnDetails(record, peeked) {
  const roll = record.roll || {}
  const breakdown = roll.modifierBreakdown || {}
  const covered = Boolean(roll.hidden && !peeked)
  if (covered) {
    return h('dl', { className: 'fd-turn-details' },
      h('dt', { className: 'fd-turn-dt' }, '暗骰'),
      h('dd', { className: 'fd-turn-dd' }, '结果尚未揭晓，点按胶囊头部偷看'))
  }

  const rows = []
  rows.push(h('dt', { key: 'dt-rule', className: 'fd-turn-dt' }, '骰面算式'))
  rows.push(h('dd', { key: 'dd-rule', className: 'fd-turn-dd' },
    `${roll.rule || 'd6'} 原骰 [${(roll.dice || []).join(', ')}]`
    + ` = ${roll.total}（目标${roll.rule === 'd100' ? ' ≤ ' : ' ≥ '}${roll.target === undefined ? '—' : roll.target}）`))

  const skillBonus = fdNumber(breakdown.skillBonus ?? roll.skillBonus, 0)
  rows.push(h('dt', { key: 'dt-skill', className: 'fd-turn-dt' }, '角色能力修正'))
  rows.push(h('dd', { key: 'dd-skill', className: 'fd-turn-dd' },
    `${roll.check || '检定'} ${skillBonus >= 0 ? '+' : ''}${skillBonus}`
    + (roll.modifier ? `（总修正 ${roll.modifier > 0 ? '+' : ''}${roll.modifier}）` : '')))

  if (fdNumber(breakdown.varModifier, 0) || (Array.isArray(breakdown.matchedVars) && breakdown.matchedVars.length)) {
    const matched = Array.isArray(breakdown.matchedVars) ? breakdown.matchedVars : []
    rows.push(h('dt', { key: 'dt-var', className: 'fd-turn-dt' }, 'MVU 变量修正'))
    rows.push(h('dd', { key: 'dd-var', className: 'fd-turn-dd' },
      `${fdNumber(breakdown.varModifier, 0) >= 0 ? '+' : ''}${fdNumber(breakdown.varModifier, 0)}`
      + (matched.length ? ` · ${matched.map(v => `${v.label || v.path || '变量'}(${v.raw ?? v.value ?? ''})`).join('、')}` : '')))
  }

  const damper = roll.damper || roll.damperSync || null
  if (damper) {
    const quota = damper.quota || damper.quotaSync || null
    rows.push(h('dt', { key: 'dt-damper', className: 'fd-turn-dt' }, '叙事阻尼器'))
    rows.push(h('dd', { key: 'dd-damper', className: 'fd-turn-dd' },
      `${damper.applied === false ? '未联动' : '联动'}`
      + (damper.modifier ? ` · 修正 ${damper.modifier > 0 ? '+' : ''}${damper.modifier}` : '')
      + (quota ? ` · 配额同步 ${typeof quota === 'string' ? quota : `推动 ${fdNumber(quota.plotPush, 0)}/${fdNumber(quota.maxPlotPush, 0)}、氛围 ${fdNumber(quota.ambience, 0)}/${fdNumber(quota.maxAmbience, 0)}`}` : '')
      + (damper.reason ? ` · ${damper.reason}` : '')))
  }

  rows.push(h('dt', { key: 'dt-diff', className: 'fd-turn-dt' }, '难度理由'))
  rows.push(h('dd', { key: 'dd-diff', className: 'fd-turn-dd' }, `${roll.difficultyLabel || '判定'} · ${roll.reason || '本地启发式快判'}`))

  return h('dl', { className: 'fd-turn-details' }, rows)
}

const fdMountedTurnViews = new Set()

function TurnRollCapsule(props) {
  const { ui, gameId, turn, children, defaultOpen, fromTurnView, emptyFallback } = props || {}
  const stageRef = useRef(null)
  const [record, setRecord] = useState(undefined)
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const [peeked, setPeeked] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [rerollHint, setRerollHint] = useState('')

  useEffect(() => {
    if (!fromTurnView || !gameId || !turn) return undefined
    const key = `${gameId}:${turn}`
    fdMountedTurnViews.add(key)
    return () => {
      fdMountedTurnViews.delete(key)
    }
  }, [fromTurnView, gameId, turn])

  useEffect(() => {
    if (!gameId || !turn) {
      setRecord(null)
      return undefined
    }
    let alive = true
    const reload = opts => {
      fdReadTurnBatched(ui, { gameId, turn, force: Boolean(opts && opts.force) }).then(res => {
        if (!alive) return
        const data = res && res.ok ? res.data : null
        setRecord(data && typeof data === 'object' ? data : null)
      })
    }
    setRecord(undefined)
    setPeeked(false)
    setRerollHint('')
    reload()
    const offSync = fdWatch(ui, gameId, 'workbench-sync', payload => {
      if (!alive) return
      fdNoteRuntimeFlags(gameId, payload)
      if (payload && (payload.settings || payload.rule || payload.binding || fdNumber(payload.turn, 0) === fdNumber(turn, 0))) {
        reload({ force: true })
      } else if (payload && payload.fate) {
        setRecord(prev => (prev && typeof prev === 'object' ? { ...prev, fate: fdNormalizeFate(payload.fate) } : prev))
      }
    })
    return () => {
      alive = false
      offSync()
    }
  }, [gameId, turn])

  const roll = record && record.roll ? record.roll : null
  if (record === undefined) return children || null
  if (!record || !roll) return emptyFallback || children || null

  const covered = Boolean(roll.hidden && !peeked)
  const tier = covered ? 'hidden' : fdTierOf(roll.tier)
  const summary = formatRollSummary(roll, peeked)
  const fate = fdNormalizeFate(record.fate)
  const rerollState = record.rerollState && typeof record.rerollState === 'object'
    ? record.rerollState
    : {
      allowed: !roll.hidden
        && !(roll.rerollMeta && roll.rerollMeta.count >= 1)
        && roll.tier !== 'critical'
        && roll.tier !== 'success',
      canFate: fate.points > 0,
      canPush: true,
      fatePoints: fate.points,
      fateMax: fate.max,
      reason: roll.hidden
        ? '感知/洞察类暗骰不可重投'
        : (roll.rerollMeta && roll.rerollMeta.count >= 1
          ? '本轮已重投锁定（每轮限 1 次）'
          : ((roll.tier === 'critical' || roll.tier === 'success') ? '检定已达成成功，无需重投' : ''))
    }

  const manualReroll = (mode, power) => {
    if (rerolling || !gameId || !turn) return
    setRerolling(true)
    setRerollHint('')
    fdCall(ui, FD_RPC.rerollTurn, { gameId, turn, mode: mode || 'auto' })
      .then(res => {
        const data = res && res.ok ? res.data : null
        const nextRoll = data && data.ok !== false && data.roll ? data.roll : null
        if (nextRoll) {
          fdInvalidateTurnCache(gameId, turn)
          setRecord(prev => ({
            ...(prev || {}),
            roll: nextRoll,
            fate: data.fate || (prev && prev.fate) || fate,
            rerollState: data.rerollState || { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' }
          }))
          fdPlayFloorRollAnim(null, null, nextRoll, record && record.animation, { power })
          setRerollHint(data.mode === 'push'
            ? '已孤注一掷并同步配额（点酒馆「重新生成」按新结果与代价重写正文）'
            : '已消耗 1 点命运点逆命重投（点酒馆「重新生成」按新点数重写正文）')
        } else {
          if (data && data.rerollState) {
            setRecord(prev => ({ ...(prev || {}), fate: data.fate || (prev && prev.fate), rerollState: data.rerollState }))
          }
          setRerollHint((data && data.error) || (res && res.error) || '当前条件不允许重投')
        }
      })
      .catch(() => setRerollHint('手动重投失败'))
      .finally(() => setRerolling(false))
  }

  return h(Fragment, null,
    h('div', { className: 'fd-root', style: { padding: '0 0 2px' } },
      h('div', { className: 'fd-turn-capsule', 'data-tier': tier },
        h('button', {
          type: 'button',
          className: 'fd-turn-head',
          'aria-expanded': open ? 'true' : 'false',
          onClick: e => {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
            if (covered) setPeeked(true)
            else setOpen(prev => !prev)
          }
        },
        h('span', { className: 'fd-turn-head-left' },
          h('span', { 'aria-hidden': 'true' }, covered ? '🎴' : '🎲'),
          h('span', { className: 'fd-turn-summary' }, summary),
          roll.reusedOnRegenerate ? h('span', { className: 'fd-event-pill', title: '重新生成已复用本轮已锁定的真骰结果' }, '🔒 锁骰') : null,
          fdRerollChip(roll),
          roll.damper ? h('span', { className: 'fd-event-pill' }, '⛓ 阻尼') : null),
        h('span', { className: 'fd-tier-pill', 'data-tier': tier },
          covered ? '点按揭晓' : (roll.tierLabel || '结果'))),
        open
          ? h(Fragment, null,
            !covered
              ? h(Fd3DDiceStage, {
                roll,
                revealed: true,
                animation: record && record.animation,
                compact: false,
                animateOnMount: false,
                stageRef
              })
              : null,
            fdBuildTurnDetails(record, peeked),
            !covered
              ? h(FdRerollActionBox, {
                rerollState,
                fate,
                rerolling,
                rerollHint,
                isStreaming: false,
                compact: false,
                stageRef,
                onReroll: manualReroll
              })
              : null)
          : null)),
    children || null)
}

const fdMountedHeaderTurns = new Set()

function FdRerollActionBox(props) {
  const { rerollState, fate, rerolling, rerollHint, isStreaming, compact, stageRef, onReroll } = props || {}
  const state = rerollState && typeof rerollState === 'object' ? rerollState : { allowed: false }
  const safeFate = fdNormalizeFate(fate)
  const compactCls = compact ? ' is-compact' : ''
  const fateHold = useFdHoldCharge({
    mode: 'fate',
    disabled: Boolean(rerolling),
    stageRef,
    onTrigger: (mode, power) => (typeof onReroll === 'function' ? onReroll(mode, power) : undefined)
  })
  const pushHold = useFdHoldCharge({
    mode: 'push',
    disabled: Boolean(rerolling),
    stageRef,
    onTrigger: (mode, power) => (typeof onReroll === 'function' ? onReroll(mode, power) : undefined)
  })

  if (isStreaming) {
    return h('div', { className: 'fd-reroll-status' + compactCls },
      '⏳ 正文正在按上述真骰结果生成；待本轮生成落盘后，可在此执行逆命重投或孤注一掷')
  }

  if (state.allowed) {
    const remPoints = fdNumber(state.fatePoints, safeFate.points)
    const maxPoints = fdNumber(state.fateMax, safeFate.max)
    return h('div', { className: 'fd-reroll-bar' + compactCls },
      h('div', { className: 'fd-reroll-prompt' },
        h('span', null, '⚡ 点按即投 · 长按按钮可蓄力聚能（每轮限 1 次）'),
        h('span', { className: 'fd-hint' }, '蓄力移出按钮可取消 · 重投后点「重新生成正文」生效')),
      h('div', { className: 'fd-reroll-grid' },
        state.canFate
          ? h('button', {
            type: 'button',
            className: 'fd-reroll-btn is-fate' + (fateHold.charging ? ' is-charging' : ''),
            disabled: Boolean(rerolling),
            title: '消耗 1 点命运点稳妥重掷（点按即投；长按按钮激活反重力星轨蓄力，松手冲霄逆命，移出按钮可无损取消）',
            ...fateHold.bindProps
          },
          h('span', { className: 'fd-reroll-btn-top' },
            h('span', { className: 'fd-reroll-btn-title' },
              rerolling
                ? '⏳ 重投中…'
                : (fateHold.charging ? `✦ 逆命蓄力 ${fateHold.chargePct}% · 松手改命` : '✦ 逆命重投')),
            h('span', { className: 'fd-reroll-btn-tag' }, `-1 点 · 余 ${remPoints}/${maxPoints} ▸`)),
          h('span', { className: 'fd-reroll-btn-sub' }, '无恶化与挂彩惩罚 · 长按反重力星轨蓄力'))
          : null,
        h('button', {
          type: 'button',
          className: 'fd-reroll-btn is-push' + (pushHold.charging ? ' is-charging' : ''),
          disabled: Boolean(rerolling),
          title: '不耗命运点强行一搏（点按即投；长按按钮激活掌心紧攥剧颤蓄力，松手雷霆猛砸，移出按钮可无损取消）',
          ...pushHold.bindProps
        },
        h('span', { className: 'fd-reroll-btn-top' },
          h('span', { className: 'fd-reroll-btn-title' },
            rerolling
              ? '⏳ 搏命中…'
              : (pushHold.charging ? `🔥 搏命蓄力 ${pushHold.chargePct}% · 松手猛砸` : '🔥 孤注一掷')),
          h('span', { className: 'fd-reroll-btn-tag' }, '0 点 · 成王败寇 ▸')),
        h('span', { className: 'fd-reroll-btn-sub' }, '败则恶化大失败 · 长按紧攥剧颤蓄力'))),
      h('div', { className: 'fd-reroll-foot' },
        rerollHint || '直接点「重新生成正文」将自动复用原骰点；不重投认栽可攒回命运点'))
  }

  if (rerollHint) {
    return h('div', { className: 'fd-reroll-done' + compactCls }, rerollHint)
  }

  return h('div', { className: 'fd-reroll-status' + compactCls },
    `🔒 ${state.reason || '本轮骰点已锁定'}`)
}
const fdHeaderMountListeners = new Set()

function fdNotifyHeaderTurns() {
  fdHeaderMountListeners.forEach(fn => {
    try { fn() } catch {}
  })
}

function MediaTurnRollCapsule(props) {
  const { ui, gameId, turn, item } = props || {}
  const resolvedTurn = fdNumber(turn || (item && item.data && item.data.turn), 0)
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(v => v + 1)
    fdHeaderMountListeners.add(bump)
    return () => { fdHeaderMountListeners.delete(bump) }
  }, [])
  if (!gameId || !resolvedTurn) return null
  fdNoteActiveGameId(gameId)
  const key = `${gameId}:${resolvedTurn}`
  if (fdMountedTurnViews.has(key) || fdMountedHeaderTurns.has(key)) return null
  return h(TurnRollCapsule, { ui, gameId, turn: resolvedTurn })
}

function fdFormatCompactDice(roll) {
  if (!roll) return ''
  if (roll.rule === 'd100') {
    return `${roll.total}/${roll.target === undefined ? 100 : roll.target}`
  }
  const totalMod = fdNumber(roll.totalModifier ?? ((Number(roll.skillBonus) || 0) + (Number(roll.modifier) || 0)), 0)
  const modStr = totalMod ? (totalMod > 0 ? `+${totalMod}` : String(totalMod)) : ''
  if (Array.isArray(roll.dice) && roll.dice.length > 1) {
    return `[${roll.dice.join('+')}]${modStr}=${roll.total}`
  }
  const raw = Array.isArray(roll.dice) && roll.dice.length === 1 ? roll.dice[0] : (roll.rawTotal ?? roll.total)
  return modStr ? `${raw}${modStr}=${roll.total}` : String(roll.total)
}

function StoryFloorDiceItem(props) {
  const { ui, gameId, turn, streaming, headSlot, panelSlot } = props || {}
  const stageRef = useRef(null)
  const [record, setRecord] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [peeked, setPeeked] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [rerollHint, setRerollHint] = useState('')

  useEffect(() => {
    if (!turn) return undefined
    let alive = true
    const load = opts => {
      fdReadTurnBatched(ui, {
        gameId: gameId || '',
        turn,
        streaming: Boolean(streaming),
        force: Boolean(opts && opts.force)
      }).then(res => {
        if (!alive) return
        const data = res && res.ok ? res.data : null
        setRecord(data && typeof data === 'object' ? data : null)
      })
    }
    load()
    const watchKey = gameId || fdGetActiveGameId()
    const offCheck = watchKey ? fdWatch(ui, watchKey, 'turn-check', data => {
      if (!alive) return
      const evTurn = fdNumber(data && data.turn, 0)
      const affected = fdInvalidateTurnCache(watchKey, evTurn)
      if (!evTurn || evTurn === fdNumber(turn, 0) || affected.includes(fdNumber(turn, 0))) {
        load({ force: true })
      }
    }) : fdNoop
    const offSync = watchKey ? fdWatch(ui, watchKey, 'workbench-sync', data => {
      if (!alive) return
      fdNoteRuntimeFlags(watchKey, data)
      if (data && (data.settings || data.rule || data.binding)) {
        load({ force: true })
      } else if (data && data.fate) {
        setRecord(prev => (prev && typeof prev === 'object' ? { ...prev, fate: fdNormalizeFate(data.fate) } : prev))
      }
    }) : fdNoop
    const offLive = watchKey ? fdWatch(ui, watchKey, 'live-roll', data => {
      if (!alive || !data) return
      const evTurn = fdNumber(data.turn, 0)
      if (streaming || (evTurn && evTurn === fdNumber(turn, 0))) {
        setRecord(prev => fdRecordFromLiveEvent(watchKey, turn, data, prev) || prev)
      }
    }) : fdNoop
    return () => {
      alive = false
      offCheck()
      offSync()
      offLive()
    }
  }, [gameId, turn, streaming])

  const effectiveTurn = fdNumber((record && record.turn) || turn, 0)
  const hasVisibleContent = Boolean(record && (record.roll || record.setupRequiredReason || (record.judged && record.judged.shouldRoll === false)))

  useEffect(() => {
    const activeId = gameId || fdGetActiveGameId()
    if (!hasVisibleContent || !activeId || !effectiveTurn) return undefined
    const key = `${activeId}:${effectiveTurn}`
    fdMountedHeaderTurns.add(key)
    fdNotifyHeaderTurns()
    return () => {
      fdMountedHeaderTurns.delete(key)
      fdNotifyHeaderTurns()
    }
  }, [hasVisibleContent, gameId, effectiveTurn])

  if (!hasVisibleContent || !ReactDOM || typeof ReactDOM.createPortal !== 'function' || !headSlot) return null

  const roll = record.roll || null
  const judged = record.judged || null
  const setupReason = record.setupRequiredReason || ''
  const fate = fdNormalizeFate(record.fate)
  const covered = Boolean(roll && roll.hidden && !peeked)
  const isStreaming = Boolean(streaming || record.streaming)

  let tone = 'skipped'
  let pillText = '骰子 · 免检定'
  let tooltip = '点击展开命运之骰本轮详情'

  if (roll) {
    tone = covered ? 'hidden' : fdTierOf(roll.tier)
    if (covered) {
      pillText = `暗骰 · ${roll.check || '感知'} · 点按偷看`
      tooltip = '感知/洞察暗骰（点击揭晓并展开详情）'
    } else {
      const suffix = roll.rerollMeta && roll.rerollMeta.mode === 'push'
        ? ' · 孤注'
        : (roll.rerollMeta && roll.rerollMeta.mode === 'fate'
          ? ' · 逆命'
          : (roll.reusedOnRegenerate ? ' · 锁骰' : ''))
      pillText = `真骰 · ${roll.check || '检定'} ${fdFormatCompactDice(roll)} · ${roll.tierLabel || ''}${suffix}`
      tooltip = `${roll.rule || '2d6'} ${roll.check || '检定'}（难度：${roll.difficultyLabel || '普通'}）· 命运点 ${fate.points}/${fate.max}（点击展开详情与重投）`
    }
  } else if (setupReason) {
    tone = 'skipped'
    pillText = '真骰 · 待配决策模型'
    tooltip = '尚未配置决策模型 API Key（点击查看指引）'
  } else if (judged && judged.shouldRoll === false) {
    tone = 'skipped'
    const prob = Number(judged.needProbability)
    const probPart = judged.damperSync && judged.damperSync.skipped === 'scene-shift'
      ? '场景放行'
      : (Number.isFinite(prob) ? `免检定 ${Math.round(prob * 100)}%` : '免检定')
    pillText = `真骰 · ${probPart}`
    tooltip = `${judged.reason || '本轮行动无显著不确定性，免于投骰'}（点击展开详情）`
  }

  const rerollState = record.rerollState && typeof record.rerollState === 'object'
    ? record.rerollState
    : { allowed: false, reason: '本轮无重投项' }

  const runManualReroll = (mode, power) => {
    if (rerolling || !effectiveTurn) return
    setRerolling(true)
    setRerollHint('')
    fdCall(ui, FD_RPC.rerollTurn, { gameId: gameId || '', turn: effectiveTurn, mode: mode || 'auto' })
      .then(res => {
        const data = res && res.ok ? res.data : null
        const nextRoll = data && data.ok !== false && data.roll ? data.roll : null
        if (nextRoll) {
          fdInvalidateTurnCache(gameId || fdGetActiveGameId(), effectiveTurn)
          setRecord(prev => ({
            ...(prev || {}),
            roll: nextRoll,
            fate: data.fate || (prev && prev.fate) || fate,
            rerollState: data.rerollState || { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' }
          }))
          fdPlayFloorRollAnim(null, null, nextRoll, record && record.animation, { power })
          setRerollHint(data.mode === 'push'
            ? '已孤注一掷并同步阻尼配额！点击下方「重新生成正文」即可按新结果与代价改写剧情'
            : '已消耗 1 点命运点逆命重投！点击下方「重新生成正文」即可按新点数改写剧情')
        } else {
          if (data && data.rerollState) {
            setRecord(prev => ({ ...(prev || {}), fate: data.fate || (prev && prev.fate), rerollState: data.rerollState }))
          }
          setRerollHint((data && data.error) || (res && res.error) || '当前条件不允许重投')
        }
      })
      .catch(() => setRerollHint('手动重投失败'))
      .finally(() => setRerolling(false))
  }

  const pillNode = h('button', {
    type: 'button',
    className: 'fd-floor-pill',
    'data-tone': tone,
    'data-expanded': expanded ? 'true' : undefined,
    'aria-expanded': Boolean(expanded),
    title: tooltip,
    'aria-label': pillText,
    onClick: e => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
      if (covered && !peeked) {
        setPeeked(true)
        setExpanded(true)
      } else {
        setExpanded(prev => !prev)
      }
    }
  },
  h('span', { className: 'fd-floor-dot', 'aria-hidden': 'true' }),
  h('span', { className: 'fd-floor-pill-icon', 'aria-hidden': 'true' }),
  h('span', { className: 'fd-floor-pill-text' }, pillText))

  const panelNode = expanded && panelSlot
    ? ReactDOM.createPortal(
      h('section', {
        className: 'fd-root fd-floor-panel',
        'data-tone': tone,
        'aria-label': '命运之骰本轮裁定详情'
      },
      h('div', { className: 'fd-floor-panel-head' },
        h('strong', { className: 'fd-floor-panel-title' },
          roll
            ? `命运之骰裁定 · ${roll.check || '行动'}检定（${covered ? '暗骰已揭晓' : (roll.tierLabel || '判定')}）`
            : (setupReason ? '命运之骰 · 待配置决策模型' : '命运之骰 · 本轮免检定')),
        h('div', { className: 'fd-floor-panel-tags' },
          roll ? h('span', { className: 'fd-floor-tag' }, String(roll.rule || '2d6')) : null,
          roll && roll.difficultyLabel ? h('span', { className: 'fd-floor-tag' }, `难度：${roll.difficultyLabel}`) : null,
          roll && roll.damper ? h('span', { className: 'fd-floor-tag' }, `⛓ ${roll.damper.quotaLabel || '阻尼联动'}`) : null,
          h('span', { className: 'fd-floor-tag' }, `✦ 命运点 ${fate.points}/${fate.max}`))),
      roll
        ? h(Fragment, null,
          h(Fd3DDiceStage, {
            roll,
            revealed: true,
            animation: record && record.animation,
            compact: true,
            animateOnMount: false,
            stageRef
          }),
          fdBuildTurnDetails(record, true))
        : h('div', { className: 'fd-hint' },
          setupReason
            ? '请前往酒馆「设置 › 叙事阻尼器」填写决策模型与 API Key，配置后即可自动定难并投掷真骰。'
            : ((judged && judged.reason) || '本轮行动无显著不确定性，免于投骰。')),
      roll
        ? h(FdRerollActionBox, {
          rerollState,
          fate,
          rerolling,
          rerollHint,
          isStreaming,
          compact: true,
          stageRef,
          onReroll: runManualReroll
        })
        : null),
      panelSlot
    )
    : null

  return h(Fragment, null, ReactDOM.createPortal(pillNode, headSlot), panelNode)
}

function fdExtractFloorTurn(article) {
  if (!article || typeof article.getAttribute !== 'function') return 0
  const legacy = fdNumber(article.getAttribute('data-legacy-turn'), 0)
  if (legacy > 0) return legacy
  const rowKey = String(article.getAttribute('data-row-key') || '')
  const rkMatch = /^turn:(\d+)$/.exec(rowKey)
  if (rkMatch) {
    const rkTurn = fdNumber(rkMatch[1], 0)
    if (rkTurn > 0) return rkTurn
  }
  const chatTurn = fdNumber(article.getAttribute('data-chat-turn'), 0)
  if (chatTurn > 0) return chatTurn
  return fdNumber(article.getAttribute('data-floor'), 0)
}

function fdEl(doc, tag, className, text) {
  const el = doc.createElement(tag)
  if (className) el.className = className
  if (text !== undefined && text !== null && text !== '') el.textContent = String(text)
  return el
}

function fdRecordFromLiveEvent(gameId, fallbackTurn, data, prevRecord) {
  if (!data || typeof data !== 'object') return null
  const kind = String(data.kind || '')
  if (kind !== 'check' && kind !== 'skipped' && kind !== 'setup-required') return null
  return {
    gameId: gameId || (prevRecord && prevRecord.gameId) || '',
    turn: fdNumber(data.turn, fallbackTurn) || fallbackTurn || 0,
    streaming: true,
    textVersion: null,
    roll: kind === 'check' && data.roll ? data.roll : null,
    setupRequiredReason: kind === 'setup-required' ? String(data.reason || 'SETUP_REQUIRED') : null,
    judged: kind === 'skipped'
      ? {
        shouldRoll: false,
        check: String(data.check || ''),
        needProbability: Number.isFinite(Number(data.needProbability)) ? Number(data.needProbability) : null,
        reason: String(data.reason || '')
      }
      : ((prevRecord && prevRecord.judged) || null),
    fate: (prevRecord && prevRecord.fate) || null,
    rerollState: (prevRecord && prevRecord.rerollState) || null
  }
}

/* ------------------------------------------------------------------ *
 * 对话视口正中央的全宽宽银幕投骰剧场（与尾部胶囊彻底剥离）
 * 决策模型一给出判定结果（live-roll 广播即刻触发，无需等流式 DOM 楼层插入），
 * 直接在 document.body 上锚定对话滚动容器（[data-conversation-scroll]）起一枚横向 100% 占满对话区、
 * 纵向稳居对话视口正中央的 WebGL2 HDR 宽银幕舞台：
 *   天际裂隙拉开入场 -> 大翼展慢镜投骰 -> 拍案印章与铭牌定格 -> 中线合拢消散。
 * 尾部胶囊只负责常驻读数、详情与重投入口，不再承载自动播放动画。
 * ------------------------------------------------------------------ */
const fdFloorRollOverlays = new Set()
const fdPlayedRollAnimKeys = new Set()
const FD_FLOOR_ROLL_MAX = 1

function fdFloorRollAnimKey(roll) {
  if (!roll) return ''
  const mode = roll.rerollMeta && roll.rerollMeta.mode ? roll.rerollMeta.mode : ''
  return [
    roll.rolledAt || '',
    roll.total === undefined || roll.total === null ? '' : String(roll.total),
    Array.isArray(roll.dice) ? roll.dice.join(',') : '',
    String(roll.tier || ''),
    mode
  ].join(':')
}

function fdRememberPlayedRollKey(key) {
  if (!key) return
  fdPlayedRollAnimKeys.add(key)
  while (fdPlayedRollAnimKeys.size > 80) {
    const first = fdPlayedRollAnimKeys.values().next().value
    if (!first) break
    fdPlayedRollAnimKeys.delete(first)
  }
}

function fdResolveConversationPane(doc, hintNode) {
  if (!doc) return hintNode || null
  const isBoxVisible = node => {
    if (!node || typeof node.getBoundingClientRect !== 'function') return false
    const r = node.getBoundingClientRect()
    return r.width > 120 && r.height > 96
  }
  if (hintNode && typeof hintNode.closest === 'function') {
    const direct = hintNode.closest('[data-conversation-scroll]') || hintNode.closest('[data-conversation-content]')
    if (direct && isBoxVisible(direct)) return direct
  }
  if (typeof doc.querySelectorAll === 'function') {
    const activeId = fdGetActiveGameId()
    const scrolls = Array.from(doc.querySelectorAll('[data-conversation-scroll]')).filter(isBoxVisible)
    if (scrolls.length) {
      if (activeId) {
        const matched = scrolls.find(el => {
          const owner = el.closest && el.closest('[data-conversation-session]')
          return owner && owner.getAttribute('data-conversation-session') === activeId
        })
        if (matched) return matched
      }
      const primary = scrolls.find(el => {
        const content = el.closest && el.closest('[data-conversation-content]')
        return !(content && String(content.className || '').includes('embedded'))
      })
      return primary || scrolls[0]
    }
    const contents = Array.from(doc.querySelectorAll('[data-conversation-content], [data-chat-flow]')).filter(isBoxVisible)
    if (contents.length) return contents[0]
  }
  if (hintNode && isBoxVisible(hintNode)) return hintNode
  return null
}

function fdToggleNodeClass(node, cls, on) {
  if (!node || !cls) return
  const next = Boolean(on)
  if (node.classList) {
    if (next && typeof node.classList.add === 'function') { node.classList.add(cls); return }
    if (!next && typeof node.classList.remove === 'function') { node.classList.remove(cls); return }
    if (typeof node.classList.toggle === 'function') { node.classList.toggle(cls, next); return }
  }
  const list = String(node.className || '').split(/\s+/).filter(Boolean).filter(c => c !== cls)
  if (next) list.push(cls)
  node.className = list.join(' ')
}

function fdSetNodeCssVar(node, name, value) {
  if (!node || !node.style || !name) return
  if (value === null || value === undefined || value === '') {
    if (typeof node.style.removeProperty === 'function') node.style.removeProperty(name)
    else delete node.style[name]
    return
  }
  const str = String(value)
  if (typeof node.style.setProperty === 'function') node.style.setProperty(name, str)
  else node.style[name] = str
}

function fdGetPrimaryFloorRollOverlay() {
  for (const ov of fdFloorRollOverlays) {
    if (ov && ov.wrap) return ov
  }
  return null
}

function fdGetActiveFloorRollStage() {
  const ov = fdGetPrimaryFloorRollOverlay()
  return ov && ov.stage ? ov.stage : null
}

function fdBuildFloorRollKickerText(roll, hidden, mode, power) {
  const checkTitle = String((roll && roll.check) || '行动')
  if (hidden) return `✦ 命运暗骰 · ${checkTitle}检定 ✦`
  const diffTitle = roll && roll.difficultyLabel ? ` · ${roll.difficultyLabel}` : ''
  const pwrNum = Number(power) || 0
  const pwrText = pwrNum > 0.1 ? `（蓄力 ${Math.round(pwrNum * 100)}%）` : ''
  const rerollBadge = mode === 'push'
    ? ` · 🔥孤注一掷${pwrText}`
    : (mode === 'fate' ? ` · ✦逆命重投${pwrText}` : (pwrText ? ` · ${pwrText}` : ''))
  return `✦ 命运真骰裁定 · ${checkTitle}检定${diffTitle}${rerollBadge} ✦`
}

function fdPopulateFloorRollReadout(doc, readout, roll, hidden) {
  if (!doc || !readout || !roll) return
  readout.textContent = ''
  if (Array.isArray(readout.children)) readout.children.length = 0
  const checkTitle = String(roll.check || '行动')
  if (hidden) {
    readout.appendChild(fdEl(doc, 'span', 'fd-floor-roll-readout-formula', `${checkTitle}检定`))
    readout.appendChild(fdEl(doc, 'span', 'fd-floor-roll-readout-tier', '暗骰封存'))
    return
  }
  const rawDiceText = Array.isArray(roll.dice) && roll.dice.length ? `[${roll.dice.join('+')}]` : String(roll.total ?? '')
  const netMod = fdNumber(roll.totalModifier ?? ((fdNumber(roll.skillBonus, 0)) + (fdNumber(roll.modifier, 0))), 0)
  const modText = netMod ? (netMod > 0 ? ` +${netMod}` : ` ${netMod}`) : ''
  const targetText = roll.target !== undefined && roll.target !== null
    ? `（目标${roll.rule === 'd100' ? '≤' : '≥'}${roll.target}）`
    : ''
  readout.appendChild(fdEl(
    doc,
    'span',
    'fd-floor-roll-readout-formula',
    `${checkTitle} · ${roll.rule || '2d6'} ${rawDiceText}${modText} = ${roll.total}${targetText}`
  ))
  readout.appendChild(fdEl(doc, 'span', 'fd-floor-roll-readout-tier', roll.tierLabel || '判定'))
}

function fdBuildFloorRollStageSpec(roll, hidden, tier) {
  let spec = null
  try { spec = FD3D.rollToStageSpec({ ...roll, hidden }, false) } catch {}
  if (spec) {
    /* 宽银幕剧场慢镜：0.58x 舒展抛物线 + 落地凝滞慢镜，骰子飞行与碰撞弹跳约 2.7s */
    return { ...spec, pace: 0.58 }
  }
  return {
    diceSpecs: [{ meshKey: 'd20', sides: 20, targetValue: Math.max(1, Math.min(20, fdNumber(roll && roll.total, 1))) }],
    tier,
    mode: hidden ? 'hidden' : 'normal',
    total: fdNumber(roll && roll.total, 0),
    checkName: (roll && roll.check) || '检定',
    pace: 0.58
  }
}

function fdTeardownFloorRollOverlay(ov) {
  if (!ov) return
  try {
    for (let i = 0; i < ov.timers.length; i++) clearTimeout(ov.timers[i])
  } catch {}
  try {
    if (ov.exitTimers) {
      for (let i = 0; i < ov.exitTimers.length; i++) clearTimeout(ov.exitTimers[i])
    }
  } catch {}
  try { if (ov.safetyTimer) clearTimeout(ov.safetyTimer) } catch {}
  try { if (ov.ro) ov.ro.disconnect() } catch {}
  try {
    if (ov.onWinResize && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', ov.onWinResize)
    }
  } catch {}
  try { ov.stage.stop() } catch {}
  try { if (ov.wrap.parentNode) ov.wrap.parentNode.removeChild(ov.wrap) } catch {}
  fdFloorRollOverlays.delete(ov)
  if (typeof fdSyncPreSendGateLayout === 'function') {
    try { fdSyncPreSendGateLayout() } catch {}
  }
}

function fdDisposeFloorRollOverlay(entry) {
  if (!entry || !entry.rollOverlay) return
  const ov = entry.rollOverlay
  entry.rollOverlay = null
  fdTeardownFloorRollOverlay(ov)
}

function fdPlayFloorRollAnim(article, entry, roll, animationPref, options) {
  if (!roll) return false
  if (entry && entry.disposed) return false
  const baseKey = fdFloorRollAnimKey(roll)
  const eventKey = options && options.eventKey ? String(options.eventKey) : ''
  const dedupKey = eventKey || baseKey
  const forceGatePin = Boolean(options && options.forceGatePin)

  const existingOv = fdGetPrimaryFloorRollOverlay()
  if (existingOv && baseKey && existingOv.baseKey === baseKey) {
    if (forceGatePin && typeof existingOv.setGatePinned === 'function') existingOv.setGatePinned(true)
    fdRememberPlayedRollKey(dedupKey)
    if (baseKey !== dedupKey) fdRememberPlayedRollKey(baseKey)
    return true
  }

  if (!forceGatePin) {
    if (entry && baseKey && entry.rollAnimKey === baseKey) return false
    if (dedupKey && fdPlayedRollAnimKeys.has(dedupKey)) return false
    if (baseKey && !eventKey && fdPlayedRollAnimKeys.has(baseKey)) return false
  }

  const pref = String(animationPref || fdGetCachedAnimationPref() || 'atelier')
  const hidden = Boolean(roll.hidden)
  const mode = FD3D.resolveThemeMode(roll, hidden)
  let theme = null
  let supported = false
  try {
    theme = FD3D.resolveTheme(pref, mode, hidden)
    supported = Boolean(theme) && (Boolean(options && options._testForceSupported) || FD3D.canUseWebGL2())
  } catch {
    supported = false
  }
  /* 动画设置关掉（none/compact）或浏览器不支持 WebGL2 / 用户偏好减少动态时，胶囊依旧给出读数 */
  if (!supported) return false

  const doc = (article && article.ownerDocument) || (typeof document !== 'undefined' ? document : null)
  const mountHost = (doc && doc.body && typeof doc.body.appendChild === 'function')
    ? doc.body
    : (article && typeof article.appendChild === 'function' ? article : null)
  if (!doc || !mountHost) return false

  const tier = hidden ? 'hidden' : fdTierOf(roll.tier)
  const spec = fdBuildFloorRollStageSpec(roll, hidden, tier)
  const rawPower = fdNumber(options && options.power, 0)
  const gatePower = rawPower > 0 ? 0 : (typeof fdConsumePreSendGatePower === 'function' ? fdConsumePreSendGatePower() : 0)
  const power = Math.max(0, Math.min(1, rawPower || gatePower || 0))

  /* 若当前剧场仍敞开（例如发前逆命弹窗刚刚触发了重投），直接在已展开的剧场内无缝抛入新骰，绝不闪断合幕 */
  if (existingOv && existingOv.stage && (existingOv.wrap.isConnected || existingOv.wrap.parentNode)) {
    if (typeof fdNotifyPreSendGateRerollLaunched === 'function') {
      try { fdNotifyPreSendGateRerollLaunched(roll) } catch {}
    }
    if (existingOv.entry && existingOv.entry !== entry && existingOv.entry.rollOverlay === existingOv) {
      existingOv.entry.rollOverlay = null
    }
    if (entry) {
      if (entry.rollOverlay && entry.rollOverlay !== existingOv) fdDisposeFloorRollOverlay(entry)
      entry.rollOverlay = existingOv
      entry.rollAnimKey = baseKey
    }
    existingOv.rethrow({ entry, article, roll, hidden, mode, tier, theme, spec, power, baseKey, forceGatePin })
    fdRememberPlayedRollKey(dedupKey)
    if (baseKey && baseKey !== dedupKey) fdRememberPlayedRollKey(baseKey)
    return true
  }

  if (entry) fdDisposeFloorRollOverlay(entry)
  while (fdFloorRollOverlays.size >= FD_FLOOR_ROLL_MAX) {
    const oldest = fdFloorRollOverlays.values().next().value
    if (!oldest) break
    fdTeardownFloorRollOverlay(oldest)
  }

  const wrap = fdEl(doc, 'div', 'fd-floor-roll-overlay')
  wrap.setAttribute('aria-hidden', 'true')
  wrap.setAttribute('data-tier', tier)
  if (theme && theme.id) wrap.setAttribute('data-skin', theme.id)

  const backdrop = fdEl(doc, 'div', 'fd-floor-roll-backdrop')
  const stageMask = fdEl(doc, 'div', 'fd-floor-roll-stage-mask')
  const canvas = fdEl(doc, 'canvas', 'fd-3d-canvas fd-floor-roll-canvas')
  stageMask.appendChild(canvas)

  const topRail = fdEl(doc, 'div', 'fd-floor-roll-rail is-top')
  const bottomRail = fdEl(doc, 'div', 'fd-floor-roll-rail is-bottom')
  const kicker = fdEl(doc, 'div', 'fd-floor-roll-kicker', fdBuildFloorRollKickerText(roll, hidden, mode, power))
  const readout = fdEl(doc, 'div', 'fd-floor-roll-readout')
  fdPopulateFloorRollReadout(doc, readout, roll, hidden)

  wrap.appendChild(backdrop)
  wrap.appendChild(stageMask)
  wrap.appendChild(topRail)
  wrap.appendChild(bottomRail)
  wrap.appendChild(kicker)
  wrap.appendChild(readout)

  const initialPinned = Boolean(
    forceGatePin || (typeof fdIsPreSendGateHoldingOverlay === 'function' && fdIsPreSendGateHoldingOverlay())
  )
  if (initialPinned) fdToggleNodeClass(wrap, 'has-presend-gate', true)

  let paneEl = null
  const ov = {
    doc,
    article: article || null,
    entry: entry || null,
    baseKey,
    wrap,
    kicker,
    readout,
    stage: null,
    timers: [],
    exitTimers: [],
    safetyTimer: 0,
    ro: null,
    onWinResize: null,
    settled: false,
    closing: false,
    exitDeferred: false,
    pinnedByGate: initialPinned,
    dockBottomPx: 0,
    paneLeftPx: 0,
    paneWidthPx: 0,
    isHeldByGate: null,
    clearExitTimers: null,
    scheduleExit: null,
    armSafetyTimer: null,
    syncGeometry: null,
    setGatePinned: null,
    rethrow: null
  }

  ov.isHeldByGate = () => Boolean(
    ov.pinnedByGate || (typeof fdIsPreSendGateHoldingOverlay === 'function' && fdIsPreSendGateHoldingOverlay())
  )

  ov.clearExitTimers = () => {
    while (ov.exitTimers.length) {
      const t = ov.exitTimers.pop()
      if (t) clearTimeout(t)
    }
    ov.closing = false
    fdToggleNodeClass(wrap, 'is-fading', false)
  }

  ov.scheduleExit = afterMs => {
    /* 发前逆命弹窗展示期间：剧场动画必须常驻保持敞开，绝不自行倒计时关闭 */
    if (ov.isHeldByGate()) {
      ov.exitDeferred = true
      ov.clearExitTimers()
      return
    }
    if (ov.closing) return
    ov.closing = true
    ov.exitDeferred = false
    const delay = Math.max(0, Number(afterMs) || 0)
    ov.exitTimers.push(setTimeout(() => {
      if (!fdFloorRollOverlays.has(ov)) return
      if (ov.isHeldByGate()) {
        ov.exitDeferred = true
        ov.clearExitTimers()
        return
      }
      fdToggleNodeClass(wrap, 'is-fading', true)
    }, delay))
    ov.exitTimers.push(setTimeout(() => {
      if (!fdFloorRollOverlays.has(ov)) return
      if (ov.isHeldByGate()) {
        ov.exitDeferred = true
        ov.clearExitTimers()
        return
      }
      if (ov.entry && ov.entry.rollOverlay === ov) ov.entry.rollOverlay = null
      fdTeardownFloorRollOverlay(ov)
    }, delay + 880))
  }

  ov.armSafetyTimer = powerVal => {
    if (ov.safetyTimer) {
      clearTimeout(ov.safetyTimer)
      ov.safetyTimer = 0
    }
    ov.safetyTimer = setTimeout(() => {
      ov.safetyTimer = 0
      if (!fdFloorRollOverlays.has(ov)) return
      ov.settled = true
      fdToggleNodeClass(wrap, 'is-settled', true)
      ov.scheduleExit(0)
    }, 7200 + Math.round(Math.max(0, Number(powerVal) || 0) * 500))
  }

  const syncPaneGeometry = () => {
    paneEl = fdResolveConversationPane(doc, ov.article)
    const winW = (typeof window !== 'undefined' && Number(window.innerWidth)) || 1280
    const winH = (typeof window !== 'undefined' && Number(window.innerHeight)) || 820
    let paneLeft = 0
    let paneTop = 0
    let paneWidth = winW
    let paneHeight = winH
    let hasPane = false
    if (paneEl && typeof paneEl.getBoundingClientRect === 'function') {
      const r = paneEl.getBoundingClientRect()
      if (r.width > 120 && r.height > 96) {
        paneLeft = r.left
        paneTop = r.top
        paneWidth = r.width
        paneHeight = r.height
        hasPane = true
      }
    }

    const held = ov.isHeldByGate()
    fdToggleNodeClass(wrap, 'has-presend-gate', held)

    const measuredStageH = Number(wrap.offsetHeight)
      || (typeof wrap.getBoundingClientRect === 'function' ? Number(wrap.getBoundingClientRect().height) : 0)
    const fallbackStageH = held
      ? Math.min(326, Math.max(232, Math.round(winH * 0.34)))
      : Math.min(385, Math.max(290, Math.round(winH * 0.42)))
    const stageH = Math.max(180, Math.round(measuredStageH || fallbackStageH))

    if (held) {
      const gateCardH = typeof fdMeasurePreSendGateCardHeight === 'function'
        ? fdMeasurePreSendGateCardHeight()
        : 204
      /* 逆命弹窗紧贴剧场下缘正下方展开，剧场与弹窗整体在对话视口中垂直居中 */
      const stageVisualSpan = stageH
      const gapPx = 4
      const totalStackH = stageVisualSpan + gapPx + gateCardH
      const idealTop = paneTop + (paneHeight - totalStackH) * 0.5
      const maxTop = Math.max(8, winH - 12 - gateCardH - gapPx - stageVisualSpan)
      const stageTop = Math.round(Math.max(8, Math.min(maxTop, idealTop)))
      const stageCenterY = Math.round(stageTop + stageH * 0.5)
      wrap.style.left = `${Math.round(paneLeft)}px`
      wrap.style.width = `${Math.round(paneWidth)}px`
      wrap.style.top = `${stageCenterY}px`
      ov.dockBottomPx = stageTop + stageVisualSpan + gapPx
      ov.paneLeftPx = Math.round(paneLeft)
      ov.paneWidthPx = Math.round(paneWidth)
      if (typeof fdApplyPreSendGateDockGeometry === 'function') {
        fdApplyPreSendGateDockGeometry({
          docked: true,
          left: ov.paneLeftPx,
          width: ov.paneWidthPx,
          top: ov.dockBottomPx
        })
      }
      return
    }

    if (hasPane) {
      wrap.style.left = `${Math.round(paneLeft)}px`
      wrap.style.width = `${Math.round(paneWidth)}px`
      wrap.style.top = `${Math.round(paneTop + paneHeight / 2)}px`
      ov.paneLeftPx = Math.round(paneLeft)
      ov.paneWidthPx = Math.round(paneWidth)
    } else {
      wrap.style.left = '0px'
      wrap.style.width = '100vw'
      wrap.style.top = '50%'
      ov.paneLeftPx = 0
      ov.paneWidthPx = Math.round(winW)
    }
    ov.dockBottomPx = Math.round((hasPane ? paneTop + paneHeight / 2 : winH / 2) + stageH * 0.40 + 8)
  }
  ov.syncGeometry = syncPaneGeometry

  ov.setGatePinned = (pinned, releaseOpts) => {
    const nextPinned = Boolean(pinned)
    ov.pinnedByGate = nextPinned
    if (ov.stage) ov.stage.pinSettled = nextPinned
    if (nextPinned) {
      ov.clearExitTimers()
      syncPaneGeometry()
      try {
        if (ov.stage) {
          ov.stage.resize()
          ov.stage.renderSingleFrame()
        }
      } catch {}
      return
    }
    syncPaneGeometry()
    try {
      if (ov.stage) {
        ov.stage.resize()
        ov.stage.renderSingleFrame()
      }
    } catch {}
    if (ov.settled) {
      const delay = releaseOpts && typeof releaseOpts.exitDelayMs === 'number' ? releaseOpts.exitDelayMs : 260
      ov.scheduleExit(delay)
    }
  }

  ov.rethrow = next => {
    ov.entry = next.entry || null
    if (next.article) ov.article = next.article
    ov.baseKey = next.baseKey || ''
    ov.settled = false
    ov.exitDeferred = false
    ov.clearExitTimers()
    while (ov.timers.length) {
      const t = ov.timers.pop()
      if (t) clearTimeout(t)
    }
    ov.pinnedByGate = Boolean(
      next.forceGatePin || (typeof fdIsPreSendGateHoldingOverlay === 'function' && fdIsPreSendGateHoldingOverlay())
    )
    if (ov.stage) ov.stage.pinSettled = ov.pinnedByGate
    fdToggleNodeClass(wrap, 'is-open', true)
    fdToggleNodeClass(wrap, 'is-settled', false)
    fdToggleNodeClass(wrap, 'is-fading', false)
    fdToggleNodeClass(wrap, 'has-presend-gate', ov.pinnedByGate)
    wrap.setAttribute('data-tier', next.tier)
    if (next.theme && next.theme.id) wrap.setAttribute('data-skin', next.theme.id)
    kicker.textContent = fdBuildFloorRollKickerText(next.roll, next.hidden, next.mode, next.power)
    fdPopulateFloorRollReadout(doc, readout, next.roll, next.hidden)
    try {
      ov.stage.setTheme(next.theme)
      syncPaneGeometry()
      ov.stage.resize()
      const launchPower = Math.max(0, Number(next.power) || 0)
      if (launchPower > 0.1 && typeof ov.stage.releaseButtonCharge === 'function') {
        ov.stage.releaseButtonCharge(next.spec, launchPower)
      } else {
        if (ov.stage.charging && typeof ov.stage.cancelButtonCharge === 'function') {
          ov.stage.cancelButtonCharge()
        }
        ov.stage.throwDice(next.spec)
      }
    } catch {}
    ov.armSafetyTimer(next.power)
  }

  syncPaneGeometry()
  mountHost.appendChild(wrap)

  let stage = null
  try {
    const StageCtor = (options && options._testStageCtor) || FD3D.SharedBlitDiceStage
    stage = new StageCtor(canvas, {
      audio: FD3D.getAudio(),
      banner: false,
      compact: false,
      theater: true,
      onRollSettled: () => {
        if (!fdFloorRollOverlays.has(ov)) return
        ov.settled = true
        fdToggleNodeClass(wrap, 'is-open', true)
        fdToggleNodeClass(wrap, 'is-settled', true)
        ov.scheduleExit(2450)
      }
    })
    stage.pinSettled = ov.pinnedByGate
    stage.setTheme(theme)
    ov.stage = stage
  } catch {
    try { if (wrap.parentNode) wrap.parentNode.removeChild(wrap) } catch {}
    return false
  }

  if (entry) {
    entry.rollOverlay = ov
    entry.rollAnimKey = baseKey
  }
  fdRememberPlayedRollKey(dedupKey)
  if (baseKey && baseKey !== dedupKey) fdRememberPlayedRollKey(baseKey)
  fdFloorRollOverlays.add(ov)

  const handleResize = () => {
    if (!fdFloorRollOverlays.has(ov)) return
    syncPaneGeometry()
    try {
      stage.resize()
      stage.renderSingleFrame()
    } catch {}
  }
  ov.onWinResize = handleResize
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', handleResize)
  }
  if (paneEl && typeof ResizeObserver === 'function') {
    try {
      ov.ro = new ResizeObserver(handleResize)
      ov.ro.observe(paneEl)
    } catch {}
  }

  /* 第 0 帧先把宽银幕台面点亮，随裂隙拉开 180ms 后双翼抛入真骰，避免前半程被开场遮掉 */
  const primeStage = () => {
    if (!fdFloorRollOverlays.has(ov)) return
    try {
      syncPaneGeometry()
      stage.resize()
      stage.renderSingleFrame()
    } catch {}
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(primeStage)
  else setTimeout(primeStage, 16)

  ov.timers.push(setTimeout(() => {
    if (!fdFloorRollOverlays.has(ov)) return
    try {
      syncPaneGeometry()
      stage.resize()
      if (power > 0.1 && typeof stage.releaseButtonCharge === 'function') stage.releaseButtonCharge(spec, power)
      else stage.throwDice(spec)
    } catch {}
  }, 180))

  /* 后台标签页 rAF 节流兜底：最长 7.2s 落定，若逆命弹窗仍在等待则继续保持敞开 */
  ov.armSafetyTimer(power)
  return true
}

function fdEnsureFloorRollForGate(payload) {
  let ov = fdGetPrimaryFloorRollOverlay()
  if (!ov && payload && payload.tier && typeof fdRollFromGatePayload === 'function') {
    const gateRoll = fdRollFromGatePayload(payload)
    if (gateRoll) {
      fdPlayFloorRollAnim(null, null, gateRoll, payload.animation || '', { forceGatePin: true })
      ov = fdGetPrimaryFloorRollOverlay()
    }
  }
  if (ov && typeof ov.setGatePinned === 'function') {
    ov.setGatePinned(true)
  }
  return ov
}

function fdReleaseFloorRollOverlayFromGate(options) {
  const ov = fdGetPrimaryFloorRollOverlay()
  if (!ov) return
  if (ov.stage && ov.stage.charging && !(options && options.keepStageCharge)) {
    try { ov.stage.cancelButtonCharge() } catch {}
  }
  if (typeof ov.setGatePinned === 'function') {
    ov.setGatePinned(false, options)
  }
}

/* 纯原生 DOM 楼层顶栏挂载：不依赖宿主未暴露的 react-dom/client，任何浏览器页面加载即刻生效 */
function fdMountImperativeFloorHeaders(ui) {
  if (typeof document === 'undefined' || !document.body || typeof MutationObserver !== 'function') return fdNoop
  const doc = document
  const entries = new Map()
  let rafId = 0
  let disposed = false
  let watchedGameId = ''
  let latestLiveEvent = null
  let stopWatches = fdNoop

  const refreshAll = opts => {
    if (disposed) return
    entries.forEach(entry => {
      entry.retryCount = 0
      loadEntry(entry, opts)
    })
  }

  const refreshTurns = (affectedTurns, opts) => {
    if (disposed) return
    const turnSet = new Set((affectedTurns || []).map(t => fdNumber(t, 0)).filter(t => t > 0))
    entries.forEach(entry => {
      const allowWasOpen = Boolean(entry.record && entry.record.rerollState && entry.record.rerollState.allowed)
      if (entry.streaming || allowWasOpen || turnSet.has(entry.turn)) {
        entry.retryCount = 0
        loadEntry(entry, opts)
      }
    })
  }

  const applyLiveEventToStreamingEntries = (gameId, data) => {
    if (disposed || !data || typeof data !== 'object') return false
    let matched = false
    entries.forEach(entry => {
      if (!entry.streaming) return
      const optimistic = fdRecordFromLiveEvent(gameId, entry.turn, data, entry.record)
      if (!optimistic) return
      matched = true
      if (entry.retryTimer) {
        clearTimeout(entry.retryTimer)
        entry.retryTimer = 0
      }
      entry.retryCount = FD_STREAM_POLL_DELAYS.length
      entry.record = optimistic
      entry.gotLiveStreamRecord = true
      /* 判定结果一落定立刻在正文中央投骰，不等正文写完、也不进胶囊 */
      const evTurn = fdNumber(data && data.turn, 0)
      if (optimistic.roll && (!evTurn || !entry.turn || evTurn === entry.turn)) {
        fdPlayFloorRollAnim(entry.article, entry, optimistic.roll, data.animation)
      }
      renderEntry(entry)
    })
    return matched
  }

  const bindGameWatches = nextId => {
    const id = String(nextId || '').trim()
    if (!id || id === watchedGameId || disposed) return
    if (watchedGameId && watchedGameId !== id) {
      Array.from(fdFloorRollOverlays).forEach(ov => fdTeardownFloorRollOverlay(ov))
    }
    stopWatches()
    watchedGameId = id
    latestLiveEvent = null
    let lastObservedTurn = 0
    let lastObservedSettled = true

    const off1 = fdWatch(ui, id, 'turn-check', data => {
      const evTurn = fdNumber(data && data.turn, 0)
      const affected = fdInvalidateTurnCache(id, evTurn)
      if (evTurn > 0 || affected.length > 0) {
        refreshTurns(affected, { force: true })
      } else {
        refreshAll({ force: true })
      }
    })
    const off2 = fdWatch(ui, id, 'live-roll', data => {
      latestLiveEvent = data && typeof data === 'object' ? { gameId: id, data } : null
      if (data && typeof data === 'object') {
        /* 决策模型结果一落定即刻在对话视口正中央起全宽剧场，绝不等流式楼层 DOM 插入 */
        if (data.kind === 'check' && data.roll) {
          const ts = fdNumber(data.emittedAt, fdNumber(data.roll.rolledAt, 0))
          const isFresh = !ts || Math.abs(Date.now() - ts) < 25000
          if (isFresh) {
            fdPlayFloorRollAnim(null, null, data.roll, data.animation, { eventKey: data.id || '' })
          }
          if (
            !data.roll.hidden
            && (data.roll.tier === 'failure' || data.roll.tier === 'fumble')
            && typeof fdProbePreSendGate === 'function'
            && (typeof fdMayNeedPreSendGate !== 'function' || fdMayNeedPreSendGate(id))
          ) {
            setTimeout(() => fdProbePreSendGate(id), 60)
            setTimeout(() => fdProbePreSendGate(id), 260)
          }
        }
        const matched = applyLiveEventToStreamingEntries(id, data)
        const evTurn = fdNumber(data.turn, 0)
        if (!matched && evTurn > 0) {
          refreshTurns([evTurn], { force: true })
        }
      }
    })
    const off3 = fdWatch(ui, id, 'workbench-sync', data => {
      fdNoteRuntimeFlags(id, data)
      if (data && (data.settings || data.rule || data.binding)) {
        fdInvalidateTurnCache(id)
        refreshAll({ force: true })
        return
      }
      if (data && data.fate) {
        const nextFate = fdNormalizeFate(data.fate)
        entries.forEach(entry => {
          if (entry.record && typeof entry.record === 'object') {
            entry.record = { ...entry.record, fate: nextFate }
            if (entry.record.rerollState && entry.record.rerollState.allowed) {
              entry.record.rerollState = {
                ...entry.record.rerollState,
                fatePoints: nextFate.points,
                fateMax: nextFate.max,
                canFate: nextFate.points > 0
              }
            }
            renderEntry(entry)
          }
        })
      }
    })
    let off4 = fdNoop
    if (ui && typeof ui.watchTurnState === 'function') {
      try {
        const stopTurnState = ui.watchTurnState(id, st => {
          if (fdIsEnabledForGame(id) === false) return
          const nextTurn = fdNumber(st && st.turn, 0)
          const nextSettled = Boolean(st && st.settled)
          const settledChanged = nextSettled && (!lastObservedSettled || (nextTurn > 0 && nextTurn !== lastObservedTurn))
          lastObservedTurn = nextTurn
          lastObservedSettled = nextSettled
          if (settledChanged) {
            const affected = fdInvalidateTurnCache(id, nextTurn)
            refreshTurns(affected.length ? affected : [nextTurn], { force: true })
          }
        })
        if (typeof stopTurnState === 'function') off4 = stopTurnState
      } catch {}
    }
    stopWatches = () => {
      off1()
      off2()
      off3()
      off4()
    }
    refreshAll()
  }

  const offGameSub = fdSubscribeActiveGameId(bindGameWatches)
  const onTavernWindowSession = ev => {
    const sid = ev && ev.detail && ev.detail.sessionId
    const prevId = watchedGameId
    if (sid) fdNoteActiveGameId(String(sid))
    if (disposed) return
    schedule()
    if (ev && ev.type === 'dsh-tavern-session-changed' && (!sid || String(sid).trim() === prevId)) {
      entries.forEach(entry => {
        if (!entry.loadedOnce) {
          entry.retryCount = 0
          loadEntry(entry)
        }
      })
    }
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('dsh-tavern-session-changed', onTavernWindowSession)
    window.addEventListener('dsh-tavern-story-mutated', onTavernWindowSession)
    window.addEventListener('dsh-tavern-message-rendered', onTavernWindowSession)
  }
  if (fdGetActiveGameId()) {
    bindGameWatches(fdGetActiveGameId())
  } else if (typeof fdBootstrapActiveGame === 'function') {
    fdBootstrapActiveGame(ui)
  } else {
    fdCall(ui, FD_RPC.status, {}).then(res => {
      const active = res && res.ok && res.data && (res.data.activeGameId || res.data.gameId)
      if (active) fdNoteActiveGameId(String(active))
    })
  }

  function clearMountedKey(entry) {
    if (entry.mountedKey) {
      fdMountedHeaderTurns.delete(entry.mountedKey)
      entry.mountedKey = ''
      fdNotifyHeaderTurns()
    }
  }

  function renderEntry(entry) {
    if (disposed) return
    const { headSlot, panelSlot, record } = entry
    headSlot.textContent = ''
    panelSlot.textContent = ''

    const hasRecordPayload = Boolean(
      record && (record.roll || record.setupRequiredReason || (record.judged && record.judged.shouldRoll === false))
    )
    const pluginActive = fdIsEnabledForGame(watchedGameId || fdGetActiveGameId()) !== false
      && !(record && (record.enabled === false || record.autoCheck === false))
    const awaitingLiveRoll = Boolean(
      pluginActive && entry.streaming && (!hasRecordPayload || (record.streaming !== true && !entry.gotLiveStreamRecord))
    )
    const hasContent = awaitingLiveRoll || hasRecordPayload
    if (!hasContent) {
      clearMountedKey(entry)
      return
    }

    if (awaitingLiveRoll) {
      const pendingBtn = fdEl(doc, 'button', 'fd-floor-pill')
      pendingBtn.type = 'button'
      pendingBtn.setAttribute('data-tone', 'skipped')
      pendingBtn.title = '命运之骰正在读取本轮情境并投掷真骰…'
      const dot = fdEl(doc, 'span', 'fd-floor-dot')
      dot.setAttribute('aria-hidden', 'true')
      pendingBtn.appendChild(dot)
      const pendingIcon = fdEl(doc, 'span', 'fd-floor-pill-icon')
      pendingIcon.setAttribute('aria-hidden', 'true')
      pendingBtn.appendChild(pendingIcon)
      pendingBtn.setAttribute('aria-label', '真骰定难中…')
      pendingBtn.appendChild(fdEl(doc, 'span', 'fd-floor-pill-text', '🎲 真骰定难中…'))
      headSlot.appendChild(pendingBtn)
      return
    }

    const effectiveTurn = fdNumber((record && record.turn) || entry.turn, 0)
    const activeId = fdGetActiveGameId()
    const nextKey = activeId && effectiveTurn ? `${activeId}:${effectiveTurn}` : ''
    if (nextKey !== entry.mountedKey) {
      clearMountedKey(entry)
      if (nextKey) {
        entry.mountedKey = nextKey
        fdMountedHeaderTurns.add(nextKey)
        fdNotifyHeaderTurns()
      }
    }

    const roll = record.roll || null
    const judged = record.judged || null
    const setupReason = record.setupRequiredReason || ''
    const fate = fdNormalizeFate(record.fate)
    const covered = Boolean(roll && roll.hidden && !entry.peeked)
    const isStreaming = Boolean(entry.streaming || record.streaming)

    let tone = 'skipped'
    let pillText = '真骰 · 免检定'
    let tooltip = '点击展开命运之骰本轮详情'

    if (roll) {
      tone = covered ? 'hidden' : fdTierOf(roll.tier)
      if (covered) {
        pillText = `暗骰 · ${roll.check || '感知'} · 点按偷看`
        tooltip = '感知/洞察暗骰（点击揭晓并展开详情）'
      } else {
        const suffix = roll.rerollMeta && roll.rerollMeta.mode === 'push'
          ? ' · 🔥孤注'
          : (roll.rerollMeta && roll.rerollMeta.mode === 'fate'
            ? ' · ✦逆命'
            : (roll.reusedOnRegenerate ? ' · 🔒锁骰' : ''))
        pillText = `🎲 ${roll.check || '检定'} ${fdFormatCompactDice(roll)} · ${roll.tierLabel || ''}${suffix}`
        tooltip = `${roll.rule || '2d6'} ${roll.check || '检定'}（难度：${roll.difficultyLabel || '普通'}）· ✦ 命运点 ${fate.points}/${fate.max}（点击展开详情与重投）`
      }
    } else if (setupReason) {
      tone = 'skipped'
      pillText = '🎲 待配决策模型'
      tooltip = '尚未配置决策模型 API Key（点击查看指引）'
    } else if (judged && judged.shouldRoll === false) {
      tone = 'skipped'
      const prob = Number(judged.needProbability)
      const probPart = judged.damperSync && judged.damperSync.skipped === 'scene-shift'
        ? '场景放行'
        : (Number.isFinite(prob) ? `免检定 ${Math.round(prob * 100)}%` : '免检定')
      pillText = `🎲 ${probPart}`
      tooltip = `${judged.reason || '本轮行动无显著不确定性，免于投骰'}（点击展开详情）`
    }

    const pillBtn = fdEl(doc, 'button', 'fd-floor-pill')
    pillBtn.type = 'button'
    pillBtn.setAttribute('data-tone', tone)
    if (entry.expanded) pillBtn.setAttribute('data-expanded', 'true')
    pillBtn.setAttribute('aria-expanded', entry.expanded ? 'true' : 'false')
    pillBtn.title = tooltip
    const dot = fdEl(doc, 'span', 'fd-floor-dot')
    dot.setAttribute('aria-hidden', 'true')
    const icon = fdEl(doc, 'span', 'fd-floor-pill-icon')
    icon.setAttribute('aria-hidden', 'true')
    const txt = fdEl(doc, 'span', 'fd-floor-pill-text', pillText)
    pillBtn.setAttribute('aria-label', pillText)
    pillBtn.appendChild(dot)
    pillBtn.appendChild(icon)
    pillBtn.appendChild(txt)
    pillBtn.addEventListener('click', e => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
      if (covered && !entry.peeked) {
        entry.peeked = true
        entry.expanded = true
      } else {
        entry.expanded = !entry.expanded
      }
      renderEntry(entry)
    })
    headSlot.appendChild(pillBtn)

    if (!entry.expanded) {
      if (entry.stage3d) {
        entry.stage3d.stop()
        entry.stage3d = null
        entry.stageWrapEl = null
        entry.lastStageRollKey = ''
      }
      return
    }

    const panel = fdEl(doc, 'section', 'fd-root fd-floor-panel')
    panel.setAttribute('data-tone', tone)
    panel.setAttribute('aria-label', '命运之骰本轮裁定详情')

    const pHead = fdEl(doc, 'div', 'fd-floor-panel-head')
    const pTitle = fdEl(
      doc,
      'strong',
      'fd-floor-panel-title',
      roll
        ? `命运之骰裁定 · ${roll.check || '行动'}检定（${roll.tierLabel || '判定'}）`
        : (setupReason ? '命运之骰 · 待配置决策模型' : '命运之骰 · 本轮免检定')
    )
    const pTags = fdEl(doc, 'div', 'fd-floor-panel-tags')
    if (roll) pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', String(roll.rule || '2d6')))
    if (roll && roll.difficultyLabel) pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', `难度：${roll.difficultyLabel}`))
    if (roll && roll.damper) pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', `⛓ ${roll.damper.quotaLabel || '阻尼联动'}`))
    pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', `✦ 命运点 ${fate.points}/${fate.max}`))
    pHead.appendChild(pTitle)
    pHead.appendChild(pTags)
    panel.appendChild(pHead)

    if (roll) {
      const animPref = (record && record.animation) || fdGetCachedAnimationPref()
      // 胶囊里只出静态骰面：智能切换（bounce）下重投专属皮肤不外带，静止展示一律回默认星穹
      const animPrefStr = String(animPref || 'atelier')
      const theme3d = FD3D.resolveTheme(
        animPref,
        animPrefStr === 'bounce' ? 'normal' : FD3D.resolveThemeMode(roll, false),
        false
      )
      if (theme3d && FD3D.canUseWebGL2()) {
        if (!entry.stageWrapEl || !entry.stage3d) {
          const wrap = fdEl(doc, 'div', 'fd-3d-stage is-compact')
          const cv = fdEl(doc, 'canvas', 'fd-3d-canvas')
          cv.setAttribute('aria-hidden', 'true')
          wrap.appendChild(cv)
          entry.stageWrapEl = wrap
          entry.stage3d = new FD3D.SharedBlitDiceStage(cv, {
            audio: FD3D.getAudio(),
            banner: false,
            compact: true
          })
          entry.lastStageRollKey = ''
        }
        panel.appendChild(entry.stageWrapEl)
        const rKey = `${roll.rolledAt || ''}:${roll.total || ''}:${(roll.dice || []).join(',')}`
        const spec = FD3D.rollToStageSpec({ ...roll, hidden: false }, false)
        entry.stage3d.setTheme(theme3d)
        if (spec && entry.lastStageRollKey !== rKey) {
          entry.lastStageRollKey = rKey
          requestAnimationFrame(() => {
            if (!entry.stage3d) return
            entry.stage3d.resize()
            /* 胶囊内只出静态骰面：投骰动画已从胶囊剥离，改由正文中央的 fd-floor-roll-overlay 播 */
            entry.stage3d.setStaticRoll(spec)
          })
        }
      }

      const dl = fdEl(doc, 'dl', 'fd-turn-details')
      const addRow = (label, value) => {
        dl.appendChild(fdEl(doc, 'dt', 'fd-turn-dt', label))
        dl.appendChild(fdEl(doc, 'dd', 'fd-turn-dd', value))
      }
      addRow(
        '骰面算式',
        `${roll.rule || '2d6'} 原骰 [${(roll.dice || []).join(', ')}] = ${roll.total}（目标${roll.rule === 'd100' ? ' ≤ ' : ' ≥ '}${roll.target === undefined ? '—' : roll.target}）`
      )
      const breakdown = roll.modifierBreakdown || {}
      const skillBonus = fdNumber(breakdown.skillBonus ?? roll.skillBonus, 0)
      addRow(
        '能力修正',
        `${roll.check || '检定'} ${skillBonus >= 0 ? '+' : ''}${skillBonus}${roll.modifier ? `（环境/基调修正 ${roll.modifier > 0 ? '+' : ''}${roll.modifier}）` : ''}`
      )
      const damper = roll.damper || roll.damperSync || null
      if (damper) {
        const quota = damper.quota || damper.quotaSync || ''
        addRow(
          '叙事阻尼器',
          `${damper.applied === false ? '未联动' : '双向联动'}${quota ? ` · 配额 ${quota}` : ''}${damper.reason ? ` · ${damper.reason}` : ''}`
        )
      }
      addRow('难度理由', `${roll.difficultyLabel || '判定'} · ${roll.reason || 'AI 综合评定'}`)
      panel.appendChild(dl)

      const rerollState = record.rerollState && typeof record.rerollState === 'object'
        ? record.rerollState
        : { allowed: false, reason: '本轮骰点已锁定' }

      if (isStreaming) {
        panel.appendChild(fdEl(doc, 'div', 'fd-reroll-status is-compact', '⏳ 正文正在按上述真骰结果生成；生成完成后可在此执行逆命重投或孤注一掷'))
      } else if (rerollState.allowed) {
        const bar = fdEl(doc, 'div', 'fd-reroll-bar is-compact')
        const prompt = fdEl(doc, 'div', 'fd-reroll-prompt')
        prompt.appendChild(fdEl(doc, 'span', '', '⚡ 点按即投 · 长按按钮可蓄力聚能（每轮限 1 次）'))
        prompt.appendChild(fdEl(doc, 'span', 'fd-hint', '蓄力移出按钮可取消 · 重投后点「重新生成正文」生效'))
        bar.appendChild(prompt)

        const grid = fdEl(doc, 'div', 'fd-reroll-grid')
        const triggerReroll = (mode, power) => {
          if (entry.rerolling || !effectiveTurn) return
          entry.rerolling = true
          entry.rerollHint = ''
          renderEntry(entry)
          const activeId = fdGetActiveGameId()
          fdCall(ui, FD_RPC.rerollTurn, { gameId: activeId, turn: effectiveTurn, mode })
            .then(res => {
              const data = res && res.ok ? res.data : null
              const nextRoll = data && data.ok !== false && data.roll ? data.roll : null
              if (nextRoll) {
                fdInvalidateTurnCache(activeId, effectiveTurn)
                entry.record = {
                  ...(entry.record || {}),
                  roll: nextRoll,
                  fate: data.fate || fate,
                  rerollState: data.rerollState || { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' }
                }
                fdRememberTurnRecord(activeId, effectiveTurn, entry.record)
                /* 重投同样是「结果一到就投」：中央爆发，胶囊里只更新静态骰面 */
                fdPlayFloorRollAnim(entry.article, entry, nextRoll, entry.record.animation, { power })
                entry.rerollHint = data.mode === 'push'
                  ? '🔥 已孤注一掷并同步配额！现在点下方「重新生成正文」即可按新结果与代价改写剧情'
                  : '✦ 已消耗 1 点命运点逆命重投！现在点下方「重新生成正文」即可按新点数改写剧情'
              } else {
                if (data && data.rerollState) {
                  entry.record = { ...(entry.record || {}), fate: data.fate || fate, rerollState: data.rerollState }
                }
                entry.rerollHint = (data && data.error) || (res && res.error) || '当前条件不允许重投'
              }
            })
            .catch(() => { entry.rerollHint = '手动重投失败' })
            .finally(() => {
              entry.rerolling = false
              renderEntry(entry)
            })
        }

        const buildRerollBtn = (cls, titleText, tagText, subText, tip, mode) => {
          const btn = fdEl(doc, 'button', 'fd-reroll-btn ' + cls)
          btn.type = 'button'
          btn.disabled = entry.rerolling
          btn.title = tip
          const top = fdEl(doc, 'span', 'fd-reroll-btn-top')
          top.appendChild(fdEl(doc, 'span', 'fd-reroll-btn-title', titleText))
          top.appendChild(fdEl(doc, 'span', 'fd-reroll-btn-tag', tagText))
          btn.appendChild(top)
          btn.appendChild(fdEl(doc, 'span', 'fd-reroll-btn-sub', subText))
          fdAttachHoldChargeToDomBtn(btn, {
            mode,
            getStage: () => entry.stage3d,
            onTrigger: (m, power) => triggerReroll(m, power),
            baseLabel: titleText
          })
          return btn
        }

        if (rerollState.canFate) {
          const remPoints = fdNumber(rerollState.fatePoints, fate.points)
          const maxPoints = fdNumber(rerollState.fateMax, fate.max)
          grid.appendChild(buildRerollBtn(
            'is-fate',
            entry.rerolling ? '⏳ 重投中…' : '✦ 逆命重投',
            `-1 点 · 余 ${remPoints}/${maxPoints} ▸`,
            '无恶化与挂彩惩罚 · 长按按钮可聚能蓄力',
            '消耗 1 点命运点稳妥重掷（点按即投；长按按钮激活 3D 星晶旋涡蓄力，移出取消）',
            'fate'
          ))
        }

        grid.appendChild(buildRerollBtn(
          'is-push',
          entry.rerolling ? '⏳ 搏命中…' : '🔥 孤注一掷',
          '0 点 · 成王败寇 ▸',
          '败则恶化大失败 · 长按按钮可熔炉蓄力',
          '不耗命运点强行一搏（点按即投；长按按钮激活 3D 焚天熔炉蓄力，移出取消）',
          'push'
        ))

        bar.appendChild(grid)
        bar.appendChild(fdEl(doc, 'div', 'fd-reroll-foot', entry.rerollHint || '直接点「重新生成正文」将强制复用原骰点；不重投认栽可攒回命运点'))
        panel.appendChild(bar)
      } else if (entry.rerollHint) {
        panel.appendChild(fdEl(doc, 'div', 'fd-reroll-done is-compact', entry.rerollHint))
      } else {
        panel.appendChild(fdEl(doc, 'div', 'fd-reroll-status is-compact', `🔒 ${rerollState.reason || '本轮骰点已锁定'}`))
      }
    } else {
      panel.appendChild(fdEl(
        doc,
        'div',
        'fd-hint',
        setupReason
          ? '请前往酒馆「设置 › 叙事阻尼器」填写决策模型与 API Key，配好后即可自动定难并投掷真骰。'
          : ((judged && judged.reason) || '本轮行动无显著不确定性，免于投骰。')
      ))
    }

    panelSlot.appendChild(panel)
  }

  function loadEntry(entry, opts) {
    if (disposed) return
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer)
      entry.retryTimer = 0
    }
    const reqSeq = (entry.reqSeq || 0) + 1
    entry.reqSeq = reqSeq
    const activeGameId = fdGetActiveGameId()
    if (entry.streaming && fdIsEnabledForGame(activeGameId) === false) {
      entry.loadedOnce = true
      entry.record = null
      renderEntry(entry)
      return
    }
    fdReadTurnBatched(ui, {
      gameId: activeGameId,
      turn: entry.turn,
      streaming: Boolean(entry.streaming),
      force: Boolean(opts && opts.force)
    }).then(res => {
      if (disposed || entry.disposed || entry.reqSeq !== reqSeq) return
      const data = res && res.ok ? res.data : null
      if (data && data.gameId) fdNoteActiveGameId(String(data.gameId))
      const nextRecord = data && typeof data === 'object' ? data : null
      if (nextRecord) {
        fdNoteRuntimeFlags(data.gameId || activeGameId, nextRecord)
        if (nextRecord.streaming === true) entry.gotLiveStreamRecord = true
        entry.justFinishedStream = false
        entry.record = nextRecord
        /* 生成期间首次读到本轮真骰（实时事件可能先到）：同样在正文中央补播一次 */
        if (nextRecord.roll && (nextRecord.streaming === true || entry.streaming)) {
          fdPlayFloorRollAnim(entry.article, entry, nextRecord.roll, nextRecord.animation)
        }
      } else if (entry.streaming && entry.gotLiveStreamRecord && entry.record) {
        /* 保持已收到的实时检定快照，避免轮询间隙闪回「定难中」 */
      } else if (!entry.streaming && entry.justFinishedStream && entry.gotLiveStreamRecord && entry.record && (entry.retryCount || 0) < FD_POST_SETTLE_DELAYS.length) {
        /* 流式刚结束、后台结算正在写入的极短窗口内保留流式检定显示并继续重试确认 */
        entry.record = { ...entry.record, streaming: false }
      } else {
        entry.record = null
      }
      if (!entry.streaming && !(nextRecord && nextRecord.streaming === true)) {
        entry.loadedOnce = true
      }
      renderEntry(entry)
      const pluginActive = fdIsEnabledForGame(activeGameId) !== false
        && !(nextRecord && (nextRecord.enabled === false || nextRecord.autoCheck === false))
      const hasPayload = Boolean(
        entry.record && (entry.record.roll || entry.record.setupRequiredReason || (entry.record.judged && entry.record.judged.shouldRoll === false))
      )
      const awaitingLive = Boolean(
        pluginActive && entry.streaming && (!hasPayload || (entry.record.streaming !== true && !entry.gotLiveStreamRecord))
      )
      const awaitingPostStreamSettle = Boolean(
        pluginActive && !entry.streaming && entry.justFinishedStream && !nextRecord && (entry.retryCount || 0) < FD_POST_SETTLE_DELAYS.length
      )
      if (awaitingLive && (entry.retryCount || 0) < FD_STREAM_POLL_DELAYS.length) {
        const delay = FD_STREAM_POLL_DELAYS[entry.retryCount || 0]
        entry.retryCount = (entry.retryCount || 0) + 1
        entry.retryTimer = setTimeout(() => loadEntry(entry, { force: true }), delay)
      } else if (awaitingPostStreamSettle) {
        const delay = FD_POST_SETTLE_DELAYS[entry.retryCount || 0]
        entry.retryCount = (entry.retryCount || 0) + 1
        entry.retryTimer = setTimeout(() => loadEntry(entry, { force: true }), delay)
      } else if (!entry.streaming) {
        entry.justFinishedStream = false
      }
    })
  }

  const scan = () => {
    rafId = 0
    if (disposed) return
    const urlId = fdDetectUrlGameId()
    if (urlId) fdNoteActiveGameId(urlId)

    const seenArticles = new Set()
    const articles = doc.querySelectorAll('article.dsh-tavern-story-floor')
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]
      if (article.hasAttribute('data-greeting') || article.hasAttribute('data-story-held')) continue
      const head = article.querySelector('.dsh-tavern-story-floor-head')
      if (!head || head.parentNode !== article) continue
      // 胶囊跟着每一轮走：story 视图的操作栏就是每轮对话的尾部，挂在那里；
      // 原生对话或旧宿主没有操作栏时退回楼层顶栏。
      const tailActions = article.querySelector('.dsh-tavern-story-row-actions')
      const host = tailActions && tailActions.parentNode === article ? tailActions : head
      const turn = fdExtractFloorTurn(article)
      const streaming = article.classList.contains('dsh-tavern-story-streaming')
      if (turn <= 0 && !streaming) continue

      seenArticles.add(article)
      let entry = entries.get(article)
      if (!entry || entry.head !== head || entry.host !== host) {
        const inheritedRecord = entry && entry.gotLiveStreamRecord && entry.record ? entry.record : null
        const inheritedLive = Boolean(entry && entry.gotLiveStreamRecord)
        const wasStreaming = Boolean(entry && entry.streaming)
        if (entry) {
          entry.disposed = true
          if (entry.retryTimer) clearTimeout(entry.retryTimer)
          clearMountedKey(entry)
          /* 切宿主（流式 head -> 结算后 tailActions）绝不能中断正在对话中央播放的投骰剧场！ */
          entry.rollOverlay = null
          try { if (entry.headSlot.parentNode) entry.headSlot.parentNode.removeChild(entry.headSlot) } catch {}
          try { if (entry.panelSlot.parentNode) entry.panelSlot.parentNode.removeChild(entry.panelSlot) } catch {}
        }
        const headSlot = fdEl(doc, 'span', 'fd-floor-head-slot')
        const panelSlot = fdEl(doc, 'div', 'fd-floor-panel-slot')
        host.appendChild(headSlot)
        host.appendChild(panelSlot)
        let seedRecord = inheritedRecord
        let seedGotLive = inheritedLive
        if (!seedRecord && streaming && latestLiveEvent && latestLiveEvent.gameId === watchedGameId) {
          const evTurn = fdNumber(latestLiveEvent.data && latestLiveEvent.data.turn, 0)
          if (!evTurn || !turn || evTurn === turn) {
            seedRecord = fdRecordFromLiveEvent(watchedGameId, turn, latestLiveEvent.data, null)
            seedGotLive = Boolean(seedRecord)
          }
        }
        entry = {
          head,
          host,
          article,
          headSlot,
          panelSlot,
          turn,
          streaming,
          record: seedRecord,
          gotLiveStreamRecord: seedGotLive,
          justFinishedStream: Boolean(wasStreaming && !streaming),
          loadedOnce: false,
          expanded: false,
          peeked: false,
          rerolling: false,
          rerollHint: '',
          mountedKey: '',
          retryCount: 0,
          retryTimer: 0,
          reqSeq: 0,
          rollOverlay: null,
          rollAnimKey: '',
          disposed: false
        }
        entries.set(article, entry)
        if (seedRecord) {
          if (seedRecord.roll && streaming) fdPlayFloorRollAnim(article, entry, seedRecord.roll, seedRecord.animation)
          renderEntry(entry)
        }
        loadEntry(entry, { force: Boolean(wasStreaming && !streaming) })
      } else {
        const prevStreaming = entry.streaming
        const changed = entry.turn !== turn || prevStreaming !== streaming
        if (!prevStreaming && streaming) {
          entry.gotLiveStreamRecord = false
          entry.justFinishedStream = false
        } else if (prevStreaming && !streaming) {
          entry.justFinishedStream = true
        }
        entry.turn = turn
        entry.streaming = streaming
        entry.host = host
        if (entry.headSlot.parentNode !== host) host.appendChild(entry.headSlot)
        if (entry.panelSlot.parentNode !== host) host.appendChild(entry.panelSlot)
        else if (host.lastElementChild !== entry.panelSlot) {
          host.appendChild(entry.headSlot)
          host.appendChild(entry.panelSlot)
        }
        if (changed) {
          entry.loadedOnce = false
          entry.retryCount = 0
          loadEntry(entry, { force: Boolean(prevStreaming && !streaming) })
        }
      }
    }

    entries.forEach((entry, article) => {
      if (!seenArticles.has(article)) {
        entry.disposed = true
        if (entry.retryTimer) clearTimeout(entry.retryTimer)
        clearMountedKey(entry)
        entry.rollOverlay = null
        try { if (entry.headSlot.parentNode) entry.headSlot.parentNode.removeChild(entry.headSlot) } catch {}
        try { if (entry.panelSlot.parentNode) entry.panelSlot.parentNode.removeChild(entry.panelSlot) } catch {}
        entries.delete(article)
      }
    })
  }

  const schedule = () => {
    if (rafId || disposed) return
    rafId = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(scan) : setTimeout(scan, 16)
  }

  scan()
  const observer = new MutationObserver(mutations => {
    for (let i = 0; i < mutations.length; i++) {
      const t = mutations[i].target
      if (t && t.closest && (t.closest('.fd-floor-head-slot') || t.closest('.fd-floor-panel-slot') || t.closest('.fd-floor-roll-overlay'))) continue
      schedule()
      break
    }
  })
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-legacy-turn', 'data-chat-turn', 'data-row-key', 'data-story-held', 'class']
  })

  return () => {
    disposed = true
    observer.disconnect()
    offGameSub()
    stopWatches()
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('dsh-tavern-session-changed', onTavernWindowSession)
      window.removeEventListener('dsh-tavern-story-mutated', onTavernWindowSession)
      window.removeEventListener('dsh-tavern-message-rendered', onTavernWindowSession)
    }
    if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
    entries.forEach(entry => {
      entry.disposed = true
      if (entry.retryTimer) clearTimeout(entry.retryTimer)
      clearMountedKey(entry)
      entry.rollOverlay = null
      try { if (entry.headSlot.parentNode) entry.headSlot.parentNode.removeChild(entry.headSlot) } catch {}
      try { if (entry.panelSlot.parentNode) entry.panelSlot.parentNode.removeChild(entry.panelSlot) } catch {}
    })
    Array.from(fdFloorRollOverlays).forEach(ov => fdTeardownFloorRollOverlay(ov))
    fdFloorRollOverlays.clear()
    entries.clear()
  }
}

function StatusDiceSection(props) {
  const { ui, gameId } = props || {}
  const [view, setView] = useState(null)

  useEffect(() => {
    let alive = true
    if (!gameId) {
      setView(null)
      return undefined
    }
    fdNoteActiveGameId(String(gameId))
    fdLoadWorkbench(ui, gameId).then(data => {
      if (alive) setView(data)
    })
    const offSummary = fdWatch(ui, gameId, 'summary', summary => {
      if (!alive || !summary) return
      setView(prev => fdBindStatusSummary(prev || fdEmptyWorkbench(), { summary }))
    })
    const offWorkbench = fdWatch(ui, gameId, 'workbench-sync', payload => {
      if (!alive || !payload) return
      setView(prev => fdMergeWorkbench(prev || fdEmptyWorkbench(), payload))
    })
    return () => {
      alive = false
      offSummary()
      offWorkbench()
    }
  }, [gameId])

  const current = view || fdEmptyWorkbench()
  const enabled = current.settings ? Boolean(current.settings.enabled) : false
  const judgeReady = Boolean(current.judgeStatus && current.judgeStatus.available)
  const fate = fdNormalizeFate(current.fate)
  const stats = current.stats || { total: 0, good: 0, bad: 0 }
  const recent = (current.recent || []).slice(0, 5)

  return h('div', { className: 'fd-root fd-status' },
    h('div', { className: 'fd-badge-row' },
      h(FdBadge, { tone: enabled ? 'ok' : 'off' }, enabled ? '🎲 已开启' : '🎲 已关闭'),
      h(FdBadge, { tone: judgeReady ? 'ok' : 'warn' },
        judgeReady
          ? `⚡ 决策模型 ${current.judgeStatus.provider || '就绪'}`
          : '⚠️ 待配决策模型'),
      h(FdBadge, { tone: current.damper && current.damper.linkage ? 'ok' : 'off' },
        current.damper && current.damper.linkage ? '⛓ 阻尼联动' : '⛓ 阻尼未联动'),
      h(FdBadge, { tone: fate.points > 0 ? 'ok' : 'warn' }, `✦ 命运点 ${fate.points}/${fate.max}`)),
    !enabled
      ? h('div', { className: 'fd-guide-banner is-lite', role: 'note' },
        h('div', { className: 'fd-guide-banner-step' },
          '命运之骰当前已关闭（默认关闭），可在右侧「插件 › 命运之骰 › 检定设置」中开启'))
      : (judgeReady
        ? null
        : h('div', { className: 'fd-guide-banner is-lite', role: 'note' },
          h('div', { className: 'fd-guide-banner-step' },
            '需前往「设置 › 叙事阻尼器」配置决策模型与 API Key 后方可启用 AI 自动检定'))),
    h('div', { className: 'fd-stat-grid' },
      h('div', { className: 'fd-stat-cell' },
        h('span', { className: 'fd-stat-num' }, String(stats.total || 0)),
        h('span', { className: 'fd-stat-lbl' }, '累计检定')),
      h('div', { className: 'fd-stat-cell' },
        h('span', { className: 'fd-stat-num' }, String(stats.good || 0)),
        h('span', { className: 'fd-stat-lbl' }, '大成功+成功')),
      h('div', { className: 'fd-stat-cell' },
        h('span', { className: 'fd-stat-num' }, String(stats.bad || 0)),
        h('span', { className: 'fd-stat-lbl' }, '代价+失手'))),
    recent.length
      ? h('div', { className: 'fd-list' },
        recent.map(item => h('div', { key: `${item.turn}-${item.rolledAt}`, className: 'fd-list-item' },
          h('span', null, `第 ${item.turn} 轮 · ${item.check}`),
          h('span', { className: 'fd-hint' }, item.hidden ? '暗骰' : `${item.total} ${item.tierLabel}`))))
      : h('div', { className: 'fd-hint' }, '本局尚无检定记录，发送一轮行动后开始记录'))
}
