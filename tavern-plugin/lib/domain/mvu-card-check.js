import { parse as parseScript } from 'acorn'
import { parse as parseYaml } from 'yaml'

// Static format checks for MVU cards. The card is edited freely like a source
// file; this only points at things that would break at runtime, with locations
// and fixes. Card scripts are parsed, never executed.
export const MVU_MARKER = '<mvu-status/>'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const commentOf = entry => String(entry?.comment || entry?.name || '')

function parseState(text) {
  const body = String(text).replace(/^\s*```[^\n]*\n|\n```\s*$/g, '').trim()
  try { return { value: JSON.parse(body) } } catch (json) {
    try { return { value: parseYaml(body) } } catch { return { error: json.message } }
  }
}
function leafPaths(value, prefix = '', out = new Set()) {
  if (object(value) && Object.keys(value).length) {
    for (const [key, child] of Object.entries(value)) if (!key.startsWith('$')) leafPaths(child, prefix + '/' + key, out)
  } else out.add(prefix)
  return out
}
function compileRegex(source) {
  const match = /^\/([\s\S]*)\/([a-z]*)$/.exec(String(source || ''))
  return match ? new RegExp(match[1], match[2]) : new RegExp(String(source || ''))
}

export function looksLikeMvuCard(data) {
  const greetings = [data?.first_mes, ...(Array.isArray(data?.alternate_greetings) ? data.alternate_greetings : [])]
  const entries = Array.isArray(data?.character_book?.entries) ? data.character_book.entries : []
  return greetings.some(text => /<initvar>|<mvu-status\s*\/>/i.test(String(text || '')))
    || entries.some(entry => /^\s*\[(?:initvar|mvu_update)\]/i.test(commentOf(entry)))
}

export function checkMvuCard(data, prefix = '') {
  const errors = [], warnings = []
  const error = (path, message) => errors.push({ path: prefix + path, message })
  const warn = (path, message) => warnings.push({ path: prefix + path, message })
  const greetings = [data.first_mes, ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [])]
  const greetingPath = index => index ? '/alternate_greetings/' + (index - 1) : '/first_mes'
  const entries = Array.isArray(data.character_book?.entries) ? data.character_book.entries : []

  // Opening initial values
  const states = []
  for (const [index, text] of greetings.entries()) {
    const blocks = [...String(text || '').matchAll(/<initvar>([\s\S]*?)<\/initvar>/gi)]
    if (blocks.length > 1) warn(greetingPath(index), '有 ' + blocks.length + ' 个 <initvar>，通常每个开场只放一个')
    for (const block of blocks) {
      const parsed = parseState(block[1])
      if (parsed.error) error(greetingPath(index), '<initvar> 不是有效 JSON/YAML：' + parsed.error)
      else if (!object(parsed.value)) error(greetingPath(index), '<initvar> 必须是对象')
      else states.push({ path: greetingPath(index), value: parsed.value })
    }
  }
  const initEntries = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => /^\s*\[initvar\]/i.test(commentOf(entry)))
  for (const { entry, index } of initEntries) {
    const parsed = parseState(entry.content || '')
    if (parsed.error) error('/character_book/entries/' + index + '/content', '[initvar] 条目不是有效 JSON/YAML：' + parsed.error)
    else if (!object(parsed.value)) error('/character_book/entries/' + index + '/content', '[initvar] 条目必须是对象')
    else states.push({ path: '/character_book/entries/' + index, value: parsed.value })
  }
  if (!states.length && !errors.length) warn('/first_mes', '没有找到变量初值：开场里的 <initvar> 或世界书 [initvar] 条目')
  const withInit = greetings.map(text => /<initvar>/i.test(String(text || '')))
  if (withInit.some(Boolean) && !withInit.every(Boolean)) warn('/alternate_greetings', '开场 ' + withInit.flatMap((has, i) => has ? [] : [i]).join('、') + ' 没有 <initvar>，开局时没有该开场的初值')
  if (states.length > 1) {
    const all = new Set(states.flatMap(state => [...leafPaths(state.value)]))
    for (const state of states) {
      const missing = [...all].filter(path => !leafPaths(state.value).has(path))
      if (missing.length) warn(state.path, '初值缺少其他开场有的字段：' + missing.slice(0, 12).join('、') + (missing.length > 12 ? ' 等' : '') + '；如属有意可忽略')
    }
  }

  // Background update rules
  if (!entries.some(entry => /^\s*\[mvu_update\]/i.test(commentOf(entry)))) warn('/character_book/entries', '没有 [mvu_update] 条目：后台不知道变量按什么规则更新（若规则在绑定的外部世界书里可忽略）')

  // Regex scripts and the status panel
  const scripts = Array.isArray(data.extensions?.regex_scripts) ? data.extensions.regex_scripts : []
  const compiled = scripts.map((rule, index) => {
    try { return compileRegex(rule?.findRegex) } catch (cause) { error('/extensions/regex_scripts/' + index + '/findRegex', '正则无法编译：' + cause.message); return null }
  })
  const markerCount = greetings.map(text => String(text || '').split(MVU_MARKER).length - 1)
  if (markerCount.some(count => count > 1)) warn(greetingPath(markerCount.findIndex(count => count > 1)), '同一开场有多个 ' + MVU_MARKER + '，状态栏会重复')
  if (markerCount.some(Boolean)) {
    const hits = (test) => compiled.flatMap((regex, index) => {
      if (!regex || scripts[index]?.disabled === true || !test(scripts[index])) return []
      regex.lastIndex = 0
      return regex.test(MVU_MARKER) ? [index] : []
    })
    const views = hits(rule => rule.promptOnly !== true && (!Array.isArray(rule.placement) || rule.placement.includes(2)))
    if (!views.length) error('/extensions/regex_scripts', '开场有 ' + MVU_MARKER + ' 但没有把它替换成面板的正则（placement 含 2，promptOnly 不为 true），会原样显示')
    if (!hits(rule => rule.promptOnly === true).length) warn('/extensions/regex_scripts', '没有 promptOnly 正则把 ' + MVU_MARKER + ' 从模型历史中去掉，模型会看到这个标签')
    for (const index of views) checkPanel(scripts[index].replaceString, '/extensions/regex_scripts/' + index + '/replaceString', states, error, warn)
  } else if (states.length && !scripts.some(rule => /mvu|stat_data/i.test(String(rule?.replaceString || '')))) warn('/first_mes', '没有状态栏入口 ' + MVU_MARKER + '；不需要状态栏可忽略')
  return { errors, warnings }
}

function checkPanel(replaceString, path, states, error, warn) {
  const html = String(replaceString || '')
  const pattern = /\$(?:[&`'$]|\d|<[^>]*>)/.exec(html)
  if (pattern) warn(path, '含 "' + pattern[0] + '"：正则替换会把它当作引用改写；脚本里需要美元符号时写成 \\u0024')
  const bodies = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => {
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(match[1])?.[1]
    return !/\bsrc\s*=/i.test(match[1]) && (!type || /^(?:text\/javascript|application\/javascript|module)$/i.test(type))
  })
  for (const [, , body] of bodies) {
    try { parseScript(body, { ecmaVersion: 'latest', sourceType: 'script', allowAwaitOutsideFunction: true }) }
    catch (cause) { error(path, '面板脚本语法错误：' + cause.message) }
  }
  if (!/getMvuData|stat_data|getvar|getVariables/i.test(html)) warn(path, '面板没有读取变量（如 Mvu.getMvuData），只会显示静态内容')
  else if (!/VARIABLE_UPDATE_ENDED|eventOn|addEventListener/.test(html)) warn(path, '面板读取了变量但没有订阅更新事件（如 Mvu.events.VARIABLE_UPDATE_ENDED），变量变化后不会刷新')
  // data-mvu="/路径" is the documented binding convention; check the paths exist.
  const fields = new Set(states.flatMap(state => [...leafPaths(state.value)]))
  const unknown = [...html.matchAll(/data-mvu(?:-[a-z]+)?\s*=\s*["']([^"']+)["']/gi)].map(match => match[1])
    .filter(field => field.startsWith('/') && fields.size && ![...fields].some(known => known === field || known.startsWith(field + '/')))
  if (unknown.length) warn(path, '面板引用的变量路径在初值中不存在：' + [...new Set(unknown)].slice(0, 12).join('、'))
}
