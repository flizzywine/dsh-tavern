export function safeExportFileName(value, fallback) {
  const name = String(value ?? '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100)
  return name || fallback
}

// One shareable file for "how the story is told": a SillyTavern preset (raw
// text, untouched), a system prompt set and a confirmed long-term preference.
// Every part is optional; import always adds new entries and never overwrites.
export const SETTINGS_BUNDLE_SPEC = 'dsh-tavern.bundle'
export const SETTINGS_BUNDLE_PARTS = Object.freeze(['preset', 'systemPrompts', 'userProfile'])

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function buildSettingsBundle({ name, preset, systemPrompts, userProfile }) {
  const bundle = { spec: SETTINGS_BUNDLE_SPEC, version: 1, name: String(name || '').trim() || 'DSH Tavern 预设' }
  if (preset) bundle.preset = { name: preset.name, text: preset.text }
  if (systemPrompts) bundle.systemPrompts = systemPrompts
  if (userProfile) bundle.userProfile = { name: userProfile.name, summary: userProfile.summary, injectionText: userProfile.injectionText }
  return bundle
}

// Accepts a bundle, a bare SillyTavern preset or a bare system prompt file, and
// returns the parts it carries in bundle shape.
export function readSettingsBundle(text, fileName = '') {
  let document
  try { document = JSON.parse(text) } catch (error) { throw new Error('文件不是有效的 JSON: ' + String(error && error.message || error)) }
  const value = record(document)
  if (!value) throw new Error('无法识别的文件：既不是 DSH Tavern 预设包，也不是酒馆预设或系统提示词文件')
  const baseName = String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.json$/i, '').trim()
  if (value.spec === SETTINGS_BUNDLE_SPEC) {
    if (Number(value.version) !== 1) throw new Error('不支持的预设包版本: ' + String(value.version))
    const parts = { kind: 'bundle', name: String(value.name || baseName || '导入的预设包').trim() }
    const preset = record(value.preset)
    if (preset) {
      if (typeof preset.text !== 'string' || preset.text.trim() === '') throw new Error('预设包里的预设内容为空')
      parts.preset = { name: String(preset.name || parts.name + '.json'), text: preset.text }
    }
    if (record(value.systemPrompts)) parts.systemPrompts = value.systemPrompts
    const profile = record(value.userProfile)
    if (profile) {
      const injectionText = typeof profile.injectionText === 'string' ? profile.injectionText.trim() : ''
      if (injectionText === '' || injectionText.length > 3000) throw new Error('预设包里的长期偏好正文须为 1 至 3000 字')
      parts.userProfile = { name: String(profile.name || parts.name).trim().slice(0, 100), summary: typeof profile.summary === 'string' ? profile.summary : '', injectionText }
    }
    if (!parts.preset && !parts.systemPrompts && !parts.userProfile) throw new Error('预设包里没有可导入的内容')
    return parts
  }
  if (value.spec === 'dsh-tavern.system-prompts') return { kind: 'systemPrompts', name: String(value.name || baseName || '导入的方案'), systemPrompts: value }
  if (Array.isArray(value.prompts)) return { kind: 'preset', name: baseName || '导入的预设', preset: { name: (baseName || '导入的预设') + '.json', text } }
  throw new Error('无法识别的文件：既不是 DSH Tavern 预设包，也不是酒馆预设或系统提示词文件')
}
