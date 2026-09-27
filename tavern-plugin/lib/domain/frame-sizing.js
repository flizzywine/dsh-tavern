function normalizeFrameSizing(value) {
  if (!value || !['content', 'viewport', 'fixed'].includes(value.mode)) return null
  const result = { mode: value.mode, minHeight: 48, maxHeight: 32000 }
  for (const key of ['height', 'minHeight', 'maxHeight', 'aspectRatio']) {
    if (value[key] === undefined) continue
    const n = value[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 32000) return null
    result[key] = n
  }
  if (result.minHeight < 48 || result.maxHeight < result.minHeight) return null
  if (result.mode === 'fixed' && !result.height && !result.aspectRatio) return null
  return result
}

function normalizeCardFrameSizing(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const panels = Object.create(null)
  for (const [id, config] of Object.entries(value.panels || {}).slice(0, 64)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) continue
    const normalized = normalizeFrameSizing(config)
    if (normalized) panels[id] = normalized
  }
  const fallback = normalizeFrameSizing(value.default)
  return fallback || Object.keys(panels).length ? { default: fallback, panels } : null
}

export { normalizeFrameSizing, normalizeCardFrameSizing }
