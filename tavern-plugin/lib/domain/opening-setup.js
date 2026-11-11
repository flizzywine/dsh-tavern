// An explicit opening choice overrides alignment only for a new conversation.
export function parseOpeningScriptStart(value) {
  if (value === undefined) return undefined
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1) {
    if (value.mode === 'story') return { mode: 'story' }
    if (Number.isSafeInteger(value.chunk) && value.chunk >= 1) return { chunk: value.chunk }
  }
  throw new Error('剧本起点须为 { chunk: 从 1 开始的整数 } 或 { mode: "story" }')
}

// ---- openingSetup version 2 (docs/specs/opening-setup-v2.md) -------------------------------

export const OPENING_TEMPLATE_CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src 'self' data:; script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; connect-src 'none'; media-src 'none'; form-action 'none'; base-uri 'none'"

const KEY = /^[a-z][a-z0-9_]{0,31}$/
const PATH = /^[^.\s]+(\.[^.\s]+)*$/
const COLOR = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/i
const FONT = /^[\p{L}\p{N} ,'"-]{1,120}$/u
const IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/
const PLACEHOLDER = /\{\{\s*([Uu][Ss][Ee][Rr]|[Cc][Hh][Aa][Rr])\s*\}\}|\{([a-z][a-z0-9_]{0,31})(?:\.(label|text))?(?:\|([^{}]*))?\}/g
const FONTS = { serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif', sans: 'system-ui, "Noto Sans SC", "PingFang SC", sans-serif', mono: 'ui-monospace, "Cascadia Mono", monospace' }
const THEME_VARIABLES = { accent: '--dsh-opening-accent', background: '--dsh-opening-bg', surface: '--dsh-opening-surface', text: '--dsh-opening-text', muted: '--dsh-opening-muted', border: '--dsh-opening-border', radius: '--dsh-opening-radius', font: '--dsh-opening-font', titleFont: '--dsh-opening-title-font', image: '--dsh-opening-image' }
const VALUE_TYPES = new Set(['name', 'text', 'choice', 'multi', 'slider', 'toggle'])
const COMMON = ['key', 'type', 'label', 'help', 'required', 'default', 'when', 'variable', 'variables']
const EXTRA = { name: ['maxLength', 'placeholder'], text: ['maxLength', 'multiline', 'placeholder'], choice: ['options'], multi: ['options', 'min', 'max'], slider: ['min', 'max', 'step'], toggle: ['text'], note: ['text', 'fold'], group: ['points'] }
const OPTION_KEYS = ['value', 'label', 'desc', 'image', 'text', 'variables', 'scriptStart', 'worldbook']

function fail(message) { throw new Error('开局设置：' + message) }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function primitive(value) { return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) }
function text(value, max, where, required = false) {
  if (value === undefined && !required) return
  if (typeof value !== 'string' || (required && value.trim() === '') || value.length > max) fail(where + (required ? '须为非空文字' : '须为文字') + '，最长 ' + max + ' 字')
}
function onlyKeys(object, allowed, where) {
  for (const key of Object.keys(object)) if (!allowed.includes(key)) fail(where + '不认识「' + key + '」（可用：' + allowed.join('、') + '）')
}
function fieldName(field, index) { return '第 ' + (index + 1) + ' 个字段' + (field && typeof field.label === 'string' ? '「' + field.label + '」' : '') }

export function openingSetupOptions(field) {
  return (Array.isArray(field.options) ? field.options : []).map(option => typeof option === 'string'
    ? { value: option, label: option }
    : { ...option, value: option.value === undefined ? option.label : option.value, label: option.label === undefined ? String(option.value) : option.label })
}

function placeholders(value, out = []) {
  if (typeof value === 'string') for (const match of value.matchAll(PLACEHOLDER)) { if (match[2]) out.push(match[2]) }
  else if (Array.isArray(value)) value.forEach(item => placeholders(item, out))
  else if (plain(value)) Object.values(value).forEach(item => placeholders(item, out))
  return out
}

function checkVariables(variables, keys, where) {
  if (variables === undefined) return
  if (!plain(variables)) fail(where + '的 variables 须为 { 点路径: 值 }')
  for (const [path, value] of Object.entries(variables)) {
    if (path.length > 200 || !PATH.test(path)) fail(where + '的变量路径「' + path + '」不是 stat_data 下的点路径')
    if (!primitive(value) && value !== null && !Array.isArray(value) && !plain(value)) fail(where + '的变量「' + path + '」值不受支持')
    for (const key of placeholders(value)) if (!keys.has(key)) fail(where + '的变量「' + path + '」引用了不存在的字段 {' + key + '}')
  }
}

function checkImage(value, where) {
  if (value === undefined) return
  if (value === 'cover') return
  if (typeof value !== 'string' || !IMAGE.test(value) || value.length > 350000) fail(where + '的图片只能是 "cover"（本卡封面）或 data:image/png|jpeg|webp|gif;base64（≤ 256 KB）')
}

function checkTheme(theme) {
  if (theme === undefined) return
  if (!plain(theme)) fail('theme 须为对象')
  onlyKeys(theme, [...Object.keys(THEME_VARIABLES), 'layout'], 'theme ')
  for (const key of ['accent', 'background', 'surface', 'text', 'muted', 'border']) if (theme[key] !== undefined && (typeof theme[key] !== 'string' || !COLOR.test(theme[key].trim()))) fail('theme.' + key + ' 须为颜色（#rrggbb 或 rgb()/rgba()）')
  if (theme.radius !== undefined && !(typeof theme.radius === 'string' && /^(?:0|[12]?\d(?:px)?|3[0-2](?:px)?)$/.test(theme.radius))) fail('theme.radius 须为 0–32px')
  for (const key of ['font', 'titleFont']) if (theme[key] !== undefined && (typeof theme[key] !== 'string' || (!FONTS[theme[key]] && !FONT.test(theme[key])))) fail('theme.' + key + ' 须为 serif、sans、mono 或字体名列表')
  if (theme.layout !== undefined && theme.layout !== 'center' && theme.layout !== 'split') fail('theme.layout 须为 center 或 split')
  checkImage(theme.image, 'theme')
}

function checkWhen(field, index, earlier, where) {
  if (field.when === undefined) return
  if (!plain(field.when) || Object.keys(field.when).length === 0) fail(where + '的 when 须为 { 字段: 值 }')
  for (const [key, expected] of Object.entries(field.when)) {
    if (!earlier.has(key)) fail(where + '的 when 只能引用它前面的字段，「' + key + '」不在前面')
    const values = Array.isArray(expected) ? expected : [expected]
    if (values.length === 0 || !values.every(primitive)) fail(where + '的 when.' + key + ' 须为值或值的数组')
  }
}

function checkOptions(field, keys, where) {
  const options = field.options
  if (!Array.isArray(options) || options.length === 0 || options.length > 40) fail(where + '须有 1–40 个选项')
  const seen = new Set()
  options.forEach((option, index) => {
    const at = where + '的第 ' + (index + 1) + ' 个选项'
    if (typeof option === 'string') { text(option, 60, at, true) }
    else {
      if (!plain(option)) fail(at + '须为文字或对象')
      onlyKeys(option, OPTION_KEYS, at)
      if (option.value === undefined && option.label === undefined) fail(at + '须有 value 或 label')
      if (option.value !== undefined && !primitive(option.value)) fail(at + '的 value 须为文字、数字或布尔')
      text(option.label, 60, at + '的 label')
      text(option.desc, 200, at + '的 desc')
      text(option.text, 8000, at + '的 text')
      checkImage(option.image, at)
      checkVariables(option.variables, keys, at)
      if (option.scriptStart !== undefined) {
        if (field.type !== 'choice') fail(at + '：只有 choice 字段的选项可以带 scriptStart')
        try { parseOpeningScriptStart(option.scriptStart) } catch (error) { fail(at + '：' + error.message) }
      }
      if (option.worldbook !== undefined) {
        if (!plain(option.worldbook) || !Object.keys(option.worldbook).length) fail(at + '的 worldbook 须为 { 条目标题前缀: true|false }')
        for (const [prefix, on] of Object.entries(option.worldbook)) if (prefix.trim() === '' || prefix.length > 120 || typeof on !== 'boolean') fail(at + '的 worldbook 须为 { 条目标题前缀: true|false }')
      }
    }
    const value = typeof option === 'string' ? option : (option.value === undefined ? option.label : option.value)
    if (seen.has(value)) fail(where + '的选项值「' + value + '」重复')
    seen.add(value)
  })
}

/** Validates a version 2 document once, when it enters a card. Throws one readable Chinese error. */
export function validateOpeningSetupSpec(spec) {
  if (!plain(spec) || spec.version !== 2) fail('须为 { version: 2, fields, message }')
  onlyKeys(spec, ['version', 'title', 'intro', 'theme', 'fields', 'message', 'template'], '')
  if (JSON.stringify(spec).length > 1024 * 1024) fail('整份设置超过 1 MB')
  text(spec.title, 60, 'title')
  text(spec.intro, 400, 'intro')
  checkTheme(spec.theme)
  if (!Array.isArray(spec.fields) || spec.fields.length === 0 || spec.fields.length > 40) fail('fields 须有 1–40 个字段')
  const keys = new Set(), valued = new Map()
  let names = 0, starts = 0
  spec.fields.forEach((field, index) => {
    const where = fieldName(field, index)
    if (!plain(field)) fail(where + '须为对象')
    if (!EXTRA[field.type]) fail(where + '的 type「' + field.type + '」不受支持（可用：' + Object.keys(EXTRA).join('、') + '）')
    onlyKeys(field, [...COMMON, ...EXTRA[field.type]], where)
    if (field.key !== undefined || VALUE_TYPES.has(field.type)) {
      if (typeof field.key !== 'string' || !KEY.test(field.key)) fail(where + '的 key 须为小写字母开头的英文、数字或下划线（≤ 32 字）')
      if (keys.has(field.key)) fail('字段 key「' + field.key + '」重复')
    }
    if (field.type === 'note') text(field.text, 4000, where + '的 text', true)
    else text(field.label, 60, where + '的 label', true)
    text(field.help, 200, where + '的 help')
    if (field.required !== undefined && typeof field.required !== 'boolean') fail(where + '的 required 须为 true/false')
    if (field.fold !== undefined) text(field.fold, 60, where + '的 fold')
    if (field.placeholder !== undefined) text(field.placeholder, 80, where + '的 placeholder')
    checkWhen(field, index, valued, where)
    if (field.variable !== undefined && (!VALUE_TYPES.has(field.type) || typeof field.variable !== 'string' || field.variable.length > 200 || !PATH.test(field.variable))) fail(where + '的 variable 须为 stat_data 下的点路径')
    if (field.type === 'name') { if (++names > 1) fail('至多一个 name 字段') }
    if (field.type === 'name' || field.type === 'text') {
      const limit = field.type === 'name' ? 80 : 4000
      if (field.maxLength !== undefined && !(Number.isInteger(field.maxLength) && field.maxLength >= 1 && field.maxLength <= limit)) fail(where + '的 maxLength 须为 1–' + limit)
      if (field.multiline !== undefined && typeof field.multiline !== 'boolean') fail(where + '的 multiline 须为 true/false')
      if (field.default !== undefined) text(field.default, field.maxLength || limit, where + '的 default')
    }
    if (field.type === 'choice' || field.type === 'multi') {
      checkOptions(field, new Set([...keys, ...(field.key ? [field.key] : [])]), where)
      const values = openingSetupOptions(field).map(option => option.value)
      if (field.type === 'choice' && field.default !== undefined && !values.includes(field.default)) fail(where + '的 default 不是它的选项')
      if (field.type === 'multi') {
        if (field.default !== undefined && !(Array.isArray(field.default) && field.default.every(value => values.includes(value)))) fail(where + '的 default 须为它的选项值数组')
        for (const key of ['min', 'max']) if (field[key] !== undefined && !(Number.isInteger(field[key]) && field[key] >= 0 && field[key] <= values.length)) fail(where + '的 ' + key + ' 须为 0–' + values.length)
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(where + '的 min 大于 max')
      }
      if (openingSetupOptions(field).some(option => option.scriptStart !== undefined)) starts++
    }
    if (field.type === 'slider') {
      if (![field.min, field.max].every(Number.isFinite) || field.min >= field.max) fail(where + '须有 min < max')
      if (field.step !== undefined && !(Number.isFinite(field.step) && field.step > 0)) fail(where + '的 step 须为正数')
      if (field.default !== undefined && !(Number.isFinite(field.default) && field.default >= field.min && field.default <= field.max)) fail(where + '的 default 须在 min–max 之间')
    }
    if (field.type === 'toggle') {
      text(field.text, 8000, where + '的 text')
      if (field.default !== undefined && typeof field.default !== 'boolean') fail(where + '的 default 须为 true/false')
    }
    if (field.type === 'group' && field.points !== undefined && !(Number.isInteger(field.points) && field.points >= 0)) fail(where + '的 points 须为非负整数')
    if (field.key !== undefined) keys.add(field.key)
    checkVariables(field.variables, keys, where)
    if (VALUE_TYPES.has(field.type)) valued.set(field.key, field)
  })
  if (starts > 1) fail('至多一个 choice 字段的选项带 scriptStart')
  if (typeof spec.message === 'string') text(spec.message, 20000, 'message', true)
  else if (!plain(spec.message)) fail('message 须为文字或 JSON 对象')
  else if (JSON.stringify(spec.message).length > 40000) fail('message 超过 40000 字')
  for (const key of placeholders(spec.message)) if (!valued.has(key)) fail('message 引用了不存在的字段 {' + key + '}')
  if (spec.template !== undefined) {
    text(spec.template, 200 * 1024, 'template', true)
    const slots = new Map()
    for (const match of spec.template.matchAll(/<dsh-field\b[^>]*?\bkey\s*=\s*["']?([^"'\s>]+)/gi)) slots.set(match[1], (slots.get(match[1]) || 0) + 1)
    for (const key of slots.keys()) if (!valued.has(key)) fail('template 的 <dsh-field key="' + key + '"> 不是字段')
    for (const key of valued.keys()) if (slots.get(key) !== 1) fail('template 须恰好放一次 <dsh-field key="' + key + '">（现在 ' + (slots.get(key) || 0) + ' 次）')
    for (const match of spec.template.matchAll(/<dsh-value\b[^>]*?\bkey\s*=\s*["']?([^"'\s>]+)/gi)) if (!valued.has(match[1])) fail('template 的 <dsh-value key="' + match[1] + '"> 不是字段')
  }
  return spec
}

// ---- player submit ----------------------------------------------------------------------------

function matches(actual, expected) {
  const values = Array.isArray(expected) ? expected : [expected]
  return Array.isArray(actual) ? actual.some(value => values.includes(value)) : values.includes(actual)
}

function fieldState(field, raw, userName) {
  const label = '「' + field.label + '」'
  if (field.type === 'name' || field.type === 'text') {
    const value = (raw === undefined ? (field.type === 'name' ? (field.default ?? userName) : (field.default ?? '')) : raw)
    if (typeof value !== 'string') fail(label + '须为文字')
    const trimmed = value.trim()
    const max = field.maxLength || (field.type === 'name' ? 40 : 200)
    if ((field.type === 'name' || field.required) && trimmed === '') fail(label + '还没填')
    if (trimmed.length > max) fail(label + '最长 ' + max + ' 字')
    return { value: trimmed }
  }
  const options = openingSetupOptions(field)
  if (field.type === 'choice') {
    const value = raw === undefined ? (field.default ?? options[0].value) : raw
    const option = options.find(item => item.value === value)
    if (!option) fail(label + '的选项不存在')
    return { value, option }
  }
  if (field.type === 'multi') {
    const value = raw === undefined ? (field.default || []) : raw
    if (!Array.isArray(value) || new Set(value).size !== value.length) fail(label + '须为选项的列表')
    const chosen = options.filter(item => value.includes(item.value))
    if (chosen.length !== value.length) fail(label + '的选项不存在')
    if (field.min !== undefined && chosen.length < field.min) fail(label + '至少选 ' + field.min + ' 项')
    if (field.max !== undefined && chosen.length > field.max) fail(label + '至多选 ' + field.max + ' 项')
    if (field.required && chosen.length === 0) fail(label + '还没选')
    return { value: chosen.map(item => item.value), options: chosen }
  }
  if (field.type === 'slider') {
    const value = raw === undefined ? (field.default ?? field.min) : raw
    const step = field.step || 1
    if (!Number.isFinite(value) || value < field.min || value > field.max) fail(label + '须在 ' + field.min + '–' + field.max + ' 之间')
    if (Math.abs((value - field.min) / step - Math.round((value - field.min) / step)) > 1e-9) fail(label + '须按 ' + step + ' 递增')
    return { value }
  }
  const value = raw === undefined ? (field.default ?? false) : raw
  if (typeof value !== 'boolean') fail(label + '须为开或关')
  return { value }
}

function partText(field, state, part) {
  if (!state) return ''
  if (field.type === 'choice') return part === 'label' ? String(state.option.label) : part === 'text' ? String(state.option.text ?? '') : String(state.value)
  if (field.type === 'multi') return part === 'label' ? state.options.map(option => option.label).join('、') : part === 'text' ? state.options.map(option => option.text || '').filter(Boolean).join('\n') : state.value.join('、')
  if (field.type === 'toggle') return part === 'text' ? (state.value ? String(field.text || '') : '') : (state.value ? '是' : '否')
  return String(state.value)
}

function renderTemplate(value, context) {
  if (typeof value === 'string') {
    const whole = /^\{([a-z][a-z0-9_]{0,31})\}$/.exec(value)
    if (whole && context.fields.has(whole[1])) {
      const state = context.states.get(whole[1])
      return state ? state.value : ''
    }
    return value.replace(PLACEHOLDER, (all, macro, key, part, fallback) => {
      if (macro) return macro.toLowerCase() === 'user' ? context.userName : context.charName
      const field = context.fields.get(key)
      if (!field) return all
      const result = partText(field, context.states.get(key), part)
      return result === '' && fallback !== undefined ? fallback : result
    })
  }
  if (Array.isArray(value)) return value.map(item => renderTemplate(item, context))
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, context)]))
  return value
}

/**
 * Turns submitted values into the v1 start payload: { playerName, variables, message, scriptStart?, worldbook? }.
 * requireMessage false: a start that keeps its greeting (a stage opening page) needs no message, so '' is allowed.
 */
export function resolveOpeningSetup(spec, values = {}, { userName = '你', charName = '', requireMessage = true } = {}) {
  if (!plain(values)) fail('提交的内容须为对象')
  const fields = new Map(spec.fields.filter(field => VALUE_TYPES.has(field.type)).map(field => [field.key, field]))
  const states = new Map()
  const context = { fields, states, userName, charName }
  let playerName = userName, scriptStart, worldbook, group, spent = 0
  const variables = {}
  const finishGroup = () => { if (group?.points !== undefined && spent > group.points) fail('「' + group.label + '」最多分配 ' + group.points + ' 点（现在 ' + spent + ' 点）') }
  for (const field of spec.fields) {
    if (field.type === 'group') { finishGroup(); group = field; spent = 0 }
    if (!VALUE_TYPES.has(field.type)) continue
    const visible = !field.when || Object.entries(field.when).every(([key, expected]) => states.has(key) && matches(states.get(key).value, expected))
    if (!visible) continue
    const state = fieldState(field, values[field.key], userName)
    states.set(field.key, state)
    if (field.type === 'name') context.userName = playerName = state.value
    if (field.type === 'slider' && group) spent += state.value - field.min
    if (field.variable) variables[field.variable] = state.value
    for (const [path, value] of Object.entries(field.variables || {})) variables[path] = renderTemplate(value, context)
    for (const option of state.options || (state.option ? [state.option] : [])) {
      for (const [path, value] of Object.entries(option.variables || {})) variables[path] = renderTemplate(value, context)
      if (option.scriptStart) scriptStart = parseOpeningScriptStart(option.scriptStart)
      if (option.worldbook) worldbook = { ...worldbook, ...option.worldbook }
    }
  }
  finishGroup()
  const rendered = renderTemplate(spec.message, context)
  const message = (typeof rendered === 'string' ? rendered : JSON.stringify(rendered, null, 2)).trim()
  if (!message && requireMessage) fail('开局内容为空')
  return { playerName, variables, message, ...(scriptStart ? { scriptStart } : {}), ...(worldbook ? { worldbook } : {}) }
}

/** Writes resolved { dot.path: value } into a floor's variables under stat_data; MVU's [value, description] keeps its description. */
export function applyOpeningVariables(all, variables) {
  const next = structuredClone(plain(all) ? all : {})
  const root = plain(next.stat_data) ? next.stat_data : (next.stat_data = {})
  for (const [path, value] of Object.entries(variables || {})) {
    const keys = path.split('.')
    let node = root
    for (const key of keys.slice(0, -1)) node = plain(node[key]) ? node[key] : (node[key] = {})
    const last = keys[keys.length - 1]
    if (Array.isArray(node[last]) && node[last].length === 2 && typeof node[last][1] === 'string') node[last] = [structuredClone(value), node[last][1]]
    else node[last] = structuredClone(value)
  }
  return next
}

/** Entry title → enabled, by the longest matching prefix; entries no prefix matches are unchanged. */
export function openingWorldbookEnabled(title, worldbook) {
  let best
  for (const prefix of Object.keys(worldbook)) if (String(title).startsWith(prefix) && (best === undefined || prefix.length > best.length)) best = prefix
  return best === undefined ? undefined : worldbook[best]
}

// ---- display ----------------------------------------------------------------------------------

/** theme → { '--dsh-opening-*': css } for the form root; unset tokens fall back to the host theme in CSS. */
export function openingThemeVariables(theme = {}, coverUrl = '') {
  const out = {}
  for (const [key, name] of Object.entries(THEME_VARIABLES)) {
    const value = theme[key]
    if (value === undefined) continue
    if (key === 'font' || key === 'titleFont') out[name] = FONTS[value] || value
    else if (key === 'radius') out[name] = /px$/.test(value) || value === '0' ? value : value + 'px'
    else if (key === 'image') { if (value !== 'cover' || coverUrl) out[name] = 'url("' + (value === 'cover' ? coverUrl : value).replace(/["\\\n]/g, '') + '")' }
    else out[name] = value.trim()
  }
  return out
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) }

function cleanCss(css) {
  return String(css)
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (all, quote, url) => /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);/i.test(url.trim()) ? all : 'none')
    .replace(/<\/style/gi, '')
}

const DROPPED_WITH_CONTENT = 'script|iframe|frame|frameset|object|embed|applet|noscript|template|title'
const DROPPED_TAGS = /^(?:script|iframe|frame|frameset|object|embed|applet|noscript|template|title|form|base|meta|link|html|head|body|style)$/i
const DROPPED_ATTRS = /^(?:on.*|srcdoc|target|formaction|action|http-equiv|ping|download|autofocus)$/i
const URL_ATTRS = /^(?:href|src|xlink:href|poster|background|lowsrc|dynsrc|data|codebase|cite|longdesc|usemap|manifest|srcset|imagesrcset)$/i

function cleanAttributes(source) {
  const kept = []
  for (const match of source.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1], value = match[2] ?? match[3] ?? match[4]
    if (!/^[a-zA-Z_:][\w:.-]*$/.test(name) || DROPPED_ATTRS.test(name)) continue
    const decoded = value === undefined ? '' : value.replace(/&#x?([0-9a-f]+);?/gi, (all, code) => String.fromCodePoint(parseInt(code, /x/i.test(all) ? 16 : 10))).replace(/[\s\u0000-\u001f]+/g, '')
    if (/(?:java|vb)script:|livescript:/i.test(decoded)) continue
    if (URL_ATTRS.test(name)) {
      if (/^href$/i.test(name) ? !/^#/.test(decoded) : !/^data:image\/(?:png|jpeg|webp|gif);/i.test(decoded)) continue
    }
    if (/^style$/i.test(name)) { kept.push(name + '="' + escapeHtml(cleanCss(value || ''))+ '"'); continue }
    kept.push(value === undefined ? name : name + '="' + escapeHtml(value) + '"')
  }
  return kept.length ? ' ' + kept.join(' ') : ''
}

/** The sanitized srcdoc for a template: CSP first, token stylesheet, then the author's markup. No script can survive. */
export function compileOpeningTemplate(spec, { userName = '你', charName = '' } = {}) {
  if (typeof spec.template !== 'string') return ''
  let html = spec.template.replace(/\{\{\s*([Uu][Ss][Ee][Rr]|[Cc][Hh][Aa][Rr])\s*\}\}/g, (all, macro) => escapeHtml(macro.toLowerCase() === 'user' ? userName : charName))
  html = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  for (let previous; previous !== html;) {
    previous = html
    html = html.replace(new RegExp('<(' + DROPPED_WITH_CONTENT + ')\\b[\\s\\S]*?<\\/\\1\\s*>', 'gi'), '')
  }
  const styles = []
  html = html.replace(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi, (all, css) => { styles.push(cleanCss(css)); return '' })
  // Every tag is rebuilt from parsed parts; anything else that looks like markup is escaped.
  const rebuilt = []
  html = html.replace(/\u0000/g, '').replace(/<(\/?)([a-zA-Z!?][^\s\/>]*)([^>]*)>/g, (all, close, tag, rest) => {
    if (!/^[a-zA-Z][\w:-]*$/.test(tag) || DROPPED_TAGS.test(tag)) return ''
    rebuilt.push('<' + close + tag.toLowerCase() + (close ? '' : cleanAttributes(rest)) + (/\/\s*$/.test(rest) && !close ? ' /' : '') + '>')
    return '\u0000' + (rebuilt.length - 1) + '\u0000'
  })
  html = html.replace(/</g, '&lt;').replace(/\u0000(\d+)\u0000/g, (all, index) => rebuilt[Number(index)])
  const tokens = Object.entries(openingThemeVariables(spec.theme || {})).filter(([name]) => name !== '--dsh-opening-image').map(([name, value]) => name + ':' + value).join(';')
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + OPENING_TEMPLATE_CSP + '">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>:root{' + tokens + '}' + OPENING_TEMPLATE_BASE_CSS + '</style>'
    + styles.map(css => '<style>' + css + '</style>').join('')
    + '</head><body class="dsh-opening-template">' + html + '</body></html>'
}

const OPENING_TEMPLATE_BASE_CSS = 'html{color-scheme:light dark}body{margin:0;font-family:var(--dsh-opening-font,system-ui,sans-serif);color:var(--dsh-opening-text,var(--dsh-theme-text,CanvasText));background:var(--dsh-opening-bg,var(--dsh-theme-bg,Canvas))}'
  + 'dsh-field,dsh-start{display:block}dsh-value{white-space:pre-wrap}[hidden]{display:none!important}'
  + '.dsh-opening-control{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;font:inherit}'
  + '.dsh-opening-control>label,.dsh-opening-control>legend{font-weight:600}'
  + '.dsh-opening-control input[type=text],.dsh-opening-control textarea{box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;font:inherit;color:inherit;background:var(--dsh-opening-surface,var(--dsh-theme-surface,Field));border:1px solid var(--dsh-opening-border,var(--dsh-theme-border,GrayText));border-radius:var(--dsh-opening-radius,8px)}'
  + '.dsh-opening-control textarea{min-height:88px;resize:vertical}'
  + '.dsh-opening-options{display:flex;flex-wrap:wrap;gap:8px}'
  + '.dsh-opening-option{display:flex;align-items:center;gap:8px;min-height:40px;padding:6px 12px;border:1px solid var(--dsh-opening-border,var(--dsh-theme-border,GrayText));border-radius:var(--dsh-opening-radius,8px);background:var(--dsh-opening-surface,var(--dsh-theme-surface,Field));cursor:pointer}'
  + '.dsh-opening-option[aria-checked=true]{border-color:var(--dsh-opening-accent,var(--dsh-theme-accent,Highlight));box-shadow:inset 0 0 0 1px var(--dsh-opening-accent,var(--dsh-theme-accent,Highlight))}'
  + '.dsh-opening-help{font-size:.9em;color:var(--dsh-opening-muted,var(--dsh-theme-muted,GrayText))}'
  + '.dsh-opening-start{min-height:44px;padding:10px 24px;font:inherit;font-weight:600;color:#fff;background:var(--dsh-opening-accent,var(--dsh-theme-accent,Highlight));border:0;border-radius:var(--dsh-opening-radius,8px);cursor:pointer}'
