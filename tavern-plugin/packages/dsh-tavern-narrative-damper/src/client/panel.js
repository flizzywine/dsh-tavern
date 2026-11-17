/* ------------------------------------------------------------------ *
 * panel.js —— 叙事阻尼器面板（侧栏「插件」页）。
 *
 * 这一页原来在「设置 › 叙事阻尼器」：字段、默认值、提示文案都照原样搬过来，只是宿主设置里
 * 不再有这一页。读写走插件自己的宿主半（narrative-damper:read / :update / :set-key / :test），
 * 宿主的引擎照旧在每轮生成前介入。
 * ------------------------------------------------------------------ */

function TndHelp({ label, text }) {
  if (!text) return null
  const h = React.createElement
  return h('span', { className: 'tnd-help', role: 'img', tabIndex: 0, title: text, 'aria-label': label + '说明' }, '?')
}

function TndRow({ title, help, helpLabel, note, children }) {
  const h = React.createElement
  return h('div', { className: 'dsh-tavern-settings-row' },
    h('span', { className: 'dsh-tavern-settings-copy' },
      h('span', { className: 'dsh-tavern-settings-title' }, title, h(TndHelp, { label: helpLabel || title, text: help }))),
    h('span', { className: 'dsh-tavern-settings-control' },
      note ? h('span', { className: 'tnd-notice', role: 'status' }, note) : null,
      children))
}

function TndGroup({ title, help, notice, children }) {
  const h = React.createElement
  return h('section', { className: 'dsh-tavern-gs-group', 'aria-label': title },
    h('header', { className: 'dsh-tavern-gs-head' },
      h('h2', null, title),
      h(TndHelp, { label: title, text: help }),
      notice),
    h('div', { className: 'dsh-tavern-gs-card' }, children))
}

// 文本 / 数字输入：编辑中留草稿，回车或失焦提交；宿主要求的边界在这里先收紧一次。
function TndField({ kind = 'text', label, value, placeholder, unit, wide, multiline, secret, maxLength, min, max, step, integer, disabled, validate, onCommit }) {
  const h = React.createElement
  const [draft, setDraft] = useState(value === undefined || value === null ? '' : String(value))
  const [invalid, setInvalid] = useState('')
  useEffect(() => { setDraft(value === undefined || value === null ? '' : String(value)); setInvalid('') }, [value])
  function commit() {
    const raw = String(draft ?? '').trim()
    if (typeof validate === 'function') {
      const message = validate(raw)
      if (message) { setInvalid(message); return }
    }
    let next = raw
    if (kind === 'number') {
      const num = Number(raw)
      if (!Number.isFinite(num)) { setInvalid('请填写数字'); return }
      const lower = min === undefined ? -Infinity : min
      const upper = max === undefined ? Infinity : max
      const rounded = integer ? Math.round(num) : Math.round(num * 100) / 100
      next = Math.min(upper, Math.max(lower, rounded))
    }
    setInvalid('')
    // 没改就不发补丁：失焦不该在「已保存」里刷一条空改动。
    if (kind === 'number') { if (Number(next) !== Number(value)) onCommit(next) }
    else if (raw !== String(value ?? '')) onCommit(raw)
  }
  const common = {
    'aria-label': label,
    disabled: Boolean(disabled),
    value: draft,
    placeholder,
    maxLength: multiline ? 2000 : maxLength,
    onChange: event => { setDraft(event.target.value); if (invalid) setInvalid('') },
    onBlur: commit,
    onKeyDown: event => {
      if (kind === 'number' && event.key === 'Enter') { event.preventDefault(); commit() }
      else if (!multiline && event.key === 'Enter') { event.preventDefault(); commit() }
      if (event.key === 'Escape') { setDraft(value === undefined || value === null ? '' : String(value)); setInvalid(''); event.currentTarget.blur() }
    }
  }
  if (multiline) return h('textarea', { ...common, className: 'tnd-area', rows: 3, type: undefined, inputMode: undefined })
  return h('span', { className: 'tnd-actions' },
    h('input', {
      ...common,
      className: 'tnd-input' + (wide ? ' tnd-wide' : ''),
      type: kind === 'number' ? 'number' : (secret ? 'password' : 'text'),
      min: kind === 'number' ? min : undefined,
      max: kind === 'number' ? max : undefined,
      step: kind === 'number' ? step : undefined,
      inputMode: kind === 'number' ? (integer ? 'numeric' : 'decimal') : undefined,
      autoComplete: secret ? 'off' : undefined
    }),
    unit ? h('span', { className: 'tnd-unit' }, unit) : null,
    invalid ? h('span', { className: 'tnd-badge is-error', role: 'alert' }, invalid) : null)
}

function TndPanel({ ui }) {
  const h = React.createElement
  const components = ui.components || {}
  const Switch = components.Switch
  const Segmented = components.Segmented
  const [state, setState] = useState({ loading: true, busy: false, config: null, credential: null, error: '', notice: '', test: null, editingKey: false })
  const testSeq = React.useRef(0)
  const mounted = React.useRef(true)

  useEffect(() => {
    mounted.current = true
    tndCall(ui, 'narrative-damper:read').then(result => {
      if (!mounted.current) return
      if (!result || !result.config) { setState(current => ({ ...current, loading: false, error: '读不到叙事阻尼器设置' })); return }
      setState(current => ({ ...current, loading: false, config: result.config, credential: result.credential, error: '' }))
    }, error => {
      if (mounted.current) setState(current => ({ ...current, loading: false, error: String((error && error.message) || error) }))
    })
    return () => { mounted.current = false }
  }, [])

  async function savePatch(patch) {
    if (state.loading || state.busy || !state.config || !patch || !Object.keys(patch).length) return
    testSeq.current += 1
    setState(current => ({ ...current, busy: true, error: '', notice: '', test: null }))
    try {
      const result = await tndCall(ui, 'narrative-damper:update', { values: patch })
      setState(current => ({ ...current, busy: false, config: (result && result.config) || current.config, credential: (result && result.credential) || current.credential, editingKey: false, notice: '已保存' }))
      // 在对话楼层显示裁定结果 这一项就在这批开关里：让楼层的显示偏好立刻重读。
      tndNotifySettingsChanged()
    } catch (error) {
      setState(current => ({ ...current, busy: false, error: String((error && error.message) || error) }))
    }
  }

  function changeProvider(provider) {
    void savePatch(tndProviderPatch(state.config, provider))
  }

  async function saveKey(value) {
    if (!state.config || state.busy) return
    testSeq.current += 1
    setState(current => ({ ...current, busy: true, error: '', notice: '', test: null }))
    try {
      const result = await tndCall(ui, 'narrative-damper:set-key', { provider: state.config.provider, value })
      setState(current => ({ ...current, busy: false, config: (result && result.config) || current.config, credential: (result && result.credential) || current.credential, editingKey: false, notice: value === null ? '已清除密钥' : '密钥已保存' }))
      tndNotifySettingsChanged()
    } catch (error) {
      setState(current => ({ ...current, busy: false, error: String((error && error.message) || error) }))
    }
  }

  async function runTest() {
    if (!state.config || state.busy || (state.test && state.test.running)) return
    const seq = ++testSeq.current
    setState(current => ({ ...current, test: { running: true }, error: '' }))
    try {
      const result = await tndCall(ui, 'narrative-damper:test', { config: state.config })
      if (seq === testSeq.current) setState(current => ({ ...current, test: result || { ok: false, error: { message: '没有返回结果' } } }))
    } catch (error) {
      if (seq === testSeq.current) setState(current => ({ ...current, test: { ok: false, latencyMs: 0, error: { message: String((error && error.message) || error) } } }))
    }
  }

  const config = state.config
  const disabled = state.loading || state.busy || !config
  const providerMeta = tndProviderMeta(config && config.provider)
  const notice = state.error
    ? h('span', { className: 'dsh-tavern-gs-notice is-alert', role: 'alert' }, '⚠ ' + state.error)
    : state.notice ? h('span', { className: 'dsh-tavern-gs-notice', role: 'status' }, state.notice) : null

  if (!config) {
    return h('div', { className: 'tnd-panel dsh-tavern-global-settings', 'aria-busy': state.loading || undefined },
      h('p', { className: state.error ? 'tnd-notice is-alert' : 'tnd-loading', role: state.error ? 'alert' : 'status' },
        state.error || '正在读取叙事阻尼器设置…'))
  }

  const testControls = h('span', { className: 'tnd-actions' },
    h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: disabled || Boolean(state.test && state.test.running), onClick: runTest },
      state.test && state.test.running ? '测试中…' : '测试连接'),
    state.test && !state.test.running
      ? h('span', { className: 'tnd-badge ' + (state.test.ok ? 'is-ok' : 'is-error'), role: state.test.ok ? 'status' : 'alert' },
        state.test.ok
          ? '✓ 连接正常' + (Number.isFinite(state.test.latencyMs) ? ' · ' + Math.round(state.test.latencyMs) + ' ms' : '')
          : '✕ ' + ((state.test.error && state.test.error.message) || '连接失败'))
      : null)

  const keyRow = state.credential && state.credential.configured === true && !state.editingKey
    ? h('span', { className: 'tnd-actions' },
      h('span', { className: 'tnd-credential' }, tndCredentialText(state.credential)),
      h('button', { type: 'button', className: 'dsh-tavern-btn', disabled, onClick: () => setState(current => ({ ...current, editingKey: true })) }, '更换'),
      state.credential.source === 'stored'
        ? h('button', { type: 'button', className: 'dsh-tavern-btn', disabled, onClick: () => { void saveKey(null) } }, '清除')
        : null,
      testControls)
    : h('span', { className: 'tnd-actions' },
      h(TndField, {
        kind: 'text', secret: true, label: 'API Key', value: '', disabled, maxLength: 4096,
        placeholder: '粘贴 API Key 或环境变量名（回车保存）',
        validate: tndKeyError,
        onCommit: value => { void saveKey(value) }
      }),
      state.editingKey
        ? h('button', { type: 'button', className: 'dsh-tavern-btn', disabled, onClick: () => setState(current => ({ ...current, editingKey: false })) }, '取消')
        : null,
      testControls)

  return h('div', { className: 'tnd-panel dsh-tavern-global-settings', 'aria-busy': state.loading || state.busy || undefined },
    h(TndGroup, {
      title: '叙事阻尼器',
      help: '通用防口胡与状态惯性引擎：每轮正文生成前，轻量决策模型结合 MVU 状态并发评估玩家意图，保留角色言行自由度的同时剥离越权结果，并在后台结算层钳制单轮数值突变。',
      notice
    },
      h(TndRow, { title: '启用叙事阻尼器', help: '开启后对所有游玩对话生效，下一轮消息立即介入裁定。' },
        h(Switch, { label: '启用叙事阻尼器', disabled, checked: config.enabled === true, onChange: value => { void savePatch({ enabled: value }) } })),
      h(TndRow, { title: '在对话楼层显示裁定结果', help: '在每轮回复楼层顶部展示生效状态、裁定档位、筹码得分与数值钳制摘要；点击状态胶囊可展开完整指标与未生效原因。' },
        h(Switch, { label: '在对话楼层显示裁定结果', disabled, checked: config.showTurnStatus !== false, onChange: value => { void savePatch({ showTurnStatus: value }) } })),
      h(TndRow, { title: '判定模式', help: '角色扮演：系统认定你只控制自己的角色，替 NPC 落笔反应或调用场外情报会被判越权剥离。写作（上帝）：不存在你的角色，可为任意角色落笔、自由切镜头与场景，只有与既有设定矛盾的吃书才会被判为设定冲突。' },
        h(Segmented, {
          label: '判定模式', disabled, value: config.judgeMode || 'roleplay',
          options: [['roleplay', '角色扮演'], ['author', '写作 · 上帝视角']],
          onChange: value => { void savePatch({ judgeMode: value }) }
        })),
      h(TndRow, { title: '阻尼模式', help: '标准拉扯适合大多数恋爱、NTR 与剧情向游玩（常规变动 ±5 / 突破 ±12）；慢热严苛提高破防筹码要求并收紧单轮状态上限（常规 ±3 / 突破 ±8）。' },
        h(Segmented, {
          label: '阻尼模式', disabled, value: config.mode || 'balanced',
          options: [['balanced', '标准拉扯（推荐）'], ['strict', '慢热严苛']],
          onChange: value => { void savePatch({ mode: value }) }
        })),
      h(TndRow, { title: 'R18 送审语义分级脱敏', help: '只对发往决策模型的临时评估副本把露骨词汇映射为强度等级标签，防止云端决策接口拦截；发给主写作模型的提示词保留完整原文。送审副本按露骨程度自动降级：全量脱敏 → 骨架 → 结构摘要，三级都被拒才放行本轮。' },
        h(Switch, { label: 'R18 送审语义分级脱敏', disabled, checked: config.desensitizeR18 !== false, onChange: value => { void savePatch({ desensitizeR18: value }) } })),
      h(TndRow, { title: '后台 MVU 数值涨跌钳制', help: '按本轮决策配额（反弹 / 冻结 / 微调 / 突破）在后台 MVU 结算落盘前限制好感、信任、沦陷、防线等指标的单轮跳变幅度。' },
        h(Switch, { label: '后台 MVU 数值涨跌钳制', disabled, checked: config.clampMvuDelta !== false, onChange: value => { void savePatch({ clampMvuDelta: value }) } })),
      h(TndRow, { title: '无 MVU 卡自动维护四维状态', help: '人物卡没有自带 MVU 变量表时，随楼层自动维护亲密信任、心理防线、情绪张力与筹码深度四项惯性锚点，支持回退与分叉。' },
        h(Switch, { label: '无 MVU 卡自动维护四维状态', disabled, checked: config.fallbackStateForPlainCards !== false, onChange: value => { void savePatch({ fallbackStateForPlainCards: value }) } }))),
    h(TndGroup, {
      title: '决策模型与连接',
      help: '推荐 Google Gemini Decisions（gemini-decision-1，单次 Prefill 零输出 Token 并发返回校准概率）。API Key 保存在宿主安全凭据库，不会明文写进设置文件，也不会回传到浏览器。'
    },
      h(TndRow, { title: '决策服务提供方' },
        h('select', {
          className: 'tnd-select', 'aria-label': '决策服务提供方', disabled,
          value: config.provider || 'gemini',
          onChange: event => changeProvider(event.target.value)
        }, TND_PROVIDERS.map(item => h('option', { key: item.value, value: item.value }, item.label)))),
      providerMeta.customUrl
        ? h(TndRow, { title: '自定义接口地址', help: '填写 HTTPS 反代根地址或本地 127.0.0.1 地址（会自动拼接 /v1beta/decisions 或 /v1/decisions）。' },
          h(TndField, {
            kind: 'text', label: '自定义接口地址', wide: true, disabled, maxLength: 512,
            value: config.baseUrl || '', placeholder: 'https://example.com',
            onCommit: value => { void savePatch({ baseUrl: value }) }
          }))
        : null,
      h(TndRow, { title: '决策模型名称' },
        h(TndField, {
          kind: 'text', label: '决策模型名称', disabled, maxLength: 160,
          value: config.model || providerMeta.defaultModel, placeholder: providerMeta.defaultModel,
          onCommit: value => { void savePatch({ model: value || providerMeta.defaultModel }) }
        })),
      h(TndRow, { title: 'API Key', help: '直接粘贴密钥保存到本机安全凭据库，或输入已生效的环境变量名（如 GEMINI_API_KEY）作为引用。' }, keyRow),
      h(TndRow, { title: '判定阈值', help: '概率达到此阈值时触发裁定：角色扮演模式下命中越权代笔、无依据篡改或天眼即剥离；写作模式下命中设定吃书即判为设定冲突（0.50–0.95，越低越严格，默认 0.72）。' },
        h(TndField, {
          kind: 'number', label: '判定阈值', disabled, min: 0.5, max: 0.95, step: 0.01,
          value: config.godmodeThreshold ?? 0.72,
          onCommit: value => { void savePatch({ godmodeThreshold: tndThreshold(value) }) }
        })),
      h(TndRow, { title: '请求超时上限', help: '决策请求超过此时长仍未返回时自动静默放行，不阻塞本轮正文生成。' },
        h(TndField, {
          kind: 'number', label: '请求超时上限', disabled, integer: true, min: 300, max: 30000, step: 100, unit: '毫秒',
          value: config.timeoutMs ?? 2500,
          onCommit: value => { void savePatch({ timeoutMs: tndTimeout(value) }) }
        })),
      h(TndRow, { title: '附加裁判准则', help: '可选：随状态快照一同发给决策模型的补充说明（如特殊世界观法则），一般留空即可。' },
        h(TndField, {
          kind: 'text', label: '附加裁判准则', multiline: true, disabled, maxLength: 2000,
          value: config.preamble || '', placeholder: '留空使用内置通用规则',
          onCommit: value => { void savePatch({ preamble: value }) }
        }))))
}
