// 画风 (the style a generated picture is painted in): one chain, 素材包 → 角色卡 → 配图插件.
// A pack (manifest.genStyle) and a card (extensions.dsh_tavern.genStyle) store the same
// shape: a style id (= every use), or {all?, figure?, sheet?, background?, cg?}. A style id names a style preset of the image
// plugin; 'no-style' paints none; 'follow-plugin' skips the card and takes the plugin's choice. A missing value follows the
// next link: a pack's goes to its card (only a card's 自动素材 pack has one card) and then to the plugin; a card's goes to the
// plugin. The plugin's own choice ends the chain (a template that adds no style = no style).
// A card and a pack may carry style definitions of their own (`styles`, the image plugin's preset format), so a style travels
// with the card; the host registers them read-only into the plugin (随卡 / 随包) before it names one.
import { check, assertJson } from './common.js'

export const GEN_STYLE_USES = Object.freeze(['figure', 'sheet', 'background', 'cg'])
export const GEN_STYLE_LAYERS = Object.freeze(['all', ...GEN_STYLE_USES])
export const NO_STYLE = 'no-style'
export const FOLLOW_PLUGIN = 'follow-plugin'
// The pack's own background style (manifest.backgroundStyle {prompt, references}) stands for its background value.
export const PACK_BACKGROUND_STYLE = 'pack-background'
// Packs written before presets store one of the four former ids; they read as the plugin presets that replaced them.
const LEGACY_GEN_STYLES = Object.freeze({clean:'galgame-clean', anime:'galgame-anime', polished:'galgame-polished', none:NO_STYLE})
const MAX_CARRIED_STYLES = 8, MAX_CARRIED_BYTES = 64 * 1024

export function validGenStyle(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/.test(value) && value.length <= 80
}
export const genStyleId = value => LEGACY_GEN_STYLES[value] ?? value

export function validateGenStyleValue(value, path = '$.genStyle') {
  if (typeof value === 'string') return check(validGenStyle(value), path, 'Unknown style id')
  check(value && typeof value === 'object' && !Array.isArray(value), path, 'Expected a style id or {all, figure, sheet, background, cg}')
  const keys = Object.keys(value)
  check(keys.length > 0, path, 'An empty style object is written as no value')
  for (const key of keys) {
    check(GEN_STYLE_LAYERS.includes(key), path + '.' + key, 'Unknown use; expected all, figure, sheet, background or cg', 'UNKNOWN_FIELD')
    check(validGenStyle(value[key]), path + '.' + key, 'Unknown style id')
  }
}

/** A stored value as {all?, figure?, sheet?, background?, cg?}, former ids read as their presets. */
export function readGenStyle(value) {
  if (value === undefined || value === null) return {}
  const layers = typeof value === 'string' ? {all:value} : value
  return Object.fromEntries(GEN_STYLE_LAYERS.filter(key => typeof layers[key] === 'string').map(key => [key, genStyleId(layers[key])]))
}

/** The stored value after one layer is set (a style id) or cleared (undefined): only 「全部」 is a plain id, none is undefined. */
export function writeGenStyle(value, layer, style) {
  check(GEN_STYLE_LAYERS.includes(layer), '$.layer', 'Unknown use')
  if (style !== undefined) check(validGenStyle(style), '$.style', 'Unknown style id')
  const next = {...readGenStyle(value), [layer]:style}
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
  const keys = Object.keys(next)
  return !keys.length ? undefined : keys.length === 1 && keys[0] === 'all' ? next.all : next
}

/** A card's or a pack's own style definitions: the image plugin's preset format, ids namespaced as the plugin registers them. */
export function validateCarriedStyles(value, path = '$.styles') {
  assertJson(value)
  check(Array.isArray(value) && value.length <= MAX_CARRIED_STYLES, path, 'Expected at most ' + MAX_CARRIED_STYLES + ' styles')
  check(JSON.stringify(value).length <= MAX_CARRIED_BYTES, path, 'Styles are too large', 'LIMIT_EXCEEDED')
  const seen = new Set()
  value.forEach((style, index) => {
    const at = path + '[' + index + ']'
    check(style && typeof style === 'object' && !Array.isArray(style), at, 'Expected a style preset')
    check(typeof style.id === 'string' && /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(style.id) && style.id.length <= 80, at + '.id',
      'A carried style id is namespaced like the plugin registers it, e.g. triangle-agency.style')
    check(typeof style.name === 'string' && style.name.trim() && style.name.length <= 80, at + '.name', 'Expected a name of 1-80 characters')
    check(!seen.has(style.id), at + '.id', 'Duplicate style id'); seen.add(style.id)
  })
}

/**
 * The one computation of a picture's 画风. use: figure | sheet | background | cg. pack: {genStyle, backgroundStyle, automatic}
 * (null without a pack); card: the card's genStyle value (read only for a card's 自动素材 pack, or with no pack: the card's
 * own pictures, its CG); plugin: the image plugin's current style id, null when it adds none. request: this one request's
 * choice. → {id, from: request | pack | card | plugin, layer: all | use | null}.
 */
export function resolveGenStyle({use, request, pack = null, card, plugin = null}) {
  check(GEN_STYLE_USES.includes(use), '$.use', 'Unknown use')
  const fromPlugin = {id:plugin || NO_STYLE, from:'plugin', layer:null}
  if (request !== undefined) return {id:genStyleId(request), from:'request', layer:null}
  if (pack) {
    const own = readGenStyle(pack.genStyle)
    if (use === 'background' && own.background === undefined && pack.backgroundStyle) return {id:PACK_BACKGROUND_STYLE, from:'pack', layer:'background'}
    const layer = own[use] !== undefined ? use : own.all !== undefined ? 'all' : null
    if (layer) return own[layer] === FOLLOW_PLUGIN ? fromPlugin : {id:own[layer], from:'pack', layer}
    if (!pack.automatic) return fromPlugin
  }
  const own = readGenStyle(card)
  const layer = own[use] !== undefined ? use : own.all !== undefined ? 'all' : null
  return layer && own[layer] !== FOLLOW_PLUGIN ? {id:own[layer], from:'card', layer} : fromPlugin
}
