// Options a plugin adds to a game's settings (docs/plugin-api.md gameSettings): the plugin
// declares the fields, Tavern draws them in 本局设置 and keeps the player's values with the game.
const TYPES = new Set(['boolean', 'select', 'number', 'text'])
const MAX_FIELDS = 20
const MAX_OPTIONS = 20
const MAX_TEXT = 500

function invalid(message) { return Object.assign(new Error(message), { code: 'TAVERN_PLUGIN_INVALID' }) }

function shortText(value, limit, label, required) {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > limit) throw invalid(label + (required ? ' 需要 1–' : ' 最多 ') + limit + ' 字')
  return value.trim()
}

/** Check one plugin's declaration and return it in a plain, frozen-ready form. */
export function normalizeGameSettings({ title, fields } = {}) {
  const heading = shortText(title, 20, 'title', false)
  if (!Array.isArray(fields) || !fields.length || fields.length > MAX_FIELDS) throw invalid('fields 需要 1–' + MAX_FIELDS + ' 项')
  const keys = new Set()
  const normalized = fields.map((field, index) => {
    const label = 'fields[' + index + ']'
    if (!field || typeof field !== 'object') throw invalid(label + ' 必须是对象')
    if (typeof field.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(field.key)) throw invalid(label + '.key 只能用字母、数字和下划线，以字母开头，最多 40 字')
    if (keys.has(field.key)) throw invalid('配置项 ' + field.key + ' 重复')
    keys.add(field.key)
    if (!TYPES.has(field.type)) throw invalid(label + ".type 只能是 'boolean'、'select'、'number' 或 'text'")
    const result = { key: field.key, type: field.type, label: shortText(field.label, 40, label + '.label', true), description: shortText(field.description, 200, label + '.description', false) }
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > MAX_OPTIONS) throw invalid(label + '.options 需要 1–' + MAX_OPTIONS + ' 项')
      result.options = field.options.map((option, at) => {
        const value = typeof option === 'string' ? option : option?.value
        if (typeof value !== 'string' || !value || value.length > 100) throw invalid(label + '.options[' + at + '] 的 value 需要 1–100 字')
        return { value, label: typeof option === 'string' ? option : shortText(option.label ?? value, 40, label + '.options[' + at + '].label', true) }
      })
      if (new Set(result.options.map(option => option.value)).size !== result.options.length) throw invalid(label + '.options 有重复的 value')
    }
    if (field.type === 'number') {
      for (const name of ['min', 'max', 'step']) {
        if (field[name] === undefined) continue
        if (!Number.isFinite(field[name])) throw invalid(label + '.' + name + ' 必须是数字')
        result[name] = field[name]
      }
      if (result.min !== undefined && result.max !== undefined && result.min > result.max) throw invalid(label + ' 的 min 不能大于 max')
      if (result.step !== undefined && !(result.step > 0)) throw invalid(label + '.step 必须大于 0')
    }
    if (field.type === 'text') result.maxLength = Number.isInteger(field.maxLength) && field.maxLength > 0 ? Math.min(MAX_TEXT, field.maxLength) : 200
    const fallback = { boolean: false, select: result.options?.[0]?.value, number: result.min ?? 0, text: '' }[field.type]
    if (field.default === undefined) result.default = fallback
    else {
      const value = coerceSetting(result, field.default)
      if (value === undefined) throw invalid(label + '.default 不符合这个配置项的类型或范围')
      result.default = value
    }
    return result
  })
  return { title: heading, fields: normalized }
}

/** A value the player (or a card) gives one field, or undefined when it does not fit. */
export function coerceSetting(field, value) {
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : undefined
  if (field.type === 'select') return field.options.some(option => option.value === value) ? value : undefined
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    if (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) return undefined
    return value
  }
  if (field.type === 'text') return typeof value === 'string' && value.length <= field.maxLength ? value : undefined
  return undefined
}

/** The values in effect: what was stored where it still fits, the declared default elsewhere. */
export function settingValues(declaration, stored) {
  const values = {}
  for (const field of declaration.fields) {
    const saved = stored && Object.hasOwn(stored, field.key) ? coerceSetting(field, stored[field.key]) : undefined
    values[field.key] = saved === undefined ? field.default : saved
  }
  return values
}
