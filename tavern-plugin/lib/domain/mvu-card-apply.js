// Mechanical half of turning a card into an MVU card. The Agent decides the
// variables, the rules and the panel design; this places them: <initvar> and
// the status marker at the end of every opening, the two worldbook entries and
// the two regex scripts. Opening prose and everything else is left untouched.
import { inspectCardExtensions } from './card-extension-reading.js'
import { plainKeys, plainPath } from './encoded-keys.js'

export const STATUS_VIEW_ID = 'dsh-mvu-status-view'
export const HIDE_MARKER_ID = 'dsh-mvu-hide-marker'
const UPDATE_TAIL = '依据本轮已经发生的正文事实和当前变量快照，用 mvu_submit_update 提交。路径相对于 stat_data；无变化提交空 operations。'
const INITVAR_BLOCK = /\n*<initvar>[\s\S]*?<\/initvar>/gi
const MARKER = /\n*<mvu-status\s*\/>/gi

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = value => typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
const commentOf = entry => str(entry?.comment || entry?.name)
// Same rule as the card readers: v2/v3 keep fields under data, older files at the root.
const cardBase = raw => (raw?.spec === 'chara_card_v2' || raw?.spec === 'chara_card_v3') && object(raw.data) ? '/data' : ''

function merge(base, patch) {
  if (!object(base) || !object(patch)) return structuredClone(patch)
  const out = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) out[key] = object(out[key]) && object(value) ? merge(out[key], value) : structuredClone(value)
  return out
}
function withMeta(state) {
  const { $meta, ...rest } = state
  return { $meta: { ...(object($meta) ? $meta : {}), strictSet: true }, ...rest }
}
function stateJson(state) { return JSON.stringify(withMeta(state), null, 2).replace(/</g, '\\u003c') }
function existingState(text) {
  const block = /<initvar>([\s\S]*?)<\/initvar>/i.exec(str(text))
  if (!block) return undefined
  try { return JSON.parse(block[1].replace(/^\s*```[^\n]*\n|\n```\s*$/g, '').trim()) } catch { return undefined }
}
export function leafPaths(value, prefix = '', out = []) {
  if (object(value) && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) if (!key.startsWith('$')) leafPaths(child, prefix + '/' + key, out)
  } else if (prefix) out.push(prefix)
  return out
}

const escapeHtml = text => str(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const at = (state, path) => path.split('/').slice(1).reduce((value, key) => value == null ? undefined : value[key], state)

// Layout spec → panel fields. Without sections every leaf is shown, grouped by
// its top-level key: numbers within 0–100 as bars, arrays as lists.
function sectionsOf(spec, state) {
  if (Array.isArray(spec.sections) && spec.sections.length) {
    return spec.sections.map(section => ({
      title: str(section?.title),
      fields: (Array.isArray(section?.fields) ? section.fields : []).map(field => typeof field === 'string' ? { path: field } : field)
        .filter(field => object(field) && str(field.path).startsWith('/'))
    }))
  }
  const groups = new Map()
  for (const path of leafPaths(state)) {
    const top = path.split('/')[1]
    if (!groups.has(top)) groups.set(top, [])
    const value = at(state, path)
    groups.get(top).push({ path, kind: Array.isArray(value) ? 'list' : typeof value === 'number' && value >= 0 && value <= 100 ? 'bar' : 'text' })
  }
  return [...groups].map(([title, fields]) => ({ title, fields }))
}

// A field without its own label is named by the shortest tail of its path that no other
// field of the section shares: /地图/人物/角色甲/地点 next to /地图/玩家/地点 is 「角色甲 · 地点」.
function fieldLabels(fields) {
  const parts = fields.map(field => field.path.split('/').filter(Boolean))
  const depth = fields.map(() => 1)
  const name = index => str(fields[index].label) || parts[index].slice(-depth[index]).join(' · ') || fields[index].path
  for (let changed = true; changed;) {
    changed = false
    const names = fields.map((field, index) => name(index))
    fields.forEach((field, index) => {
      if (field.label || depth[index] >= parts[index].length) return
      if (names.some((other, at) => at !== index && other === names[index])) { depth[index]++; changed = true }
    })
  }
  return fields.map((field, index) => name(index))
}

export function generatePanel(spec, state) {
  const accent = /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(str(spec.accent)) ? spec.accent : '#8b3a2e'
  const sections = sectionsOf(spec, state).map(section => {
    const labels = fieldLabels(section.fields)
    return { ...section, fields: section.fields.map((field, index) => ({ ...field, label: labels[index] })) }
  })
  const label = field => escapeHtml(field.label)
  const row = field => {
    const path = escapeHtml(field.path)
    // Yes/no words for a true/false value, e.g. 在线 / 离线; the script falls back to 是 / 否.
    const yesNo = (str(field.yes) ? ' data-yes="' + escapeHtml(field.yes) + '"' : '') + (str(field.no) ? ' data-no="' + escapeHtml(field.no) + '"' : '')
    const kind = field.kind || (Array.isArray(at(state, field.path)) ? 'list' : 'text')
    if (kind === 'list') return '<div class="row list"><b>' + label(field) + '</b><ul data-mvu-list="' + path + '"></ul></div>'
    if (kind === 'bar') {
      const max = Number(field.max) > 0 ? Number(field.max) : 100
      return '<div class="row"><b>' + label(field) + '</b><span data-mvu="' + path + '"></span><div class="bar"><i data-mvu-width="' + path + '" data-max="' + max + '"></i></div></div>'
    }
    return '<div class="row"><b>' + label(field) + '</b><span data-mvu="' + path + '"' + yesNo + '></span></div>'
  }
  const body = sections.map(section => '<section>' + (section.title ? '<h3>' + escapeHtml(section.title) + '</h3>' : '') + section.fields.map(row).join('') + '</section>').join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--accent:${accent}}
body{margin:0;font:14px/1.6 system-ui,sans-serif;color:#2b2b2b}
.panel{padding:10px 12px;border:1px solid color-mix(in srgb,var(--accent) 35%,#ccc);border-radius:8px;background:color-mix(in srgb,var(--accent) 6%,#fff)}
.panel>header{font-weight:600;color:var(--accent);margin-bottom:4px}
section{margin:6px 0}h3{margin:0 0 2px;font-size:13px;color:var(--accent)}
.row{display:grid;grid-template-columns:7em 1fr;gap:2px 8px}.row b{font-weight:500;color:#666}
.row .bar{grid-column:2;height:5px;background:#e6e1d8;border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}
.row.list ul{margin:0;padding-left:1.2em}
@media (prefers-color-scheme:dark){body{color:#ddd}.panel{background:#22201d;border-color:#555}.row b{color:#aaa}.row .bar{background:#444}}
</style>
</head>
<body>
<div class="panel">${spec.title ? '<header>' + escapeHtml(spec.title) + '</header>' : ''}
${body}
</div>
<script>
(function () {
  function get(data, path) { return path.split('/').slice(1).reduce(function (value, key) { return value == null ? undefined : value[key]; }, data); }
  function render() {
    var data = Mvu.getMvuData({ type: 'message', message_id: 'latest' }).stat_data || {};
    document.querySelectorAll('[data-mvu]').forEach(function (el) { var v = get(data, el.dataset.mvu); el.textContent = v == null || v === '' ? '未明确' : typeof v === 'boolean' ? (v ? el.dataset.yes || '是' : el.dataset.no || '否') : typeof v === 'object' ? JSON.stringify(v) : String(v); });
    document.querySelectorAll('[data-mvu-width]').forEach(function (el) { var v = Number(get(data, el.dataset.mvuWidth)) || 0, max = Number(el.dataset.max) || 100; el.style.width = Math.max(0, Math.min(100, v / max * 100)) + '%'; });
    document.querySelectorAll('[data-mvu-list]').forEach(function (el) { var v = get(data, el.dataset.mvuList); el.replaceChildren(); (Array.isArray(v) ? v : []).forEach(function (item) { var li = document.createElement('li'); li.textContent = typeof item === 'object' ? JSON.stringify(item) : String(item); el.append(li); }); if (!el.children.length) { var li = document.createElement('li'); li.textContent = '无'; el.append(li); } });
  }
  waitGlobalInitialized('Mvu').then(function () {
    new Set([Mvu.events.VARIABLE_INITIALIZED, Mvu.events.VARIABLE_UPDATE_ENDED].concat(Object.values(tavern_events))).forEach(function (event) { eventOn(event, render); });
    render();
  });
})();
</script>
</body>
</html>`
}

/**
 * request: { variables, openings, rules, panel, remove }. Omitted parts keep what the
 * card already has. Returns ordinary Tavern saves plus a summary.
 */
// The converting Agent may write a key percent-encoded (encoded-keys.js); the card gets its
// plain name, in the variables and in the panel's field paths alike.
function plainRequest(request) {
  const panel = object(request.panel) && Array.isArray(request.panel.sections) ? { ...request.panel, sections: request.panel.sections.map(section => object(section) && Array.isArray(section.fields)
    ? { ...section, fields: section.fields.map(field => typeof field === 'string' ? plainPath(field) : object(field) && typeof field.path === 'string' ? { ...field, path: plainPath(field.path) } : field) }
    : section) } : request.panel
  return { ...request,
    ...(object(request.variables) ? { variables: plainKeys(request.variables) } : {}),
    ...(Array.isArray(request.openings) ? { openings: request.openings.map(item => object(item) ? plainKeys(item) : item) } : {}),
    ...(panel === undefined ? {} : { panel }) }
}

export function planMvuApply(raw, input = {}) {
  const request = plainRequest(input)
  const base = cardBase(raw)
  const data = base ? raw.data : raw
  const greetings = [str(data.first_mes), ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings.map(str) : [])]
  const openings = Array.isArray(request.openings) ? request.openings : []
  if (request.variables !== undefined && !object(request.variables)) throw new Error('variables 必须是对象')
  if (openings.length > greetings.length) throw new Error('openings 有 ' + openings.length + ' 项，但这张卡只有 ' + greetings.length + ' 个开场（first_mes + alternate_greetings）')
  openings.forEach((item, index) => { if (item !== null && item !== undefined && !object(item)) throw new Error('openings[' + index + '] 必须是对象或 null') })
  const remove = object(request.remove) ? request.remove : {}

  // Old status protocol: one pattern cleans every opening.
  let cleaned = 0
  const bodies = greetings.map(text => {
    if (!str(remove.fromOpenings)) return text
    let pattern
    try { pattern = new RegExp(str(remove.fromOpenings), 'g') } catch (error) { throw new Error('remove.fromOpenings 不是有效正则：' + error.message) }
    const next = text.replace(pattern, '')
    if (next !== text) cleaned++
    return next
  })
  if (str(remove.fromOpenings) && !cleaned) throw new Error('remove.fromOpenings 在所有开场里都没有匹配，未保存')

  // Openings: replace any old <initvar>/marker, append the new ones.
  const touchOpenings = object(request.variables) || openings.some(object)
  const states = greetings.map((text, index) => {
    const own = existingState(text)
    const start = object(request.variables) ? request.variables : own || {}
    return object(openings[index]) ? merge(start, openings[index]) : start
  })
  const fields = {}
  if (touchOpenings) {
    const next = bodies.map((text, index) => text.replace(INITVAR_BLOCK, '').replace(MARKER, '').replace(/\s+$/, '')
      + '\n\n<initvar>\n' + stateJson(states[index]) + '\n</initvar>\n\n<mvu-status/>')
    if (next[0] !== greetings[0]) fields.first_mes = next[0]
    if (next.slice(1).some((text, index) => text !== greetings[index + 1])) fields.alternate_greetings = next.slice(1)
  } else {
    const missing = bodies.flatMap((text, index) => /<mvu-status\s*\/>/i.test(text) ? [] : [index])
    const next = missing.length && bodies.some(text => /<initvar>/i.test(text))
      ? bodies.map((text, index) => missing.includes(index) ? text.replace(/\s+$/, '') + '\n\n<mvu-status/>' : text) : bodies
    if (next[0] !== greetings[0]) fields.first_mes = next[0]
    if (next.slice(1).some((text, index) => text !== greetings[index + 1])) fields.alternate_greetings = next.slice(1)
  }

  // Worldbook: one rules entry, one disabled default-values entry.
  const entries = Array.isArray(data.character_book?.entries) ? data.character_book.entries : []
  const worldbook = []
  const find = tag => entries.findIndex(entry => new RegExp('^\\s*\\[' + tag + '\\]', 'i').test(commentOf(entry)))
  const upsert = (tag, title, patch) => {
    const index = find(tag)
    if (index >= 0) worldbook.push({ op: 'update', ref: 'entry:' + index, patch })
    else worldbook.push({ op: 'add', entry: { comment: '[' + tag + ']' + title, primaryKeys: [], ...patch } })
  }
  if (request.rules !== undefined) {
    const rules = str(request.rules).trim()
    if (!rules) throw new Error('rules 不能为空')
    upsert('mvu_update', '状态更新规则', { content: rules.includes('mvu_submit_update') ? rules : rules + '\n\n' + UPDATE_TAIL, enabled: true, constant: true })
  }
  if (object(request.variables)) upsert('initvar', '状态初值', { content: stateJson(states[0]), enabled: false, constant: false })
  // Deletions go last, highest index first, so earlier refs stay valid.
  const dropEntries = [...new Set((Array.isArray(remove.entries) ? remove.entries : []).map(ref => {
    const index = Number(str(ref).replace(/^entry:/, ''))
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) throw new Error('remove.entries 里的条目不存在：' + ref)
    if (/^\s*\[(?:mvu_update|initvar)\]/i.test(commentOf(entries[index]))) throw new Error('不能删除 MVU 自己的条目：' + ref)
    return index
  }))].sort((a, b) => b - a)
  for (const index of dropEntries) worldbook.push({ op: 'delete', ref: 'entry:' + index })

  // Regex scripts: the panel view and the prompt-side marker removal.
  const scripts = Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts : []
  const dropRegex = new Set((Array.isArray(remove.regex) ? remove.regex : []).map(item => {
    const key = str(item).replace(/^.*\/regex_scripts\//, '')
    const index = /^\d+$/.test(key) && Number(key) < scripts.length ? Number(key) : scripts.findIndex(rule => str(rule?.id) === key)
    if (index < 0) throw new Error('remove.regex 里的正则不存在：' + item)
    if ([STATUS_VIEW_ID, HIDE_MARKER_ID].includes(scripts[index]?.id)) throw new Error('不能删除 MVU 自己的正则：' + item)
    return index
  }))
  const viewIndex = scripts.findIndex(rule => rule?.id === STATUS_VIEW_ID)
  const panel = request.panel
  let html, panelSource = 'kept'
  if (object(panel) && str(panel.html).trim()) { html = str(panel.html).trim(); panelSource = 'custom' }
  else if (object(panel) || viewIndex < 0) { html = generatePanel(object(panel) ? panel : {}, states[0]); panelSource = 'generated' }
  const nextScripts = scripts.map(rule => structuredClone(rule))
  const view = html === undefined ? undefined : {
    id: STATUS_VIEW_ID, scriptName: 'MVU 状态视图', findRegex: '/<mvu-status\\s*\\/>/g',
    // Regex replacement text: escape $ so scripts keep their dollar signs.
    replaceString: '```html\n' + html.replace(/\$/g, '$$$$') + '\n```',
    trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true, substituteRegex: 0
  }
  if (view) viewIndex >= 0 ? (nextScripts[viewIndex] = view) : nextScripts.push(view)
  for (const index of [...dropRegex].sort((a, b) => b - a)) nextScripts.splice(index, 1)
  if (!scripts.some(rule => rule?.id === HIDE_MARKER_ID)) nextScripts.push({
    id: HIDE_MARKER_ID, scriptName: '隐藏模型历史中的状态入口', findRegex: '/\\n*<mvu-status\\s*\\/>/g', replaceString: '',
    trimStrings: [], placement: [2], disabled: false, markdownOnly: false, promptOnly: true, runOnEdit: true, substituteRegex: 0
  })
  const rawOperations = JSON.stringify(nextScripts) === JSON.stringify(scripts) ? [] : [{ op: 'set', path: base + '/extensions/regex_scripts', value: nextScripts }]

  return {
    fields, rawOperations, worldbook,
    summary: {
      openings: touchOpenings ? greetings.length : 0,
      variables: leafPaths(states[0]),
      rules: request.rules === undefined ? 'kept' : find('mvu_update') >= 0 ? 'updated' : 'added',
      panel: panelSource,
      removed: { openings: cleaned, entries: dropEntries.length, regex: dropRegex.size }
    }
  }
}

// One-call map of what a conversion has to deal with, so the Agent need not
// walk the card file. Flags point at likely old status protocols to clean up.
const FLAGS = [
  ['MVU', /\bmvu\b|magvarupdate|initvar|stat[_ -]?data|mvu_submit_update/i],
  ['变量', /变量|getvar|setvar|<UpdateVariable|_\.set\(/i],
  ['状态输出', /状态栏|状态块|状态面板|StatusPlaceHolder|<status|status\s*bar|每(?:轮|次)(?:回复)?(?:末尾|结尾)?.{0,8}输出|输出.{0,6}格式/i],
  ['候选', /候选|选项|option|choice|行动建议/i],
  ['HTML', /<html|<div|<style|<details/i]
]
const flagsOf = (...parts) => { const text = parts.map(str).join('\n'); return FLAGS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name) }
const tail = (text, size) => { const flat = str(text).replace(/\s+/g, ' ').trim(); return flat.length > size ? '…' + flat.slice(-size) : flat }
const brief = (text, size = 80) => { const flat = str(text).replace(/\s+/g, ' ').trim(); return flat.length > size ? flat.slice(0, size) + '…' : flat }

export function surveyMvuCard(raw) {
  const base = cardBase(raw)
  const data = base ? raw.data : raw
  const greetings = [str(data.first_mes), ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings.map(str) : [])]
  const extensions = inspectCardExtensions(raw)
  const states = greetings.map(existingState)
  return {
    name: str(data.name), base,
    fields: Object.fromEntries(['description', 'personality', 'scenario', 'system_prompt', 'post_history_instructions', 'mes_example'].map(key => [key, { chars: str(data[key]).length, flags: flagsOf(data[key]) }])),
    openings: greetings.map((text, index) => ({
      index, pointer: base + (index ? '/alternate_greetings/' + (index - 1) : '/first_mes'), chars: text.length, start: brief(text), end: tail(text.replace(/<initvar>[\s\S]*?<\/initvar>|<mvu-status\s*\/>/gi, ''), 120),
      initvar: /<initvar>/i.test(text), marker: /<mvu-status\s*\/>/i.test(text), flags: flagsOf(text.replace(/<initvar>[\s\S]*?<\/initvar>/gi, ''))
    })),
    variables: leafPaths(states.find(object) || {}),
    worldbook: (Array.isArray(data.character_book?.entries) ? data.character_book.entries : []).map((entry, index) => ({
      ref: 'entry:' + index, title: commentOf(entry), enabled: entry?.enabled !== false && entry?.disable !== true, constant: entry?.constant === true,
      keys: (Array.isArray(entry?.keys) ? entry.keys : []).slice(0, 4).map(str), chars: str(entry?.content).length, flags: flagsOf(commentOf(entry), entry?.content)
    })),
    regex: extensions.regexScripts.map((script, index) => ({
      pointer: base + '/extensions/regex_scripts/' + index, id: script.id, name: script.name, enabled: script.enabled !== false,
      find: brief(script.findRegex, 60), chars: str(script.replaceString).length, flags: flagsOf(script.name, script.findRegex, script.replaceString)
    })),
    scripts: extensions.helperScripts.map(script => ({ name: script.name, enabled: script.enabled, chars: script.chars, buttons: script.buttonCount, flags: flagsOf(script.name, script.content, script.dataText) }))
  }
}

export function surveyText(survey) {
  const flags = list => list.length ? ' [' + list.join('/') + ']' : ''
  const lines = ['《' + survey.name + '》卡片文件里内容在 raw 下，字段位于 raw' + survey.base + '（下文路径都是 Tavern 工具用的 JSON Pointer，从 raw 起算）；meta 是酒馆元数据，不用改',
    '方括号为程序按关键词标出的可能相关处，需要你读原文判断']
  lines.push('设定字段：' + Object.entries(survey.fields).filter(([, v]) => v.chars).map(([k, v]) => k + ' ' + v.chars + '字' + flags(v.flags)).join('；'))
  lines.push('开场 ' + survey.openings.length + ' 个：')
  for (const item of survey.openings) lines.push('- ' + item.pointer + ' · ' + item.chars + '字' + (item.initvar ? ' · 有<initvar>' : '') + (item.marker ? ' · 有<mvu-status/>' : '') + flags(item.flags) + ' · 开头：' + item.start + (item.chars > 160 ? ' · 结尾：' + item.end : ''))
  if (survey.variables.length) lines.push('现有变量：' + survey.variables.join('、'))
  lines.push('内置世界书 ' + survey.worldbook.length + ' 条：')
  for (const item of survey.worldbook) lines.push('- ' + item.ref + ' ' + (item.title || '（无标题）') + ' · ' + (item.enabled ? (item.constant ? '常驻' : '关键词 ' + item.keys.join(',')) : '禁用') + ' · ' + item.chars + '字' + flags(item.flags))
  lines.push('正则 ' + survey.regex.length + ' 条' + (survey.regex.length ? '：' : ''))
  for (const item of survey.regex) lines.push('- ' + item.pointer + ' ' + item.name + (item.enabled ? '' : '（停用）') + ' · 查找 ' + item.find + ' · 替换 ' + item.chars + '字' + flags(item.flags))
  lines.push('脚本 ' + survey.scripts.length + ' 个' + (survey.scripts.length ? '：' : ''))
  for (const item of survey.scripts) lines.push('- ' + item.name + (item.enabled ? '' : '（停用）') + ' · ' + item.chars + '字' + (item.buttons ? ' · ' + item.buttons + ' 个按钮' : '') + flags(item.flags))
  return lines.join('\n')
}
