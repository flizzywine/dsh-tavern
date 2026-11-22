/* ------------------------------------------------------------------ *
 * uikit.js —— 基础组件（按钮/开关/输入/卡片/折叠/说明气泡），全部走 CSS 类
 * 仅依赖 React.createElement；帮助气泡只用 useState 记录展开态，不用 useCallback 等非必需 hook
 * ------------------------------------------------------------------ */

function FdBtn(props) {
  const { children, onClick, primary, danger, small, disabled, title, ariaLabel } = props || {}
  const cls = 'fd-btn' + (primary ? ' is-primary' : '') + (danger ? ' is-danger' : '') + (small ? ' is-sm' : '')
  return h('button', {
    type: 'button',
    className: cls,
    onClick: typeof onClick === 'function' ? onClick : undefined,
    disabled: Boolean(disabled),
    title: title || undefined,
    'aria-label': ariaLabel || undefined
  }, children)
}

function FdChip(props) {
  const { children, onClick, active, title } = props || {}
  return h('button', {
    type: 'button',
    className: 'fd-chip' + (active ? ' is-active' : ''),
    onClick: typeof onClick === 'function' ? onClick : undefined,
    title: title || undefined,
    'aria-pressed': active ? 'true' : 'false'
  }, children)
}

function FdSwitch(props) {
  const { on, onChange, label, disabled } = props || {}
  return h('button', {
    type: 'button',
    disabled,
    className: 'fd-switch' + (on ? ' is-on' : ''),
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    'aria-label': label || '开关',
    onClick: () => (typeof onChange === 'function' ? onChange(!on) : undefined)
  })
}

/* 把字符串按 \n 拆段；数组逐项处理；React 节点原样透传 */
function fdHelpLines(text) {
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

function fdHelpTitle(title) {
  return typeof title === 'string' || typeof title === 'number' ? String(title) : '详细说明'
}

function fdHasHelp(help) {
  return help !== undefined && help !== null && help !== false && help !== ''
}

/* 说明按钮（受控）：圆角 ? / 展开后变 ×，统一 fd-help-btn 类名与外层拦截 */
function FdHelpToggle(props) {
  const { title, open, onToggle } = props || {}
  const plain = fdHelpTitle(title)
  const label = '查看说明：' + plain
  return h('button', {
    type: 'button',
    className: 'fd-help-btn' + (open ? ' is-open' : ''),
    'aria-label': label,
    'aria-expanded': open ? 'true' : 'false',
    title: label,
    onClick: e => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault()
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
      if (typeof onToggle === 'function') onToggle(!open)
    }
  }, open ? '×' : '?')
}

/* 说明卡片（无状态）：左侧强调竖条 + 右上角收起，深浅主题自适应 */
function fdHelpPop(title, help, children, onClose) {
  const lines = fdHelpLines(help)
  const hasChildren = children !== undefined && children !== null && children !== false
  const list = hasChildren ? [children] : lines
  const stop = e => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault()
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
  }
  return h('div', { className: 'fd-help-pop', role: 'note' },
    h('div', { className: 'fd-help-pop-head' },
      h('span', { className: 'fd-help-pop-title' }, fdHelpTitle(title)),
      h('button', {
        type: 'button',
        className: 'fd-help-close',
        'aria-label': '收起说明',
        onClick: e => {
          stop(e)
          if (typeof onClose === 'function') onClose()
        }
      }, '收起')),
    h('div', { className: 'fd-help-pop-body' },
      list.length
        ? list.map((line, idx) => (typeof line === 'string' || typeof line === 'number')
          ? h('p', { key: idx, className: 'fd-help-line' }, String(line))
          : h('div', { key: idx, className: 'fd-help-line' }, line))
        : h('p', { className: 'fd-help-line' }, '暂无说明')))
}

/* FdHelp —— 独立用法：? 按钮点开后就在按钮下方就地渲染说明卡片 */
function FdHelp(props) {
  const { title, text, children } = props || {}
  const [open, setOpen] = useState(false)
  return h('span', { className: 'fd-help' + (open ? ' is-open' : '') },
    h(FdHelpToggle, { title, open, onToggle: value => setOpen(Boolean(value)) }),
    open ? fdHelpPop(title, text, children, () => setOpen(false)) : null
  )
}

/* 最外层用 div 而非 label：避免点击 ? 或阅读弹层时误触内部 select/input */
function FdField(props) {
  const { label, help, hint, children } = props || {}
  const withHelp = fdHasHelp(help)
  const [open, setOpen] = useState(false)
  return h('div', { className: 'fd-field' },
    label || withHelp
      ? h('div', { className: 'fd-label-row' },
        label ? h('span', { className: 'fd-field-label' }, label) : null,
        withHelp ? h(FdHelpToggle, { title: label, open, onToggle: value => setOpen(Boolean(value)) }) : null)
      : null,
    withHelp && open ? fdHelpPop(label, help, null, () => setOpen(false)) : null,
    children,
    hint ? h('span', { className: 'fd-hint' }, hint) : null
  )
}

function FdText(props) {
  const { value, onChange, placeholder, inline, mono, maxLength } = props || {}
  return h('input', {
    className: 'fd-input' + (inline ? ' is-inline' : '') + (mono ? ' fd-mono' : ''),
    type: 'text',
    value: value === undefined || value === null ? '' : String(value),
    placeholder: placeholder || '',
    maxLength: maxLength || undefined,
    onChange: e => (typeof onChange === 'function' ? onChange(e.target.value) : undefined)
  })
}

function FdSelect(props) {
  const { value, onChange, options, ariaLabel, placeholder } = props || {}
  const list = Array.isArray(options) ? options : []
  return h('select', {
    className: 'fd-select',
    value: value === undefined || value === null ? '' : String(value),
    'aria-label': ariaLabel || undefined,
    onChange: e => (typeof onChange === 'function' ? onChange(e.target.value) : undefined)
  },
  placeholder ? h('option', { value: '' }, placeholder) : null,
  list.map(opt => h('option', { key: String(opt.value), value: String(opt.value) }, String(opt.label || opt.value))))
}

function FdBadge(props) {
  const { children, tone, title } = props || {}
  return h('span', { className: 'fd-badge' + (tone ? ' is-' + tone : ''), title: title || undefined }, children)
}

function FdSection(props) {
  const { title, help, note, actions, children } = props || {}
  const withHelp = fdHasHelp(help)
  const [open, setOpen] = useState(false)
  return h('section', { className: 'fd-section' },
    title || actions || withHelp
      ? h('div', { className: 'fd-section-head' },
        h('span', { className: 'fd-label-row' },
          h('span', { className: 'fd-section-title' }, title),
          withHelp ? h(FdHelpToggle, { title, open, onToggle: value => setOpen(Boolean(value)) }) : null),
        note ? h('span', { className: 'fd-section-note' }, note) : null,
        actions ? h('div', { className: 'fd-btn-row' }, actions) : null)
      : null,
    withHelp && open ? fdHelpPop(title, help, null, () => setOpen(false)) : null,
    children
  )
}

function FdRow(props) {
  const { title, help, sub, children, plain } = props || {}
  const withHelp = fdHasHelp(help)
  const [open, setOpen] = useState(false)
  return h('div', { className: 'fd-row' + (plain ? ' is-plain' : '') },
    h('div', { className: 'fd-row-main' },
      h('div', { className: 'fd-label-row' },
        h('span', { className: 'fd-row-title' }, title),
        withHelp ? h(FdHelpToggle, { title, open, onToggle: value => setOpen(Boolean(value)) }) : null),
      withHelp && open ? fdHelpPop(title, help, null, () => setOpen(false)) : null,
      sub ? h('span', { className: 'fd-row-sub' }, sub) : null),
    children ? h('div', { className: 'fd-row-end' }, children) : null
  )
}

function FdCollapse(props) {
  const { title, sub, right, defaultOpen, children } = props || {}
  const [open, setOpen] = useState(Boolean(defaultOpen))
  return h('div', { className: 'fd-track' },
    h('div', { className: 'fd-track-head' },
      h('button', {
        type: 'button',
        className: 'fd-chip',
        onClick: () => setOpen(prev => !prev),
        'aria-expanded': open ? 'true' : 'false'
      }, open ? '▾ ' + String(title || '') : '▸ ' + String(title || '')),
      sub ? h('span', { className: 'fd-hint' }, sub) : null,
      right ? h('div', { className: 'fd-btn-row' }, right) : null),
    open ? h('div', { className: 'fd-track-body' }, children) : null
  )
}
