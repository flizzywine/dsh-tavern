/* ------------------------------------------------------------------ *
 * panel.js —— 剧情罗盘浏览器端工作台面板、输入栏挂载与状态卡
 *
 * 视觉与交互与「命运之骰」工作台完全一致：
 * 顶栏固定标题 + ? 说明 + 总开关 + 双页签（路线与推演 / 罗盘设置），
 * 正文为独立滚动卡片区，底部浮动 toast；全部核心区域与设置项均配 ? / ×
 * 左侧强调竖条多段详细说明卡（含「收起」与 Esc 关闭）。
 * ------------------------------------------------------------------ */

const PC_PANEL_ID = 'plot-compass'
const PC_PLUGIN_ID = 'dsh-tavern-plot-compass'

const PC_PRESET_ARCHETYPES = Object.freeze([
  '情感拉扯', '修罗场', '权谋博弈', '悬疑调查',
  '奇幻冒险', '副本闯关', '经营养成', '群像势力',
  '高自由沙盒', '日常治愈', '禁忌共犯', '同人IF破局'
])

const PC_HORIZON_META = Object.freeze([
  {
    key: 'shortTerm',
    label: '今期',
    span: '2–5 轮',
    subtitle: '当前幕破局方向与多轮推进节拍（联动下一步候选项角标）'
  },
  {
    key: 'midTerm',
    label: '中期',
    span: '5–20 轮',
    subtitle: '篇章弧转折、隐藏支线与阶段里程碑'
  },
  {
    key: 'longTerm',
    label: '长期',
    span: '终局蓝图',
    subtitle: '多结局命运假想（点亮仅注入无剧透暗流基调，不抢跑结局）'
  }
])

const PC_STRENGTH_OPTIONS = Object.freeze([
  { key: 'soft', label: '软铺垫', title: '仅作氛围与风声软引导（常规位置注入），不主动打断当前自由对话' },
  { key: 'guided', label: '强牵引', title: '置底导演级引导（默认）：回应玩家的同时借在场角色或环境契机实质性推进目标节拍' },
  { key: 'strict', label: '硬性兑现', title: '置底必达裁定：除主角物理受困或明确反向掀桌外，每轮都必须正面推进当前目标节拍，到预计轮数时兑现' }
])

const PC_PACE_OPTIONS = Object.freeze([
  { key: 'foreshadow', label: '只铺垫', title: '侧重前兆感官、试探交锋与悬念蓄势，本轮把局面推至临界点而留白最终摊牌' },
  { key: 'natural', label: '自然推进', title: '顺应角色性格与现场因果，按预计轮数把当前目标节拍逐轮演透（默认）' },
  { key: 'climax', label: '尽快引爆', title: '拉满戏剧张力，推动当前节拍或潜藏冲突在本轮正面对撞（多轮节拍可压缩到一轮）' }
])

const PC_MODEL_OPTIONS = Object.freeze([
  { key: 'background', label: '跟随后台', title: '全局使用当前对话或全局后台模型（所有对话共用）' },
  { key: 'foreground', label: '跟随前台', title: '全局使用当前对话前台模型（所有对话共用）' },
  { key: 'independent', label: '独立', title: '为剧情罗盘指定全局独立模型（所有对话共用）' }
])

const PC_AUTO_UPDATE_PRESETS = Object.freeze([
  { value: 0, label: '关闭' },
  { value: 3, label: '每 3 楼' },
  { value: 5, label: '每 5 楼' },
  { value: 10, label: '每 10 楼' }
])

const PC_MAX_ROUTES_DEFAULT = 4
const PC_MAX_ROUTES_MIN = 1
const PC_MAX_ROUTES_MAX = 10
const PC_MAX_ROUTES_PRESETS = Object.freeze([
  { value: 2, label: '2 条' },
  { value: 3, label: '3 条' },
  { value: 4, label: '4 条' },
  { value: 6, label: '6 条' }
])

const PC_GOAL_HORIZON_OPTIONS = Object.freeze([
  {
    key: 'shortTerm',
    label: '短期',
    span: '2–5 轮',
    placeholder: '输入短期目标结果（2–5 轮内达成，如：本幕内说服苏晚交出残图并暂时结盟）',
    hint: '短期目标（2–5 轮）：后续生成的近期所有分支路线都将殊途同归导向达成此结果，中长期路线以此结果为既定起点顺延。',
    title: '短期目标（2–5 轮）：近期所有路线直接导向达成此结果，中长期路线以此为起点顺延'
  },
  {
    key: 'midTerm',
    label: '中期',
    span: '5–20 轮',
    placeholder: '输入中期目标结果（5–20 轮篇章达成，如：在武林大会揭穿盟主伪善面目并全身而退）',
    hint: '中期目标（5–20 轮）：短期路线作为先导阶梯为其铺垫蓄势，中期所有篇章路线均收束达成此结果，长期以此为基石顺延。',
    title: '中期目标（5–20 轮）：短期路线为其铺垫蓄势，中期所有篇章路线汇聚达成此结果'
  },
  {
    key: 'longTerm',
    label: '长期',
    span: '终局结果',
    placeholder: '输入长期目标结果（20+ 轮至终局达成，如：查明当年灭门真相，携手重开北岭山门）',
    hint: '长期目标（20+ 轮至终局）：短中期路线层层铺路搭桥，长期所有终局蓝图均导向达成此目标结果（严禁生成背离该结局的分支）。',
    title: '长期目标（20+ 轮至终局）：短中期路线层层铺路，长期所有终局蓝图均导向达成此目标结果'
  }
])

/* 详细说明文案（与命运之骰同风格：分点分段，覆盖机制、各档差异与实用建议） */
const PC_HELP = Object.freeze({
  overview: [
    '剧情罗盘是后台多路线编剧助手：结合人物卡设定、当前剧情进展、MVU 变量与未触发的世界书暗线，推演「今期（2–5 轮）」「中期（5–20 轮）」「长期（终局蓝图）」三个时间跨度的分支路线。',
    '你可以随时「点亮」任意跨度的路线作为本局导向，系统会按设定的约束力度与推进节奏将其融入后续正文与下一步候选项角标；也可一键「分叉试玩」克隆平行存档体验不同走向。',
    '顶栏总开关仅控制当前这一局是否启用剧情罗盘；关闭后已生成的路线会安全保留，随时可重新开启继续使用。',
    '面板分为「路线与推演」（配置游玩类型与目标导向、查看路线、点亮锚定、脑暴讨论与逐层拆解）和「罗盘设置」（约束力度、节奏、盲盒防剧透、自动更新、条目上限与推演模型）两页，所有 ? 均可点开查看详细说明。'
  ].join('\n'),

  brainstorm: [
    '下方输入框默认走「脑暴对话」模式：你可以像和编剧搭档聊天一样讨论灵感、追问伏笔或试探转折，AI 会结合人设、现场定格与世界书暗线给出方案，不会直接覆盖当前已生成的路线卡片。',
    '聊出满意思路后，点回复下方的「✨ 应用为今期」或「✦ 应用为全局」即可将讨论结果正式生成为路线卡片；若不想聊天只想直接重推，点「✨ 直接重推」即可按输入方向全局刷新今/中/长期路线。'
  ].join('\n'),

  funnel: [
    '这里汇总本局所有正在生效的剧情导向（目标导向 + 今期 / 中期 / 长期已点亮路线），点击任意胶囊可快速切到对应跨度查看卡片详情。',
    '每个今期节拍都标有预计轮数，这里会显示当前节拍已演到第几轮；若点亮的节拍超出预计轮数仍未达成（未标轮数的旧节拍按连续 2 轮计，且约束力度不是「软铺垫」），系统会自动亮起「⚡ 停滞加压中」标记，在下轮适当加强破局推力，防止剧情原地打转。',
    '点「✏️ 微调引导」可在不重推路线的前提下，临时补充一句导演侧重点（例如「本段多给对话交锋与误会，先别点破真相」），下轮正文立即生效；点「生成联动候选项」可立即刷新带路线角标的下一步行动建议。'
  ].join('\n'),

  horizons: [
    '今期（2–5 轮）：聚焦眼前这一幕的破局方向，每条路线拆成 2–3 个多轮推进节拍，各自标注预计轮数、阻力与达成标志；点亮后直接联动下一步候选项角标，正文出现达成标志时自动打勾，也可手动点选调整进度。',
    '中期（5–20 轮）：规划篇章级转折、隐藏支线与阶段里程碑（入线 → 升级 → 抉择 → 高潮），可点「拆解今期 ↘」把选中的中期篇章细化成眼前的今期路线。',
    '长期（终局蓝图）：给出多结局命运假想与达成前置拐点；点亮长期路线时，前台正文只会收到无剧透的「防剧透暗流指引」，营造宿命氛围而不抢跑结局。可点「拆解中期 ↘」逐层落地。'
  ].join('\n'),

  settingsSection: [
    '这一区控制本局剧情罗盘的约束力度、推进节奏、盲盒防剧透、自动更新间隔与每层条目上限；每改一项即时生效并自动保存，无需额外提交。',
    '除「推演模型」为所有对话全局共用外，其余偏好均按当前对局独立保存，不同人物卡和存档可各自采用不同玩法。'
  ].join('\n'),

  archetypes: [
    '决定 AI 推演分支路线时优先发散哪些戏剧维度（如情感拉扯、权谋博弈、悬疑调查、修罗场、经营养成等）。',
    '未手动指定时，推演会自动根据人物卡与当前剧情识别题材；手动锁定 1–5 个标签后，后续推演与刷新会严格围绕这些流派展开。支持点选预设或输入最多 16 字的自定义流派。'
  ].join('\n'),

  goal: [
    '默认未设置时，罗盘会发散出风格迥异的多结局自由剧情树；设定「目标导向」后，后续生成的分支路线会「殊途同归」全部收束导向你期望的结果。',
    '短期目标（2–5 轮）：近期所有路线直接导向达成此结果，中长期路线以此为起点顺延。',
    '中期目标（5–20 轮）：短期路线作为先导阶梯蓄势，中期篇章路线全部汇聚达成此结果。',
    '长期目标（20+ 轮至终局）：短中期层层铺路搭桥，长期所有终局蓝图均严格导向该结局（不生成背离结局的分支）。支持随时「暂停」恢复自由发散而保留已填内容。'
  ].join('\n'),

  strength: [
    '决定已点亮路线（或目标导向）对前台主写作模型的影响强度：',
    '软铺垫：仅在常规位置注入氛围与风声提示，不主动打断当前自由对话，适合随缘推进、偶尔借灵感的轻度引导。',
    '强牵引（默认）：置底导演级引导，在充分回应你当前行动的同时，借在场角色或环境契机实质性推进目标节拍，兼顾自由度与推进效率。',
    '硬性兑现：置底必达裁定，除主角物理受困或明确反向掀桌外，每轮都必须正面推进当前目标节拍，到预计轮数时必须兑现达成标志，适合想快速兑现关键剧情的场合。'
  ].join('\n'),

  pace: [
    '控制当前目标节拍在正文里的展开速度与张力释放方式：',
    '只铺垫：侧重感官前兆、试探交锋与悬念蓄势，把局面推至临界点而留白最终摊牌，适合慢热拉扯与悬疑铺陈。',
    '自然推进（默认）：顺应角色性格与现场因果，按预计轮数把当前目标节拍逐轮演透，每轮让阻力真实发作，不急不拖。',
    '尽快引爆：拉满戏剧张力，推动当前节拍或潜藏冲突在本轮正面对撞（多轮节拍可压缩到一轮完成），适合高燃高潮或快速破冰。'
  ].join('\n'),

  blindBox: [
    '开启后，所有路线卡片的详细节拍、因果依据、收益风险与终局剧透都会被自动遮罩，仅保留路线标题、方向基调与世界内预兆风声，让你像玩未知剧本一样在正文中亲自探索。',
    '需要核对某张卡细节时，可随时点击该卡的「👀 临时查看此卡剧透」单独掀开，再点「🙈 收起剧透」恢复遮罩；关闭开关即全体切回明牌模式。'
  ].join('\n'),

  autoUpdate: [
    '设置每隔多少楼回合结算后，后台自动执行一次全层演进刷新，让路线进度与最新剧情保持同步，不影响继续对话。',
    '关闭（默认）：仅在你手动点「全局演进刷新」或触发归卷时更新，最省模型调用。',
    '可选每 3 / 5 / 10 楼预设，或点「自定义」输入 1–100 之间的任意整数楼数；开启后会实时显示距离下次全局刷新的剩余楼数。'
  ].join('\n'),

  maxRoutes: [
    '控制今期、中期、长期每个时间跨度每次推演与保留的路线条目上限，支持 1–10 条，默认 4 条。',
    '调小（如 2–3 条）可让路线更聚焦、推演更快、面板更清爽；调大（如 6 条）可获得更丰富的分支脑洞与多结局对比。'
  ].join('\n'),

  model: [
    '指定剧情罗盘执行路线推演与脑暴对话所用的模型，此项为全局设置，所有对话共用：',
    '跟随后台（默认）：复用当前对话或全局后台模型，兼顾速度与开销。',
    '跟随前台：复用当前对话的主写作前台模型，文风与人物理解最一致，但耗时与成本较高。',
    '独立：为剧情罗盘单独指定一个服务商/模型（及可选推理强度），不受前后台模型切换影响。'
  ].join('\n')
})

function pcUseRef(initial) {
  return typeof React.useRef === 'function' ? React.useRef(initial) : { current: initial }
}

function pcHelpLines(text) {
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

function pcHelpTitle(title) {
  return typeof title === 'string' || typeof title === 'number' ? String(title) : '详细说明'
}

function pcHasHelp(help) {
  return help !== undefined && help !== null && help !== false && help !== ''
}

function pcRevealHelp(open, node) {
  if (!open || !node || typeof node.scrollIntoView !== 'function') return
  node.scrollIntoView({ block: 'nearest' })
}

/* 说明按钮（受控）：圆角 ? / 展开后变 ×，与命运之骰 FdHelpToggle 一致 */
function PcHelpToggle(props) {
  const { title, open, onToggle } = props || {}
  const plain = pcHelpTitle(title)
  const label = '查看说明：' + plain
  return h('button', {
    type: 'button',
    className: 'pc-help-btn' + (open ? ' is-open' : ''),
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

/* 说明卡片（左侧强调竖条 + 标题 + 右上角「收起」，深浅主题自适应） */
function pcHelpPop(title, help, onClose, ref) {
  const lines = pcHelpLines(help)
  const stop = event => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault()
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
  }
  return h('div', { ref, className: 'pc-help-pop', role: 'note' },
    h('div', { className: 'pc-help-pop-head' },
      h('span', { className: 'pc-help-pop-title' }, pcHelpTitle(title)),
      h('button', {
        type: 'button',
        className: 'pc-help-close',
        'aria-label': '收起说明',
        onClick: event => {
          stop(event)
          if (typeof onClose === 'function') onClose()
        }
      }, '收起')),
    h('div', { className: 'pc-help-pop-body' },
      lines.length
        ? lines.map((line, idx) => h('p', { key: idx, className: 'pc-help-line' }, String(line)))
        : h('p', { className: 'pc-help-line' }, '暂无说明')))
}

function PcBtn(props) {
  const { children, onClick, primary, danger, small, disabled, title, ariaLabel } = props || {}
  const cls = 'pc-btn' + (primary ? ' is-primary' : '') + (danger ? ' is-danger' : '') + (small ? ' is-sm' : '')
  return h('button', {
    type: 'button',
    className: cls,
    onClick: typeof onClick === 'function' ? onClick : undefined,
    disabled: Boolean(disabled),
    title: title || undefined,
    'aria-label': ariaLabel || undefined
  }, children)
}

function PcChip(props) {
  const { children, onClick, active, tone, disabled, title } = props || {}
  return h('button', {
    type: 'button',
    className: 'pc-chip' + (active ? ' is-active' : '') + (tone ? ' is-' + tone : ''),
    disabled: Boolean(disabled),
    onClick: typeof onClick === 'function' ? onClick : undefined,
    title: title || undefined,
    'aria-pressed': active ? 'true' : 'false'
  }, children)
}

function PcBadge(props) {
  const { children, tone, title } = props || {}
  return h('span', {
    className: 'pc-badge' + (tone ? ' is-' + tone : ''),
    title: title || undefined
  }, children)
}

function PcSwitch({ label, checked, disabled, onChange }) {
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-label': label || '开关',
    'aria-checked': checked ? 'true' : 'false',
    disabled: Boolean(disabled),
    className: 'pc-switch' + (checked ? ' is-on' : ''),
    onClick: () => {
      if (!disabled && typeof onChange === 'function') onChange(!checked)
    }
  })
}

function PcSection(props) {
  const { title, helpTitle, help, note, actions, accent, ariaLabel, children } = props || {}
  const withHelp = pcHasHelp(help)
  const [open, setOpen] = useState(false)
  const helpRef = pcUseRef(null)
  useEffect(() => { pcRevealHelp(open, helpRef.current) }, [open])
  const plainTitle = helpTitle || title
  return h('section', { className: 'pc-section' + (accent ? ' is-accent' : ''), 'aria-label': ariaLabel || plainTitle },
    title || actions || note || withHelp
      ? h('div', { className: 'pc-section-head' },
        h('span', { className: 'pc-label-row' },
          title ? h('span', { className: 'pc-section-title' }, title) : null,
          withHelp ? h(PcHelpToggle, { title: plainTitle, open, onToggle: value => setOpen(Boolean(value)) }) : null),
        note ? h('span', { className: 'pc-section-note' }, note) : null,
        actions ? h('div', { className: 'pc-btn-row' }, actions) : null)
      : null,
    withHelp && open ? pcHelpPop(plainTitle, help, () => setOpen(false), helpRef) : null,
    children)
}

function PcRow(props) {
  const { title, help, sub, children, plain } = props || {}
  const withHelp = pcHasHelp(help)
  const [open, setOpen] = useState(false)
  const helpRef = pcUseRef(null)
  useEffect(() => { pcRevealHelp(open, helpRef.current) }, [open])
  return h('div', { className: 'pc-row' + (plain ? ' is-plain' : '') },
    h('div', { className: 'pc-row-main' },
      h('div', { className: 'pc-label-row' },
        h('span', { className: 'pc-row-title' }, title),
        withHelp ? h(PcHelpToggle, { title, open, onToggle: value => setOpen(Boolean(value)) }) : null),
      withHelp && open ? pcHelpPop(title, help, () => setOpen(false), helpRef) : null,
      sub ? h('span', { className: 'pc-row-sub' }, sub) : null),
    children ? h('div', { className: 'pc-row-end' }, children) : null)
}

function PcField(props) {
  const { label, help, hint, actions, children } = props || {}
  const withHelp = pcHasHelp(help)
  const [open, setOpen] = useState(false)
  const helpRef = pcUseRef(null)
  useEffect(() => { pcRevealHelp(open, helpRef.current) }, [open])
  return h('div', { className: 'pc-field' },
    label || withHelp || actions
      ? h('div', { className: 'pc-section-head' },
        h('div', { className: 'pc-label-row' },
          label ? h('span', { className: 'pc-field-label' }, label) : null,
          withHelp ? h(PcHelpToggle, { title: label, open, onToggle: value => setOpen(Boolean(value)) }) : null),
        actions ? h('div', { className: 'pc-btn-row' }, actions) : null)
      : null,
    withHelp && open ? pcHelpPop(label, help, () => setOpen(false), helpRef) : null,
    children,
    hint ? h('span', { className: 'pc-hint' }, hint) : null)
}

function PcSpinner({ className }) {
  return h('span', {
    className: 'dsh-tavern-compass-spinner' + (className ? ' ' + className : ''),
    'aria-hidden': 'true'
  })
}

function PcCompassIcon({ size = 16, className } = {}) {
  return h('svg', {
    className: 'pc-compass-icon' + (className ? ' ' + className : ''),
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false'
  },
    h('circle', { cx: 12, cy: 12, r: 9.25 }),
    h('polygon', { points: '16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88' })
  )
}

function pcEmptyCompass() {
  return {
    strength: 'guided',
    pace: 'natural',
    stalledTurns: 0,
    blindBox: false,
    customDirective: '',
    goal: { enabled: false, horizon: 'shortTerm', text: '' },
    autoUpdateInterval: 0,
    maxRoutes: PC_MAX_ROUTES_DEFAULT,
    playArchetypes: [],
    customArchetypes: [],
    situationDigest: '',
    shortTerm: [],
    midTerm: [],
    longTerm: [],
    pinned: { shortTerm: null, midTerm: null, longTerm: null },
    archived: [],
    chatHistory: [],
    basedOnTurn: 0
  }
}

function pcActiveGoal(compass) {
  const goal = compass && compass.goal
  if (!goal || typeof goal !== 'object' || !goal.enabled || !String(goal.text || '').trim()) return null
  const opt = PC_GOAL_HORIZON_OPTIONS.find(item => item.key === goal.horizon) || PC_GOAL_HORIZON_OPTIONS[0]
  return {
    enabled: true,
    horizon: opt.key,
    horizonLabel: opt.label,
    span: opt.span,
    text: String(goal.text).trim()
  }
}

// 今期节拍的预计轮数（1–3），旧版节拍没有这个字段时为 0。
function pcStageTurns(step) {
  const n = Math.trunc(Number(step && step.turns))
  return Number.isFinite(n) && n >= 1 ? Math.min(3, n) : 0
}

function pcMidPhaseLabel(index, total) {
  if (total <= 1) return ''
  if (index === total - 1) return '高潮'
  if (total >= 3 && index === total - 2) return '抉择'
  if (index === 0) return '入线'
  return '升级'
}

function pcActiveCompassSummary(compass) {
  if (!compass || typeof compass !== 'object') {
    return { shortTerm: null, midTerm: null, longTerm: null, any: null, count: 0 }
  }
  const pinned = compass.pinned || {}
  const find = key => {
    const id = pinned[key]
    if (!id || !Array.isArray(compass[key])) return null
    return compass[key].find(item => item && item.id === id) || null
  }
  const shortTerm = find('shortTerm')
  const midTerm = find('midTerm')
  const longTerm = find('longTerm')
  const count = (shortTerm ? 1 : 0) + (midTerm ? 1 : 0) + (longTerm ? 1 : 0)
  return { shortTerm, midTerm, longTerm, any: shortTerm || midTerm || longTerm, count }
}

async function pcCall(ui, name, args) {
  if (!ui || typeof ui.callHost !== 'function') {
    throw new Error('当前宿主版本不支持插件后端调用')
  }
  const res = await ui.callHost(name, args || {})
  if (res && typeof res === 'object' && res.ok === false) {
    throw new Error(res.error || '操作失败')
  }
  return res || {}
}

function usePlotCompassState(ui, gameId) {
  const id = gameId ? String(gameId) : ''
  const [state, setState] = useState({
    loaded: false,
    enabled: false,
    modelSelection: 'background',
    plotCompass: pcEmptyCompass(),
    plotCompassTask: { status: 'idle', scope: 'all', error: '' },
    latestAssistantTurn: 0
  })

  useEffect(() => {
    if (!ui || !id) {
      setState({
        loaded: false,
        enabled: false,
        modelSelection: 'background',
        plotCompass: pcEmptyCompass(),
        plotCompassTask: { status: 'idle', scope: 'all', error: '' },
        latestAssistantTurn: 0
      })
      return
    }

    let cancelled = false
    const applyPayload = data => {
      if (cancelled || !data || typeof data !== 'object') return
      setState(prev => ({
        loaded: true,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : prev.enabled,
        modelSelection: data.modelSelection || prev.modelSelection,
        plotCompass: data.plotCompass ? data.plotCompass : prev.plotCompass,
        plotCompassTask: data.plotCompassTask ? data.plotCompassTask : prev.plotCompassTask,
        latestAssistantTurn: typeof data.latestAssistantTurn === 'number'
          ? data.latestAssistantTurn
          : prev.latestAssistantTurn
      }))
    }

    pcCall(ui, 'plot-compass:state', { gameId: id }).then(applyPayload).catch(() => {
      if (!cancelled) setState(prev => ({ ...prev, loaded: true }))
    })

    const unsubState = typeof ui.watchState === 'function'
      ? ui.watchState(id, 'compass', applyPayload)
      : null
    const unsubTurn = typeof ui.watchTurnState === 'function'
      ? ui.watchTurnState(id, turnState => {
          if (cancelled || !turnState || typeof turnState !== 'object') return
          if (typeof turnState.turn === 'number') {
            setState(prev => ({
              ...prev,
              latestAssistantTurn: Math.max(prev.latestAssistantTurn || 0, Number(turnState.turn) || 0)
            }))
          }
          if (turnState.settled) {
            pcCall(ui, 'plot-compass:state', { gameId: id }).then(applyPayload).catch(() => {})
          }
        })
      : null

    return () => {
      cancelled = true
      if (typeof unsubState === 'function') unsubState()
      if (typeof unsubTurn === 'function') unsubTurn()
    }
  }, [ui, id])

  const refresh = () => {
    if (!ui || !id) return Promise.resolve(null)
    return pcCall(ui, 'plot-compass:state', { gameId: id }).then(data => {
      if (data && typeof data === 'object') {
        setState(prev => ({
          loaded: true,
          enabled: typeof data.enabled === 'boolean' ? data.enabled : prev.enabled,
          modelSelection: data.modelSelection || prev.modelSelection,
          plotCompass: data.plotCompass || prev.plotCompass,
          plotCompassTask: data.plotCompassTask || prev.plotCompassTask,
          latestAssistantTurn: typeof data.latestAssistantTurn === 'number'
            ? data.latestAssistantTurn
            : prev.latestAssistantTurn
        }))
      }
      return data
    }).catch(() => null)
  }

  return { state, setState, refresh }
}

function PlotCompassComposerDock({ ui, gameId, sessionId }) {
  const id = String(sessionId || gameId || '')
  const { state } = usePlotCompassState(ui, id)
  if (!id || state.enabled !== true) return null

  const compass = state.plotCompass || pcEmptyCompass()
  const task = state.plotCompassTask || {}
  const isRunning = task.status === 'running'
  const active = pcActiveCompassSummary(compass)
  const activeGoal = pcActiveGoal(compass)
  const hasActiveAnchor = Boolean(active.any || activeGoal)
  const totalRoutes = (compass.shortTerm?.length || 0) + (compass.midTerm?.length || 0) + (compass.longTerm?.length || 0)

  const titleParts = []
  if (activeGoal) titleParts.push('目标〔' + activeGoal.horizonLabel + '〕：' + activeGoal.text)
  if (active.shortTerm) titleParts.push('今期：' + active.shortTerm.title)
  if (active.midTerm) titleParts.push('中期：' + active.midTerm.title)
  if (active.longTerm) titleParts.push('长期：' + active.longTerm.title)

  const title = isRunning
    ? '正在推演今期/中期/长期多路线剧情规划…'
    : titleParts.length > 0
      ? '当前剧情罗盘导向 — ' + titleParts.join(' ｜ ') + '（点击打开剧情罗盘）'
      : '打开剧情罗盘：查看或推演今期、中期、长期多路线剧情灵感'

  const label = isRunning
    ? '罗盘推演中…'
    : active.any
      ? '罗盘 · ' + (active.any.tag || active.any.title)
      : activeGoal
        ? '罗盘 · 🎯' + activeGoal.horizonLabel
        : totalRoutes > 0
          ? '剧情罗盘 (' + totalRoutes + ')'
          : '剧情罗盘'

  return h('div', { className: 'dsh-tavern-compass-composer-wrap' },
    h('button', {
      type: 'button',
      className: 'dsh-tavern-btn dsh-tavern-compass-dock-btn' + (hasActiveAnchor ? ' is-pinned' : '') + (isRunning ? ' is-running' : ''),
      title,
      'aria-label': title,
      onClick: () => {
        if (ui && typeof ui.openPanel === 'function') {
          ui.openPanel(PC_PANEL_ID, id)
        }
      }
    },
      isRunning ? h(PcSpinner) : h('span', { 'aria-hidden': 'true', className: 'dsh-tavern-compass-dock-glyph' }, h(PcCompassIcon, { size: 14 })),
      h('span', { className: 'dsh-tavern-compass-dock-label' }, label)
    )
  )
}

function PlotCompassComposerTool({ ui, sessionId, busy }) {
  const id = String(sessionId || '')
  const { state } = usePlotCompassState(ui, id)
  if (!id || state.enabled !== true) return null

  const compass = state.plotCompass || pcEmptyCompass()
  const task = state.plotCompassTask || {}
  const isRunning = task.status === 'running'
  const active = pcActiveCompassSummary(compass)
  const activeGoal = pcActiveGoal(compass)
  const hasActiveAnchor = Boolean(active.any || activeGoal)
  const totalRoutes = (compass.shortTerm?.length || 0) + (compass.midTerm?.length || 0) + (compass.longTerm?.length || 0)
  const routes = totalRoutes > 0 ? ' · ' + totalRoutes + ' 条路线' : ''
  const goalHint = activeGoal ? ' · 目标〔' + activeGoal.horizonLabel + '〕：' + activeGoal.text : ''
  const label = active.any
    ? '剧情罗盘 · 已锚定' + (active.any.tag || active.any.title) + goalHint + routes
    : activeGoal
      ? '剧情罗盘' + goalHint + routes
      : '剧情罗盘' + routes

  return h('button', {
    type: 'button',
    className: 'dsh-tavern-compass-tool-btn' + (hasActiveAnchor ? ' is-pinned' : '') + (isRunning ? ' is-running' : ''),
    title: label,
    'aria-label': label,
    'data-busy': busy === true ? 'true' : undefined,
    onClick: () => {
      if (ui && typeof ui.openPanel === 'function') {
        ui.openPanel(PC_PANEL_ID, id)
      }
    }
  },
    isRunning ? h(PcSpinner) : h('span', { 'aria-hidden': 'true', className: 'dsh-tavern-compass-tool-glyph' }, h(PcCompassIcon, { size: 16 })),
    hasActiveAnchor && !isRunning ? h('span', { className: 'dsh-tavern-compass-tool-dot', 'aria-hidden': 'true' }) : null
  )
}

function PlotCompassStatusSection({ ui, gameId }) {
  const id = String(gameId || '')
  const { state } = usePlotCompassState(ui, id)
  if (!id || state.enabled !== true) return null
  const compass = state.plotCompass || pcEmptyCompass()
  const active = pcActiveCompassSummary(compass)
  const activeGoal = pcActiveGoal(compass)
  const task = state.plotCompassTask || {}

  return h('div', { className: 'dsh-tavern-compass-status-box' },
    h('p', { className: 'dsh-tavern-compass-desc' },
      task.status === 'running'
        ? '状态：后台推演中…'
        : (compass.basedOnTurn > 0 ? '状态：已开启（基于第 ' + compass.basedOnTurn + ' 轮）' : '状态：已开启，尚未推演')
    ),
    active.count > 0 || activeGoal
      ? h('div', { className: 'dsh-tavern-compass-funnel-items' },
          activeGoal ? h('span', { className: 'dsh-tavern-compass-funnel-chip is-goal' }, '🎯 ' + activeGoal.horizonLabel + '目标：' + activeGoal.text) : null,
          active.shortTerm ? h('span', { className: 'dsh-tavern-compass-funnel-chip' }, '今期：' + active.shortTerm.title) : null,
          active.midTerm ? h('span', { className: 'dsh-tavern-compass-funnel-chip' }, '中期：' + active.midTerm.title) : null,
          active.longTerm ? h('span', { className: 'dsh-tavern-compass-funnel-chip' }, '长期：' + active.longTerm.title) : null
        )
      : null,
    ui && typeof ui.openPanel === 'function'
      ? h('div', null,
          h('button', {
            type: 'button',
            className: 'dsh-tavern-btn',
            onClick: () => ui.openPanel(PC_PANEL_ID, id)
          }, '打开剧情罗盘面板')
        )
      : null
  )
}

function PlotCompassPanel({ ui, gameId }) {
  const sessionId = String(gameId || '')
  const { state, setState, refresh } = usePlotCompassState(ui, sessionId)

  const [panelTab, setPanelTab] = useState('routes')
  const [overviewHelpOpen, setOverviewHelpOpen] = useState(false)
  const overviewHelpRef = pcUseRef(null)
  const [activeHorizon, setActiveHorizon] = useState('shortTerm')
  const [guidance, setGuidance] = useState('')
  const [editingArchetypes, setEditingArchetypes] = useState(false)
  const [archetypeDraft, setArchetypeDraft] = useState('')
  const [selectedArchetypes, setSelectedArchetypes] = useState([])
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalHorizonDraft, setGoalHorizonDraft] = useState('shortTerm')
  const [goalTextDraft, setGoalTextDraft] = useState('')
  const [editingDirective, setEditingDirective] = useState(false)
  const [directiveDraft, setDirectiveDraft] = useState('')
  const [peekedCards, setPeekedCards] = useState({})
  const [chatOpen, setChatOpen] = useState(false)
  const [confirmingFresh, setConfirmingFresh] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [localError, setLocalError] = useState('')
  const [localNotice, setLocalNotice] = useState('')
  const [pickingIndependentModel, setPickingIndependentModel] = useState(false)
  const [modelCatalog, setModelCatalog] = useState([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [modelReasoning, setModelReasoning] = useState({ key: '', value: null, error: '' })
  const [customIntervalOpen, setCustomIntervalOpen] = useState(false)
  const [intervalDraft, setIntervalDraft] = useState('')
  const [customMaxRoutesOpen, setCustomMaxRoutesOpen] = useState(false)
  const [maxRoutesDraft, setMaxRoutesDraft] = useState(String(PC_MAX_ROUTES_DEFAULT))
  const toastTimer = pcUseRef(null)

  useEffect(() => { pcRevealHelp(overviewHelpOpen, overviewHelpRef.current) }, [overviewHelpOpen])

  function notify(message) {
    setLocalNotice(String(message || ''))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    if (message) {
      toastTimer.current = setTimeout(() => {
        setLocalNotice(prev => (prev === message ? '' : prev))
      }, 4200)
    }
  }

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const compass = state.plotCompass || pcEmptyCompass()
  const compassEnabled = state.enabled === true
  const compassModel = state.modelSelection || 'background'
  const compassModelIsObject = Boolean(compassModel && typeof compassModel === 'object')
  const compassModelMode = compassModelIsObject ? 'independent' : (compassModel === 'foreground' ? 'foreground' : 'background')
  const compassModelKey = compassModelIsObject ? JSON.stringify({ provider: compassModel.provider, model: compassModel.model }) : ''
  const task = state.plotCompassTask || { status: 'idle', scope: 'all', error: '' }
  const isRunning = task.status === 'running'
  const active = pcActiveCompassSummary(compass)
  const rawGoal = compass.goal && typeof compass.goal === 'object'
    ? compass.goal
    : { enabled: false, horizon: 'shortTerm', text: '' }
  const savedGoalText = String(rawGoal.text || '').trim()
  const hasSavedGoal = Boolean(savedGoalText)
  const savedGoalHorizonOpt = PC_GOAL_HORIZON_OPTIONS.find(opt => opt.key === rawGoal.horizon) || PC_GOAL_HORIZON_OPTIONS[0]
  const activeGoal = pcActiveGoal(compass)
  const goalDraftHorizonOpt = PC_GOAL_HORIZON_OPTIONS.find(opt => opt.key === goalHorizonDraft) || PC_GOAL_HORIZON_OPTIONS[0]
  const hasAnyRoutes = (compass.shortTerm?.length || 0) > 0 || (compass.midTerm?.length || 0) > 0 || (compass.longTerm?.length || 0) > 0
  const currentStrength = PC_STRENGTH_OPTIONS.some(opt => opt.key === compass.strength) ? compass.strength : 'guided'
  const currentStrengthOption = PC_STRENGTH_OPTIONS.find(opt => opt.key === currentStrength) || PC_STRENGTH_OPTIONS[1]
  const currentPace = compass.pace || 'natural'
  const currentPaceOption = PC_PACE_OPTIONS.find(opt => opt.key === currentPace) || PC_PACE_OPTIONS[1]
  const stalledTurns = Math.max(0, Number(compass.stalledTurns) || 0)
  const activeStage = active.shortTerm && Array.isArray(active.shortTerm.beats)
    ? active.shortTerm.beats.find(step => step && !step.done) || null
    : null
  const activeStageTurns = pcStageTurns(activeStage)
  // 与正文注入一致：超出预计轮数才加压，旧版节拍按连续 2 轮。
  const stallThreshold = Math.max(2, activeStageTurns)
  const blindBox = compass.blindBox === true
  const customDirective = String(compass.customDirective || '')
  const autoUpdateInterval = Number.isInteger(Number(compass.autoUpdateInterval)) && Number(compass.autoUpdateInterval) >= 0
    ? Math.min(100, Number(compass.autoUpdateInterval))
    : 0
  const isPresetAutoUpdateInterval = PC_AUTO_UPDATE_PRESETS.some(opt => opt.value === autoUpdateInterval)
  const maxRoutes = Number.isInteger(Number(compass.maxRoutes)) && Number(compass.maxRoutes) >= PC_MAX_ROUTES_MIN
    ? Math.min(PC_MAX_ROUTES_MAX, Number(compass.maxRoutes))
    : PC_MAX_ROUTES_DEFAULT
  const isPresetMaxRoutes = PC_MAX_ROUTES_PRESETS.some(opt => opt.value === maxRoutes)
  const latestTurn = Number(state.latestAssistantTurn) || 0
  const basedOnTurn = Number(compass.basedOnTurn) || 0
  const sinceBaseTurns = Math.max(0, latestTurn - basedOnTurn)
  const remainingAutoUpdateFloors = Math.max(0, autoUpdateInterval - sinceBaseTurns)
  const autoUpdateHint = !compassEnabled
    ? '当前罗盘已关闭，暂不触发'
    : (remainingAutoUpdateFloors === 0
      ? '下轮结算后立即全局刷新'
      : '还差 ' + remainingAutoUpdateFloors + ' 楼全局刷新')
  const chatHistory = Array.isArray(compass.chatHistory) ? compass.chatHistory : []

  useEffect(() => {
    setLocalError('')
    setLocalNotice('')
    setEditingArchetypes(false)
    setEditingGoal(false)
    setEditingDirective(false)
    setConfirmingFresh(false)
    setPeekedCards({})
    setChatOpen(false)
    setPickingIndependentModel(false)
    setCustomIntervalOpen(false)
    setCustomMaxRoutesOpen(false)
  }, [sessionId])

  useEffect(() => {
    setIntervalDraft(autoUpdateInterval > 0 ? String(autoUpdateInterval) : '')
    setCustomIntervalOpen(autoUpdateInterval > 0 && !PC_AUTO_UPDATE_PRESETS.some(opt => opt.value === autoUpdateInterval))
  }, [autoUpdateInterval, sessionId])

  useEffect(() => {
    setMaxRoutesDraft(String(maxRoutes))
    setCustomMaxRoutesOpen(!PC_MAX_ROUTES_PRESETS.some(opt => opt.value === maxRoutes))
  }, [maxRoutes, sessionId])

  useEffect(() => {
    if (!compassEnabled || (!pickingIndependentModel && !compassModelIsObject)) return
    let activeEffect = true
    setCatalogLoading(true)
    pcCall(ui, 'plot-compass:model-catalog', {}).then(result => {
      if (!activeEffect) return
      setModelCatalog(Array.isArray(result.modelCatalog) ? result.modelCatalog : [])
      setCatalogLoading(false)
    }, () => {
      if (activeEffect) setCatalogLoading(false)
    })
    return () => { activeEffect = false }
  }, [ui, compassEnabled, pickingIndependentModel, compassModelIsObject])

  useEffect(() => {
    if (!compassEnabled || !compassModelKey) return
    let activeEffect = true
    const parsed = JSON.parse(compassModelKey)
    pcCall(ui, 'plot-compass:model-reasoning', parsed).then(result => {
      if (activeEffect) setModelReasoning({ key: compassModelKey, value: result.reasoning || null, error: '' })
    }, err => {
      if (activeEffect) setModelReasoning({ key: compassModelKey, value: null, error: String(err && err.message || err) })
    })
    return () => { activeEffect = false }
  }, [ui, compassEnabled, compassModelKey])

  useEffect(() => {
    if (chatHistory.length > 0 && task.scope === 'chat') {
      setChatOpen(true)
    }
  }, [chatHistory.length, task.scope])

  useEffect(() => {
    setDirectiveDraft(customDirective)
  }, [customDirective, sessionId])

  async function saveCompassModel(nextModel, message) {
    if (busyAction) return
    setBusyAction('model')
    setLocalError('')
    setLocalNotice('')
    try {
      const res = await pcCall(ui, 'plot-compass:set-model', { gameId: sessionId, model: nextModel })
      const savedModel = res.modelSelection || res.plotCompassModel
      if (savedModel) {
        setState(prev => ({ ...prev, modelSelection: savedModel }))
      }
      await refresh()
      setPickingIndependentModel(false)
      if (message) notify(message)
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function toggleEnabled(nextEnabled) {
    if (!sessionId || busyAction) return
    setBusyAction('toggleEnabled')
    setLocalError('')
    setLocalNotice('')
    try {
      await pcCall(ui, 'plot-compass:set-enabled', { gameId: sessionId, enabled: Boolean(nextEnabled) })
      setState(prev => ({ ...prev, enabled: Boolean(nextEnabled) }))
      await refresh()
      notify(nextEnabled ? '已开启剧情罗盘。' : '已关闭剧情罗盘，本局将不再注入提示词或自动演进，已有路线已保留。')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function runGenerate(scope, customGuidance, options) {
    if (!sessionId || isRunning || busyAction) return
    const fresh = Boolean(options && options.fresh)
    setConfirmingFresh(false)
    setBusyAction('generate:' + scope)
    setLocalError('')
    setLocalNotice('')
    try {
      const text = customGuidance !== undefined ? customGuidance : guidance
      await pcCall(ui, 'plot-compass:generate', {
        gameId: sessionId,
        scope: scope || 'all',
        guidance: String(text || '').trim(),
        fresh
      })
      await refresh()
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function sendCompassChat(overrideText) {
    const text = String(overrideText !== undefined ? overrideText : guidance).trim()
    if (!text || !sessionId || isRunning || busyAction) return
    setBusyAction('chat')
    setLocalError('')
    setLocalNotice('')
    setChatOpen(true)
    if (overrideText === undefined) setGuidance('')
    try {
      await pcCall(ui, 'plot-compass:chat', { gameId: sessionId, message: text })
      await refresh()
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function clearCompassChatHistory() {
    if (!sessionId || isRunning || busyAction) return
    setBusyAction('clearChat')
    setLocalError('')
    try {
      const res = await pcCall(ui, 'plot-compass:clear-chat', { gameId: sessionId })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      setChatOpen(false)
      await refresh()
      notify('已清空脑暴对话记录。')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function applyBrainstormIdea(scope, ideaText) {
    const target = scope === 'shortTerm' ? 'shortTerm' : 'all'
    const promptText = '请严格围绕我们刚才在罗盘对话里讨论通过的以下思路，直接生成并更新正式的多分支路线规划：\n' + String(ideaText || '').slice(0, 680)
    if (target === 'shortTerm') setActiveHorizon('shortTerm')
    setPanelTab('routes')
    await runGenerate(target, promptText)
  }

  async function cancelGenerate() {
    if (!sessionId) return
    setBusyAction('cancel')
    setLocalError('')
    try {
      await pcCall(ui, 'plot-compass:cancel', { gameId: sessionId })
      await refresh()
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function togglePin(horizon, route) {
    if (!sessionId || busyAction) return
    setBusyAction('pin:' + route.id)
    setLocalError('')
    setLocalNotice('')
    try {
      const wasPinned = compass.pinned && compass.pinned[horizon] === route.id
      const res = await pcCall(ui, 'plot-compass:pin', { gameId: sessionId, horizon, routeId: route.id })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      await refresh()
      notify(wasPinned
        ? '已取消锚定「' + route.title + '」'
        : '已点亮「' + route.title + '」，将按「' + currentStrengthOption.label + '」力度牵引后续正文与候选项。')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function toggleStep(horizon, routeId, stepIndex) {
    if (!sessionId || busyAction) return
    setBusyAction('step:' + routeId + ':' + stepIndex)
    setLocalError('')
    try {
      const res = await pcCall(ui, 'plot-compass:toggle-step', { gameId: sessionId, horizon, routeId, stepIndex })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      await refresh()
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function forkWithRoute(horizon, route) {
    if (!sessionId || isRunning || busyAction) return
    if (!ui || typeof ui.forkGame !== 'function') {
      setLocalError('当前宿主版本暂不支持从插件触发分叉试玩。')
      return
    }
    setBusyAction('fork:' + route.id)
    setLocalError('')
    setLocalNotice('')
    try {
      const forked = await ui.forkGame(sessionId, {
        turn: Number(state.latestAssistantTurn) || 0,
        titleSuffix: ' · ' + (route.tag || route.title)
      })
      const targetId = typeof forked === 'string' ? forked : String(forked?.gameId || '')
      if (targetId) {
        await pcCall(ui, 'plot-compass:pin', { gameId: targetId, horizon, routeId: route.id, exact: true })
        notify('已分叉平行存档，并点亮「' + route.title + '」。')
      }
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function drillDownRoute(fromHorizon, route) {
    const targetScope = fromHorizon === 'longTerm' ? 'midTerm' : 'shortTerm'
    const targetName = targetScope === 'midTerm' ? '中期篇章' : '今期节拍'
    const countPhrase = maxRoutes === 1 ? '1 条聚焦' : ('最多 ' + maxRoutes + ' 条不同切入角度的')
    const promptText = '围绕已选定的方向「' + route.title + '」（' + (route.vision || route.summary || '') + '），拆解出' + countPhrase + targetName + '路线。'
    setActiveHorizon(targetScope)
    await runGenerate(targetScope, promptText)
  }

  async function refreshCandidatesFromCompass() {
    if (!sessionId || busyAction) return
    if (!ui || typeof ui.regenerateCandidates !== 'function') {
      setLocalError('当前宿主版本暂不支持直接从罗盘触发候选项重生成。')
      return
    }
    setBusyAction('candidates')
    setLocalError('')
    setLocalNotice('')
    try {
      await ui.regenerateCandidates(sessionId, '')
      notify('已提交候选项生成，新候选项将携带当前罗盘路线角标。')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  function openArchetypeEditor() {
    const initial = (compass.customArchetypes && compass.customArchetypes.length)
      ? compass.customArchetypes
      : (compass.playArchetypes || [])
    setSelectedArchetypes(initial.slice(0, 5))
    setArchetypeDraft('')
    setEditingArchetypes(true)
  }

  function togglePresetArchetype(tag) {
    setSelectedArchetypes(prev => {
      if (prev.includes(tag)) return prev.filter(item => item !== tag)
      if (prev.length >= 5) return prev
      return prev.concat(tag)
    })
  }

  function addCustomArchetypeChip() {
    const text = String(archetypeDraft || '').trim().slice(0, 16)
    if (!text) return
    setSelectedArchetypes(prev => {
      if (prev.includes(text) || prev.length >= 5) return prev
      return prev.concat(text)
    })
    setArchetypeDraft('')
  }

  async function saveArchetypes(andRegenerate) {
    if (!sessionId || busyAction) return
    setBusyAction('archetypes')
    setLocalError('')
    try {
      const pendingText = String(archetypeDraft || '').trim().slice(0, 16)
      const finalTags = pendingText && !selectedArchetypes.includes(pendingText) && selectedArchetypes.length < 5
        ? selectedArchetypes.concat(pendingText)
        : selectedArchetypes
      const res = await pcCall(ui, 'plot-compass:set-archetypes', { gameId: sessionId, archetypes: finalTags })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      setEditingArchetypes(false)
      setArchetypeDraft('')
      await refresh()
      if (andRegenerate) {
        setBusyAction('')
        setPanelTab('routes')
        await runGenerate('all')
        return
      }
      notify(finalTags.length ? '已锁定游玩类型标签：' + finalTags.join('、') : '已恢复自动识别游玩类型')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  function openGoalEditor() {
    const initialHorizon = hasSavedGoal
      ? savedGoalHorizonOpt.key
      : (PC_GOAL_HORIZON_OPTIONS.some(opt => opt.key === activeHorizon) ? activeHorizon : 'shortTerm')
    setGoalHorizonDraft(initialHorizon)
    setGoalTextDraft(savedGoalText)
    setEditingGoal(true)
  }

  async function saveGoal(andRegenerate) {
    if (!sessionId || busyAction) return
    const trimmed = String(goalTextDraft || '').trim()
    if (!trimmed) {
      setLocalError('请先填写目标结果内容')
      return
    }
    setBusyAction('goal')
    setLocalError('')
    setLocalNotice('')
    try {
      const opt = PC_GOAL_HORIZON_OPTIONS.find(item => item.key === goalHorizonDraft) || PC_GOAL_HORIZON_OPTIONS[0]
      const res = await pcCall(ui, 'plot-compass:set-goal', {
        gameId: sessionId,
        text: trimmed,
        horizon: opt.key,
        enabled: true
      })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      setEditingGoal(false)
      await refresh()
      if (andRegenerate && !isRunning) {
        setBusyAction('')
        setPanelTab('routes')
        setActiveHorizon(opt.key)
        await runGenerate(
          'all',
          '玩家已设定「' + opt.label + '」目标导向：「' + trimmed + '」。请围绕该目标结果生成并收束今期、中期、长期整棵剧情树，确保所有分支路线最终导向达成该目标结果。'
        )
        return
      }
      notify('已开启「' + opt.label + '」目标导向，后续生成的剧情树与正文推进将导向此结果。')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function toggleGoalEnabled(nextEnabled) {
    if (!sessionId || busyAction || !hasSavedGoal) return
    setBusyAction('goalToggle')
    setLocalError('')
    setLocalNotice('')
    try {
      const res = await pcCall(ui, 'plot-compass:set-goal', {
        gameId: sessionId,
        enabled: Boolean(nextEnabled)
      })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      await refresh()
      notify(nextEnabled
        ? '已恢复「' + savedGoalHorizonOpt.label + '」目标导向，后续生成的剧情树将导向所设目标。'
        : '已暂停目标导向，恢复自由发散推演（目标内容已保留）。')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function clearGoal() {
    if (!sessionId || busyAction) return
    setBusyAction('goalClear')
    setLocalError('')
    setLocalNotice('')
    try {
      const res = await pcCall(ui, 'plot-compass:set-goal', {
        gameId: sessionId,
        text: '',
        enabled: false
      })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      setGoalTextDraft('')
      setEditingGoal(false)
      await refresh()
      notify('已清除目标导向，恢复多结局自由发散模式。')
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  async function savePreferences(patch, noticeText) {
    if (!sessionId || busyAction) return
    setBusyAction('preferences')
    setLocalError('')
    try {
      const res = await pcCall(ui, 'plot-compass:set-preferences', { gameId: sessionId, ...patch })
      if (res.plotCompass) setState(prev => ({ ...prev, plotCompass: res.plotCompass }))
      await refresh()
      if (noticeText) notify(noticeText)
    } catch (err) {
      setLocalError(String(err && err.message || err))
    } finally {
      setBusyAction('')
    }
  }

  function commitCustomInterval() {
    const trimmed = String(intervalDraft || '').trim()
    if (!trimmed) {
      setCustomIntervalOpen(false)
      setIntervalDraft(autoUpdateInterval > 0 ? String(autoUpdateInterval) : '')
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      setLocalError('自动更新间隔须为 0–100 的整数（0 表示关闭）')
      return
    }
    if (parsed === autoUpdateInterval) {
      if (PC_AUTO_UPDATE_PRESETS.some(opt => opt.value === parsed)) {
        setCustomIntervalOpen(false)
      }
      return
    }
    savePreferences(
      { autoUpdateInterval: parsed },
      parsed > 0 ? '已设置每 ' + parsed + ' 楼自动全局刷新剧情罗盘。' : '已关闭剧情罗盘定期自动更新。'
    )
  }

  function commitCustomMaxRoutes() {
    const trimmed = String(maxRoutesDraft || '').trim()
    if (!trimmed) {
      setCustomMaxRoutesOpen(false)
      setMaxRoutesDraft(String(maxRoutes))
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < PC_MAX_ROUTES_MIN || parsed > PC_MAX_ROUTES_MAX) {
      setLocalError('剧情规划条目上限须为 ' + PC_MAX_ROUTES_MIN + '–' + PC_MAX_ROUTES_MAX + ' 的整数')
      return
    }
    if (parsed === maxRoutes) {
      if (PC_MAX_ROUTES_PRESETS.some(opt => opt.value === parsed)) {
        setCustomMaxRoutesOpen(false)
      }
      return
    }
    savePreferences(
      { maxRoutes: parsed },
      '已设置每层剧情规划上限为 ' + parsed + ' 条。'
    )
  }

  function toggleCardPeek(horizon, routeId) {
    const key = horizon + ':' + routeId
    setPeekedCards(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const topTitleBlock = h('h3', { className: 'pc-wb-title' },
    h(PcCompassIcon, { size: 16 }),
    '剧情罗盘',
    h(PcHelpToggle, { title: '剧情罗盘', open: overviewHelpOpen, onToggle: value => setOverviewHelpOpen(Boolean(value)) }))

  if (!sessionId) {
    return h('aside', { className: 'pc-root pc-workbench' },
      h('div', { className: 'pc-wb-top' },
        h('div', { className: 'pc-wb-head' }, topTitleBlock),
        overviewHelpOpen ? pcHelpPop('剧情罗盘', PC_HELP.overview, () => setOverviewHelpOpen(false), overviewHelpRef) : null),
      h('div', { className: 'pc-wb-scroll' },
        h('div', { className: 'pc-empty' },
          h('p', { className: 'pc-hint' }, '请先打开一局游玩对话，即可推演今期、中期、长期的多路线剧情发展灵感。'))))
  }

  if (!state.loaded) {
    return h('aside', { className: 'pc-root pc-workbench', 'aria-busy': true },
      h('div', { className: 'pc-wb-top' },
        h('div', { className: 'pc-wb-head' }, topTitleBlock),
        overviewHelpOpen ? pcHelpPop('剧情罗盘', PC_HELP.overview, () => setOverviewHelpOpen(false), overviewHelpRef) : null),
      h('div', { className: 'pc-wb-scroll' },
        h('div', { className: 'pc-section' },
          h('p', { className: 'pc-hint', role: 'status' }, '正在读取当前对局…'))))
  }

  const activeMeta = PC_HORIZON_META.find(m => m.key === activeHorizon) || PC_HORIZON_META[0]
  const currentRoutes = Array.isArray(compass[activeHorizon]) ? compass[activeHorizon] : []
  const currentPinnedId = compass.pinned ? compass.pinned[activeHorizon] : null
  const displayArchetypes = (compass.customArchetypes && compass.customArchetypes.length)
    ? compass.customArchetypes
    : (compass.playArchetypes || [])

  function onHorizonKeyDown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const at = PC_HORIZON_META.findIndex(m => m.key === activeHorizon)
    const nextAt = (at + (event.key === 'ArrowRight' ? 1 : PC_HORIZON_META.length - 1)) % PC_HORIZON_META.length
    setActiveHorizon(PC_HORIZON_META[nextAt].key)
  }

  function renderGoalBlock() {
    if (editingGoal) {
      return h('div', { className: 'pc-goal-box', role: 'region', 'aria-label': '目标导向设置' },
        h('div', { className: 'pc-tabbar is-3', role: 'group', 'aria-label': '目标时间跨度' },
          PC_GOAL_HORIZON_OPTIONS.map(opt => {
            const selected = goalDraftHorizonOpt.key === opt.key
            return h('button', {
              key: opt.key,
              type: 'button',
              className: 'pc-tab' + (selected ? ' is-active' : ''),
              disabled: Boolean(busyAction),
              'aria-pressed': selected ? 'true' : 'false',
              title: opt.title,
              onClick: () => setGoalHorizonDraft(opt.key)
            }, h('span', { className: 'pc-tab-title' }, opt.label), h('small', null, opt.span))
          })),
        h('input', {
          type: 'text',
          className: 'pc-input',
          'aria-label': '目标结果内容',
          maxLength: 300,
          placeholder: goalDraftHorizonOpt.placeholder,
          value: goalTextDraft,
          disabled: Boolean(busyAction),
          onChange: e => setGoalTextDraft(e.target.value),
          onKeyDown: e => {
            if (e.key === 'Enter' && !e.isComposing && goalTextDraft.trim()) {
              e.preventDefault()
              saveGoal(!isRunning)
            }
          }
        }),
        h('p', { className: 'pc-hint' }, goalDraftHorizonOpt.hint),
        h('div', { className: 'pc-btn-row' },
          h(PcBtn, {
            small: true, primary: true,
            disabled: Boolean(busyAction) || isRunning || !goalTextDraft.trim(),
            title: '保存目标导向并立即推演导向该目标结果的整棵剧情树',
            onClick: () => saveGoal(true)
          }, '保存并推演剧情树'),
          h(PcBtn, {
            small: true,
            disabled: Boolean(busyAction) || !goalTextDraft.trim(),
            title: '保存目标导向，后续手动推演、自动演进与正文推进均将导向此结果',
            onClick: () => saveGoal(false)
          }, '仅保存目标'),
          hasSavedGoal ? h(PcBtn, { small: true, danger: true, disabled: Boolean(busyAction), onClick: clearGoal }, '清除目标') : null,
          h(PcBtn, { small: true, disabled: Boolean(busyAction), onClick: () => setEditingGoal(false) }, '取消')))
    }

    if (hasSavedGoal) {
      return h('div', {
        className: 'pc-goal-box' + (rawGoal.enabled ? '' : ' is-paused'),
        'aria-label': '当前目标导向'
      },
        h('div', { className: 'pc-section-head' },
          h('div', { className: 'pc-badge-row' },
            h('strong', { style: { fontSize: '12px' } }, '🎯 目标导向'),
            h(PcBadge, { tone: rawGoal.enabled ? 'ok' : 'off' }, savedGoalHorizonOpt.label + ' · ' + savedGoalHorizonOpt.span),
            !rawGoal.enabled ? h(PcBadge, { tone: 'off' }, '已暂停') : null),
          h('div', { className: 'pc-btn-row' },
            h(PcChip, { disabled: Boolean(busyAction), onClick: () => toggleGoalEnabled(!rawGoal.enabled) }, rawGoal.enabled ? '暂停' : '启用'),
            h(PcChip, { disabled: Boolean(busyAction), onClick: openGoalEditor }, '修改'),
            h(PcChip, { disabled: Boolean(busyAction), onClick: clearGoal }, '清除'))),
        h('p', { className: 'pc-goal-text' }, savedGoalText))
    }

    return h('div', { className: 'pc-row is-plain' },
      h('div', { className: 'pc-row-main' },
        h('span', { className: 'pc-row-sub' }, '未设置（默认发散多结局自由剧情树）')),
      h('div', { className: 'pc-row-end' },
        h(PcBtn, {
          small: true,
          disabled: Boolean(busyAction),
          title: '设置短期 / 中期 / 长期目标结果，使后续生成的剧情树全部导向达成该结果',
          onClick: openGoalEditor
        }, '🎯 设置目标')))
  }

  function renderRouteCard(horizon, route) {
    const isPinned = currentPinnedId === route.id
    const steps = horizon === 'shortTerm' ? (route.beats || []) : horizon === 'midTerm' ? (route.milestones || []) : []
    const doneCount = steps.filter(s => s && s.done).length
    const peekKey = horizon + ':' + route.id
    const isPeeked = Boolean(peekedCards[peekKey])
    const isMasked = blindBox && !isPeeked

    return h('article', {
      key: route.id,
      className: 'pc-card' + (isPinned ? ' is-pinned' : '') + (isMasked ? ' is-blindbox' : ''),
      'data-horizon': horizon
    },
      h('header', { className: 'pc-card-head' },
        h('div', { className: 'pc-card-titles' },
          h('span', { className: 'pc-route-tag' }, '〔' + route.tag + '〕'),
          h('h4', { className: 'pc-card-title' }, route.title)),
        h('div', { className: 'pc-badge-row' },
          route.direction || route.tone ? h(PcBadge, null, route.direction || route.tone) : null,
          route.sourceHook ? h(PcBadge, { tone: 'warn', title: '灵感来源' }, route.sourceHook) : null,
          isPinned ? h(PcBadge, { tone: 'ok' }, '★ 已锚定') : null)),
      isMasked
        ? h('div', { className: 'pc-blindbox-mask' },
            h('p', { className: 'pc-meta-line' },
              route.diegeticOmen
                ? '🎁 盲盒防剧透已开启（已隐藏走向与节点）：' + route.diegeticOmen
                : '🎁 盲盒防剧透已开启：详细节拍、因果依据与终局剧透已遮罩，仅保留方向基调，放心在正文中探索未知。'),
            steps.length > 0 ? h('p', { className: 'pc-meta-line is-subtle' }, '当前进度：' + doneCount + '/' + steps.length + ' 阶段已完成') : null,
            h(PcChip, { onClick: () => toggleCardPeek(horizon, route.id) }, '👀 临时查看此卡剧透'))
        : h(Fragment, null,
            blindBox ? h('div', { className: 'pc-btn-row', style: { justifyContent: 'flex-end' } },
              h(PcChip, { onClick: () => toggleCardPeek(horizon, route.id) }, '🙈 收起剧透')) : null,
            h('p', { className: 'pc-card-summary' }, horizon === 'longTerm' ? route.vision : route.summary),
            route.causalBasis && horizon !== 'longTerm' ? h('p', { className: 'pc-meta-line' },
              h('strong', null, '因果依据：'), route.causalBasis) : null,
            horizon === 'shortTerm' && route.sceneTrigger ? h('p', { className: 'pc-meta-line is-subtle', title: '仅在对话空转时供正文参考的破冰引子，不限制候选与正文的临场演法' },
              h('strong', null, '破冰参考：'), route.sceneTrigger) : null,
            horizon === 'midTerm' && route.entryHook ? h('div', { className: 'pc-callout' },
              h('strong', null, '入线契机：'), h('span', null, route.entryHook)) : null,
            steps.length > 0 ? h('div', { className: 'pc-steps' },
              h('div', { className: 'pc-steps-head' },
                h('span', null, (horizon === 'shortTerm' ? '推进节拍' : '篇章里程碑') + ' · 随新回合自动打勾（可点选）'),
                h('span', null, doneCount + '/' + steps.length)),
              h('ul', { className: 'pc-step-list' }, steps.map((step, idx) => {
                const checked = Boolean(step && step.done)
                const roleLabel = horizon === 'midTerm' ? pcMidPhaseLabel(idx, steps.length) : ''
                const stageTurns = horizon === 'shortTerm' ? pcStageTurns(step) : 0
                const stageNote = horizon === 'shortTerm' && !checked
                  ? [step.friction ? '阻力：' + step.friction : '', step.doneWhen ? '达成：' + step.doneWhen : ''].filter(Boolean).join(' ｜ ')
                  : ''
                return h('li', { key: idx, className: checked ? 'is-done' : '' },
                  h('button', {
                    type: 'button',
                    className: 'pc-step-btn',
                    disabled: Boolean(busyAction),
                    'aria-pressed': checked ? 'true' : 'false',
                    title: checked ? '标记为未完成' : '标记为已达成',
                    onClick: () => toggleStep(horizon, route.id, idx)
                  },
                    h('span', { className: 'pc-check', 'aria-hidden': true }, checked ? '✓' : '○'),
                    roleLabel ? h('span', { className: 'pc-phase-tag' }, roleLabel) : null,
                    stageTurns ? h('span', { className: 'pc-phase-tag' }, '约' + stageTurns + '轮') : null,
                    h('span', { className: 'pc-step-body' },
                      h('span', { className: 'pc-step-text' }, step.text),
                      stageNote ? h('span', { className: 'pc-step-note' }, stageNote) : null)))
              }))) : null,
            horizon === 'midTerm' && route.stakes ? h('p', { className: 'pc-meta-line' },
              h('strong', null, '收益与风险：'), route.stakes) : null,
            horizon === 'longTerm' && Array.isArray(route.prerequisites) && route.prerequisites.length > 0 ? h('div', { className: 'pc-steps' },
              h('div', { className: 'pc-steps-head' }, h('span', null, '达成前置拐点')),
              h('ul', { className: 'pc-prereq-list' }, route.prerequisites.map((req, idx) => h('li', { key: idx }, req)))) : null,
            horizon === 'longTerm' && route.toneGuidance ? h('p', { className: 'pc-meta-line is-subtle', title: '点亮此终局后，前台正文只会收到这句暗流基调，不会剧透或抢跑结局' },
              h('strong', null, '防剧透暗流指引：'), route.toneGuidance) : null,
            route.diegeticOmen && horizon !== 'shortTerm' ? h('p', { className: 'pc-meta-line is-subtle', title: '点亮此路线时，正文可通过传闻/异象自然透出此风声（不剧透）' },
              h('strong', null, '世界内预兆：'), route.diegeticOmen) : null),
      h('footer', { className: 'pc-btn-row' },
        h(PcBtn, {
          small: true,
          primary: isPinned,
          disabled: Boolean(busyAction),
          onClick: () => togglePin(horizon, route)
        }, isPinned ? '✓ 已点亮（取消）' : '点亮此路线'),
        horizon !== 'shortTerm' ? h(PcBtn, {
          small: true,
          disabled: isRunning || Boolean(busyAction),
          title: horizon === 'longTerm' ? '围绕此终局推演配套的中期篇章路线' : '围绕此篇章推演眼前的今期节拍路线',
          onClick: () => drillDownRoute(horizon, route)
        }, horizon === 'longTerm' ? '拆解中期 ↘' : '拆解今期 ↘') : null,
        ui && typeof ui.forkGame === 'function' ? h(PcBtn, {
          small: true,
          disabled: isRunning || Boolean(busyAction),
          title: '从当前回合克隆出一个独立平行存档，并自动点亮此路线',
          onClick: () => forkWithRoute(horizon, route)
        }, '分叉试玩 ⑂') : null))
  }

  const routesTabBody = h(Fragment, null,
    confirmingFresh ? h('div', { className: 'pc-alert is-warn', role: 'dialog', 'aria-label': '确认全新生成' },
      h('span', null,
        '全新生成会作废当前盘面上的今期 / 中期 / 长期全部路线和点亮标记，模型也看不到这些旧内容，只会依据当前剧情重新推演一套独立方向。' +
        (activeGoal ? '当前开启的「' + activeGoal.horizonLabel + '目标导向」会保留，新生成的剧情树仍将导向该目标结果。' : '已归档的历史记录会保留。') +
        '确定继续？'),
      h('div', { className: 'pc-btn-row', style: { justifyContent: 'flex-end' } },
        h(PcBtn, { small: true, onClick: () => setConfirmingFresh(false) }, '取消'),
        h(PcBtn, { small: true, primary: true, disabled: Boolean(busyAction), onClick: () => runGenerate('all', undefined, { fresh: true }) }, '全新生成'))) : null,

    isRunning ? h('div', { className: 'pc-alert is-info', role: 'status' },
      h('div', { className: 'pc-alert-left' },
        h(PcSpinner),
        h('span', null, task.scope === 'chat'
          ? '脑暴灵感助手正在结合人设、现场定格' + (activeGoal ? '与' + activeGoal.horizonLabel + '目标导向' : '与世界书暗线') + '构思回复…'
          : '后台正在' + (activeGoal ? '围绕「' + activeGoal.horizonLabel + '目标导向」' : '结合人物卡、变量状态与世界书暗线') + '推演' + (task.scope === 'shortTerm' ? '今期' : task.scope === 'midTerm' ? '中期' : task.scope === 'longTerm' ? '长期' : '今期 / 中期 / 长期') + '路线…（不影响继续对话）'))) : null,

    task.status === 'failed' && task.error ? h('div', { className: 'pc-alert is-error', role: 'alert' },
      h('span', null, task.error),
      task.scope !== 'chat' ? h(PcBtn, { small: true, disabled: isRunning || Boolean(busyAction), onClick: () => runGenerate(task.scope || 'all') }, '重试') : null) : null,

    localError ? h('div', { className: 'pc-alert is-error', role: 'alert' }, h('span', null, localError)) : null,

    /* 头部：游玩类型标签 + 目标导向 */
    h('section', { className: 'pc-section', 'aria-label': '游玩类型与目标导向' },
      h(PcField, {
        label: '游玩类型标签',
        help: PC_HELP.archetypes,
        actions: h(PcChip, {
          disabled: Boolean(busyAction),
          onClick: () => { editingArchetypes ? setEditingArchetypes(false) : openArchetypeEditor() }
        }, editingArchetypes ? '收起' : '定制标签')
      },
        h('div', { className: 'pc-badge-row' },
          displayArchetypes.length > 0
            ? displayArchetypes.map(tag => h(PcBadge, { key: tag, tone: 'accent' }, tag))
            : h('span', { className: 'pc-hint' }, '推演时自动识别，也可点右侧「定制标签」手动锁定')),
        editingArchetypes ? h('div', { className: 'pc-field', style: { marginTop: '4px' } },
          h('span', { className: 'pc-hint' }, '选择或输入 1–5 个游玩题材/流派标签，AI 将按对应戏剧维度发散路线：'),
          h('div', { className: 'pc-chip-group' }, PC_PRESET_ARCHETYPES.map(tag => {
            const on = selectedArchetypes.includes(tag)
            return h(PcChip, { key: tag, active: on, onClick: () => togglePresetArchetype(tag) }, (on ? '✓ ' : '+ ') + tag)
          })),
          selectedArchetypes.length > 0 ? h('div', { className: 'pc-chip-group' },
            selectedArchetypes.map(tag => h('span', { key: tag, className: 'pc-badge is-accent' },
              tag,
              h('button', {
                type: 'button',
                className: 'pc-chip-x',
                'aria-label': '移除 ' + tag,
                onClick: () => setSelectedArchetypes(selectedArchetypes.filter(t => t !== tag))
              }, '×')))) : null,
          h('div', { className: 'pc-btn-row' },
            h('input', {
              type: 'text',
              className: 'pc-input is-inline',
              maxLength: 16,
              placeholder: '自定义流派（如：克苏鲁调查、赛博跑团）',
              value: archetypeDraft,
              onChange: e => setArchetypeDraft(e.target.value),
              onKeyDown: e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addCustomArchetypeChip() } }
            }),
            h(PcBtn, { small: true, disabled: !archetypeDraft.trim() || selectedArchetypes.length >= 5, onClick: addCustomArchetypeChip }, '添加')),
          h('div', { className: 'pc-btn-row' },
            h(PcBtn, { small: true, primary: true, disabled: Boolean(busyAction), onClick: () => saveArchetypes(true) }, '保存并立即重推路线'),
            h(PcBtn, { small: true, disabled: Boolean(busyAction), onClick: () => saveArchetypes(false) }, '仅保存'),
            selectedArchetypes.length > 0 ? h(PcBtn, { small: true, danger: true, disabled: Boolean(busyAction), onClick: () => setSelectedArchetypes([]) }, '清空') : null)) : null),

      h('div', { className: 'pc-divider' }),

      h(PcField, {
        label: '目标导向',
        help: PC_HELP.goal
      }, renderGoalBlock())),

    /* 局势摘要 + 脑暴灵感对话 */
    h(PcSection, {
      title: '💬 局势与脑暴灵感',
      helpTitle: '局势与脑暴灵感',
      help: PC_HELP.brainstorm
    },
      compass.situationDigest ? h('p', { className: 'pc-digest' }, compass.situationDigest) : null,
      chatHistory.length > 0 ? h('div', { className: 'pc-section-head' },
        h(PcChip, { onClick: () => setChatOpen(!chatOpen) }, (chatOpen ? '▾ 收起' : '▸ 展开') + '脑暴对话（' + chatHistory.length + '）'),
        chatOpen ? h(PcChip, { disabled: isRunning || Boolean(busyAction), onClick: clearCompassChatHistory }, '清空记录') : null) : null,
      chatOpen && chatHistory.length > 0 ? h('div', { className: 'pc-chat-thread', 'aria-label': '剧情罗盘脑暴对话记录' },
        chatHistory.map(msg => {
          const isUser = msg.role === 'user'
          const scopeBadge = msg.scopeApplied === 'shortTerm' ? '今期'
            : msg.scopeApplied === 'midTerm' ? '中期'
            : msg.scopeApplied === 'longTerm' ? '长期'
            : msg.scopeApplied === 'all' ? '全部' : ''
          return h('div', { key: msg.id, className: 'pc-chat-msg ' + (isUser ? 'is-user' : 'is-assistant') },
            h('div', { className: 'pc-chat-bubble' }, msg.text),
            !isUser ? h('div', { className: 'pc-btn-row' },
              scopeBadge
                ? h(PcChip, {
                    tone: 'ok',
                    onClick: () => { if (msg.scopeApplied && msg.scopeApplied !== 'all') setActiveHorizon(msg.scopeApplied) }
                  }, '★ 已按此对话更新「' + scopeBadge + '」路线')
                : h(Fragment, null,
                    h(PcChip, {
                      disabled: isRunning || Boolean(busyAction),
                      title: '将上面讨论的方案立即生成并更新今期路线卡片',
                      onClick: () => applyBrainstormIdea('shortTerm', msg.text)
                    }, '✨ 应用为今期'),
                    h(PcChip, {
                      disabled: isRunning || Boolean(busyAction),
                      title: '将上面讨论的方案同步规划进今/中/长期全部路线',
                      onClick: () => applyBrainstormIdea('all', msg.text)
                    }, '✦ 应用为全局'))) : null)
        })) : null,
      h('div', { className: 'pc-btn-row' },
        h('input', {
          type: 'text',
          className: 'pc-input is-inline',
          maxLength: 400,
          disabled: isRunning,
          placeholder: '聊聊剧情点子或指定发展方向（回车商量，不覆盖当前路线）',
          value: guidance,
          onChange: e => setGuidance(e.target.value),
          onKeyDown: e => {
            if (e.key === 'Enter' && !e.isComposing && !isRunning) {
              e.preventDefault()
              sendCompassChat()
            }
          }
        }),
        h(PcBtn, {
          small: true, primary: true,
          disabled: isRunning || Boolean(busyAction) || !guidance.trim(),
          title: '与剧情罗盘多轮讨论灵感（仅当你在对话里明确要求改路线时才会更新卡片）',
          onClick: () => sendCompassChat()
        }, isRunning && task.scope === 'chat' ? '思考中…' : '💬 发送'),
        guidance.trim() ? h(PcBtn, {
          small: true,
          disabled: isRunning || Boolean(busyAction),
          title: '不经对话，直接按输入框方向全局重推今/中/长期路线',
          onClick: () => runGenerate('all')
        }, '✨ 直接重推') : null)),

    /* 当前激活方向 + 微调引导 */
    (active.count > 0 || activeGoal || editingDirective || customDirective)
      ? h(PcSection, {
        accent: true,
        title: (active.count > 0 || activeGoal) ? h(Fragment, null, h(PcCompassIcon, { size: 14 }), '当前激活方向') : '✏️ 剧情微调引导',
        helpTitle: '当前激活方向与微调引导',
        help: PC_HELP.funnel,
        actions: h(Fragment, null,
          h(PcChip, {
            disabled: Boolean(busyAction),
            title: '在不重推路线的前提下，补充或微调前台正文导演引导的侧重点',
            onClick: () => setEditingDirective(!editingDirective)
          }, editingDirective ? '收起微调' : (customDirective ? '✏️ 已设微调' : '✏️ 微调引导')),
          (active.count > 0 || activeGoal) && ui && typeof ui.regenerateCandidates === 'function'
            ? h(PcBtn, {
              small: true,
              disabled: Boolean(busyAction),
              title: '按当前罗盘路线与目标导向重新生成下一步行动候选项（带路线角标）',
              onClick: refreshCandidatesFromCompass
            }, busyAction === 'candidates' ? '提交中…' : '生成联动候选项')
            : null)
      },
        (active.count > 0 || activeGoal) ? h('div', { className: 'pc-badge-row' },
          h(PcBadge, { tone: currentStrength === 'strict' ? 'bad' : 'ok' }, '力度：' + currentStrengthOption.label),
          h(PcBadge, null, '节奏：' + currentPaceOption.label),
          activeStage && activeStageTurns > 0
            ? h(PcBadge, { title: '当前点亮的今期节拍预计 ' + activeStageTurns + ' 轮达成，正文出现达成标志后自动打勾' }, '节拍进度：第 ' + (stalledTurns + 1) + ' 轮 / 约 ' + activeStageTurns + ' 轮')
            : null,
          activeStage && currentStrength !== 'soft' && stalledTurns >= stallThreshold
            ? h(PcBadge, { tone: 'warn', title: '当前点亮的今期节拍已连续 ' + stalledTurns + ' 轮未达成' + (activeStageTurns > 0 ? '（预计 ' + activeStageTurns + ' 轮）' : '') + '，下轮将自动加强破局推力' }, '⚡ 停滞 ' + stalledTurns + ' 轮·加压中')
            : null) : null,
        (active.count > 0 || activeGoal) ? h('div', { className: 'pc-chip-group' },
          activeGoal ? h(PcChip, { tone: 'goal', title: '点击查看对应跨度路线', onClick: () => setActiveHorizon(activeGoal.horizon) }, '🎯 ' + activeGoal.horizonLabel + '目标：' + activeGoal.text) : null,
          active.shortTerm ? h(PcChip, { tone: 'ok', onClick: () => setActiveHorizon('shortTerm') }, '今期：' + active.shortTerm.title) : null,
          active.midTerm ? h(PcChip, { tone: 'ok', onClick: () => setActiveHorizon('midTerm') }, '中期：' + active.midTerm.title) : null,
          active.longTerm ? h(PcChip, { tone: 'ok', onClick: () => setActiveHorizon('longTerm') }, '长期：' + active.longTerm.title) : null) : null,
        (editingDirective || customDirective) ? (
          editingDirective
            ? h('div', { className: 'pc-btn-row' },
                h('input', {
                  type: 'text',
                  className: 'pc-input is-inline',
                  maxLength: 240,
                  placeholder: '微调导演引导语气或侧重点（如：本段多给对话交锋与误会，先别点破真相）',
                  value: directiveDraft,
                  onChange: e => setDirectiveDraft(e.target.value),
                  onKeyDown: e => {
                    if (e.key === 'Enter' && !e.isComposing) {
                      e.preventDefault()
                      savePreferences({ customDirective: directiveDraft }, directiveDraft.trim() ? '已更新微调引导（无需重推路线，下轮立即生效）' : '已清空微调引导').then(() => setEditingDirective(false))
                    }
                  }
                }),
                h(PcBtn, {
                  small: true, primary: true, disabled: Boolean(busyAction),
                  onClick: () => savePreferences({ customDirective: directiveDraft }, directiveDraft.trim() ? '已更新微调引导（无需重推路线，下轮立即生效）' : '已清空微调引导').then(() => setEditingDirective(false))
                }, '应用'),
                customDirective ? h(PcBtn, {
                  small: true, danger: true, disabled: Boolean(busyAction),
                  onClick: () => { setDirectiveDraft(''); savePreferences({ customDirective: '' }, '已清空微调引导').then(() => setEditingDirective(false)) }
                }, '清空') : null)
            : h('p', { className: 'pc-meta-line is-subtle' }, h('strong', null, '微调引导：'), customDirective)
        ) : null)
      : null,

    /* 三层时间跨度路线区 */
    h(PcSection, {
      title: '🗺️ 多路线剧情树',
      helpTitle: '三层时间跨度路线',
      help: PC_HELP.horizons,
      actions: h(Fragment, null,
        (active.count === 0 && !activeGoal)
          ? h(PcChip, {
            disabled: Boolean(busyAction),
            title: '直接指定本段剧情的导演微调要求（无需先推演或点亮路线）',
            onClick: () => setEditingDirective(!editingDirective)
          }, editingDirective ? '收起微调' : (customDirective ? '✏️ 已设微调' : '✏️ 微调引导'))
          : null,
        hasAnyRoutes && !isRunning
          ? h(PcChip, { disabled: Boolean(busyAction), onClick: () => runGenerate(activeHorizon) }, '↻ 换一批' + activeMeta.label)
          : null)
    },
      h('div', { className: 'pc-tabbar is-3', role: 'tablist', 'aria-label': '剧情规划时间跨度', onKeyDown: onHorizonKeyDown },
        PC_HORIZON_META.map(meta => {
          const selected = meta.key === activeHorizon
          const count = Array.isArray(compass[meta.key]) ? compass[meta.key].length : 0
          const hasPin = Boolean(compass.pinned && compass.pinned[meta.key])
          const isGoalHorizon = Boolean(activeGoal && activeGoal.horizon === meta.key)
          return h('button', {
            key: meta.key,
            type: 'button',
            role: 'tab',
            'aria-selected': selected ? 'true' : 'false',
            tabIndex: selected ? 0 : -1,
            className: 'pc-tab' + (selected ? ' is-active' : '') + (hasPin ? ' has-pin' : ''),
            onClick: () => setActiveHorizon(meta.key)
          },
            h('span', { className: 'pc-tab-title' }, (isGoalHorizon ? '🎯 ' : '') + (hasPin ? '★ ' : '') + meta.label),
            h('small', null, count > 0 ? meta.span + ' · ' + count : meta.span))
        })),
      h('p', { className: 'pc-hint' },
        activeGoal && activeGoal.horizon === activeHorizon
          ? '🎯 当前层级已锁定目标导向，所有路线将殊途同归导向所设结果'
          : activeMeta.subtitle),
      currentRoutes.length > 0
        ? h('div', { className: 'pc-cards' }, currentRoutes.map(route => renderRouteCard(activeHorizon, route)))
        : !isRunning
          ? h('div', { className: 'pc-empty' },
              h('p', null, '尚未生成' + activeMeta.label + '路线规划。'),
              h('p', { className: 'pc-hint' },
                activeGoal
                  ? '已设置「' + activeGoal.horizonLabel + '」目标导向。点击下方按钮，AI 将结合当前剧情、人物卡与世界书暗线，推演出整棵导向该目标结果的多分支剧情树。'
                  : '点击「✦ 推演多路线」，AI 将基于本卡题材玩法、已埋伏笔与未触发的世界书暗线，提供多条截然不同的近/中/长期发展路线供你挑选灵感或一键分叉试玩。'),
              h(PcBtn, { small: true, primary: true, disabled: Boolean(busyAction), onClick: () => runGenerate('all') },
                activeGoal ? '✦ 立即推演目标导向剧情树' : '✦ 立即推演今期 / 中期 / 长期路线'))
          : null),

    Array.isArray(compass.archived) && compass.archived.length > 0 ? h('details', { className: 'pc-archived' },
      h('summary', null, '已偏离/归档的旧路线（' + compass.archived.length + '）'),
      compass.archived.map((item, idx) => h('p', { key: idx, className: 'pc-hint', style: { marginTop: '4px' } },
        '【第 ' + (item.turn || '?') + ' 轮 · ' + item.title + '】' + (item.reason || '剧情已走向新分支')))) : null)

  const settingsTabBody = h(Fragment, null,
    localError ? h('div', { className: 'pc-alert is-error', role: 'alert' }, h('span', null, localError)) : null,

    h(PcSection, {
      title: '⚙️ 推演与引导设置',
      helpTitle: '推演与引导设置',
      note: '改动即时生效 · 自动保存',
      help: PC_HELP.settingsSection
    },
      h(PcField, {
        label: '约束力度',
        help: PC_HELP.strength,
        hint: currentStrengthOption.title
      },
        h('div', { className: 'pc-tabbar is-3', role: 'group', 'aria-label': '约束力度' },
          PC_STRENGTH_OPTIONS.map(opt => {
            const selected = currentStrength === opt.key
            return h('button', {
              key: opt.key,
              type: 'button',
              className: 'pc-tab' + (opt.key === 'strict' ? ' is-strict' : '') + (selected ? ' is-active' : ''),
              disabled: Boolean(busyAction),
              'aria-pressed': selected ? 'true' : 'false',
              title: opt.title,
              onClick: () => {
                if (!selected) savePreferences({ strength: opt.key }, '约束力度已切换为「' + opt.label + '」')
              }
            }, opt.label)
          }))),

      h(PcField, {
        label: '推进节奏',
        help: PC_HELP.pace,
        hint: currentPaceOption.title
      },
        h('div', { className: 'pc-tabbar is-3', role: 'group', 'aria-label': '推进节奏' },
          PC_PACE_OPTIONS.map(opt => {
            const selected = currentPace === opt.key
            return h('button', {
              key: opt.key,
              type: 'button',
              className: 'pc-tab' + (selected ? ' is-active' : ''),
              disabled: Boolean(busyAction),
              'aria-pressed': selected ? 'true' : 'false',
              title: opt.title,
              onClick: () => {
                if (!selected) savePreferences({ pace: opt.key }, '推进节奏已切换为「' + opt.label + '」')
              }
            }, opt.label)
          }))),

      h(PcRow, {
        plain: true,
        title: '盲盒防剧透模式',
        sub: blindBox ? '已开启：卡片节拍与终局剧透已遮罩，仅凭风声探索' : '默认关闭：明牌展示所有节拍、因果依据与终局剧透',
        help: PC_HELP.blindBox
      },
        h(PcSwitch, {
          label: '盲盒防剧透模式',
          checked: blindBox,
          disabled: Boolean(busyAction),
          onChange: next => savePreferences({ blindBox: next }, next ? '已开启盲盒防剧透模式，卡片剧透详情已遮罩。' : '已切回明牌模式。')
        })),

      h(PcField, {
        label: '自动更新间隔',
        help: PC_HELP.autoUpdate,
        hint: autoUpdateInterval > 0 ? autoUpdateHint : '当前关闭：仅手动点刷新或归卷时更新'
      },
        h('div', { className: 'pc-chip-group', role: 'group', 'aria-label': '剧情罗盘自动更新间隔' },
          PC_AUTO_UPDATE_PRESETS.map(opt => {
            const selected = !customIntervalOpen && autoUpdateInterval === opt.value
            return h(PcChip, {
              key: opt.value,
              active: selected,
              disabled: Boolean(busyAction),
              title: opt.value === 0 ? '仅手动推演或归卷时更新' : '每隔 ' + opt.value + ' 楼回合结算后自动全层刷新路线',
              onClick: () => {
                setCustomIntervalOpen(false)
                if (autoUpdateInterval !== opt.value) {
                  savePreferences({ autoUpdateInterval: opt.value }, opt.value > 0 ? '已设置每 ' + opt.value + ' 楼自动全局刷新剧情罗盘。' : '已关闭剧情罗盘定期自动更新。')
                }
              }
            }, opt.label)
          }),
          h(PcChip, {
            active: customIntervalOpen || !isPresetAutoUpdateInterval,
            disabled: Boolean(busyAction),
            title: '自定义每隔多少楼自动全层刷新（1–100 楼，0 为关闭）',
            onClick: () => {
              setIntervalDraft(autoUpdateInterval > 0 ? String(autoUpdateInterval) : '')
              setCustomIntervalOpen(true)
            }
          }, !isPresetAutoUpdateInterval && autoUpdateInterval > 0 ? '自定义(' + autoUpdateInterval + '楼)' : '自定义')),
        (customIntervalOpen || !isPresetAutoUpdateInterval) ? h('div', { className: 'pc-btn-row' },
          h('input', {
            type: 'number', min: 0, max: 100, step: 1,
            className: 'pc-input is-num',
            'aria-label': '自定义自动更新楼数',
            placeholder: '1–100',
            value: intervalDraft,
            disabled: Boolean(busyAction),
            onChange: e => setIntervalDraft(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitCustomInterval() } }
          }),
          h('span', { className: 'pc-hint' }, '楼'),
          h(PcBtn, { small: true, primary: true, disabled: Boolean(busyAction), onClick: commitCustomInterval }, '应用')) : null),

      h(PcField, {
        label: '每层条目上限',
        help: PC_HELP.maxRoutes,
        hint: '当前每跨度最多保留与推演 ' + maxRoutes + ' 条路线（范围 ' + PC_MAX_ROUTES_MIN + '–' + PC_MAX_ROUTES_MAX + ' 条）'
      },
        h('div', { className: 'pc-chip-group', role: 'group', 'aria-label': '剧情规划条目上限' },
          PC_MAX_ROUTES_PRESETS.map(opt => {
            const selected = !customMaxRoutesOpen && maxRoutes === opt.value
            return h(PcChip, {
              key: opt.value,
              active: selected,
              disabled: Boolean(busyAction),
              title: '今期 / 中期 / 长期每个跨度最多保留与推演 ' + opt.value + ' 条剧情规划（默认 4 条）',
              onClick: () => {
                setCustomMaxRoutesOpen(false)
                if (maxRoutes !== opt.value) {
                  savePreferences({ maxRoutes: opt.value }, '已设置每层剧情规划上限为 ' + opt.value + ' 条。')
                }
              }
            }, opt.label)
          }),
          h(PcChip, {
            active: customMaxRoutesOpen || !isPresetMaxRoutes,
            disabled: Boolean(busyAction),
            title: '自定义每层剧情规划条目上限（' + PC_MAX_ROUTES_MIN + '–' + PC_MAX_ROUTES_MAX + ' 条，默认 4 条）',
            onClick: () => {
              setMaxRoutesDraft(String(maxRoutes))
              setCustomMaxRoutesOpen(true)
            }
          }, !isPresetMaxRoutes ? '自定义(' + maxRoutes + '条)' : '自定义')),
        (customMaxRoutesOpen || !isPresetMaxRoutes) ? h('div', { className: 'pc-btn-row' },
          h('input', {
            type: 'number', min: PC_MAX_ROUTES_MIN, max: PC_MAX_ROUTES_MAX, step: 1,
            className: 'pc-input is-num',
            'aria-label': '自定义剧情规划条目上限',
            placeholder: PC_MAX_ROUTES_MIN + '–' + PC_MAX_ROUTES_MAX,
            value: maxRoutesDraft,
            disabled: Boolean(busyAction),
            onChange: e => setMaxRoutesDraft(e.target.value),
            onKeyDown: e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); commitCustomMaxRoutes() } }
          }),
          h('span', { className: 'pc-hint' }, '条'),
          h(PcBtn, { small: true, primary: true, disabled: Boolean(busyAction), onClick: commitCustomMaxRoutes }, '应用')) : null)),

    h(PcSection, {
      title: '🤖 推演模型设置',
      helpTitle: '推演模型设置',
      note: '所有对话全局共用',
      help: PC_HELP.model
    },
      h(PcField, {
        label: '推演模型',
        help: PC_HELP.model
      },
        h('div', { className: 'pc-tabbar is-3', role: 'group', 'aria-label': '剧情罗盘模型' },
          PC_MODEL_OPTIONS.map(opt => {
            const activeMode = pickingIndependentModel ? 'independent' : compassModelMode
            const selected = activeMode === opt.key
            return h('button', {
              key: opt.key,
              type: 'button',
              className: 'pc-tab' + (selected ? ' is-active' : ''),
              disabled: Boolean(busyAction),
              'aria-pressed': selected ? 'true' : 'false',
              title: opt.title,
              onClick: () => {
                if (opt.key === 'independent') {
                  setPickingIndependentModel(true)
                  return
                }
                setPickingIndependentModel(false)
                if (compassModelMode !== opt.key) {
                  saveCompassModel(opt.key, '剧情罗盘推演模型已切换为「' + opt.label + '」（全局生效）。')
                }
              }
            }, opt.label)
          })),
        (compassModelIsObject || pickingIndependentModel) ? (() => {
          const compassEfforts = modelReasoning.key === compassModelKey ? (modelReasoning.value && modelReasoning.value.efforts) || [] : []
          const compassKnown = !compassModelIsObject || modelCatalog.some(group =>
            group.provider === compassModel.provider && Array.isArray(group.models) && group.models.some(m => m.id === compassModel.model)
          )
          const fallbackName = compassModelIsObject ? (compassModel.provider + ' / ' + compassModel.model) : ''
          const effortVal = compassModelIsObject ? (compassModel.reasoningEffort || '') : ''
          return h('div', { className: 'pc-field', style: { marginTop: '4px' } },
            h('select', {
              className: 'pc-select',
              'aria-label': '剧情罗盘独立模型',
              value: compassModelKey,
              disabled: Boolean(busyAction) || catalogLoading,
              onChange: e => {
                const val = e.target.value
                if (!val) return
                saveCompassModel(JSON.parse(val), '已切换剧情罗盘独立模型（全局生效）。')
              }
            },
              !compassModelIsObject ? h('option', { value: '' }, catalogLoading ? '正在加载模型…' : '选择独立模型') : null,
              !compassKnown && compassModelIsObject ? h('option', { value: compassModelKey }, fallbackName + '（当前不可用）') : null,
              modelCatalog.map(group => h('optgroup', {
                key: group.provider,
                label: group.providerName || group.provider
              }, (group.models || []).map(model => h('option', {
                key: group.provider + '/' + model.id,
                value: JSON.stringify({ provider: group.provider, model: model.id })
              }, model.name || model.id))))),
            compassModelKey ? h('select', {
              className: 'pc-select',
              'aria-label': '剧情罗盘推理强度',
              value: effortVal,
              disabled: Boolean(busyAction) || !compassEfforts.length,
              onChange: e => {
                const next = { provider: compassModel.provider, model: compassModel.model }
                if (e.target.value) next.reasoningEffort = e.target.value
                saveCompassModel(next, '已更新剧情罗盘推理强度（全局生效）。')
              }
            },
              h('option', { value: '' }, '推理强度：模型默认'),
              effortVal && !compassEfforts.some(item => item.id === effortVal) ? h('option', { value: effortVal }, effortVal) : null,
              compassEfforts.map(item => h('option', { key: item.id, value: item.id }, item.name || item.id))) : null)
        })() : null)),

    h('p', { className: 'pc-hint' }, '以上改动即时生效并自动保存，无需手动提交；面板重新打开或切换对话都会保留。'))

  const panelTabs = [
    ['routes', '路线与推演'],
    ['settings', '罗盘设置']
  ]

  return h('aside', { className: 'pc-root pc-workbench' },
    h('div', { className: 'pc-wb-top' },
      h('div', { className: 'pc-wb-head' },
        h('div', { className: 'pc-wb-head-left' },
          topTitleBlock,
          h('div', { className: 'pc-btn-row pc-wb-toggle', title: compassEnabled ? '关闭本局剧情罗盘' : '开启本局剧情罗盘' },
            h(PcSwitch, { label: '剧情罗盘', checked: compassEnabled, disabled: Boolean(busyAction), onChange: toggleEnabled }),
            h('span', null, compassEnabled ? '已开启' : '已关闭'),
            compassEnabled && compass.basedOnTurn > 0 ? h(PcBadge, null, '第 ' + compass.basedOnTurn + ' 轮') : null)),
        compassEnabled ? h('div', { className: 'pc-btn-row' },
          isRunning
            ? h(PcBtn, { small: true, danger: true, disabled: busyAction === 'cancel', onClick: cancelGenerate }, '取消推演')
            : h(Fragment, null,
                hasAnyRoutes ? h(PcBtn, {
                  small: true,
                  disabled: Boolean(busyAction),
                  title: '作废当前全部路线与点亮标记，模型看不到旧路线，只按当前剧情重新推演一套独立方向',
                  onClick: () => { setPanelTab('routes'); setConfirmingFresh(!confirmingFresh) }
                }, '✦ 全新生成') : null,
                h(PcBtn, {
                  small: true,
                  primary: true,
                  disabled: Boolean(busyAction),
                  onClick: () => { setPanelTab('routes'); runGenerate('all') }
                }, hasAnyRoutes ? '全局演进刷新' : '✦ 推演多路线'))) : null),
      overviewHelpOpen ? pcHelpPop('剧情罗盘', PC_HELP.overview, () => setOverviewHelpOpen(false), overviewHelpRef) : null,
      compassEnabled ? h('div', { className: 'pc-tabbar', role: 'tablist', 'aria-label': '剧情罗盘工作台页签' },
        panelTabs.map(([value, label]) => h('button', {
          key: value,
          type: 'button',
          role: 'tab',
          'aria-selected': panelTab === value ? 'true' : 'false',
          className: 'pc-tab' + (panelTab === value ? ' is-active' : ''),
          onClick: () => setPanelTab(value)
        }, label))) : null),

    h('div', { className: 'pc-wb-scroll' },
      !compassEnabled
        ? h(Fragment, null,
            localError ? h('div', { className: 'pc-alert is-error', role: 'alert' }, h('span', null, localError)) : null,
            h('div', { className: 'pc-empty' },
              h('strong', null, '剧情罗盘已关闭'),
              h('p', { className: 'pc-hint' },
                hasAnyRoutes
                  ? '当前对局已关闭剧情罗盘，后台推演、自动演进与提示词软引导已暂停；已生成的路线数据已为您安全保留，重新开启后可立即恢复使用。'
                  : '开启后，剧情罗盘会结合人物卡、当前剧情与未触发的世界书暗线，为您推演今期 / 中期 / 长期多路线分支方向，并支持点亮导向、脑暴讨论与一键分叉试玩。'),
              h(PcBtn, {
                small: true,
                primary: true,
                disabled: Boolean(busyAction),
                onClick: () => toggleEnabled(true)
              }, busyAction === 'toggleEnabled' ? '正在开启…' : '开启剧情罗盘')))
        : (panelTab === 'settings' ? settingsTabBody : routesTabBody)),

    localNotice ? h('div', { className: 'pc-toast', role: 'status' }, localNotice) : null)
}
