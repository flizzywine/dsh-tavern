// Presentation declarations are validated only when a card write changes them.
import { emptyLedger } from './story-ledger.js'

export const STATUS_PANEL_LEDGER_SECTIONS = Object.freeze(Object.keys(emptyLedger()).filter(name => name !== 'version'))
export const STATUS_PANEL_SIZES = Object.freeze(['window', 'full'])
export const CARD_PAGE_SHORTCUT_KEYS = Object.freeze([... 'bcdefijkmnopqrstuwxyz'])
const KEYS = ['id', 'label', 'html', 'shortcut', 'menu', 'showOn', 'initial', 'size', 'closeControl', 'ledger', 'preload', 'figures']
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function invalid(path, message) {
  throw Object.assign(new Error('卡页面 ' + path + '：' + message), { code: 'CARD_PAGES_INVALID', path })
}
function text(value, path, max) {
  if (typeof value !== 'string' || !value.trim()) invalid(path, '必须是非空字符串')
  if ([...value].length > max) invalid(path, '最多 ' + max + ' 个字符')
}
export function validateCardPages(value, path = 'pages') {
  if (!Array.isArray(value)) invalid(path, '必须是数组')
  if (value.length > 8) invalid(path + '.8', '最多 8 个页面')
  const ids = new Set(), shortcuts = new Set()
  value.forEach((page, i) => {
    const p = path + '.' + i
    validatePage(page, p)
    if (ids.has(page.id)) invalid(p + '.id', '页面 id 不能重复')
    ids.add(page.id)
    if (page.shortcut !== undefined) {
      if (shortcuts.has(page.shortcut)) invalid(p + '.shortcut', '快捷键不能重复')
      shortcuts.add(page.shortcut)
    }
  })
  return value
}
function validatePage(value, path) {
  if (!plain(value)) invalid(path, '必须是页面对象')
  const unknown = Object.keys(value).find(key => !KEYS.includes(key))
  if (unknown) invalid(path + '.' + unknown, '不认识的字段')
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.id)) invalid(path + '.id', '必须是小写字母开头的页面 id，最多 32 字符')
  text(value.label, path + '.label', 16)
  if (typeof value.html !== 'string' || !value.html.trim()) invalid(path + '.html', '必须是非空的 HTML 字符串')
  if (value.shortcut !== undefined && !CARD_PAGE_SHORTCUT_KEYS.includes(value.shortcut)) invalid(path + '.shortcut', '必须是可用的小写字母快捷键')
  if (value.menu !== undefined && typeof value.menu !== 'boolean') invalid(path + '.menu', '必须是布尔值')
  if (value.showOn !== undefined && (!plain(value.showOn) || value.showOn.event !== 'stage-enter' || Object.keys(value.showOn).some(key => key !== 'event'))) invalid(path + '.showOn', '必须是 {event:"stage-enter"}')
  if (value.initial !== undefined && (value.initial !== true || value.showOn === undefined)) invalid(path + '.initial', '只能是 true，且需要 showOn')
  if (value.size !== undefined && !STATUS_PANEL_SIZES.includes(value.size)) invalid(path + '.size', '只能是 window 或 full')
  if (value.closeControl !== undefined && (value.closeControl !== 'page' || value.size !== 'full')) invalid(path + '.closeControl', '只能是 "page"，且需要 size:"full"')
  if (value.preload !== undefined) {
    if (!Array.isArray(value.preload) || value.preload.length > 8) invalid(path + '.preload', '必须是最多 8 项的数组')
    value.preload.forEach((ref, i) => {
      const p = path + '.preload.' + i
      if (!plain(ref) || Object.keys(ref).some(key => !['kind', 'id', 'variant', 'file', 'size'].includes(key))) invalid(p, '必须是 {kind, id, variant?, file?, size?}')
      text(ref.kind, p + '.kind', 32); text(ref.id, p + '.id', 64)
      for (const key of ['variant', 'file']) if (ref[key] !== undefined) text(ref[key], p + '.' + key, 128)
      if (ref.size !== undefined && ![256, 512, 1024].includes(ref.size)) invalid(p + '.size', '只能是 256、512 或 1024')
    })
  }
  if (value.ledger !== undefined) {
    if (!Array.isArray(value.ledger) || value.ledger.length > 8) invalid(path + '.ledger', '必须是最多 8 项的数组')
    value.ledger.forEach((name, i) => { if (!STATUS_PANEL_LEDGER_SECTIONS.includes(name)) invalid(path + '.ledger.' + i, '不认识的账本分区；可用：' + STATUS_PANEL_LEDGER_SECTIONS.join('、')) })
    if (new Set(value.ledger).size !== value.ledger.length) invalid(path + '.ledger', '分区不能重复')
  }
  if (value.figures !== undefined) {
    if (!Array.isArray(value.figures) || value.figures.length > 8) invalid(path + '.figures', '必须是最多 8 项的数组')
    value.figures.forEach((figure, i) => {
      const p = path + '.figures.' + i
      if (!plain(figure) || Object.keys(figure).some(key => !['name', 'emotion'].includes(key))) invalid(p, '必须是 {name, emotion?}')
      text(figure.name, p + '.name', 40)
      if (figure.emotion !== undefined) text(figure.emotion, p + '.emotion', 24)
    })
    if (new Set(value.figures.map(figure => figure.name)).size !== value.figures.length) invalid(path + '.figures', '人物不能重复')
  }
  return value
}
