// Card Stage: a card-owned presentation layer.
//
// A card may ship `data.extensions.dsh_stage`, a single HTML document that the
// client runs in sandboxed iframes around the story: a full-bleed backdrop
// behind the text, an interactive HUD, or (opt-in) a full takeover of the play
// area. The stage is presentation only. It reads variables and story through
// the existing Tavern Helper runtime and never becomes an authority for story,
// variables or the Story Timeline.
//
// Pure module: no DSH, no filesystem.

export const CARD_STAGE_EXTENSION = 'dsh_stage'
export const CARD_STAGE_VERSION = 1
export const CARD_STAGE_MAX_HTML = 2 * 1024 * 1024
const MODES = new Set(['layers', 'takeover'])
const REGIONS = ['backdrop', 'hud']
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|hsla?\(\s*[\d.]+(deg)?\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+%?\s*)?\)|transparent)$/i
const FONT_PRESETS = Object.freeze({
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", SimSun, Georgia, serif',
  kai: '"LXGW WenKai", "Kaiti SC", STKaiti, KaiTi, "Noto Serif SC", serif'
})
// Theme keys the host applies to its own reading surface as CSS custom properties.
const THEME_COLORS = Object.freeze({ text: '--stage-text', muted: '--stage-muted', panel: '--stage-panel', accent: '--stage-accent', border: '--stage-border' })

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function str(value) { return typeof value === 'string' ? value : '' }

function color(value) {
  const text = str(value).trim()
  return text !== '' && text.length <= 64 && COLOR.test(text) ? text : ''
}

function font(value) {
  const text = str(value).trim()
  if (FONT_PRESETS[text]) return FONT_PRESETS[text]
  // Font stacks only: names, quotes, commas, spaces. No url(), no semicolons.
  return text !== '' && text.length <= 240 && /^[\p{L}\p{N} ,"'_-]+$/u.test(text) ? text : ''
}

function themeOf(value) {
  const source = object(value) ? value : {}
  const vars = {}
  for (const [key, property] of Object.entries(THEME_COLORS)) {
    const resolved = color(source[key])
    if (resolved) vars[property] = resolved
  }
  const readingFont = font(source.readingFont)
  if (readingFont) vars['--stage-reading-font'] = readingFont
  const scheme = source.scheme === 'dark' || source.scheme === 'light' ? source.scheme : ''
  return { scheme, vars }
}

function simpleHash(text) {
  // FNV-1a, enough to key a document revision; not a security boundary.
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/**
 * Normalize a card's stage extension.
 * @returns {null | { version, mode, regions, html, theme, hudWidth, revision, warnings }}
 */
export function projectCardStage(extensions) {
  const source = object(extensions) ? extensions[CARD_STAGE_EXTENSION] : undefined
  if (!object(source) || source.enabled === false) return null
  const html = str(source.html)
  if (html.trim() === '') return null
  const warnings = []
  if (html.length > CARD_STAGE_MAX_HTML) {
    return { version: CARD_STAGE_VERSION, mode: 'layers', regions: [], html: '', theme: { scheme: '', vars: {} }, hudWidth: 0, revision: '', warnings: ['卡片舞台超过 2MB，已停用。大体积素材请放进舞台素材并按引用加载。'] }
  }
  const mode = MODES.has(source.mode) ? source.mode : 'layers'
  if (source.mode !== undefined && !MODES.has(source.mode)) warnings.push('未知舞台模式 ' + JSON.stringify(source.mode) + '，已按 layers 处理。')
  const requested = Array.isArray(source.regions) ? source.regions.filter(function (item) { return REGIONS.includes(item) }) : ['backdrop']
  const regions = mode === 'takeover' ? ['takeover'] : (requested.length ? Array.from(new Set(requested)) : ['backdrop'])
  const width = Number(source.hudWidth)
  const hudWidth = Number.isFinite(width) ? Math.max(200, Math.min(560, Math.round(width))) : 300
  const theme = themeOf(source.theme)
  const revision = simpleHash(JSON.stringify([mode, regions, hudWidth, theme, html]))
  return { version: CARD_STAGE_VERSION, mode, regions, html, theme, hudWidth, revision, warnings }
}
