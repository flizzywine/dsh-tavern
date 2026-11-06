import { checkMvuCard, looksLikeMvuCard } from './mvu-card-check.js'
import { parseJsonWithLocation } from './resource-validation.js'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// Static validation only: never execute card scripts or rewrite the document.
export function validateCardText(text) {
  const errors = [], warnings = []
  const issue = (path, message) => errors.push({ path, message })
  const result = () => ({ valid: errors.length === 0, errors, warnings })
  const parsed = parseJsonWithLocation(text)
  if (parsed.error) { issue('/', parsed.error); return result() }
  let raw = parsed.value
  let prefix = ''
  if (object(raw) && raw.kind === 'dsh-tavern-character-workspace') {
    if (raw.version !== 1) issue('/version', '不支持的人物卡工作版版本')
    raw = raw.raw; prefix = '/raw'
  }
  if (!object(raw)) { issue(prefix || '/', '人物卡根节点必须是对象'); return result() }
  let data = raw
  if (raw.spec !== undefined) {
    if (!['chara_card_v2', 'chara_card_v3'].includes(raw.spec)) issue(prefix + '/spec', '不支持的人物卡 spec')
    // Legacy workspace snapshots retain the spec marker but store fields flat.
    // Match card-preparation's read/write fallback without accepting an explicit
    // malformed data container or changing the persisted card.
    if (raw.data !== undefined) { prefix += '/data'; data = raw.data }
  }
  if (!object(data)) { issue(prefix, '人物卡 data 必须是对象'); return result() }
  if (typeof data.name !== 'string' || !data.name.trim()) issue(prefix + '/name', '角色名必须是非空字符串')
  for (const key of ['description', 'personality', 'scenario', 'first_mes', 'mes_example', 'system_prompt', 'post_history_instructions', 'creator_notes', 'creator', 'character_version']) {
    if (data[key] !== undefined && typeof data[key] !== 'string') issue(prefix + '/' + key, '必须是字符串')
  }
  for (const key of ['tags', 'alternate_greetings', 'group_only_greetings']) {
    if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(item => typeof item !== 'string'))) issue(prefix + '/' + key, '必须是字符串数组')
  }
  for (const key of ['extensions', 'character_book']) {
    if (data[key] !== undefined && data[key] !== null && !object(data[key])) issue(prefix + '/' + key, '必须是对象')
  }
  const extensions = object(data.extensions) ? data.extensions : {}
  const helper = extensions.tavern_helper
  if (helper !== undefined && !object(helper)) issue(prefix + '/extensions/tavern_helper', '必须是对象')
  if (object(helper)) {
    if (helper.variables !== undefined && !object(helper.variables)) issue(prefix + '/extensions/tavern_helper/variables', '变量初值必须是对象')
    if (helper.scripts !== undefined && !Array.isArray(helper.scripts)) issue(prefix + '/extensions/tavern_helper/scripts', '脚本集合必须是数组')
  }
  if (data.character_book && data.character_book.entries !== undefined && !Array.isArray(data.character_book.entries)) issue(prefix + '/character_book/entries', '世界书条目必须是数组')
  if (!data.first_mes) warnings.push({ path: prefix + '/first_mes', message: '未设置开场白；请确认是否符合预期' })
  if (data.character_book && Array.isArray(data.character_book.entries)) data.character_book.entries.forEach(function (entry, index) {
    const path = prefix + '/character_book/entries/' + index
    if (!object(entry)) return issue(path, '世界书条目必须是对象')
    if (entry.keys !== undefined && (!Array.isArray(entry.keys) || entry.keys.some(key => typeof key !== 'string'))) issue(path + '/keys', '关键词必须是字符串数组')
    if (entry.content !== undefined && typeof entry.content !== 'string') issue(path + '/content', '条目正文必须是字符串')
  })
  if (looksLikeMvuCard(data)) {
    const mvu = checkMvuCard(data, prefix)
    errors.push(...mvu.errors); warnings.push(...mvu.warnings)
  }
  warnings.push({ path: '/', message: '仅检查静态格式；未执行正则、脚本或 MVU 结算，格式通过不代表运行成功' })
  return result()
}

export async function validateCardFile({ path, readText }) {
  if (!path) return { valid: false, errors: [{ path: '/', message: '请先保存人物卡文件，再指定 cards/... 路径校验' }], warnings: [] }
  const text = await readText(path)
  if (text === undefined) return { valid: false, errors: [{ path, message: '人物卡文件不存在' }], warnings: [] }
  return validateCardText(text)
}
