/* ------------------------------------------------------------------ *
 * panel.js —— 叙事阻尼器工作台面板（侧栏「插件」页）。
 *
 * 视觉与交互与「命运之骰」保持完全一致：
 * 顶栏固定标题 + 总开关，正文为独立滚动卡片区，所有项支持 ? / × 展开左侧强调竖条
 * 多段详细说明（带右上角「收起」与 Esc 关闭）。读写走宿主半（narrative-damper:read
 * / :update / :set-key / :test），引擎照旧在每轮生成前介入。
 * ------------------------------------------------------------------ */

/* 把字符串按 \n 拆段；数组逐项处理；React 节点原样透传 */
function tndHelpLines(text) {
  if (text === undefined || text === null || text === false || text === '') return []
  const raw = Array.isArray(text) ? text : [text]
  const out = []
  raw.forEach(item => {
    if (item === undefined || item === null || item === false || item === '') return
    if (typeof item === 'string' || typeof item === 'number') {
      String(item).split('\n').forEach(part => {
        const line = part.trim()
        if (line) out.push(line)
      })
      return
    }
    out.push(item)
  })
  return out
}

function tndHelpTitle(title) {
  return typeof title === 'string' || typeof title === 'number' ? String(title) : '详细说明'
}

function tndHasHelp(help) {
  return help !== undefined && help !== null && help !== false && help !== ''
}

// 说明展开在滚动区下沿之外时把它滚进来，别让文字藏在看不见的地方。
function tndRevealHelp(open, node) {
  if (!open || !node || typeof node.scrollIntoView !== 'function') return
  node.scrollIntoView({ block: 'nearest' })
}

/* 说明按钮（受控）：圆角 ? / 展开后变 ×，与命运之骰 FdHelpToggle 一致 */
function TndHelpToggle(props) {
  const { title, open, onToggle } = props || {}
  const plain = tndHelpTitle(title)
  const label = '查看说明：' + plain
  return h('button', {
    type: 'button',
    className: 'tnd-help-btn' + (open ? ' is-open' : ''),
    'aria-label': label,
    'aria-expanded': open ? 'true' : 'false',
    title: open ? '收起说明：' + plain : label,
    onClick: event => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault()
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
      if (typeof onToggle === 'function') onToggle(!open)
    },
    onKeyDown: event => {
      if (event && event.key === 'Escape' && open) {
        event.preventDefault()
        if (typeof onToggle === 'function') onToggle(false)
      }
    }
  }, open ? '×' : '?')
}

/* 说明卡片（左侧强调竖条 + 标题 + 右上角「收起」按钮，深浅主题自适应） */
function tndHelpPop(title, help, onClose, ref) {
  const lines = tndHelpLines(help)
  const stop = event => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
  }
  return h('div', { ref, className: 'tnd-help-pop', role: 'note' },
    h('div', { className: 'tnd-help-pop-head' },
      h('span', { className: 'tnd-help-pop-title' }, tndHelpTitle(title)),
      h('button', {
        type: 'button',
        className: 'tnd-help-close',
        'aria-label': '收起说明',
        onClick: event => {
          stop(event)
          if (typeof onClose === 'function') onClose()
        }
      }, '收起')),
    h('div', { className: 'tnd-help-pop-body' },
      lines.length
        ? lines.map((line, idx) => h('p', { key: idx, className: 'tnd-help-line' }, String(line)))
        : h('p', { className: 'tnd-help-line' }, '暂无说明')))
}

function TndBtn(props) {
  const { children, onClick, primary, danger, small, disabled, title, ariaLabel } = props || {}
  const cls = 'tnd-btn' + (primary ? ' is-primary' : '') + (danger ? ' is-danger' : '') + (small ? ' is-sm' : '')
  return h('button', {
    type: 'button',
    className: cls,
    onClick: typeof onClick === 'function' ? onClick : undefined,
    disabled: Boolean(disabled),
    title: title || undefined,
    'aria-label': ariaLabel || undefined
  }, children)
}

function TndSwitch(props) {
  const { on, onChange, label, disabled } = props || {}
  return h('button', {
    type: 'button',
    disabled: Boolean(disabled),
    className: 'tnd-switch' + (on ? ' is-on' : ''),
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    'aria-label': label || '开关',
    onClick: () => (typeof onChange === 'function' ? onChange(!on) : undefined)
  })
}

function TndBadge(props) {
  const { children, tone, role, title } = props || {}
  return h('span', {
    className: 'tnd-badge' + (tone ? ' is-' + tone : ''),
    role: role || undefined,
    title: title || undefined
  }, children)
}

function TndSection(props) {
  const { title, helpTitle, help, note, children } = props || {}
  const withHelp = tndHasHelp(help)
  const [open, setOpen] = useState(false)
  const helpRef = React.useRef(null)
  useEffect(() => { tndRevealHelp(open, helpRef.current) }, [open])
  const plainTitle = helpTitle || title
  return h('section', { className: 'tnd-section', 'aria-label': plainTitle },
    h('div', { className: 'tnd-section-head' },
      h('span', { className: 'tnd-label-row' },
        h('span', { className: 'tnd-section-title' }, title),
        withHelp ? h(TndHelpToggle, { title: plainTitle, open, onToggle: value => setOpen(Boolean(value)) }) : null),
      note ? h('span', { className: 'tnd-section-note' }, note) : null),
    withHelp && open ? tndHelpPop(plainTitle, help, () => setOpen(false), helpRef) : null,
    children)
}

function TndRow(props) {
  const { title, help, sub, children, plain } = props || {}
  const withHelp = tndHasHelp(help)
  const [open, setOpen] = useState(false)
  const helpRef = React.useRef(null)
  useEffect(() => { tndRevealHelp(open, helpRef.current) }, [open])
  return h('div', { className: 'tnd-row' + (plain ? ' is-plain' : '') },
    h('div', { className: 'tnd-row-main' },
      h('div', { className: 'tnd-label-row' },
        h('span', { className: 'tnd-row-title' }, title),
        withHelp ? h(TndHelpToggle, { title, open, onToggle: value => setOpen(Boolean(value)) }) : null),
      withHelp && open ? tndHelpPop(title, help, () => setOpen(false), helpRef) : null,
      sub ? h('span', { className: 'tnd-row-sub' }, sub) : null),
    children ? h('div', { className: 'tnd-row-end' }, children) : null)
}

/* 表单字段容器：与命运之骰 FdField 一致，外层用 div 避免点 ? 误触内部控件 */
function TndFormField(props) {
  const { label, help, hint, children } = props || {}
  const withHelp = tndHasHelp(help)
  const [open, setOpen] = useState(false)
  const helpRef = React.useRef(null)
  useEffect(() => { tndRevealHelp(open, helpRef.current) }, [open])
  return h('div', { className: 'tnd-field' },
    label || withHelp
      ? h('div', { className: 'tnd-label-row' },
        label ? h('span', { className: 'tnd-field-label' }, label) : null,
        withHelp ? h(TndHelpToggle, { title: label, open, onToggle: value => setOpen(Boolean(value)) }) : null)
      : null,
    withHelp && open ? tndHelpPop(label, help, () => setOpen(false), helpRef) : null,
    children,
    hint ? h('span', { className: 'tnd-hint' }, hint) : null)
}

function TndSegmented(props) {
  const { label, value, options, disabled, onChange } = props || {}
  return h('div', { className: 'tnd-segbar', role: 'radiogroup', 'aria-label': label },
    (options || []).map(([optionValue, text]) => {
      const active = value === optionValue
      return h('button', {
        key: optionValue,
        type: 'button',
        role: 'radio',
        'aria-checked': active ? 'true' : 'false',
        className: 'tnd-seg' + (active ? ' is-active' : ''),
        disabled: Boolean(disabled),
        onClick: () => { if (!active && typeof onChange === 'function') onChange(optionValue) }
      }, text)
    }))
}

// 文本 / 数字输入：编辑中留草稿，回车或失焦提交；宿主要求的边界在这里先收紧一次。
function TndField({ kind = 'text', label, value, placeholder, unit, inline, multiline, secret, maxLength, min, max, step, integer, disabled, validate, onCommit }) {
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
  if (multiline) return h('textarea', { ...common, className: 'tnd-textarea', rows: 3, type: undefined, inputMode: undefined })
  const inputCls = 'tnd-input' + (kind === 'number' ? ' is-num' : (inline ? ' is-inline' : ''))
  return h('div', { className: 'tnd-btn-row' },
    h('input', {
      ...common,
      className: inputCls,
      type: kind === 'number' ? 'number' : (secret ? 'password' : 'text'),
      min: kind === 'number' ? min : undefined,
      max: kind === 'number' ? max : undefined,
      step: kind === 'number' ? step : undefined,
      inputMode: kind === 'number' ? (integer ? 'numeric' : 'decimal') : undefined,
      autoComplete: secret ? 'off' : undefined
    }),
    unit ? h('span', { className: 'tnd-unit' }, unit) : null,
    invalid ? h(TndBadge, { tone: 'bad', role: 'alert' }, invalid) : null)
}

/* 详细说明文案（与命运之骰同风格：分点分段，覆盖机制、各档差异与实用建议） */
const TND_HELP = {
  overview: [
    '叙事阻尼器是通用「防口胡与状态惯性」引擎：每轮正文生成前，轻量决策模型会结合当前 MVU 变量（或内置四维惯性状态）与剧情上下文并发评估你的行动意图。',
    '它不会限制你扮演主角的自由度，而是精准识别「替 NPC 强行落笔反应 / 无依据篡改事实 / 调用场外上帝情报（天眼）」，在送给主写作模型前剥离越权结果，并按铺陈筹码分配本轮状态变化配额。',
    '顶栏总开关控制阻尼器是否介入正文；下方「决策模型与连接」配好后，即使总开关关闭，「命运之骰」等插件也能独立复用该决策模型。',
    '本面板所有设置均为全局生效、改动即时保存；每个标题右侧的 ? 均可点开查看详细机制与调优建议。'
  ].join('\n'),

  rulesSection: [
    '这一区控制叙事阻尼器的裁定边界、阻力强度与状态钳制行为：每改一项即刻生效并自动保存，对所有游玩对话统一生效。',
    '每项标题右侧的 ? 可展开详细说明，点「收起」或 × 即可折叠，保持侧栏清爽单列布局。'
  ].join('\n'),

  showTurnStatus: [
    '开启（默认）后，每轮回复楼层顶部会展示一枚紧凑的裁定状态胶囊，直观呈现本轮是否生效、裁定档位（放行 / 微调 / 冻结 / 反弹 / 剥离越权）、铺陈筹码得分与 MVU 数值钳制摘要。',
    '点击楼层胶囊可展开完整诊断详情，包括各维度判定概率、实际生效阈值、变量钳制前后对比，以及未生效时的具体原因（如超时放行、脱敏降级等）。',
    '关闭后仅隐藏楼层界面的状态胶囊，后台裁定与数值钳制仍按配置照常执行，适合偏好纯净阅读界面的玩家。'
  ].join('\n'),

  judgeMode: [
    '决定系统如何界定「你这一轮写下的内容是否越权」，按你的游玩习惯二选一：',
    '角色扮演（默认）：系统认定你只控制自己的角色。你可以自由描写主角的动作、语言、心理与尝试，但如果直接替 NPC 落笔情绪崩溃/立刻屈服、无依据篡改既有事实，或调用角色不可能知道的场外情报（天眼），会被判为越权并剥离结果，交由主模型按当前好感与防线自然演绎。',
    '写作 · 上帝视角：适用于把酒馆当成共同创作或导演模式的玩法。系统允许你替任意角色落笔、自由切镜头与推进多线场景，只有与前文既定事实硬冲突的「吃书」才会被判为设定冲突。'
  ].join('\n'),

  mode: [
    '控制关系推进的阻力大小、破防所需的铺陈筹码门槛，以及单轮状态数值的涨跌上限：',
    '标准拉扯（推荐）：适合绝大多数恋爱、拉扯、NTR 与剧情向游玩。常规推进单轮上限 ±5，铺陈充分达成突破时上限 ±12；判定阈值按下方设定原值执行。',
    '慢热严苛：适合高防线、冷漠/傲娇角色或追求极慢热攻略体验的剧本。常规单轮上限收紧至 ±3、突破上限收紧至 ±8；内部判定阈值会自动再收紧 0.08（最低不低于 0.50），并提高完全放行所需的筹码门槛，防止寥寥数语轻易破防。'
  ].join('\n'),

  desensitizeR18: [
    '开启（默认）后，发往云端决策模型的「临时评估副本」会自动将露骨词汇映射为中性强度等级标签，防止触发云端决策接口的内容安全拦截；发给主写作模型的提示词始终保留 100% 完整原文，不影响正文尺度。',
    '引擎内置三级自动降级阶梯：常规先送「全量脱敏」副本；若遇接口拦截，自动降级为「语义骨架」重送；再次被拒则降级为「纯结构摘要」。三级全部被拒时才静默放行本轮，绝不卡死对话。',
    '仅在使用完全无审查的本地/自建决策模型，且希望决策模型直接阅读原始措辞时才建议关闭。'
  ].join('\n'),

  clampMvuDelta: [
    '开启（默认）后，当人物卡自带 MVU（变量更新）系统时，后台结算层在把变量写回楼层之前，会按本轮裁定配额（反弹 / 冻结 / 微调 / 突破）限制好感、信任、沦陷、防线等关系与情绪指标的单轮跳变幅度。',
    '例如本轮被判为「冻结」或「微调」时，即使主写作模型或结算脚本试图一次性把好感度 +40，也会被自动截断在配额上限内，并在楼层胶囊中记下被钳制的明细；金钱、回合计数等非情绪事务变量不受误伤。',
    '关闭后，阻尼器只通过提示词约束正文描写，不再干预后台 MVU 变量的实际落盘数值。'
  ].join('\n'),

  fallbackStateForPlainCards: [
    '开启（默认）后，当游玩的人物卡没有自带 MVU 变量表时，引擎会自动为该对话维护一套轻量的四维惯性状态锚点（0–100）：亲密信任、心理防线、情绪张力与筹码深度。',
    '这四项数值随每轮裁定平滑演进，作为下一轮决策模型的客观依据，并完整支持对话回退与分叉——退回旧楼层时状态会同步恢复。',
    '若同时开启了「命运之骰」的双向联动，这四维状态也会直接参与检定难度修正（如心理防线过高提高社交难度、亲密信任较高降低阻力）。关闭后，普通卡仅凭文本上下文裁定。'
  ].join('\n'),

  modelSection: [
    '叙事阻尼器依赖轻量决策模型在每轮正文前快速返回校准概率；推荐 Google Gemini Decisions（gemini-decision-1），采用单次 Prefill 零输出 Token 并发架构，响应快、成本极低。',
    'API Key 保存在宿主本机的安全凭据库中，不会明文写进设置文件，也不会回传给浏览器；同时支持填写环境变量名作为引用。',
    '配好此处的决策模型后，即使顶栏「叙事阻尼器」总开关关闭，「命运之骰」插件也可直接复用该连接完成 AI 自动判难与选技能。'
  ].join('\n'),

  provider: [
    '选择决策模型的接口协议；切换服务提供方时，下方的模型名称与默认环境变量名会自动切换为该提供方的推荐默认值。',
    'Google Gemini Decisions / OpenAI Decisions / Typesafe JEV：直连官方默认端点，只需配置对应 API Key 即可使用。',
    'Gemini 兼容接口 / OpenAI 兼容接口：适用于反代中转站、聚合网关或本地部署服务，切换后下方会显示「自定义接口地址」输入框。'
  ].join('\n'),

  baseUrl: [
    '填写反代中转站根地址（HTTPS）或本地服务地址（如 http://127.0.0.1:8000）。',
    '无需手动拼接尾路径：引擎会按当前协议自动补全 /v1beta/decisions 或 /v1/decisions。',
    '输入完成后按回车或点击输入框外（失焦）自动保存；按 Esc 可撤销未提交的草稿。'
  ].join('\n'),

  model: [
    '发往决策接口的模型名称，默认随服务提供方自动填入（如 gemini-decision-1、gpt-6-luna、jev-1.13.0）。',
    '若使用中转站或自定义映射名，可按服务商提供的实际模型 ID 修改；清空并失焦会自动恢复当前提供方的默认模型名称。'
  ].join('\n'),

  apiKey: [
    '支持两种配置方式：① 直接粘贴 API Key 并按回车，系统会加密保存在本机安全凭据库；② 输入已生效的环境变量名（如 GEMINI_API_KEY / OPENAI_API_KEY），系统会自动识别为引用并清除同提供方下已存明文。',
    'API Key 须为不含空格或中文的可见 ASCII 字符；保存后界面只展示配置状态，绝不回显明文。',
    '点击「测试连接」会使用当前面板上的提供方、接口地址、模型与密钥真实发一次探针请求，返回连通状态与往返耗时（ms）。'
  ].join('\n'),

  godmodeThreshold: [
    '触发裁定干预的概率门槛，可调范围 0.50–0.95，默认 0.72；数值越低把关越严格，数值越高越宽松。',
    '角色扮演模式下，当越权代笔、无依据篡改或天眼任一维度概率达到此阈值（且铺陈筹码不足）时触发剥离；写作模式下，当设定吃书概率达到此阈值时判为设定冲突。',
    '注意：开启「慢热严苛」阻尼模式时，引擎会在你填写的阈值基础上自动再下调 0.08（最低 0.50）以进一步收紧把关。'
  ].join('\n'),

  timeoutMs: [
    '单次决策请求允许等待的最长时间，可调范围 300–30000 毫秒，默认 2500 毫秒（2.5 秒）。',
    '超过此时长仍未返回结果时，引擎会自动中止等待并静默放行本轮，绝不阻塞主写作模型生成正文，同时在楼层胶囊中记下「超时放行」。',
    '网络直连较快时保持 2500 毫秒即可；若走较慢的中转线路或常遇超时，可适当调高至 5000–8000 毫秒。'
  ].join('\n'),

  preamble: [
    '可选补充规则（最多 2000 字），每轮会随状态快照一同发给决策模型，一般留空使用内置通用规则即可。',
    '适合写入特殊世界观或全局游玩约定，例如：「本世界存在合法读心术，主角使用读心技能获取他人想法不算天眼」「战斗中允许玩家直接描写杂兵倒下」。',
    '编辑完成后点击输入框外（失焦）自动保存；若开启了 R18 送审脱敏，此处内容发往决策模型前同样会经过脱敏处理。'
  ].join('\n')
}

function TndPanel({ ui }) {
  const [state, setState] = useState({ loading: true, busy: false, config: null, credential: null, error: '', notice: '', test: null, editingKey: false })
  const [overviewHelpOpen, setOverviewHelpOpen] = useState(false)
  const overviewHelpRef = React.useRef(null)
  const testSeq = React.useRef(0)
  const mounted = React.useRef(true)
  const toastTimer = React.useRef(null)

  useEffect(() => { tndRevealHelp(overviewHelpOpen, overviewHelpRef.current) }, [overviewHelpOpen])

  function flashNotice(message) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      if (mounted.current) setState(current => (current.notice === message ? { ...current, notice: '' } : current))
    }, 3200)
  }

  useEffect(() => {
    mounted.current = true
    tndCall(ui, 'narrative-damper:read').then(result => {
      if (!mounted.current) return
      if (!result || !result.config) { setState(current => ({ ...current, loading: false, error: '读不到叙事阻尼器设置' })); return }
      setState(current => ({ ...current, loading: false, config: result.config, credential: result.credential, error: '' }))
    }, error => {
      if (mounted.current) setState(current => ({ ...current, loading: false, error: String((error && error.message) || error) }))
    })
    return () => {
      mounted.current = false
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  async function savePatch(patch) {
    if (state.loading || state.busy || !state.config || !patch || !Object.keys(patch).length) return
    testSeq.current += 1
    setState(current => ({ ...current, busy: true, error: '', notice: '', test: null }))
    try {
      const result = await tndCall(ui, 'narrative-damper:update', { values: patch })
      setState(current => ({ ...current, busy: false, config: (result && result.config) || current.config, credential: (result && result.credential) || current.credential, editingKey: false, notice: '已保存' }))
      flashNotice('已保存')
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
      const msg = value === null ? '已清除密钥' : '密钥已保存'
      setState(current => ({ ...current, busy: false, config: (result && result.config) || current.config, credential: (result && result.credential) || current.credential, editingKey: false, notice: msg }))
      flashNotice(msg)
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
  const enabled = Boolean(config && config.enabled === true)
  const providerMeta = tndProviderMeta(config && config.provider)

  const topHead = h('div', { className: 'tnd-wb-top' },
    h('div', { className: 'tnd-wb-head' },
      h('h3', { className: 'tnd-wb-title' },
        '⚖️ 叙事阻尼器',
        h(TndHelpToggle, { title: '叙事阻尼器', open: overviewHelpOpen, onToggle: value => setOverviewHelpOpen(Boolean(value)) })),
      h('div', { className: 'tnd-btn-row tnd-wb-toggle' },
        h(TndSwitch, {
          on: enabled,
          disabled,
          label: '启用叙事阻尼器',
          onChange: value => { void savePatch({ enabled: value }) }
        }),
        h('span', null, config ? (enabled ? '已开启' : '已关闭') : (state.error ? '读取失败' : '读取中…')))),
    overviewHelpOpen ? tndHelpPop('叙事阻尼器', TND_HELP.overview, () => setOverviewHelpOpen(false), overviewHelpRef) : null)

  if (!config) {
    return h('div', { className: 'tnd-root tnd-workbench', 'aria-busy': state.loading || undefined },
      topHead,
      h('div', { className: 'tnd-wb-scroll' },
        h('div', { className: 'tnd-section' },
          h('p', { className: state.error ? 'tnd-empty is-alert' : 'tnd-empty', role: state.error ? 'alert' : 'status' },
            state.error || '正在读取叙事阻尼器设置…'))))
  }

  const testControls = h(Fragment, null,
    h(TndBtn, {
      small: true,
      primary: true,
      disabled: disabled || Boolean(state.test && state.test.running),
      onClick: runTest
    }, state.test && state.test.running ? '测试中…' : '测试连接'),
    state.test && !state.test.running
      ? h(TndBadge, {
        tone: state.test.ok ? 'ok' : 'bad',
        role: state.test.ok ? 'status' : 'alert'
      }, state.test.ok
        ? '✓ 连接正常' + (Number.isFinite(state.test.latencyMs) ? ' · ' + Math.round(state.test.latencyMs) + ' ms' : '')
        : '✕ ' + ((state.test.error && state.test.error.message) || '连接失败'))
      : null)

  const keyRow = state.credential && state.credential.configured === true && !state.editingKey
    ? h('div', { className: 'tnd-btn-row' },
      h(TndBadge, { tone: 'ok' }, tndCredentialText(state.credential)),
      h(TndBtn, { small: true, disabled, onClick: () => setState(current => ({ ...current, editingKey: true })) }, '更换'),
      state.credential.source === 'stored'
        ? h(TndBtn, { small: true, danger: true, disabled, onClick: () => { void saveKey(null) } }, '清除')
        : null,
      testControls)
    : h('div', { className: 'tnd-field' },
      h(TndField, {
        kind: 'text', secret: true, inline: true, label: 'API Key', value: '', disabled, maxLength: 4096,
        placeholder: '粘贴 API Key 或环境变量名（回车保存）',
        validate: tndKeyError,
        onCommit: value => { void saveKey(value) }
      }),
      h('div', { className: 'tnd-btn-row' },
        state.editingKey
          ? h(TndBtn, { small: true, disabled, onClick: () => setState(current => ({ ...current, editingKey: false })) }, '取消')
          : null,
        testControls))

  const toast = state.error
    ? h('div', { className: 'tnd-toast is-alert', role: 'alert' }, '⚠ ' + state.error)
    : state.notice
      ? h('div', { className: 'tnd-toast', role: 'status' }, state.notice)
      : null

  return h('div', { className: 'tnd-root tnd-workbench', 'aria-busy': state.loading || state.busy || undefined },
    topHead,
    h('div', { className: 'tnd-wb-scroll' },
      h(TndSection, {
        title: '⚙️ 裁定与惯性设置',
        helpTitle: '裁定与惯性设置',
        note: '改动即时生效 · 自动保存',
        help: TND_HELP.rulesSection
      },
        h(TndRow, {
          plain: true,
          title: '在对话楼层显示裁定结果',
          sub: '默认开启：在每轮回复顶部展示状态胶囊与钳制摘要',
          help: TND_HELP.showTurnStatus
        },
          h(TndSwitch, {
            on: config.showTurnStatus !== false,
            disabled,
            label: '在对话楼层显示裁定结果',
            onChange: value => { void savePatch({ showTurnStatus: value }) }
          })),

        h(TndFormField, {
          label: '判定模式',
          help: TND_HELP.judgeMode,
          hint: (config.judgeMode || 'roleplay') === 'author'
            ? '当前：可为任意角色落笔与切镜头，仅拦截与既定设定矛盾的吃书'
            : '当前：你只控制主角，替 NPC 落笔反应或调用场外情报会被剥离'
        },
          h(TndSegmented, {
            label: '判定模式',
            disabled,
            value: config.judgeMode || 'roleplay',
            options: [['roleplay', '角色扮演'], ['author', '写作 · 上帝视角']],
            onChange: value => { void savePatch({ judgeMode: value }) }
          })),

        h(TndFormField, {
          label: '阻尼模式',
          help: TND_HELP.mode,
          hint: (config.mode || 'balanced') === 'strict'
            ? '当前：慢热严苛（常规 ±3 / 突破 ±8，内部判定阈值自动再收紧 0.08）'
            : '当前：标准拉扯（常规 ±5 / 突破 ±12，适合大多数恋爱与剧情向游玩）'
        },
          h(TndSegmented, {
            label: '阻尼模式',
            disabled,
            value: config.mode || 'balanced',
            options: [['balanced', '标准拉扯（推荐）'], ['strict', '慢热严苛']],
            onChange: value => { void savePatch({ mode: value }) }
          })),

        h(TndRow, {
          plain: true,
          title: 'R18 送审语义分级脱敏',
          sub: '默认开启：仅对决策副本三级脱敏，主写作提示词保留原文',
          help: TND_HELP.desensitizeR18
        },
          h(TndSwitch, {
            on: config.desensitizeR18 !== false,
            disabled,
            label: 'R18 送审语义分级脱敏',
            onChange: value => { void savePatch({ desensitizeR18: value }) }
          })),

        h(TndRow, {
          plain: true,
          title: '后台 MVU 数值涨跌钳制',
          sub: '默认开启：结算落盘前按配额限制好感/防线单轮跳变',
          help: TND_HELP.clampMvuDelta
        },
          h(TndSwitch, {
            on: config.clampMvuDelta !== false,
            disabled,
            label: '后台 MVU 数值涨跌钳制',
            onChange: value => { void savePatch({ clampMvuDelta: value }) }
          })),

        h(TndRow, {
          plain: true,
          title: '无 MVU 卡自动维护四维状态',
          sub: '默认开启：普通卡自动追踪信任 / 防线 / 张力 / 筹码，支持回退',
          help: TND_HELP.fallbackStateForPlainCards
        },
          h(TndSwitch, {
            on: config.fallbackStateForPlainCards !== false,
            disabled,
            label: '无 MVU 卡自动维护四维状态',
            onChange: value => { void savePatch({ fallbackStateForPlainCards: value }) }
          }))),

      h(TndSection, {
        title: '🔌 决策模型与连接',
        helpTitle: '决策模型与连接',
        note: '密钥仅存本机安全凭据库',
        help: TND_HELP.modelSection
      },
        h(TndFormField, {
          label: '决策服务提供方',
          help: TND_HELP.provider
        },
          h('select', {
            className: 'tnd-select',
            'aria-label': '决策服务提供方',
            disabled,
            value: config.provider || 'gemini',
            onChange: event => changeProvider(event.target.value)
          }, TND_PROVIDERS.map(item => h('option', { key: item.value, value: item.value }, item.label)))),

        providerMeta.customUrl
          ? h(TndFormField, {
            label: '自定义接口地址',
            help: TND_HELP.baseUrl
          },
            h(TndField, {
              kind: 'text', label: '自定义接口地址', disabled, maxLength: 512,
              value: config.baseUrl || '', placeholder: 'https://example.com',
              onCommit: value => { void savePatch({ baseUrl: value }) }
            }))
          : null,

        h(TndFormField, {
          label: '决策模型名称',
          help: TND_HELP.model
        },
          h(TndField, {
            kind: 'text', label: '决策模型名称', disabled, maxLength: 160,
            value: config.model || providerMeta.defaultModel, placeholder: providerMeta.defaultModel,
            onCommit: value => { void savePatch({ model: value || providerMeta.defaultModel }) }
          })),

        h(TndFormField, {
          label: 'API Key',
          help: TND_HELP.apiKey
        }, keyRow),

        h(TndFormField, {
          label: '判定阈值',
          help: TND_HELP.godmodeThreshold,
          hint: '范围 0.50–0.95，越低越严格，默认 0.72'
        },
          h(TndField, {
            kind: 'number', label: '判定阈值', disabled, min: 0.5, max: 0.95, step: 0.01,
            value: config.godmodeThreshold ?? 0.72,
            onCommit: value => { void savePatch({ godmodeThreshold: tndThreshold(value) }) }
          })),

        h(TndFormField, {
          label: '请求超时上限',
          help: TND_HELP.timeoutMs,
          hint: '范围 300–30000 毫秒，超时静默放行，不阻塞正文'
        },
          h(TndField, {
            kind: 'number', label: '请求超时上限', disabled, integer: true, min: 300, max: 30000, step: 100, unit: '毫秒',
            value: config.timeoutMs ?? 2500,
            onCommit: value => { void savePatch({ timeoutMs: tndTimeout(value) }) }
          })),

        h(TndFormField, {
          label: '附加裁判准则',
          help: TND_HELP.preamble
        },
          h(TndField, {
            kind: 'text', label: '附加裁判准则', multiline: true, disabled, maxLength: 2000,
            value: config.preamble || '', placeholder: '留空使用内置通用规则',
            onCommit: value => { void savePatch({ preamble: value }) }
          }))),

      h('div', { className: 'tnd-hint' }, '以上改动即时生效并自动保存，无需手动提交；面板重新打开或切换对话都会保留。')),
    toast)
}
