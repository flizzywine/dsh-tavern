import { randomUUID } from 'node:crypto'

export const LEGACY_BUBBLE_TEMPLATE = '【对话气泡格式 · 必须遵守】\n{{bubble_format}}\n{{bubble_emotions}}\n- 玩家（{{user}}）的台词同样改写成气泡行。\n{{bubble_characters}}'
// Same heading as block mode, so saving the default unchanged or editing it keeps the aligned wording.
export const DEFAULT_BUBBLE_TEMPLATE = '【对白格式】\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}'
// The previous default heading; saved verbatim it is still not a customization.
export const OLD_HEADING_BUBBLE_TEMPLATE = '【对话气泡格式 · 必须遵守】\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_characters}}'
// The default before {{bubble_player}} was retired (it now expands to ''); cards that saved it verbatim are not customized.
export const PLAYER_SLOT_BUBBLE_TEMPLATE = '【对话气泡格式 · 必须遵守】\n{{bubble_format}}\n{{bubble_emotions}}\n{{bubble_player}}\n{{bubble_characters}}'
// Every built-in default a card may have saved; any of them normalizes to '' (block mode).
export const BUILTIN_BUBBLE_TEMPLATES = Object.freeze([DEFAULT_BUBBLE_TEMPLATE, OLD_HEADING_BUBBLE_TEMPLATE, PLAYER_SLOT_BUBBLE_TEMPLATE, LEGACY_BUBBLE_TEMPLATE])
export const BUILTIN_BUBBLE_PRESETS = Object.freeze([
  ['detailed', '细分', 'detailed', false],
  ['simple', '简洁八类', 'simple', false],
  ['detailed-bilingual', '细分＋双语', 'detailed', true],
  ['simple-bilingual', '简洁八类＋双语', 'simple', true]
].map(([presetId, name, emotionMode, bilingual]) => Object.freeze({ presetId, name, emotionMode, bilingual, template: DEFAULT_BUBBLE_TEMPLATE, builtin: true })))
const ID = /^[a-zA-Z0-9_-]{1,80}$/
const REQUIRED = ['bubble_format', 'bubble_emotions', 'bubble_characters']
export function normalizeBubblePlacement(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('插入位置必须是对象')
  const result = {}
  if (Object.hasOwn(value, 'book')) {
    if (typeof value.book !== 'string' || !value.book || value.book.length > 1000) throw new Error('目标世界书无效')
    result.book = value.book
  }
  for (const [key, min, max] of [['position', 0, 1], ['depth', 0, 1000], ['role', 0, 2], ['order', -1000000, 1000000]]) {
    if (!Object.hasOwn(value, key)) continue
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error('插入位置字段无效：' + key)
    result[key] = value[key]
  }
  return result
}
// Legacy RPC snapshots remain readable, but cards no longer select a format preset.
export function normalizeBubbleInjection(value) {
  if (value == null) return { template: '', extra: '' }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('格式设置必须是对象')
  const template = value.template === undefined ? '' : value.template
  if (typeof template !== 'string' || template.length > 12000) throw new Error('模板正文最多 12000 字')
  const extra = value.extra === undefined ? '' : value.extra
  if (typeof extra !== 'string' || extra.length > 2000) throw new Error('补充要求最多 2000 字')
  const placement = normalizeBubblePlacement(value.placement)
  const settings = { extra, ...(placement === undefined ? {} : { placement }) }
  if (!template.trim() || BUILTIN_BUBBLE_TEMPLATES.includes(template)) return { template: '', ...settings }
  for (const token of REQUIRED) if (!template.includes('{{' + token + '}}')) throw new Error('模板必须保留 {{' + token + '}} 占位符')
  return { template, ...settings }
}

function normalizeBubblePreset(value = BUILTIN_BUBBLE_PRESETS[0]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('格式预设必须是对象')
  const { presetId, name, emotionMode, bilingual, template } = value
  if (typeof presetId !== 'string' || !ID.test(presetId)) throw new Error('预设编号无效')
  if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('预设名称须为 1–60 字')
  if (!['detailed', 'simple'].includes(emotionMode)) throw new Error('请选择细分或简洁八类差分')
  if (typeof bilingual !== 'boolean') throw new Error('双语格式选项无效')
  if (typeof template !== 'string' || template.length > 12000) throw new Error('模板正文最多 12000 字')
  for (const token of REQUIRED) if (!template.includes('{{' + token + '}}')) throw new Error('模板必须保留 {{' + token + '}} 占位符')
  return { presetId, name: name.trim(), emotionMode, bilingual, template }
}

export function createDialogueBubblePresets(profileData) {
  const file = 'bubbles/presets.json'
  let tail = Promise.resolve()
  async function read() {
    const stored = await profileData.readJson(file)
    if (stored == null) return []
    if (!Array.isArray(stored) || stored.length > 32) throw new Error('自定义预设库格式无效')
    const seen = new Set(BUILTIN_BUBBLE_PRESETS.map(item => item.presetId))
    return stored.map(item => {
      const next = normalizeBubblePreset(item)
      if (seen.has(next.presetId)) throw new Error('预设编号重复或占用内置编号')
      seen.add(next.presetId)
      return next
    })
  }
  function enqueue(work) { const result = tail.then(work); tail = result.catch(() => {}); return result }
  async function list() { await tail; return [...BUILTIN_BUBBLE_PRESETS.map(item => ({ ...item })), ...await read()] }
  function upsert(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('格式预设必须是对象')
    const next = normalizeBubblePreset({ ...value, presetId: value.presetId === undefined || value.presetId === '' ? 'custom-' + randomUUID() : value.presetId })
    if (BUILTIN_BUBBLE_PRESETS.some(item => item.presetId === next.presetId)) throw new Error('内置预设不能覆盖，请另存为自定义预设')
    return enqueue(async () => {
      const items = await read(), index = items.findIndex(item => item.presetId === next.presetId)
      if (index < 0) { if (items.length >= 32) throw new Error('最多保存 32 个自定义预设'); items.push(next) } else items[index] = next
      await profileData.writeJson(file, items)
      return { ...next }
    })
  }
  function remove(presetId) {
    if (typeof presetId !== 'string' || !ID.test(presetId)) throw new Error('预设编号无效')
    if (BUILTIN_BUBBLE_PRESETS.some(item => item.presetId === presetId)) throw new Error('内置预设不能删除')
    return enqueue(async () => {
      const items = await read()
      await profileData.writeJson(file, items.filter(item => item.presetId !== presetId))
      return { removed: items.some(item => item.presetId === presetId) }
    })
  }
  return Object.freeze({ list, upsert, remove })
}
