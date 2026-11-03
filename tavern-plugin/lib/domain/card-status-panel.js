// The card-supplied status panel (extensions.dsh_tavern.statusPanel): presentation-only data the stage
// shows behind the S key and the 「状态」 menu row. Checked once when a card write changes it; reads trust it.
import contract from '../../src/client/widget-contracts.cjs'
import { emptyLedger } from './story-ledger.js'

export const STATUS_PANEL_LEDGER_SECTIONS = Object.freeze(Object.keys(emptyLedger()).filter(name => name !== 'version'))
const KEYS = ['version', 'title', 'html', 'variables', 'ledger', 'figures']
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function invalid(path, message) {
  throw Object.assign(new Error('状态面板 ' + path + '：' + message), { code: 'CARD_STATUS_PANEL_INVALID', path })
}
function text(value, path, max) {
  if (typeof value !== 'string' || !value.trim()) invalid(path, '必须是非空字符串')
  if ([...value].length > max) invalid(path, '最多 ' + max + ' 个字符')
}

export function validateCardStatusPanel(value, path = 'statusPanel') {
  if (!plain(value)) invalid(path, '必须是对象 {version:1, html, …}')
  const unknown = Object.keys(value).find(key => !KEYS.includes(key))
  if (unknown) invalid(path + '.' + unknown, '不认识的字段；可用字段：' + KEYS.join('、'))
  if (value.version !== 1) invalid(path + '.version', '必须是 1')
  if (typeof value.html !== 'string' || !value.html.trim()) invalid(path + '.html', '必须是非空的 HTML 字符串')
  if (value.title !== undefined) text(value.title, path + '.title', 40)
  if (value.variables !== undefined) {
    if (!plain(value.variables) || value.variables.writes !== undefined) invalid(path + '.variables', '只能声明 {reads}；状态面板不写变量')
    try { contract.validateStageWidgetVariables(value.variables) }
    catch (error) { invalid(path + '.variables', error.message + '（同小组件的 reads 声明：{id: {source: "mvu" | "helper-chat", path: "/…"}}，最多 32 项）') }
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
