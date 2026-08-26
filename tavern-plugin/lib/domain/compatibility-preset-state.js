function emptyState() {
  return { version: 1, entries: {}, updatedAt: 0 }
}

function normalizeState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const entries = Number(source.version) === 1 && source.entries && typeof source.entries === 'object' && !Array.isArray(source.entries)
    ? source.entries
    : {}
  return {
    version: 1,
    entries: Object.fromEntries(Object.entries(entries).map(function ([path, overrides]) {
      const record = overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {}
      return [path, Object.fromEntries(Object.entries(record).filter(function ([entryKey, enabled]) {
        return entryKey !== '' && typeof enabled === 'boolean'
      }))]
    })),
    updatedAt: Number(source.updatedAt) || 0
  }
}

function recognized(preset) {
  return preset && preset.valid === true && preset.recognized === true && Array.isArray(preset.entries)
}

export function createCompatibilityPresetState(options = {}) {
  const readPreset = options.readPreset
  const readState = options.readState
  const updateState = options.updateState
  const now = typeof options.now === 'function' ? options.now : Date.now
  if ([readPreset, readState, updateState].some(function (fn) { return typeof fn !== 'function' })) {
    throw new TypeError('酒馆兼容预设状态缺少存储适配器')
  }

  async function state() {
    return normalizeState(await readState())
  }

  async function mutate(updater) {
    return updateState(async function (value) {
      const current = normalizeState(value)
      const next = await updater(current)
      if (next === undefined) return undefined
      next.updatedAt = now()
      return next
    })
  }

  async function view(path, presetValue) {
    const preset = presetValue || await readPreset(path)
    if (!recognized(preset)) throw new Error('当前预设不是可识别的 SillyTavern 预设：' + path)
    const current = await state()
    const overrides = current.entries[path] || {}
    const entries = preset.entries.map(function (entry) {
      const inherited = entry.enabled !== false
      const overridden = Object.prototype.hasOwnProperty.call(overrides, entry.entryKey)
      return Object.assign({}, entry, {
        compatibilityEnabled: overridden ? overrides[entry.entryKey] : inherited,
        compatibilityInherited: !overridden
      })
    })
    return Object.assign({}, preset, {
      entries,
      compatibilityEnabledCount: entries.filter(function (entry) { return entry.ordered === true && entry.compatibilityEnabled === true }).length
    })
  }

  async function apply(path, presetValue) {
    const projected = await view(path, presetValue)
    return Object.assign({}, projected, {
      entries: projected.entries.map(function (entry) {
        return Object.assign({}, entry, { enabled: entry.compatibilityEnabled === true })
      })
    })
  }

  async function toggle({ path, entryKey, enabled }) {
    const preset = await readPreset(path)
    if (!recognized(preset)) throw new Error('当前预设不是可识别的 SillyTavern 预设：' + path)
    const entry = preset.entries.find(function (item) { return item.entryKey === entryKey })
    if (!entry) throw new Error('预设条目不存在：' + entryKey)
    if (entry.ordered !== true) throw new Error('未进入 prompt_order 的条目不能用于酒馆兼容请求')
    return mutate(function (current) {
      if (!current.entries[path]) current.entries[path] = {}
      current.entries[path][entryKey] = enabled === true
      return current
    })
  }

  async function rename(oldPath, newPath) {
    if (oldPath === newPath) return await state()
    return mutate(function (current) {
      if (!Object.prototype.hasOwnProperty.call(current.entries, oldPath)) return undefined
      current.entries[newPath] = current.entries[oldPath]
      delete current.entries[oldPath]
      return current
    })
  }

  async function remove(path) {
    return mutate(function (current) {
      if (!Object.prototype.hasOwnProperty.call(current.entries, path)) return undefined
      delete current.entries[path]
      return current
    })
  }

  return Object.freeze({ state, view, apply, toggle, rename, remove })
}
