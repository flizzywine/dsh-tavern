/* ------------------------------------------------------------------ *
 * workbench.js —— 右侧栏「插件」卡片区极简工作台外壳（双页签）
 * 注册点：ui.registerPanel({ id: 'fate-dice', title: '命运之骰', render })
 * 架构：.fd-root.fd-workbench → 固定顶栏 .fd-wb-top + 独立纵向滚动区 .fd-wb-scroll
 * ------------------------------------------------------------------ */

function fdToastResult(res, localNote) {
  if (!res) return localNote || '已保存'
  if (res.ok) return '已保存并同步宿主'
  return (localNote || '已保存到本地浏览器') + '（宿主接口不可用：' + String(res.error || '未实现') + '）'
}

function fdLocalRollExpression(expression) {
  const text = String(expression || '').trim().toLowerCase().replace(/\s+/g, '')
  const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(text)
  if (!match) return { ok: false, error: '表达式格式应为 NdM±K，例如 2d6+1 / 1d20 / 1d100' }
  const count = fdClamp(match[1] === '' ? 1 : Number(match[1]), 1, 20)
  const sides = fdClamp(Number(match[2]), 2, 100)
  const bonus = match[3] ? Number(match[3]) : 0
  const dice = []
  let sum = 0
  for (let i = 0; i < count; i += 1) {
    const face = 1 + Math.floor(Math.random() * sides)
    dice.push(face)
    sum += face
  }
  return {
    ok: true,
    result: { expression: `${count}d${sides}${bonus ? (bonus > 0 ? '+' + bonus : bonus) : ''}`, dice, sides, bonus, total: sum + bonus, rolledAt: Date.now(), local: true }
  }
}

/* 自由骰小工具：默认折叠，纯娱乐投掷或挂载为下轮局势/奇遇骰（支持 3D 舞台与长按按钮聚能蓄力！） */
function FreeRollCard(props) {
  const { gameId, notify, ui, animation, pendingEncounter, onEncounterChange } = props || {}
  const [expr, setExpr] = useState('2d6')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [asEncounter, setAsEncounter] = useState(false)
  const stageRef = useRef(null)

  const roll = value => {
    const expression = String(value || expr || '').trim()
    if (!expression) return
    setBusy(true)
    const injectAsEncounter = Boolean(asEncounter && gameId)
    fdFreeRoll(ui, gameId, expression, { injectAsEncounter }).then(res => {
      if (res.ok && res.data && res.data.result) {
        setResult(res.data.result)
        if (injectAsEncounter && typeof onEncounterChange === 'function') onEncounterChange(res.data.result)
        if (injectAsEncounter && notify) notify(`已挂载下轮局势骰：${res.data.result.expression} = ${res.data.result.total}`)
      } else {
        const local = fdLocalRollExpression(expression)
        if (local.ok) {
          setResult(local.result)
          if (notify) notify('宿主未响应，已用本地真随机模拟投掷')
        } else if (notify) notify(local.error)
      }
    }).finally(() => setBusy(false))
  }

  const clearEncounter = () => {
    if (!gameId) return
    fdFreeRoll(ui, gameId, '', { clearEncounter: true }).then(() => {
      if (typeof onEncounterChange === 'function') onEncounterChange(null)
      if (notify) notify('已取消下轮局势骰挂载')
    })
  }

  const holdCharge = useFdHoldCharge({
    mode: 'normal',
    disabled: busy,
    stageRef,
    onTrigger: () => roll()
  })

  const idlePreview = useMemo(() => {
    const m = /^(\d*)d(\d+)/i.exec(String(expr || '').trim())
    const count = m ? fdClamp(m[1] === '' ? 1 : Number(m[1]), 1, 12) : 2
    const sides = m ? fdClamp(Number(m[2]), 2, 100) : 6
    const face = sides === 100 ? 100 : sides
    const dice = Array.from({ length: count }, () => face)
    return { expression: expr || '2d6', dice, sides, total: count * face, rolledAt: 0 }
  }, [expr])

  const previewRoll = result || idlePreview

  return h(FdCollapse, {
    title: '🎲 自由骰 / 局势奇遇骰',
    sub: pendingEncounter ? `已挂载下轮局势：${pendingEncounter.expression}=${pendingEncounter.total}` : '默认折叠 · 支持长按蓄力与下轮局势注入',
    right: h(FdHelp, {
      title: '自由骰与局势奇遇骰',
      text: [
        '支持 ndm 与加减修正量表达式，例如 2d6+1、1d20、3d10-2：前缀为骰子个数，d 后为面数，后面可跟 +N / -N。',
        '点击「投掷」即刻出点；长按「投掷」按钮可激活 3D 引力聚能旋涡蓄力，松手爆发投出（蓄力途中移出按钮可无损取消）。',
        '打开「挂载为下轮局势 / 奇遇骰」后，在赶路、探索或休整轮次投出一骰（高点=顺风奇遇、低点=突发波折或险兆），结果会自动注入下一轮环境上下文，消费后自动清空。'
      ]
    })
  },
  gameId
    ? h(FdRow, {
      plain: true,
      title: '作为下轮局势 / 奇遇骰注入',
      sub: asEncounter ? '投出后自动附入下轮场景上下文（适合赶路/探索）' : '仅娱乐展示，不写入任何对话上下文'
    }, h(FdSwitch, { on: asEncounter, label: '作为下轮局势 / 奇遇骰注入', onChange: setAsEncounter }))
    : null,
  pendingEncounter
    ? h('div', { className: 'fd-profile-delta' },
      `✦ 下轮已挂载局势骰：${pendingEncounter.expression} = ${pendingEncounter.total}（下轮发送行动时自动生效）`,
      h('button', {
        type: 'button',
        className: 'fd-chip',
        style: { marginLeft: '8px' },
        onClick: clearEncounter
      }, '取消挂载'))
    : null,
  h('div', { className: 'fd-btn-row' },
    ['2d6+1', '1d20', '1d100', '2d6', '1d6'].map(item => h(FdChip, {
      key: item,
      onClick: () => { setExpr(item); roll(item) }
    }, item))),
  h('div', { className: 'fd-btn-row' },
    h('div', { style: { flex: '1 1 140px' } }, h(FdText, {
      value: expr,
      placeholder: '骰子表达式，如 2d6+1 / 1d20 / 1d100',
      mono: true,
      onChange: setExpr
    })),
    h('button', {
      type: 'button',
      className: 'fd-btn is-primary fd-hold-btn' + (holdCharge.charging ? ' is-charging' : ''),
      disabled: busy,
      title: '点击即投；长按按钮可激活 3D 旋涡蓄力，移出按钮取消',
      ...holdCharge.bindProps
    }, busy ? '投掷中…' : (holdCharge.charging ? `⚡ 蓄力 ${holdCharge.chargePct}%` : '🎲 投掷 (长按蓄力)'))),
  previewRoll
    ? h(Fd3DDiceStage, {
      roll: previewRoll,
      isFree: true,
      revealed: true,
      animation,
      compact: true,
      animateOnMount: Boolean(result),
      stageRef
    })
    : null,
  result
    ? h('div', { className: 'fd-row' },
      h('div', { className: 'fd-row-main' },
        h('span', { className: 'fd-row-title' }, `${result.expression} = ${result.total}`),
        h('span', { className: 'fd-row-sub' }, `骰面 [${(result.dice || []).join(', ')}]${result.bonus ? (result.bonus > 0 ? ' +' : ' ') + result.bonus : ''}${result.local ? ' · 本地模拟' : ''}`)),
      h('div', { className: 'fd-die-stage' },
        (result.dice || []).slice(0, 3).map((face, idx) => h(DieGlyph, {
          key: idx,
          sides: result.sides || 6,
          label: face,
          tier: 'success'
        }))))
    : h('div', { className: 'fd-hint' }, '仅输入骰子表达式，不涉及剧情行动文本 · 长按「投掷」按钮可体验 3D 蓄力甩投'))
}

/* 决策模型未就绪时的醒目引导横幅：常驻在「检定与能力」页首，可收起详情但保留横幅 */
function DecisionModelGuideBanner(props) {
  const { view, onRecheck, checking } = props || {}
  const [open, setOpen] = useState(true)
  const judge = (view && view.judgeStatus) || { available: false }
  if (judge.available) return null

  const invalidConfig = judge.reason === 'INVALID_CONFIG'
  const title = invalidConfig
    ? '⚠️ 决策模型配置地址无效：需在「叙事阻尼器」中修正后才能使用 AI 检定'
    : '⚠️ 需先在「叙事阻尼器」中设置决策模型才能使用 AI 检定'
  const steps = [
    '1. 打开酒馆左侧/顶栏「设置 › 叙事阻尼器」；',
    '2. 选择决策模型提供方（如 gemini / jev / openai-compatible），填入模型与 API Key 并点击「测试连接」；',
    '3. 配好密钥后命运之骰即可直接复用该模型自动判难与选技能（无需强行打开「启用叙事阻尼器」拦截开关也能独立使用；若开启阻尼器则自动合并为单趟请求并双向联动配额）；',
    '4. 若暂不想配置决策模型，也可前往「检定设置」开启「宿命序列真骰带」实现零小模型开销的多检定。'
  ]

  return h('div', { className: 'fd-guide-banner', role: 'alert' },
    h('div', { className: 'fd-guide-banner-head' },
      h('span', { className: 'fd-guide-banner-title' }, title),
      h('div', { className: 'fd-btn-row', style: { marginLeft: 'auto' } },
        h(FdBtn, {
          small: true,
          primary: true,
          disabled: Boolean(checking),
          onClick: () => (typeof onRecheck === 'function' ? onRecheck() : undefined)
        }, checking ? '检测中…' : '↻ 重新检测模型'),
        h(FdChip, { onClick: () => setOpen(prev => !prev) }, open ? '收起详情' : '展开详情'))),
    open
      ? h('div', { className: 'fd-guide-banner-steps' },
        steps.map((line, idx) => h('p', { key: idx, className: 'fd-guide-banner-step' }, line)))
      : h('div', { className: 'fd-guide-banner-meta' },
        invalidConfig ? '配置地址无效：请检查该提供方的接口地址格式' : '尚未配置决策模型或 API Key'),
    judge.reason && !invalidConfig
      ? h('div', { className: 'fd-guide-banner-meta' }, `诊断信息：${String(judge.reason)}`)
      : null
  )
}

function WorkbenchPanel(props) {
  const { ui, gameId } = props || {}
  const hasGame = Boolean(gameId)
  const [tab, setTab] = useState('checks')
  const [view, setView] = useState(fdEmptyWorkbench)
  const [settingsReady, setSettingsReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)
  /* 最新视图 + 用户是否已手动改过设置：首屏异步加载回包时不得把用户刚拨的开关打回 */
  const viewRef = useRef(view)
  viewRef.current = view
  const touchedRef = useRef(false)
  const persistChain = useRef(null)

  const notify = text => {
    setToast(String(text || ''))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4200)
  }

  useEffect(() => {
    let alive = true
    fdLoadWorkbench(ui, gameId).then(data => {
      if (!alive || !data) return
      /* 首次加载可能与用户的拨动并发：已经手动改过设置时，保留本地视图里的设置项，
         只接受宿主回包的其余字段，避免出现「打开了又自动关闭」的回弹 */
      setView(prev => {
        const base = prev || fdEmptyWorkbench()
        if (!touchedRef.current) return data
        const merged = fdNormalizeSettings({ ...(data.settings || {}), ...(base.settings || {}) })
        viewRef.current = { ...data, settings: merged, damper: { ...(data.damper || base.damper), linkage: merged.damperLinkage } }
        return viewRef.current
      })
      setSettingsReady(true)
    })
    const offSync = fdWatch(ui, gameId, 'workbench-sync', payload => {
      if (!alive || !payload) return
      setView(prev => fdMergeWorkbench(prev || fdEmptyWorkbench(), payload))
    })
    const offSummary = fdWatch(ui, gameId, 'summary', summary => {
      if (!alive || !summary) return
      setView(prev => fdBindStatusSummary(prev || fdEmptyWorkbench(), { summary }))
    })
    return () => {
      alive = false
      offSync()
      offSummary()
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [gameId])

  const patch = patchView => setView(prev => ({ ...(prev || fdEmptyWorkbench()), ...patchView(prev || fdEmptyWorkbench()) }))

  const recheckModel = () => {
    if (checking) return
    setChecking(true)
    fdLoadWorkbench(ui, gameId)
      .then(data => {
        const next = data || fdEmptyWorkbench()
        setView(next)
        const ready = Boolean(next.judgeStatus && next.judgeStatus.available)
        notify(ready ? '⚡ 已连接决策模型' : '请确认已在「设置 › 叙事阻尼器」保存 API Key')
      })
      .catch(() => notify('请确认已在「设置 › 叙事阻尼器」保存 API Key'))
      .finally(() => setChecking(false))
  }

  /* 设置项即时生效：先乐观写视图（开关立刻翻），再串行落盘（本地缓存 + 宿主） */
  const persistSettings = nextSettings => {
    const base = (viewRef.current && viewRef.current.settings) || FD_DEFAULT_SETTINGS
    const merged = fdNormalizeSettings({ ...base, ...(nextSettings || {}) })
    touchedRef.current = true
    viewRef.current = {
      ...(viewRef.current || fdEmptyWorkbench()),
      settings: merged,
      damper: { ...((viewRef.current || {}).damper || {}), linkage: merged.damperLinkage }
    }
    patch(prev => ({ settings: merged, damper: { ...prev.damper, linkage: merged.damperLinkage } }))

    const run = () => fdPersistSettings(ui, merged)
      .then(res => {
        if (!res || res.ok !== true) notify(fdToastResult(res, '改动已保存在本地浏览器'))
        /* 宿主回包带权威设置时以宿主为准（宿主侧可能做过兜底归一化）；
           但如果用户在这趟往返期间又拨了别的开关，视图已是更新的值，不能再拿旧回包打回去 */
        const hostSettings = res && res.ok && res.data && res.data.settings
        const current = viewRef.current && viewRef.current.settings
        if (hostSettings && typeof hostSettings === 'object' && current === merged) {
          const synced = fdNormalizeSettings({ ...merged, ...hostSettings })
          viewRef.current = { ...(viewRef.current || fdEmptyWorkbench()), settings: synced }
          patch(prev => ({ settings: synced }))
        }
        return merged
      })
      .catch(() => {
        notify('改动已保存在本地浏览器')
        return merged
      })

    persistChain.current = (persistChain.current || Promise.resolve()).then(run, run)
    return persistChain.current
  }

  const setAutoCheck = next => {
    patch(prev => ({ autoCheck: next, binding: { ...prev.binding, autoCheck: next } }))
    if (!hasGame) {
      notify('开关已记录：进入任意对话后生效')
      return
    }
    fdPersistBinding(ui, gameId, { autoCheck: next })
      .then(res => notify(fdToastResult(res, '开关已记录，进入对话后由宿主生效')))
  }

  const actions = {
    persistSettings,
    setAutoCheck,
    setRule(rule) {
      patch(() => ({ rule }))
      notify(`检定骰制已切换为 ${fdRuleMeta(rule).label}`)
    },
    /* AI 画像与上下文源：由 tab-checks 在提取/保存后回写视图 */
    setProfile(profile, contextSources) {
      patch(prev => ({
        characterProfile: profile ? fdNormalizeCharacterProfile(profile) : prev.characterProfile,
        contextSources: contextSources ? fdNormalizeContextSources(contextSources) : prev.contextSources
      }))
    },
    setPendingEncounter(encounter) {
      patch(() => ({ pendingEncounter: encounter || null }))
    }
  }

  const tabs = [
    ['checks', '检定与能力'],
    ['settings', '检定设置']
  ]

  const enabled = Boolean(view && view.settings && view.settings.enabled)
  const body = tab === 'settings'
    ? h(SettingsTab, { ui, gameId, hasGame, view, actions, notify })
    : h(ChecksTab, { ui, gameId, hasGame, view, actions, notify, checking, onRecheck: recheckModel })

  return h('div', { className: 'fd-root fd-workbench' },
    h('div', { className: 'fd-wb-top' },
      h('div', { className: 'fd-wb-head' },
        h('h3', { className: 'fd-wb-title' }, '🎲 命运之骰'),
        h('div', { className: 'fd-btn-row fd-wb-toggle' },
          h(FdSwitch, {
            on: enabled,
            disabled: !settingsReady,
            label: '启用命运之骰',
            onChange: next => persistSettings({ enabled: next })
          }),
          h('span', null, settingsReady ? (enabled ? '已开启' : '已关闭') : '读取中…'))),
      h('div', { className: 'fd-tabbar', role: 'tablist' },
        tabs.map(([value, label]) => h('button', {
          key: value,
          type: 'button',
          role: 'tab',
          'aria-selected': tab === value ? 'true' : 'false',
          className: 'fd-tab' + (tab === value ? ' is-active' : ''),
          onClick: () => setTab(value)
        }, label)))),
    h('div', { className: 'fd-wb-scroll' }, body),
    toast ? h('div', { className: 'fd-toast', role: 'status' }, toast) : null)
}
