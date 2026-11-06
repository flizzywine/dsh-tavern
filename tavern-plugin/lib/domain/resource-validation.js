import { inspectPreset, nativeRegexScriptsOf, regexScriptsOf } from './preset-reading.js'
import { inspectWorldBookDocument } from './worldbook-resource.js'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string')

// Offset of the first JSON syntax error. V8 omits positions for some
// messages, and a JavaScript parser accepts trailing commas and elisions.
function jsonErrorOffset(text) {
  let i = 0
  const fail = () => { throw i }
  const space = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++ }
  const literal = word => { if (text.startsWith(word, i)) i += word.length; else fail() }
  const string = () => {
    i++
    while (i < text.length && text[i] !== '"') {
      if (text.charCodeAt(i) < 0x20) fail()
      if (text[i] === '\\') {
        i++
        if (text[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail(); i += 4 }
        else if (!'"\\/bfnrt'.includes(text[i] ?? 'x')) fail()
      }
      i++
    }
    if (i >= text.length) fail()
    i++
  }
  const value = () => {
    space()
    const c = text[i]
    if (c === '{') {
      i++; space()
      if (text[i] === '}') { i++; return }
      for (;;) {
        space(); if (text[i] !== '"') fail(); string(); space()
        if (text[i] !== ':') fail(); i++; value(); space()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return }
        fail()
      }
    }
    if (c === '[') {
      i++; space()
      if (text[i] === ']') { i++; return }
      for (;;) {
        value(); space()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return }
        fail()
      }
    }
    if (c === '"') return string()
    if (c === 't') return literal('true')
    if (c === 'f') return literal('false')
    if (c === 'n') return literal('null')
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 400))
    if (!number) fail()
    i += number[0].length
  }
  try { value(); space(); return i < text.length ? i : -1 } catch (offset) { return offset }
}

/** Parse JSON; on failure report only the location, since V8 messages quote document text. */
export function parseJsonWithLocation(text) {
  try { return { value: JSON.parse(text) } } catch {
    const offset = jsonErrorOffset(text)
    if (offset < 0) return { error: 'JSON 语法错误' }
    const prefix = text.slice(0, offset)
    return { error: 'JSON 语法错误（第 ' + prefix.split('\n').length + ' 行，第 ' + (prefix.length - prefix.lastIndexOf('\n')) + ' 列）' }
  }
}

function regexIssues(scripts, path, issue) {
  scripts.forEach((script, index) => {
    const source = script.findRegex
    if (!source) return
    const match = /^\/(.*)\/([dgimsuvy]*)$/s.exec(source)
    try { match ? new RegExp(match[1], match[2]) : new RegExp(source) } catch { issue(path + '/' + index + '/findRegex', '正则「' + script.name + '」无法编译') }
  })
}

// Static structure check only: the preset is never applied or run.
export function validatePresetText(text) {
  const errors = [], warnings = []
  const issue = (path, message) => errors.push({ path, message })
  const result = () => ({ valid: errors.length === 0, errors, warnings })
  const parsed = parseJsonWithLocation(text)
  if (parsed.error) { issue('/', parsed.error); return result() }
  const raw = parsed.value
  if (!object(raw)) { issue('/', '预设根节点必须是对象'); return result() }
  if (raw.prompts !== undefined && !Array.isArray(raw.prompts)) issue('/prompts', 'prompts 必须是数组')
  if (Array.isArray(raw.prompts)) raw.prompts.forEach((prompt, index) => {
    const path = '/prompts/' + index
    if (!object(prompt)) return issue(path, '提示词条目必须是对象')
    if (prompt.identifier !== undefined && typeof prompt.identifier !== 'string') issue(path + '/identifier', 'identifier 必须是字符串')
    for (const key of ['name', 'content']) if (prompt[key] !== undefined && typeof prompt[key] !== 'string') issue(path + '/' + key, key + ' 必须是字符串')
    for (const key of ['enabled', 'marker', 'system_prompt']) if (prompt[key] !== undefined && typeof prompt[key] !== 'boolean') issue(path + '/' + key, key + ' 必须是布尔值')
  })
  if (raw.prompt_order !== undefined && !Array.isArray(raw.prompt_order)) issue('/prompt_order', 'prompt_order 必须是数组')
  if (Array.isArray(raw.prompt_order)) raw.prompt_order.forEach((group, index) => {
    const path = '/prompt_order/' + index
    if (!object(group)) return issue(path, '排序分组必须是对象')
    if (!Array.isArray(group.order)) return issue(path + '/order', 'order 必须是数组')
    group.order.forEach((item, itemIndex) => {
      if (!object(item) || typeof item.identifier !== 'string') issue(path + '/order/' + itemIndex, '排序项必须是带 identifier 字符串的对象')
      else if (item.enabled !== undefined && typeof item.enabled !== 'boolean') issue(path + '/order/' + itemIndex + '/enabled', 'enabled 必须是布尔值')
    })
  })
  if (object(raw.extensions) && raw.extensions.regex_scripts !== undefined && !Array.isArray(raw.extensions.regex_scripts)) issue('/extensions/regex_scripts', 'regex_scripts 必须是数组')
  regexIssues(nativeRegexScriptsOf(raw), '/extensions/regex_scripts', issue)
  regexIssues(regexScriptsOf(raw), '/extensions/SPreset/RegexBinding/regexes', issue)
  const inspected = inspectPreset(text)
  if (!inspected.recognized) warnings.push({ path: '/', message: '没有 prompts 数组，不是可识别的 SillyTavern 对话预设' })
  else if (inspected.warning) warnings.push({ path: '/prompt_order', message: inspected.warning })
  warnings.push({ path: '/', message: '仅检查静态格式；未应用预设或运行正则，格式通过不代表效果符合预期' })
  return result()
}

export function validateWorldBookText(text) {
  const errors = [], warnings = []
  const issue = (path, message) => errors.push({ path, message })
  const result = () => ({ valid: errors.length === 0, errors, warnings })
  const parsed = parseJsonWithLocation(text)
  if (parsed.error) { issue('/', parsed.error); return result() }
  let inspected
  try { inspected = inspectWorldBookDocument(parsed.value) } catch (error) { issue('/', error.message); return result() }
  const embedded = inspected.format !== 'sillytavern-worldbook'
  const base = inspected.format === 'card-embedded' ? (object(parsed.value.data) ? '/data/character_book' : '/character_book') : ''
  const raw = inspected.raw
  const records = embedded ? (raw.entries || []).map((entry, index) => [String(index), entry]) : Object.entries(raw.entries)
  for (const [key, entry] of records) {
    const path = base + '/entries/' + key
    if (!object(entry)) { issue(path, '世界书条目必须是对象'); continue }
    for (const field of embedded ? ['keys', 'secondary_keys'] : ['key', 'keysecondary']) {
      if (entry[field] !== undefined && !strings(entry[field])) issue(path + '/' + field, '关键词必须是字符串数组')
    }
    for (const field of ['content', 'comment']) if (entry[field] !== undefined && typeof entry[field] !== 'string') issue(path + '/' + field, field + ' 必须是字符串')
  }
  for (const diagnostic of inspected.diagnostics) {
    const path = diagnostic.ref ? base + '/entries/' + diagnostic.ref.replace(/^entry:/, '') : base || '/'
    if (diagnostic.level === 'error') issue(path, diagnostic.message)
    else warnings.push({ path, message: diagnostic.message })
  }
  return result()
}
